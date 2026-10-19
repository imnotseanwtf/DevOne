import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { openCodeFreeModels } from './opencode-free';
import { object, ProtocolError, type JsonObject } from './translation';

const executeFile = promisify(execFile);
const allowedFields = new Set([
  'model',
  'messages',
  'stream',
  'stream_options',
  'max_tokens',
  'max_completion_tokens',
  'tools',
  'tool_choice'
]);

/** The CLI owns its agent tools; this adapter accepts text conversations only. */
function transcript(body: JsonObject): { prompt: string; model: string; maxTokens: number } {
  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key))
      throw new ProtocolError(`OpenCode runtime does not support ${key}`);
  }
  const model = body.model;
  if (
    typeof model !== 'string' ||
    !/^[a-z0-9][a-z0-9._-]{0,199}$/.test(model) ||
    !openCodeFreeModels([model]).length
  )
    throw new ProtocolError('Choose an OpenCode free Chat model');
  if (body.tools !== undefined && (!Array.isArray(body.tools) || body.tools.length))
    throw new ProtocolError(
      'OpenCode runtime supports text chat only; caller tools are unsupported'
    );
  if (body.tool_choice !== undefined && body.tool_choice !== 'none')
    throw new ProtocolError('OpenCode runtime does not support tool_choice');
  if (!Array.isArray(body.messages) || !body.messages.length)
    throw new ProtocolError('A nonempty conversation is required');
  const messages = body.messages.map((raw) => {
    const message = object(raw);
    if (
      !['system', 'developer', 'user', 'assistant'].includes(String(message.role)) ||
      Object.keys(message).some((key) => !['role', 'content', 'name'].includes(key))
    )
      throw new ProtocolError('OpenCode runtime supports text messages without tool calls');
    let content = message.content;
    if (Array.isArray(content)) {
      content = content
        .map((rawPart) => {
          const part = object(rawPart);
          if (part.type !== 'text' || typeof part.text !== 'string')
            throw new ProtocolError(
              'OpenCode runtime supports text chat only; images are unsupported'
            );
          return part.text;
        })
        .join('\n');
    }
    if (typeof content !== 'string') throw new ProtocolError('Expected text message content');
    return { ...message, content };
  });
  const maxTokens = body.max_completion_tokens ?? body.max_tokens ?? 2048;
  if (
    typeof maxTokens !== 'number' ||
    !Number.isInteger(maxTokens) ||
    maxTokens < 1 ||
    maxTokens > 8192
  )
    throw new ProtocolError('OpenCode runtime token limit must be an integer from 1 to 8192');
  return {
    model,
    maxTokens,
    prompt: JSON.stringify({
      instruction:
        'Continue this text conversation. Follow its system and developer instructions and use prior messages as context. Return only the assistant reply to the final user message. Do not use tools.',
      messages
    })
  };
}

function outputObject(value: unknown): JsonObject {
  try {
    return object(value);
  } catch {
    throw new ProtocolError('Malformed OpenCode runtime output', 502);
  }
}

function tokenCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function readReply(output: string): { text: string; reason: string; usage: JsonObject } {
  let text = '',
    reason = '';
  let promptTokens = 0,
    completionTokens = 0;
  for (const line of output.split('\n')) {
    // The CLI may print a permission rejection alongside its JSON events.
    if (!line.trimStart().startsWith('{')) continue;
    let event: JsonObject;
    try {
      event = object(JSON.parse(line));
    } catch {
      throw new ProtocolError('Malformed OpenCode runtime output', 502);
    }
    if (event.type === 'error') {
      const error = outputObject(event.error ?? {});
      const data = outputObject(error.data ?? {});
      const status =
        typeof data.statusCode === 'number' && data.statusCode >= 400 && data.statusCode <= 599
          ? data.statusCode
          : 502;
      throw new ProtocolError(
        String(data.message ?? error.name ?? 'OpenCode runtime failed').slice(0, 500),
        status
      );
    }
    if (event.type === 'tool_use')
      throw new ProtocolError(
        'OpenCode requested a tool; runtime mode supports text replies only',
        502
      );
    const part = outputObject(event.part ?? {});
    if (event.type === 'text' && typeof part.text === 'string') text += part.text;
    if (event.type === 'step_finish') {
      reason = String(part.reason ?? '');
      const tokens = outputObject(part.tokens ?? {}),
        cache = outputObject(tokens.cache ?? {});
      promptTokens += tokenCount(tokens.input) + tokenCount(cache.read) + tokenCount(cache.write);
      completionTokens += tokenCount(tokens.output) + tokenCount(tokens.reasoning);
    }
  }
  if (!text || !['stop', 'length'].includes(reason))
    throw new ProtocolError('OpenCode runtime ended without a completed text reply', 502);
  return {
    text,
    reason,
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens
    }
  };
}

/** One isolated process per request; the gateway still owns authentication, deadlines and fallback. */
export async function openCodeRuntimeCompletion(
  body: JsonObject,
  signal: AbortSignal
): Promise<Response> {
  const { prompt, model, maxTokens } = transcript(body);
  if (signal.aborted) throw new ProtocolError('Client disconnected', 499);
  const binary =
    process.env.DEVONE_AI_OPENCODE_BIN ||
    join(process.cwd(), 'node_modules', 'opencode-linux-x64-baseline', 'bin', 'opencode');
  const directory = await mkdtemp(join(tmpdir(), 'devone-opencode-'));
  try {
    const workspace = join(directory, 'workspace');
    await mkdir(workspace);
    const pending = executeFile(
      binary,
      ['run', '--pure', '--format', 'json', '--model', `opencode/${model}`],
      {
        cwd: workspace,
        env: {
          NODE_ENV: 'production',
          PATH: process.env.PATH,
          LANG: 'C.UTF-8',
          XDG_DATA_HOME: join(directory, 'data'),
          XDG_CONFIG_HOME: join(directory, 'config'),
          XDG_CACHE_HOME: join(directory, 'cache'),
          XDG_STATE_HOME: join(directory, 'state'),
          OPENCODE_TEST_HOME: directory,
          OPENCODE_DISABLE_AUTOUPDATE: '1',
          OPENCODE_DISABLE_DEFAULT_PLUGINS: '1',
          OPENCODE_DISABLE_CLAUDE_CODE: '1',
          OPENCODE_DISABLE_EXTERNAL_SKILLS: '1',
          OPENCODE_DISABLE_PROJECT_CONFIG: '1',
          OPENCODE_DISABLE_LSP_DOWNLOAD: '1',
          OPENCODE_DISABLE_MODELS_FETCH: '1',
          OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: '1',
          OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX: String(maxTokens),
          OPENCODE_CONFIG_CONTENT: JSON.stringify({
            enabled_providers: ['opencode'],
            // Non-interactive `run` auto-rejects all asks without --auto. This keeps native tool
            // declarations available while preventing their execution. Never pass --auto.
            permission: 'ask',
            share: 'disabled',
            autoupdate: false
          })
        },
        signal,
        timeout: 60_000,
        killSignal: 'SIGKILL',
        maxBuffer: 1024 * 1024,
        encoding: 'utf8'
      }
    );
    const closed = new Promise<void>((resolve) => pending.child.once('close', () => resolve()));
    // OpenCode reads stdin to EOF even when a positional prompt was provided.
    pending.child.stdin?.on('error', () => {});
    pending.child.stdin?.end(prompt);
    let output: string;
    try {
      output = (await pending).stdout;
    } catch (error) {
      const failure = error as NodeJS.ErrnoException & { stdout?: string; killed?: boolean };
      if (signal.aborted) throw new ProtocolError('Client disconnected', 499);
      if (failure.code === 'ENOENT' || failure.code === 'EACCES')
        throw new ProtocolError(
          'OpenCode executable unavailable. Include the pinned Linux binary in the deployment or set DEVONE_AI_OPENCODE_BIN.',
          503
        );
      if (failure.killed && failure.code !== 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER')
        throw new ProtocolError('OpenCode runtime timed out', 504);
      if (failure.stdout) readReply(failure.stdout); // Preserve the provider's actual error/status.
      throw new ProtocolError('OpenCode runtime exited without a successful reply', 502);
    } finally {
      await closed;
    }
    const reply = readReply(output);
    const id = `chatcmpl-${randomUUID()}`;
    const created = Math.floor(Date.now() / 1000);
    const chunks = [
      {
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [
          { index: 0, delta: { role: 'assistant', content: reply.text }, finish_reason: null }
        ]
      },
      {
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{ index: 0, delta: {}, finish_reason: reply.reason }],
        usage: reply.usage
      }
    ];
    // The CLI emits complete text parts; the gateway translates these into the caller's JSON/SSE format.
    return new Response(
      chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n',
      {
        headers: { 'content-type': 'text/event-stream' }
      }
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
