import type { ProviderFormat } from './types';

export class ProtocolError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'ProtocolError';
    this.status = status;
  }
}
export type JsonObject = Record<string, unknown>;
export function object(value: unknown, label = 'object'): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ProtocolError(`Expected ${label}`);
  return value as JsonObject;
}
function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new ProtocolError(`Expected ${label}`);
  return value;
}
function string(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new ProtocolError(`Expected ${label}`);
  return value;
}
function keys(value: JsonObject, supported: string[]): void {
  for (const key of Object.keys(value))
    if (value[key] !== undefined && !supported.includes(key))
      throw new ProtocolError(`Unsupported field: ${key}`);
}
function args(value: unknown): JsonObject {
  try {
    return object(JSON.parse(string(value, 'tool arguments')), 'tool arguments object');
  } catch {
    throw new ProtocolError('Tool arguments must be a JSON object');
  }
}
function chatContent(value: unknown): JsonObject[] {
  if (value == null) return [];
  if (typeof value === 'string') return value ? [{ type: 'text', text: value }] : [];
  return array(value, 'message content').map((item) => {
    const part = object(item, 'content block');
    if (part.type === 'text') {
      keys(part, ['type', 'text']);
      return { type: 'text', text: string(part.text, 'text') };
    }
    if (part.type === 'image_url') {
      keys(part, ['type', 'image_url']);
      const image = object(part.image_url, 'image_url');
      keys(image, ['url', 'detail']);
      string(image.url, 'image URL');
      return part;
    }
    throw new ProtocolError(`Unsupported content type: ${String(part.type)}`);
  });
}
function compactContent(parts: JsonObject[]): unknown {
  if (parts.every((part) => part.type === 'text')) return parts.map((part) => part.text).join('');
  return parts;
}
function claudeContent(parts: JsonObject[]): JsonObject[] {
  return parts.map((part) => {
    if (part.type === 'text') return part;
    const image = object(part.image_url);
    if (image.detail !== undefined && image.detail !== 'auto')
      throw new ProtocolError('Unsupported image detail for Claude');
    const url = string(image.url, 'image URL');
    const data = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(url);
    if (data)
      return { type: 'image', source: { type: 'base64', media_type: data[1], data: data[2] } };
    if (!/^https?:\/\//.test(url)) throw new ProtocolError('Unsupported image URL');
    return { type: 'image', source: { type: 'url', url } };
  });
}
function nativeContent(value: unknown, format: ProviderFormat): JsonObject[] {
  if (typeof value === 'string') return [{ type: 'text', text: value }];
  return array(value, 'content').map((raw) => {
    const part = object(raw, 'content block');
    if (['text', 'input_text', 'output_text'].includes(String(part.type))) {
      keys(part, ['type', 'text', 'annotations']);
      if (Array.isArray(part.annotations) && part.annotations.length)
        throw new ProtocolError('Unsupported text annotations');
      return { type: 'text', text: string(part.text, 'text') };
    }
    if (format === 'claude' && part.type === 'image') {
      keys(part, ['type', 'source']);
      const source = object(part.source);
      keys(source, ['type', 'url', 'media_type', 'data']);
      const url =
        source.type === 'url'
          ? string(source.url, 'image URL')
          : source.type === 'base64'
            ? `data:${string(source.media_type, 'media_type')};base64,${string(source.data, 'image data')}`
            : null;
      if (!url) throw new ProtocolError('Unsupported image source');
      return { type: 'image_url', image_url: { url } };
    }
    if (format === 'openai-responses' && part.type === 'input_image') {
      keys(part, ['type', 'image_url', 'detail']);
      return {
        type: 'image_url',
        image_url: {
          url: string(part.image_url, 'image URL'),
          ...(part.detail ? { detail: part.detail } : {})
        }
      };
    }
    throw new ProtocolError(`Unsupported content type: ${String(part.type)}`);
  });
}
function requestToChat(body: JsonObject, format: ProviderFormat): JsonObject {
  if (format === 'openai') return body;
  const next: JsonObject = {};
  const common = ['model', 'stream', 'temperature', 'top_p'];
  for (const key of common) if (body[key] !== undefined) next[key] = body[key];
  const messages: JsonObject[] = [];
  if (format === 'claude') {
    keys(body, [
      ...common,
      'messages',
      'system',
      'max_tokens',
      'stop_sequences',
      'tools',
      'tool_choice'
    ]);
    if (body.system)
      messages.push({
        role: 'system',
        content: compactContent(nativeContent(body.system, format))
      });
    for (const raw of array(body.messages, 'messages')) {
      const message = object(raw);
      keys(message, ['role', 'content']);
      if (message.role !== 'user' && message.role !== 'assistant')
        throw new ProtocolError('Unsupported Claude message role');
      const content =
        typeof message.content === 'string'
          ? [{ type: 'text', text: message.content }]
          : array(message.content, 'content');
      let parts: JsonObject[] = [];
      let tools: JsonObject[] = [];
      const flush = () => {
        if (parts.length || tools.length)
          messages.push({
            role: message.role,
            content: parts.length ? compactContent(parts) : null,
            ...(tools.length ? { tool_calls: tools } : {})
          });
        parts = [];
        tools = [];
      };
      for (const rawPart of content) {
        const part = object(rawPart);
        if (part.type === 'tool_use') {
          keys(part, ['type', 'id', 'name', 'input']);
          if (message.role !== 'assistant')
            throw new ProtocolError('Tool use requires assistant role');
          tools.push({
            id: string(part.id, 'tool id'),
            type: 'function',
            function: {
              name: string(part.name, 'tool name'),
              arguments: JSON.stringify(object(part.input, 'tool input'))
            }
          });
        } else if (part.type === 'tool_result') {
          keys(part, ['type', 'tool_use_id', 'content', 'is_error']);
          if (part.is_error)
            throw new ProtocolError('Unsupported tool result is_error in Chat translation');
          if (message.role !== 'user') throw new ProtocolError('Tool result requires user role');
          flush();
          messages.push({
            role: 'tool',
            tool_call_id: string(part.tool_use_id, 'tool_use_id'),
            content: compactContent(nativeContent(part.content, format))
          });
        } else parts.push(...nativeContent([part], format));
      }
      flush();
    }
    if (body.max_tokens !== undefined) next.max_tokens = body.max_tokens;
    if (body.stop_sequences !== undefined) next.stop = body.stop_sequences;
    if (body.tools !== undefined)
      next.tools = array(body.tools, 'tools').map((raw) => {
        const tool = object(raw);
        keys(tool, ['name', 'description', 'input_schema']);
        return {
          type: 'function',
          function: {
            name: tool.name,
            ...(tool.description !== undefined ? { description: tool.description } : {}),
            parameters: tool.input_schema
          }
        };
      });
    if (body.tool_choice !== undefined) {
      const choice = object(body.tool_choice);
      keys(choice, ['type', 'name', 'disable_parallel_tool_use']);
      next.tool_choice =
        choice.type === 'tool'
          ? { type: 'function', function: { name: choice.name } }
          : choice.type === 'any'
            ? 'required'
            : choice.type;
      if (choice.disable_parallel_tool_use !== undefined)
        next.parallel_tool_calls = !choice.disable_parallel_tool_use;
    }
  } else {
    keys(body, [
      ...common,
      'input',
      'instructions',
      'max_output_tokens',
      'tools',
      'tool_choice',
      'parallel_tool_calls',
      'store'
    ]);
    if (body.instructions)
      messages.push({ role: 'system', content: string(body.instructions, 'instructions') });
    const input =
      typeof body.input === 'string'
        ? [{ role: 'user', content: body.input }]
        : array(body.input, 'input');
    for (const raw of input) {
      const item = object(raw);
      if (item.type === 'function_call') {
        keys(item, ['type', 'id', 'call_id', 'name', 'arguments', 'status']);
        messages.push({
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: string(item.call_id, 'call_id'),
              type: 'function',
              function: {
                name: string(item.name, 'name'),
                arguments: string(item.arguments, 'arguments')
              }
            }
          ]
        });
      } else if (item.type === 'function_call_output') {
        keys(item, ['type', 'id', 'call_id', 'output', 'status']);
        messages.push({
          role: 'tool',
          tool_call_id: string(item.call_id, 'call_id'),
          content:
            typeof item.output === 'string'
              ? item.output
              : compactContent(nativeContent(item.output, format))
        });
      } else {
        keys(item, ['type', 'id', 'role', 'content', 'status']);
        if (item.type !== undefined && item.type !== 'message')
          throw new ProtocolError(`Unsupported input type: ${String(item.type)}`);
        messages.push({
          role: item.role,
          content: compactContent(nativeContent(item.content, format))
        });
      }
    }
    if (body.max_output_tokens !== undefined) next.max_completion_tokens = body.max_output_tokens;
    if (body.parallel_tool_calls !== undefined) next.parallel_tool_calls = body.parallel_tool_calls;
    if (body.store === true)
      throw new ProtocolError('Unsupported stored Responses request across protocols');
    if (body.tools !== undefined)
      next.tools = array(body.tools, 'tools').map((raw) => {
        const tool = object(raw);
        keys(tool, ['type', 'name', 'description', 'parameters', 'strict']);
        if (tool.type !== 'function') throw new ProtocolError('Unsupported tool type');
        const { type: _type, ...definition } = tool;
        return { type: 'function', function: definition };
      });
    if (body.tool_choice !== undefined) {
      const choice = body.tool_choice;
      next.tool_choice =
        typeof choice === 'string'
          ? choice
          : { type: 'function', function: { name: object(choice).name } };
    }
  }
  next.messages = messages;
  return next;
}

/** Translate only the interoperable chat/tool/image subset. Same-format requests retain native fields. */
export function translateRequest(
  body: JsonObject,
  source: ProviderFormat,
  target: ProviderFormat,
  model: string
): JsonObject {
  if (source === target) return { ...body, model };
  const chat = requestToChat(body, source);
  if (target === 'openai') return { ...chat, model };
  keys(chat, [
    'model',
    'messages',
    'stream',
    'stream_options',
    'max_tokens',
    'max_completion_tokens',
    'temperature',
    'top_p',
    'stop',
    'tools',
    'tool_choice',
    'parallel_tool_calls',
    'n'
  ]);
  if (chat.n !== undefined && chat.n !== 1)
    throw new ProtocolError('Unsupported multiple completions across protocols');
  if (chat.max_tokens !== undefined && chat.max_completion_tokens !== undefined)
    throw new ProtocolError('Choose one token limit');
  if (chat.stream_options !== undefined) keys(object(chat.stream_options), ['include_usage']);
  const result: JsonObject = { model };
  for (const key of ['stream', 'temperature', 'top_p'])
    if (chat[key] !== undefined) result[key] = chat[key];
  const limit = chat.max_completion_tokens ?? chat.max_tokens;
  if (target === 'claude') result.max_tokens = limit ?? 4096;
  else if (limit !== undefined) result.max_output_tokens = limit;
  const system: JsonObject[] = [],
    messages: JsonObject[] = [];
  for (const raw of array(chat.messages, 'messages')) {
    const message = object(raw);
    keys(message, ['role', 'content', 'tool_calls', 'tool_call_id']);
    const role = message.role;
    const parts = chatContent(message.content);
    if (role === 'system' || role === 'developer') {
      if (parts.some((part) => part.type !== 'text'))
        throw new ProtocolError('Unsupported non-text system content');
      if (target === 'claude') {
        if (messages.length)
          throw new ProtocolError('Unsupported system message after conversation starts');
        system.push(...parts);
      } else
        messages.push({
          role,
          content: parts.map((part) => ({ type: 'input_text', text: part.text }))
        });
      continue;
    }
    if (role !== 'user' && role !== 'assistant' && role !== 'tool')
      throw new ProtocolError(`Unsupported message role: ${String(role)}`);
    if (role === 'tool') {
      const id = string(message.tool_call_id, 'tool_call_id');
      if (target === 'claude')
        messages.push({
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: id, content: claudeContent(parts) }]
        });
      else
        messages.push({
          type: 'function_call_output',
          call_id: id,
          output: parts.every((part) => part.type === 'text')
            ? parts.map((part) => part.text).join('')
            : parts.map((part) =>
                part.type === 'text'
                  ? { type: 'input_text', text: part.text }
                  : {
                      type: 'input_image',
                      image_url: object(part.image_url).url,
                      ...(object(part.image_url).detail
                        ? { detail: object(part.image_url).detail }
                        : {})
                    }
              )
        });
      continue;
    }
    const calls =
      message.tool_calls === undefined
        ? []
        : array(message.tool_calls, 'tool_calls').map((rawCall) => {
            const call = object(rawCall);
            keys(call, ['id', 'type', 'function']);
            if (role !== 'assistant' || call.type !== 'function')
              throw new ProtocolError('Unsupported tool call');
            const definition = object(call.function);
            keys(definition, ['name', 'arguments']);
            const id = string(call.id, 'tool id'),
              name = string(definition.name, 'tool name');
            return target === 'claude'
              ? { type: 'tool_use', id, name, input: args(definition.arguments) }
              : {
                  type: 'function_call',
                  call_id: id,
                  name,
                  arguments: string(definition.arguments, 'tool arguments')
                };
          });
    if (target === 'claude') messages.push({ role, content: [...claudeContent(parts), ...calls] });
    else {
      if (parts.length || !calls.length)
        messages.push({
          role,
          content: parts.map((part) =>
            part.type === 'text'
              ? { type: role === 'assistant' ? 'output_text' : 'input_text', text: part.text }
              : {
                  type: 'input_image',
                  image_url: object(part.image_url).url,
                  ...(object(part.image_url).detail
                    ? { detail: object(part.image_url).detail }
                    : {})
                }
          )
        });
      messages.push(...calls);
    }
  }
  if (target === 'claude') {
    result.messages = messages;
    if (system.length) result.system = system;
    if (chat.stop !== undefined)
      result.stop_sequences = typeof chat.stop === 'string' ? [chat.stop] : chat.stop;
  } else {
    result.input = messages;
    if (chat.stop !== undefined)
      throw new ProtocolError('Unsupported stop sequences for Responses');
    if (chat.parallel_tool_calls !== undefined)
      result.parallel_tool_calls = chat.parallel_tool_calls;
  }
  if (chat.tools !== undefined)
    result.tools = array(chat.tools, 'tools').map((raw) => {
      const tool = object(raw);
      keys(tool, ['type', 'function']);
      if (tool.type !== 'function') throw new ProtocolError('Unsupported tool type');
      const definition = object(tool.function);
      keys(definition, ['name', 'description', 'parameters', 'strict']);
      if (target === 'claude' && definition.strict !== undefined)
        throw new ProtocolError('Unsupported strict tools for Claude');
      return target === 'claude'
        ? {
            name: string(definition.name, 'tool name'),
            ...(definition.description !== undefined
              ? { description: definition.description }
              : {}),
            input_schema: definition.parameters ?? { type: 'object', properties: {} }
          }
        : { type: 'function', ...definition };
    });
  if (
    chat.tool_choice !== undefined ||
    (target === 'claude' && chat.parallel_tool_calls !== undefined)
  ) {
    const choice = chat.tool_choice ?? 'auto';
    if (target === 'claude') {
      result.tool_choice =
        typeof choice === 'string'
          ? { type: choice === 'required' ? 'any' : choice }
          : { type: 'tool', name: object(object(choice).function).name };
      if (chat.parallel_tool_calls !== undefined)
        (result.tool_choice as JsonObject).disable_parallel_tool_use = !chat.parallel_tool_calls;
    } else
      result.tool_choice =
        typeof choice === 'string'
          ? choice
          : { type: 'function', name: object(object(choice).function).name };
  }
  return result;
}
export function finishReason(reason: unknown): string | null {
  if (reason == null) return null;
  if (reason === 'tool_use') return 'tool_calls';
  if (reason === 'max_tokens' || reason === 'max_output_tokens') return 'length';
  if (['end_turn', 'stop_sequence', 'completed', 'pause_turn'].includes(String(reason)))
    return 'stop';
  if (reason === 'refusal') return 'content_filter';
  return String(reason);
}
export function normalizedUsage(value: unknown): JsonObject | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const usage = object(value),
    input = usage.prompt_tokens ?? usage.input_tokens,
    output = usage.completion_tokens ?? usage.output_tokens;
  if (typeof input !== 'number' && typeof output !== 'number') return undefined;
  return {
    prompt_tokens: typeof input === 'number' ? input : 0,
    completion_tokens: typeof output === 'number' ? output : 0,
    total_tokens:
      (typeof input === 'number' ? input : 0) + (typeof output === 'number' ? output : 0)
  };
}
function responseToChat(body: JsonObject, source: ProviderFormat): JsonObject {
  if (source === 'openai') return body;
  let text = '',
    reasoning = '',
    calls: JsonObject[] = [];
  if (source === 'claude') {
    for (const raw of array(body.content, 'response content')) {
      const part = object(raw);
      if (part.type === 'text') {
        keys(part, ['type', 'text', 'citations']);
        if (
          part.citations !== undefined &&
          (!Array.isArray(part.citations) || part.citations.length)
        )
          throw new ProtocolError('Unsupported response citations', 502);
        text += string(part.text, 'text');
      } else if (part.type === 'tool_use')
        calls.push({
          id: part.id,
          type: 'function',
          function: { name: part.name, arguments: JSON.stringify(object(part.input)) }
        });
      else throw new ProtocolError(`Unsupported response content: ${String(part.type)}`, 502);
    }
  } else {
    for (const raw of array(body.output, 'response output')) {
      const item = object(raw);
      if (item.type === 'function_call')
        calls.push({
          id: item.call_id,
          type: 'function',
          function: { name: item.name, arguments: item.arguments }
        });
      else if (item.type === 'reasoning') {
        for (const rawPart of [
          ...(Array.isArray(item.summary) ? item.summary : []),
          ...(Array.isArray(item.content) ? item.content : [])
        ]) {
          const part = object(rawPart);
          if (part.type !== 'summary_text' && part.type !== 'reasoning_text')
            throw new ProtocolError(`Unsupported reasoning content: ${String(part.type)}`, 502);
          reasoning += string(part.text, 'reasoning text');
        }
        // Opaque encrypted state has no Chat equivalent; native Responses relay retains it.
      } else if (item.type === 'message') {
        for (const rawPart of array(item.content, 'response content')) {
          const part = object(rawPart);
          if (part.type === 'output_text') {
            keys(part, ['type', 'text', 'annotations', 'logprobs']);
            if (
              part.annotations !== undefined &&
              (!Array.isArray(part.annotations) || part.annotations.length)
            )
              throw new ProtocolError('Unsupported response annotations', 502);
            if (
              part.logprobs !== undefined &&
              (!Array.isArray(part.logprobs) || part.logprobs.length)
            )
              throw new ProtocolError('Unsupported response logprobs', 502);
            text += string(part.text, 'output text');
          } else if (part.type === 'refusal') text += string(part.refusal, 'refusal');
          else throw new ProtocolError(`Unsupported response content: ${String(part.type)}`, 502);
        }
      } else throw new ProtocolError(`Unsupported response output: ${String(item.type)}`, 502);
    }
  }
  const incomplete = body.incomplete_details && object(body.incomplete_details).reason;
  return {
    id: body.id,
    object: 'chat.completion',
    created: typeof body.created_at === 'number' ? body.created_at : Math.floor(Date.now() / 1000),
    model: body.model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: text || null,
          ...(reasoning ? { reasoning_content: reasoning } : {}),
          ...(calls.length ? { tool_calls: calls } : {})
        },
        finish_reason:
          source === 'claude'
            ? finishReason(body.stop_reason)
            : calls.length
              ? 'tool_calls'
              : finishReason(incomplete ?? body.status ?? 'completed')
      }
    ],
    ...(normalizedUsage(body.usage) ? { usage: normalizedUsage(body.usage) } : {})
  };
}
function convertResponse(
  body: JsonObject,
  source: ProviderFormat,
  target: ProviderFormat
): JsonObject {
  if (source === target) return body;
  const chat = responseToChat(body, source);
  if (target === 'openai') return chat;
  const choices = array(chat.choices, 'choices');
  if (choices.length !== 1) throw new ProtocolError('Unsupported multiple response choices', 502);
  const choice = object(choices[0]),
    message = object(choice.message);
  if (message.refusal || message.audio || (target === 'claude' && message.reasoning_content))
    throw new ProtocolError('Unsupported response content across protocols', 502);
  const content = chatContent(message.content),
    calls = message.tool_calls === undefined ? [] : array(message.tool_calls, 'tool_calls');
  const usage = normalizedUsage(chat.usage),
    reason = choice.finish_reason;
  const nativeUsage = {
    input_tokens: usage?.prompt_tokens ?? 0,
    output_tokens: usage?.completion_tokens ?? 0
  };
  if (target === 'claude')
    return {
      id: chat.id,
      type: 'message',
      role: 'assistant',
      model: chat.model,
      content: [
        ...claudeContent(content),
        ...calls.map((raw) => {
          const call = object(raw),
            fn = object(call.function);
          return { type: 'tool_use', id: call.id, name: fn.name, input: args(fn.arguments) };
        })
      ],
      stop_reason:
        reason === 'tool_calls'
          ? 'tool_use'
          : reason === 'length'
            ? 'max_tokens'
            : reason === 'content_filter'
              ? 'refusal'
              : 'end_turn',
      stop_sequence: null,
      usage: nativeUsage
    };
  const output: JsonObject[] = [];
  if (message.reasoning_content !== undefined) {
    output.push({
      type: 'reasoning',
      id: `${String(chat.id)}_reasoning`,
      summary: [
        { type: 'summary_text', text: string(message.reasoning_content, 'reasoning content') }
      ]
    });
  }
  if (content.length)
    output.push({
      type: 'message',
      id: `${String(chat.id)}_message`,
      role: 'assistant',
      status: 'completed',
      content: content.map((part) => {
        if (part.type !== 'text') throw new ProtocolError('Unsupported response image', 502);
        return { type: 'output_text', text: part.text, annotations: [] };
      })
    });
  output.push(
    ...calls.map((raw) => {
      const call = object(raw),
        fn = object(call.function);
      return {
        type: 'function_call',
        id: call.id,
        call_id: call.id,
        name: fn.name,
        arguments: fn.arguments,
        status: 'completed'
      };
    })
  );
  return {
    id: chat.id,
    object: 'response',
    created_at: chat.created,
    model: chat.model,
    status: reason === 'length' ? 'incomplete' : 'completed',
    ...(reason === 'length' ? { incomplete_details: { reason: 'max_output_tokens' } } : {}),
    output,
    usage: { ...nativeUsage, total_tokens: usage?.total_tokens ?? 0 }
  };
}

/** Malformed upstream payloads are provider failures, never client validation errors. */
export function translateResponse(
  body: JsonObject,
  source: ProviderFormat,
  target: ProviderFormat
): JsonObject {
  try {
    return convertResponse(body, source, target);
  } catch (error) {
    if (error instanceof ProtocolError && error.status === 400)
      throw new ProtocolError(error.message, 502);
    throw error;
  }
}
