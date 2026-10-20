import {
  ProtocolError,
  object,
  finishReason,
  normalizedUsage,
  translateResponse,
  type JsonObject
} from './translation';
import type { ProviderFormat } from './types';
import type { UpstreamExecution } from './executors';

export interface SseEvent {
  event: string;
  data: string;
}
/** Handles CR/LF, fragmented UTF8, multiline data, and a final frame without a blank line. */
export class SseReader {
  private decoder = new TextDecoder();
  private text = '';
  private data: string[] = [];
  private event = '';
  private bytes = 0;
  private restoredEnd = false;
  constructor(private execution: UpstreamExecution) {}
  async *events(): AsyncGenerator<SseEvent> {
    while (true) {
      const result = await this.execution.read();
      this.text += result.done
        ? this.decoder.decode()
        : this.decoder.decode(result.value, { stream: true });
      while (true) {
        const match = /\r\n|\r|\n/.exec(this.text);
        if (!match || (!result.done && match[0] === '\r' && match.index === this.text.length - 1))
          break;
        const line = this.text.slice(0, match.index);
        this.text = this.text.slice(match.index + match[0].length);
        const frame = this.line(line);
        if (frame) yield* this.complete(frame);
      }
      if (this.text.length + this.bytes > 1024 * 1024)
        throw new ProtocolError('Upstream SSE frame too large', 502);
      if (result.done) {
        if (this.text) {
          const frame = this.line(this.text);
          if (frame) yield* this.complete(frame);
        }
        const frame = this.line('');
        if (frame) yield* this.complete(frame);
        yield* this.finalize();
        return;
      }
    }
  }
  private *finalize(): Generator<SseEvent> {
    if (this.restoredEnd) return;
    this.restoredEnd = true;
    const payload = this.execution.finishRestore?.();
    if (payload) yield { event: '', data: JSON.stringify(payload) };
  }
  private *complete(frame: SseEvent): Generator<SseEvent> {
    if (frame.data === '[DONE]') yield* this.finalize();
    yield frame;
  }
  private line(line: string): SseEvent | null {
    if (!line) {
      const frame = this.data.length ? { event: this.event, data: this.data.join('\n') } : null;
      this.data = [];
      this.event = '';
      this.bytes = 0;
      if (frame && this.execution.restore && frame.data !== '[DONE]') {
        let parsed: JsonObject;
        try {
          parsed = object(JSON.parse(frame.data));
        } catch {
          // The normalizer reports malformed upstream data with the usual fallback policy.
          return frame;
        }
        frame.data = JSON.stringify(this.execution.restore(parsed));
      }
      return frame;
    }
    if (line.startsWith(':')) return null;
    const colon = line.indexOf(':');
    const key = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (key === 'data') {
      this.data.push(value);
      this.bytes += value.length;
    }
    if (key === 'event') this.event = value;
    if (this.bytes > 1024 * 1024) throw new ProtocolError('Upstream SSE frame too large', 502);
    return null;
  }
}
export function upstreamError(body: JsonObject, event = ''): ProtocolError | null {
  if (!body.error && event !== 'error' && body.type !== 'error' && body.type !== 'response.failed')
    return null;
  const response =
    body.response && typeof body.response === 'object' ? object(body.response) : body;
  const raw = response.error ?? body.error;
  const error =
    typeof raw === 'string' ? { message: raw } : raw && typeof raw === 'object' ? object(raw) : {};
  const kind = String(error.type ?? error.code ?? '');
  const supplied =
    error.status ??
    error.status_code ??
    (typeof error.code === 'number' ? error.code : body.status);
  const status =
    typeof supplied === 'number' && supplied >= 400 && supplied <= 599
      ? supplied
      : /rate_limit/.test(kind)
        ? 429
        : /authentication|invalid_api_key/.test(kind)
          ? 401
          : /permission/.test(kind)
            ? 403
            : /invalid_request/.test(kind)
              ? 400
              : /overload/.test(kind)
                ? 529
                : 502;
  return new ProtocolError(
    typeof error.message === 'string' ? error.message : 'Upstream stream failed',
    status
  );
}
export class ChatStreamTranslator {
  id = 'chatcmpl-devone';
  model = '';
  usage: JsonObject | undefined;
  ended = false;
  private tools = new Map<number, { index: number; id: string; name: string; deltas: boolean }>();
  private toolCount = 0;
  private text = false;
  private reasoning = false;
  constructor(
    private format: ProviderFormat,
    private nativePassthrough = false
  ) {}
  private chunk(delta: JsonObject = {}, reason: unknown = null, usage?: JsonObject): JsonObject {
    return {
      id: this.id,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: this.model,
      choices: [{ index: 0, delta, finish_reason: reason }],
      ...(usage ? { usage } : {})
    };
  }
  accept(event: SseEvent): (JsonObject | 'DONE')[] {
    try {
      return this.translate(event);
    } catch (error) {
      if (error instanceof ProtocolError && error.status === 400)
        throw new ProtocolError(error.message, 502);
      throw error;
    }
  }
  private translate(event: SseEvent): (JsonObject | 'DONE')[] {
    if (event.data === '[DONE]') {
      this.ended = true;
      return ['DONE'];
    }
    let body: JsonObject;
    try {
      body = object(JSON.parse(event.data));
    } catch {
      throw new ProtocolError('Malformed upstream SSE JSON', 502);
    }
    const failure = upstreamError(body, event.event);
    if (failure) throw failure;
    if (this.format === 'openai') {
      if (typeof body.id === 'string') this.id = body.id;
      if (typeof body.model === 'string') this.model = body.model;
      this.usage = normalizedUsage(body.usage) ?? this.usage;
      return [body];
    }
    const type = body.type ?? event.event;
    if (this.nativePassthrough) {
      const envelope = body.response ?? body.message;
      if (envelope && typeof envelope === 'object') {
        const message = object(envelope);
        this.id = String(message.id ?? this.id);
        this.model = String(message.model ?? this.model);
        this.usage = normalizedUsage(message.usage) ?? this.usage;
      }
      if (body.usage)
        this.usage =
          normalizedUsage({ input_tokens: this.usage?.prompt_tokens, ...object(body.usage) }) ??
          this.usage;
      const terminal = ['message_stop', 'response.completed', 'response.incomplete'].includes(
        String(type)
      );
      if (terminal) this.ended = true;
      return terminal ? [{ $native: event }, 'DONE'] : [{ $native: event }];
    }
    if (this.format === 'claude') {
      if (type === 'message_start') {
        const message = object(body.message);
        this.id = String(message.id ?? this.id);
        this.model = String(message.model ?? '');
        this.usage = normalizedUsage(message.usage);
        return [this.chunk({ role: 'assistant', content: '' })];
      }
      if (type === 'content_block_start') {
        const block = object(body.content_block),
          index = Number(body.index);
        if (block.type === 'tool_use') {
          const tool = {
            index: this.toolCount++,
            id: String(block.id),
            name: String(block.name),
            deltas: false
          };
          this.tools.set(index, tool);
          const input =
            block.input && typeof block.input === 'object' && Object.keys(block.input).length
              ? JSON.stringify(block.input)
              : '';
          tool.deltas = Boolean(input);
          return [
            this.chunk({
              tool_calls: [
                {
                  index: tool.index,
                  id: tool.id,
                  type: 'function',
                  function: { name: tool.name, arguments: input }
                }
              ]
            })
          ];
        }
        if (block.type === 'thinking') {
          if (
            typeof block.thinking !== 'string' ||
            (block.signature !== undefined && typeof block.signature !== 'string')
          )
            throw new ProtocolError('Invalid thinking block', 502);
          return block.thinking ? [this.chunk({ reasoning_content: block.thinking })] : [];
        }
        if (block.type === 'redacted_thinking') {
          if (typeof block.data !== 'string')
            throw new ProtocolError('Invalid redacted thinking block', 502);
          return [];
        }
        if (block.type !== 'text')
          throw new ProtocolError(`Unsupported streamed content: ${String(block.type)}`, 502);
        return block.text ? [this.chunk({ content: block.text })] : [];
      }
      if (type === 'content_block_delta') {
        const delta = object(body.delta);
        if (delta.type === 'text_delta') return [this.chunk({ content: delta.text })];
        if (delta.type === 'thinking_delta') {
          if (typeof delta.thinking !== 'string')
            throw new ProtocolError('Invalid thinking delta', 502);
          return [this.chunk({ reasoning_content: delta.thinking })];
        }
        if (delta.type === 'signature_delta') {
          if (typeof delta.signature !== 'string')
            throw new ProtocolError('Invalid thinking signature delta', 502);
          return [];
        }
        if (delta.type === 'input_json_delta') {
          const tool = this.tools.get(Number(body.index));
          if (!tool) throw new ProtocolError('Tool delta without tool start', 502);
          tool.deltas = true;
          return [
            this.chunk({
              tool_calls: [{ index: tool.index, function: { arguments: delta.partial_json } }]
            })
          ];
        }
        throw new ProtocolError(`Unsupported streamed delta: ${String(delta.type)}`, 502);
      }
      if (type === 'content_block_stop') {
        const tool = this.tools.get(Number(body.index));
        if (tool && !tool.deltas) {
          tool.deltas = true;
          return [
            this.chunk({ tool_calls: [{ index: tool.index, function: { arguments: '{}' } }] })
          ];
        }
        return [];
      }
      if (type === 'message_delta') {
        const usage = body.usage ? object(body.usage) : {};
        this.usage =
          normalizedUsage({ input_tokens: this.usage?.prompt_tokens, ...usage }) ?? this.usage;
        return [this.chunk({}, finishReason(object(body.delta).stop_reason), this.usage)];
      }
      if (type === 'message_stop') {
        this.ended = true;
        return ['DONE'];
      }
      return [];
    }
    if (type === 'response.created' || type === 'response.in_progress') {
      const response = object(body.response);
      this.id = String(response.id ?? this.id);
      this.model = String(response.model ?? this.model);
      return [];
    }
    if (type === 'response.output_item.added') {
      const item = object(body.item);
      if (item.type === 'function_call') {
        const tool = {
          index: this.toolCount++,
          id: String(item.call_id),
          name: String(item.name),
          deltas: false
        };
        this.tools.set(Number(body.output_index), tool);
        return [
          this.chunk({
            tool_calls: [
              {
                index: tool.index,
                id: tool.id,
                type: 'function',
                function: { name: tool.name, arguments: item.arguments ?? '' }
              }
            ]
          })
        ];
      }
      if (item.type === 'reasoning') return [];
      if (item.type !== 'message')
        throw new ProtocolError(`Unsupported response output: ${String(item.type)}`, 502);
      return [];
    }
    if (
      type === 'response.reasoning_summary_text.delta' ||
      type === 'response.reasoning_text.delta'
    ) {
      this.reasoning = true;
      return [this.chunk({ reasoning_content: body.delta })];
    }
    if (type === 'response.output_text.delta') {
      this.text = true;
      return [this.chunk({ content: body.delta })];
    }
    if (type === 'response.refusal.delta') return [this.chunk({ refusal: body.delta })];
    if (type === 'response.function_call_arguments.delta') {
      const tool = this.tools.get(Number(body.output_index));
      if (!tool) throw new ProtocolError('Tool delta without tool start', 502);
      tool.deltas = true;
      return [
        this.chunk({ tool_calls: [{ index: tool.index, function: { arguments: body.delta } }] })
      ];
    }
    if (type === 'response.function_call_arguments.done') {
      const tool = this.tools.get(Number(body.output_index));
      return tool && !tool.deltas
        ? [
            this.chunk({
              tool_calls: [{ index: tool.index, function: { arguments: body.arguments } }]
            })
          ]
        : [];
    }
    if (type === 'response.completed' || type === 'response.incomplete') {
      const response = object(body.response);
      this.usage = normalizedUsage(response.usage);
      this.ended = true;
      const chunks: (JsonObject | 'DONE')[] = [];
      if (
        !this.text &&
        !this.reasoning &&
        !this.toolCount &&
        Array.isArray(response.output) &&
        response.output.length
      ) {
        const chat = translateResponse(response, 'openai-responses', 'openai');
        const choice = object((chat.choices as unknown[])[0]);
        chunks.push(this.chunk(object(choice.message)));
      }
      chunks.push(
        this.chunk(
          {},
          type === 'response.incomplete' ? 'length' : this.toolCount ? 'tool_calls' : 'stop',
          this.usage
        ),
        'DONE'
      );
      return chunks;
    }
    if (
      /^response\.reasoning_summary_part\.(?:added|done)$/.test(String(type)) ||
      /^response\.(?:reasoning_summary_text|reasoning_text)\.done$/.test(String(type))
    )
      return [];
    // Lifecycle-only events carry no content; unsupported new content events fail visibly.
    if (/^response\.(?:reasoning|audio|image|web_search|file_search|computer)/.test(String(type)))
      throw new ProtocolError(`Unsupported response event: ${String(type)}`, 502);
    return [];
  }
}
export function hasOutput(value: JsonObject | 'DONE'): boolean {
  if (value === 'DONE') return true;
  if (value.$native) {
    const frame = value.$native as SseEvent,
      data = object(JSON.parse(frame.data));
    const type = String(data.type ?? frame.event);
    if (['message_stop', 'response.completed', 'response.incomplete'].includes(type)) return true;
    if (type === 'content_block_start') {
      const block = object(data.content_block);
      return Boolean(block.type === 'tool_use' || block.text || block.thinking);
    }
    return /(?:\.delta|content_block_delta)$/.test(type);
  }
  if (!Array.isArray(value.choices)) return false;
  return value.choices.some((raw) => {
    const choice = object(raw),
      delta = choice.delta ? object(choice.delta) : {};
    return Boolean(
      delta.content ||
      delta.reasoning_content ||
      delta.refusal ||
      delta.tool_calls ||
      choice.finish_reason
    );
  });
}

/** Buffer native Claude SSE without losing signed thinking, redacted data or block order. */
export class ClaudeAccumulator {
  private message: JsonObject | undefined;
  private blocks = new Map<number, JsonObject>();
  private inputs = new Map<number, string>();
  private size = 0;

  accept(chunk: JsonObject): void {
    try {
      this.append(chunk);
    } catch (error) {
      if (error instanceof SyntaxError || (error instanceof ProtocolError && error.status === 400))
        throw new ProtocolError('Malformed upstream Claude stream', 502);
      throw error;
    }
  }

  private append(chunk: JsonObject): void {
    const frame = chunk.$native as SseEvent;
    this.size += frame.data.length;
    if (this.size > 16 * 1024 * 1024) throw new ProtocolError('Upstream answer too large', 502);
    const body = object(JSON.parse(frame.data));
    const type = body.type ?? frame.event;
    if (type === 'message_start') {
      this.message = structuredClone(object(body.message));
    } else if (type === 'content_block_start') {
      const index = Number(body.index);
      if (!Number.isSafeInteger(index) || index < 0 || this.blocks.has(index))
        throw new ProtocolError('Invalid Claude content block index', 502);
      this.blocks.set(index, structuredClone(object(body.content_block)));
    } else if (type === 'content_block_delta') {
      const index = Number(body.index),
        block = this.blocks.get(index),
        delta = object(body.delta);
      if (!block) throw new ProtocolError('Content delta without block start', 502);
      const field =
        delta.type === 'text_delta'
          ? 'text'
          : delta.type === 'thinking_delta'
            ? 'thinking'
            : delta.type === 'signature_delta'
              ? 'signature'
              : null;
      if (field && typeof delta[field] === 'string')
        block[field] = String(block[field] ?? '') + delta[field];
      else if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string')
        this.inputs.set(index, (this.inputs.get(index) ?? '') + delta.partial_json);
      else if (delta.type === 'citations_delta' && delta.citation)
        block.citations = [
          ...(Array.isArray(block.citations) ? block.citations : []),
          delta.citation
        ];
      else throw new ProtocolError('Unsupported Claude content delta', 502);
    } else if (type === 'message_delta') {
      if (!this.message) throw new ProtocolError('Claude stream missing message start', 502);
      this.message = {
        ...this.message,
        ...object(body.delta),
        usage: { ...object(this.message.usage ?? {}), ...object(body.usage ?? {}) }
      };
    }
  }

  answer(): JsonObject {
    if (!this.message) throw new ProtocolError('Claude stream missing message start', 502);
    const content = [...this.blocks]
      .toSorted(([left], [right]) => left - right)
      .map(([index, block]) => {
        const input = this.inputs.get(index);
        if (input !== undefined) {
          try {
            block.input = object(JSON.parse(input));
          } catch {
            throw new ProtocolError('Invalid Claude tool input', 502);
          }
        }
        return block;
      });
    return { ...this.message, content };
  }
}
/** Builds a JSON completion when a provider requires streaming for a nonstream client. */
export class ChatAccumulator {
  private body: JsonObject = {
    id: 'chatcmpl-devone',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: ''
  };
  private text = '';
  private reasoning = '';
  private calls = new Map<number, JsonObject>();
  private reason: unknown = null;
  private size = 0;
  accept(chunk: JsonObject): void {
    this.size += JSON.stringify(chunk).length;
    if (this.size > 16 * 1024 * 1024) throw new ProtocolError('Upstream answer too large', 502);
    for (const key of ['id', 'model', 'created'])
      if (chunk[key] !== undefined) this.body[key] = chunk[key];
    if (chunk.usage) this.body.usage = chunk.usage;
    for (const raw of Array.isArray(chunk.choices) ? chunk.choices : []) {
      const choice = object(raw);
      if (choice.index !== undefined && choice.index !== 0)
        throw new ProtocolError('Unsupported multiple completions', 502);
      const delta = choice.delta ? object(choice.delta) : {};
      if (delta.refusal || delta.audio)
        throw new ProtocolError('Unsupported streamed content across protocols', 502);
      if (typeof delta.content === 'string') this.text += delta.content;
      if (delta.reasoning_content !== undefined) {
        if (typeof delta.reasoning_content !== 'string')
          throw new ProtocolError('Unsupported reasoning content', 502);
        this.reasoning += delta.reasoning_content;
      }
      if (choice.finish_reason != null) this.reason = choice.finish_reason;
      for (const rawTool of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
        const tool = object(rawTool),
          index = Number(tool.index ?? 0),
          existing = this.calls.get(index) ?? {
            id: '',
            type: 'function',
            function: { name: '', arguments: '' }
          };
        if (tool.id) existing.id = tool.id;
        const fn = object(existing.function),
          incoming = tool.function ? object(tool.function) : {};
        if (incoming.name) fn.name = String(fn.name) + incoming.name;
        if (incoming.arguments) fn.arguments = String(fn.arguments) + incoming.arguments;
        this.calls.set(index, existing);
      }
    }
  }
  answer(): JsonObject {
    return {
      ...this.body,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: this.text || (this.calls.size ? null : ''),
            ...(this.reasoning ? { reasoning_content: this.reasoning } : {}),
            ...(this.calls.size ? { tool_calls: [...this.calls.values()] } : {})
          },
          finish_reason: this.reason ?? (this.calls.size ? 'tool_calls' : 'stop')
        }
      ]
    };
  }
}
const encoder = new TextEncoder();
export function encodeSse(value: JsonObject | 'DONE', event?: string): Uint8Array {
  return encoder.encode(
    `${event ? `event: ${event}\n` : ''}data: ${value === 'DONE' ? '[DONE]' : JSON.stringify(value)}\n\n`
  );
}

interface ClientOutputBlock {
  index: number;
  id: string;
  name?: string;
  text: string;
  tool: boolean;
  reasoning?: boolean;
}

/** Emits native client protocol events from chat deltas. */
export class ClientStreamTranslator {
  private started = false;
  private accumulator = new ChatAccumulator();
  private blocks = new Map<string, ClientOutputBlock>();
  private id = 'chatcmpl-devone';
  private model = '';
  private usage: JsonObject | undefined;
  private reason: unknown = 'stop';
  constructor(
    private format: ProviderFormat,
    private nativePassthrough = false
  ) {}
  accept(value: JsonObject | 'DONE'): Uint8Array[] {
    if (this.nativePassthrough) {
      if (value === 'DONE') return [];
      const frame = value.$native as SseEvent;
      return [
        encoder.encode(
          `${frame.event ? `event: ${frame.event}\n` : ''}${frame.data
            .split('\n')
            .map((line) => `data: ${line}`)
            .join('\n')}\n\n`
        )
      ];
    }
    if (this.format === 'openai') return [encodeSse(value)];
    const output: Uint8Array[] = [];
    const event = (type: string, fields: JsonObject = {}) =>
      output.push(encodeSse({ type, ...fields }, type));
    if (value !== 'DONE') {
      if (this.format === 'claude') {
        for (const raw of Array.isArray(value.choices) ? value.choices : []) {
          const choice = object(raw),
            delta = choice.delta ? object(choice.delta) : {};
          if (delta.reasoning_content !== undefined && delta.reasoning_content !== '')
            throw new ProtocolError('Unsupported reasoning content for Claude', 502);
        }
      }
      if (value.id) this.id = String(value.id);
      if (value.model) this.model = String(value.model);
      if (value.usage) this.usage = normalizedUsage(value.usage);
      this.accumulator.accept(value);
    }
    if (!this.started) {
      this.started = true;
      if (this.format === 'claude')
        event('message_start', {
          message: {
            id: this.id,
            type: 'message',
            role: 'assistant',
            model: this.model,
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: this.usage?.prompt_tokens ?? 0, output_tokens: 0 }
          }
        });
      else
        event('response.created', {
          response: {
            id: this.id,
            object: 'response',
            model: this.model,
            status: 'in_progress',
            output: []
          }
        });
    }
    if (value === 'DONE') {
      const terminalOutput: JsonObject[] = [];
      for (const block of this.blocks.values()) {
        if (this.format === 'claude') event('content_block_stop', { index: block.index });
        else if (block.tool) {
          event('response.function_call_arguments.done', {
            output_index: block.index,
            item_id: block.id,
            arguments: block.text
          });
        } else if (block.reasoning) {
          event('response.reasoning_summary_text.done', {
            output_index: block.index,
            item_id: block.id,
            summary_index: 0,
            text: block.text
          });
          event('response.reasoning_summary_part.done', {
            output_index: block.index,
            item_id: block.id,
            summary_index: 0,
            part: { type: 'summary_text', text: block.text }
          });
        } else {
          event('response.output_text.done', {
            output_index: block.index,
            item_id: block.id,
            content_index: 0,
            text: block.text
          });
          event('response.content_part.done', {
            output_index: block.index,
            item_id: block.id,
            content_index: 0,
            part: { type: 'output_text', text: block.text, annotations: [] }
          });
        }
        if (this.format === 'openai-responses') {
          const item = this.completedItem(block);
          event('response.output_item.done', { output_index: block.index, item });
          terminalOutput.push(item);
        }
      }
      if (this.format === 'claude') {
        event('message_delta', {
          delta: {
            stop_reason:
              this.reason === 'tool_calls'
                ? 'tool_use'
                : this.reason === 'length'
                  ? 'max_tokens'
                  : this.reason === 'content_filter'
                    ? 'refusal'
                    : 'end_turn',
            stop_sequence: null
          },
          usage: {
            input_tokens: this.usage?.prompt_tokens ?? 0,
            output_tokens: this.usage?.completion_tokens ?? 0
          }
        });
        event('message_stop');
      } else {
        const response = translateResponse(this.accumulator.answer(), 'openai', 'openai-responses');
        response.output = terminalOutput;
        event(this.reason === 'length' ? 'response.incomplete' : 'response.completed', {
          response
        });
      }
      return output;
    }
    for (const raw of Array.isArray(value.choices) ? value.choices : []) {
      const choice = object(raw),
        delta = choice.delta ? object(choice.delta) : {};
      if (choice.finish_reason) this.reason = choice.finish_reason;
      if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
        let block = this.blocks.get('reasoning');
        if (!block) {
          block = {
            index: this.blocks.size,
            id: `${this.id}_reasoning`,
            text: '',
            tool: false,
            reasoning: true
          };
          this.blocks.set('reasoning', block);
          event('response.output_item.added', {
            output_index: block.index,
            item: { id: block.id, type: 'reasoning', summary: [] }
          });
          event('response.reasoning_summary_part.added', {
            output_index: block.index,
            item_id: block.id,
            summary_index: 0,
            part: { type: 'summary_text', text: '' }
          });
        }
        block.text += delta.reasoning_content;
        event('response.reasoning_summary_text.delta', {
          output_index: block.index,
          item_id: block.id,
          summary_index: 0,
          delta: delta.reasoning_content
        });
      }
      if (typeof delta.content === 'string' && delta.content) {
        let block = this.blocks.get('text');
        if (!block) {
          block = { index: this.blocks.size, id: `${this.id}_message`, text: '', tool: false };
          this.blocks.set('text', block);
          if (this.format === 'claude')
            event('content_block_start', {
              index: block.index,
              content_block: { type: 'text', text: '' }
            });
          else {
            event('response.output_item.added', {
              output_index: block.index,
              item: {
                id: block.id,
                type: 'message',
                role: 'assistant',
                status: 'in_progress',
                content: []
              }
            });
            event('response.content_part.added', {
              output_index: block.index,
              item_id: block.id,
              content_index: 0,
              part: { type: 'output_text', text: '', annotations: [] }
            });
          }
        }
        block.text += delta.content;
        if (this.format === 'claude')
          event('content_block_delta', {
            index: block.index,
            delta: { type: 'text_delta', text: delta.content }
          });
        else
          event('response.output_text.delta', {
            output_index: block.index,
            item_id: block.id,
            content_index: 0,
            delta: delta.content
          });
      }
      for (const rawTool of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
        const tool = object(rawTool),
          fn = tool.function ? object(tool.function) : {},
          key = `tool:${String(tool.index ?? 0)}`;
        let block = this.blocks.get(key);
        if (!block) {
          if (!tool.id || !fn.name) throw new ProtocolError('Tool stream missing id or name', 502);
          block = {
            index: this.blocks.size,
            id: String(tool.id),
            name: String(fn.name),
            text: '',
            tool: true
          };
          this.blocks.set(key, block);
          if (this.format === 'claude')
            event('content_block_start', {
              index: block.index,
              content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} }
            });
          else
            event('response.output_item.added', {
              output_index: block.index,
              item: {
                id: block.id,
                type: 'function_call',
                call_id: block.id,
                name: block.name,
                arguments: '',
                status: 'in_progress'
              }
            });
        }
        if (typeof fn.arguments === 'string' && fn.arguments) {
          block.text += fn.arguments;
          if (this.format === 'claude')
            event('content_block_delta', {
              index: block.index,
              delta: { type: 'input_json_delta', partial_json: fn.arguments }
            });
          else
            event('response.function_call_arguments.delta', {
              output_index: block.index,
              item_id: block.id,
              delta: fn.arguments
            });
        }
      }
    }
    return output;
  }
  private completedItem(block: ClientOutputBlock): JsonObject {
    if (block.tool)
      return {
        id: block.id,
        type: 'function_call',
        call_id: block.id,
        name: block.name,
        arguments: block.text,
        status: 'completed'
      };
    if (block.reasoning)
      return {
        id: block.id,
        type: 'reasoning',
        summary: [{ type: 'summary_text', text: block.text }]
      };
    return {
      id: block.id,
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: block.text, annotations: [] }]
    };
  }
  error(message: string): Uint8Array[] {
    if (this.format === 'openai')
      return [encodeSse({ error: { message, type: 'upstream_error' } }), encodeSse('DONE')];
    const type = this.format === 'claude' ? 'error' : 'response.failed';
    return [encodeSse({ type, error: { type: 'upstream_error', message } }, type)];
  }
}
