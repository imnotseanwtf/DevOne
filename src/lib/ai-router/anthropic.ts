/**
 * Anthropic Messages <-> OpenAI chat completions, so tools that only speak
 * Anthropic's API (Claude Code) can use the router. A Messages request is
 * turned into a chat completion, and the provider's answer, whole or
 * streamed, is turned back. Pure functions, checked without a network.
 */

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function blocksOf(content: unknown): Json[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return Array.isArray(content) ? content.filter(isObject) : [];
}

function textOf(content: unknown): string {
  return blocksOf(content)
    .map((block) => (block.type === 'text' && typeof block.text === 'string' ? block.text : ''))
    .join('');
}

function imagePart(block: Json): Json | null {
  const source = block.source;
  if (!isObject(source)) return null;
  if (source.type === 'base64' && typeof source.data === 'string') {
    return {
      type: 'image_url',
      image_url: {
        url: `data:${String(source.media_type ?? 'image/png')};base64,${source.data}`
      }
    };
  }
  if (source.type === 'url' && typeof source.url === 'string') {
    return { type: 'image_url', image_url: { url: source.url } };
  }
  return null;
}

function toolResultText(block: Json): string {
  const text = textOf(block.content);
  return block.is_error === true ? `Error: ${text}` : text;
}

function convertMessage(message: Json): Json[] {
  const role = message.role === 'assistant' ? 'assistant' : 'user';
  const blocks = blocksOf(message.content);

  if (role === 'assistant') {
    const text = blocks
      .filter((block) => block.type === 'text')
      .map((block) => String(block.text ?? ''))
      .join('');
    const toolCalls = blocks
      .filter((block) => block.type === 'tool_use')
      .map((block) => ({
        id: String(block.id ?? ''),
        type: 'function',
        function: {
          name: String(block.name ?? ''),
          arguments: JSON.stringify(block.input ?? {})
        }
      }));
    return [
      {
        role: 'assistant',
        content: text || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {})
      }
    ];
  }

  // Tool results come first: OpenAI wants them straight after the assistant's calls.
  const out: Json[] = blocks
    .filter((block) => block.type === 'tool_result')
    .map((block) => ({
      role: 'tool',
      tool_call_id: String(block.tool_use_id ?? ''),
      content: toolResultText(block)
    }));
  const parts = blocks.flatMap((block): Json[] => {
    if (block.type === 'text') return [{ type: 'text', text: String(block.text ?? '') }];
    if (block.type === 'image') {
      const part = imagePart(block);
      return part ? [part] : [];
    }
    return [];
  });
  if (parts.length > 0) {
    const onlyText = parts.every((part) => part.type === 'text');
    out.push({
      role: 'user',
      content: onlyText ? parts.map((part) => String(part.text)).join('\n') : parts
    });
  }
  return out;
}

function convertToolChoice(choice: unknown): unknown {
  if (!isObject(choice)) return undefined;
  if (choice.type === 'auto') return 'auto';
  if (choice.type === 'any') return 'required';
  if (choice.type === 'none') return 'none';
  if (choice.type === 'tool' && typeof choice.name === 'string') {
    return { type: 'function', function: { name: choice.name } };
  }
  return undefined;
}

/** An Anthropic Messages request as an OpenAI chat completion request. */
export function anthropicToOpenAI(body: Json): Json {
  const messages: Json[] = [];
  const system = textOf(body.system);
  if (system) messages.push({ role: 'system', content: system });
  if (Array.isArray(body.messages)) {
    for (const message of body.messages.filter(isObject)) messages.push(...convertMessage(message));
  }

  const tools = Array.isArray(body.tools)
    ? body.tools.filter(isObject).map((tool) => ({
        type: 'function',
        function: {
          name: String(tool.name ?? ''),
          description: typeof tool.description === 'string' ? tool.description : undefined,
          parameters: isObject(tool.input_schema) ? tool.input_schema : { type: 'object' }
        }
      }))
    : [];

  const out: Json = { model: body.model, messages };
  if (typeof body.max_tokens === 'number') out.max_tokens = body.max_tokens;
  if (typeof body.temperature === 'number') out.temperature = body.temperature;
  if (typeof body.top_p === 'number') out.top_p = body.top_p;
  if (Array.isArray(body.stop_sequences) && body.stop_sequences.length > 0) {
    out.stop = body.stop_sequences;
  }
  if (body.stream === true) out.stream = true;
  if (tools.length > 0) {
    out.tools = tools;
    const toolChoice = convertToolChoice(body.tool_choice);
    if (toolChoice !== undefined) out.tool_choice = toolChoice;
  }
  return out;
}

const STOP_REASONS: Record<string, string> = {
  stop: 'end_turn',
  length: 'max_tokens',
  tool_calls: 'tool_use',
  function_call: 'tool_use',
  content_filter: 'end_turn'
};

export function stopReason(finish: unknown): string {
  return typeof finish === 'string' ? (STOP_REASONS[finish] ?? 'end_turn') : 'end_turn';
}

function parseArguments(value: unknown): unknown {
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

const numberOr = (value: unknown, fallback: number) =>
  typeof value === 'number' ? value : fallback;

/** A whole OpenAI chat completion as an Anthropic message. */
export function openAIToAnthropic(completion: Json, requestedModel: string): Json {
  const choice =
    Array.isArray(completion.choices) && isObject(completion.choices[0])
      ? completion.choices[0]
      : {};
  const message = isObject(choice.message) ? choice.message : {};
  const content: Json[] = [];
  if (typeof message.content === 'string' && message.content) {
    content.push({ type: 'text', text: message.content });
  }
  if (Array.isArray(message.tool_calls)) {
    for (const call of message.tool_calls.filter(isObject)) {
      const fn = isObject(call.function) ? call.function : {};
      content.push({
        type: 'tool_use',
        id: String(call.id ?? ''),
        name: String(fn.name ?? ''),
        input: parseArguments(fn.arguments)
      });
    }
  }
  if (content.length === 0) content.push({ type: 'text', text: '' });
  const usage = isObject(completion.usage) ? completion.usage : {};
  return {
    id: `msg_${String(completion.id ?? Date.now()).replace(/^chatcmpl-/, '')}`,
    type: 'message',
    role: 'assistant',
    model: requestedModel,
    content,
    stop_reason: stopReason(choice.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: numberOr(usage.prompt_tokens, 0),
      output_tokens: numberOr(usage.completion_tokens, 0)
    }
  };
}

const ERROR_TYPES: Record<number, string> = {
  400: 'invalid_request_error',
  401: 'authentication_error',
  403: 'permission_error',
  404: 'not_found_error',
  413: 'request_too_large',
  429: 'rate_limit_error'
};

/** An error body in Anthropic's shape. */
export function anthropicError(status: number, message: string): Json {
  return {
    type: 'error',
    error: {
      type: ERROR_TYPES[status] ?? (status >= 500 ? 'api_error' : 'invalid_request_error'),
      message
    }
  };
}

/** The message from an OpenAI-style (or DevOne router) error body. */
export function errorMessage(body: unknown, fallback: string): string {
  if (isObject(body) && isObject(body.error) && typeof body.error.message === 'string') {
    return body.error.message;
  }
  return fallback;
}

/** A rough token estimate (about four characters a token) for count_tokens. */
export function estimateTokens(body: Json): number {
  return Math.ceil(JSON.stringify([body.system, body.messages, body.tools]).length / 4);
}

const sse = (event: string, data: Json) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/**
 * Turns OpenAI streaming chunks into Anthropic stream events. Feed each
 * parsed chunk to `push`, then call `finish` once at the end.
 */
export class OpenAIToAnthropicStream {
  private started = false;
  private nextIndex = 0;
  private open: { index: number; kind: 'text' | 'tool' } | null = null;
  private tools = new Map<number, number>();
  private finishReason: unknown = null;
  private inputTokens = 0;
  private outputTokens = 0;
  private ended = false;

  constructor(private readonly model: string) {}

  private start(id: unknown): string {
    if (this.started) return '';
    this.started = true;
    return sse('message_start', {
      type: 'message_start',
      message: {
        id: `msg_${String(id ?? Date.now()).replace(/^chatcmpl-/, '')}`,
        type: 'message',
        role: 'assistant',
        model: this.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: this.inputTokens, output_tokens: 0 }
      }
    });
  }

  private close(): string {
    if (!this.open) return '';
    const event = sse('content_block_stop', {
      type: 'content_block_stop',
      index: this.open.index
    });
    this.open = null;
    return event;
  }

  push(chunk: Json): string {
    let out = this.start(chunk.id);
    if (isObject(chunk.usage)) {
      this.inputTokens = numberOr(chunk.usage.prompt_tokens, this.inputTokens);
      this.outputTokens = numberOr(chunk.usage.completion_tokens, this.outputTokens);
    }
    const choice =
      Array.isArray(chunk.choices) && isObject(chunk.choices[0]) ? chunk.choices[0] : null;
    if (!choice) return out;
    if (choice.finish_reason) this.finishReason = choice.finish_reason;
    const delta = isObject(choice.delta) ? choice.delta : {};

    if (typeof delta.content === 'string' && delta.content) {
      if (this.open?.kind !== 'text') {
        out += this.close();
        this.open = { index: this.nextIndex++, kind: 'text' };
        out += sse('content_block_start', {
          type: 'content_block_start',
          index: this.open.index,
          content_block: { type: 'text', text: '' }
        });
      }
      out += sse('content_block_delta', {
        type: 'content_block_delta',
        index: this.open.index,
        delta: { type: 'text_delta', text: delta.content }
      });
    }

    if (Array.isArray(delta.tool_calls)) {
      for (const call of delta.tool_calls.filter(isObject)) {
        const position = numberOr(call.index, 0);
        const fn = isObject(call.function) ? call.function : {};
        let index = this.tools.get(position);
        if (index === undefined) {
          out += this.close();
          index = this.nextIndex++;
          this.tools.set(position, index);
          this.open = { index, kind: 'tool' };
          out += sse('content_block_start', {
            type: 'content_block_start',
            index,
            content_block: {
              type: 'tool_use',
              id: String(call.id ?? `toolu_${index}`),
              name: String(fn.name ?? ''),
              input: {}
            }
          });
        }
        if (typeof fn.arguments === 'string' && fn.arguments) {
          out += sse('content_block_delta', {
            type: 'content_block_delta',
            index,
            delta: { type: 'input_json_delta', partial_json: fn.arguments }
          });
        }
      }
    }
    return out;
  }

  /** The closing events; safe to call more than once. */
  finish(): string {
    if (this.ended) return '';
    this.ended = true;
    let out = this.start(null) + this.close();
    out += sse('message_delta', {
      type: 'message_delta',
      delta: {
        stop_reason: stopReason(this.finishReason),
        stop_sequence: null
      },
      usage: {
        input_tokens: this.inputTokens,
        output_tokens: this.outputTokens
      }
    });
    return out + sse('message_stop', { type: 'message_stop' });
  }

  /** An error mid-stream, in Anthropic's shape. */
  fail(message: string): string {
    this.ended = true;
    return sse('error', anthropicError(500, message));
  }
}

/** Wraps an OpenAI SSE body so the client receives Anthropic stream events. */
export function translateStream(
  body: ReadableStream<Uint8Array>,
  model: string
): ReadableStream<Uint8Array> {
  const translator = new OpenAIToAnthropicStream(model);
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';

  const handleLine = (line: string): string => {
    if (!line.startsWith('data:')) return '';
    const data = line.slice(5).trim();
    if (!data) return '';
    if (data === '[DONE]') return translator.finish();
    try {
      const parsed = JSON.parse(data) as unknown;
      if (isObject(parsed) && isObject(parsed.error) && !parsed.choices) {
        return translator.fail(errorMessage(parsed, 'The provider reported an error'));
      }
      return isObject(parsed) ? translator.push(parsed) : '';
    } catch {
      return '';
    }
  };

  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        const out = lines.map(handleLine).join('');
        if (out) controller.enqueue(encoder.encode(out));
      },
      flush(controller) {
        const out = handleLine(buffer + decoder.decode()) + translator.finish();
        if (out) controller.enqueue(encoder.encode(out));
      }
    })
  );
}
