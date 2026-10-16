import { handleChatCompletion } from '@/features/ai-router/request';
import {
  DocsChatAccessError,
  createPlanToolRunner,
  listChatRepositories,
  loadCodeContext,
  loadProjectDocs
} from '@/features/docs-chat/service';
import { routerError } from '@/lib/ai-router/forward';
import { getCurrentUser } from '@/lib/auth/session';
import { DEMO_DISABLED_MESSAGE, isDemoMode } from '@/lib/demo';
import {
  buildChatMessages,
  containsWholePage,
  selectContext,
  sourcesOf
} from '@/lib/docs-chat/retrieval';
import {
  MAX_TOOL_ROUNDS,
  PLAN_TOOLS,
  buildPlanMessages,
  describeToolCall,
  parseToolArgs
} from '@/lib/docs-chat/plan';
import { isSameOrigin } from '@/lib/http/same-origin';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(8_000) }))
    .min(1)
    .max(40),
  /** The page the person has open, so its content is always part of the context. */
  currentSlug: z.string().max(200).optional(),
  /** The open page as it is in the editor right now, which may be ahead of what is saved. */
  currentBody: z.string().max(200_000).optional(),
  /**
   * Set when the open text is a task's description rather than a docs page: the task's title.
   * The description itself is `currentBody`.
   */
  taskTitle: z.string().max(300).optional(),
  /** The passage the person is pointing at in the page, if any. */
  focus: z.string().max(2_000).optional(),
  /** `plan`: interview the person with tools and end with a checklist plan. */
  mode: z.enum(['ask', 'plan']).default('ask'),
  /** A router model name; "auto" unless the person picked one. */
  model: z.string().trim().min(1).max(200).default('auto'),
  /** A linked repository's branch to read code from, when the person picked one. */
  code: z
    .object({ repositoryId: z.string().min(1).max(100), branch: z.string().min(1).max(200) })
    .optional()
});

/**
 * Chat with a project's docs. The server picks the relevant excerpts (so a
 * person can only ever ask about projects they belong to), then hands the
 * conversation to the AI router, which streams the answer back with its usual
 * provider fallback, rate limit and usage log.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  if (isDemoMode()) return routerError(403, DEMO_DISABLED_MESSAGE, 'demo_mode');
  if (!isSameOrigin(request)) return routerError(403, 'Cross-site request refused', 'forbidden');
  const user = await getCurrentUser();
  if (!user) return routerError(401, 'Sign in to chat with the docs', 'unauthorized');

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return routerError(
      400,
      parsed.error.issues[0]?.message ?? 'Invalid request',
      'invalid_request'
    );
  }
  const { messages, currentSlug, currentBody, taskTitle, focus, model, code, mode } = parsed.data;
  const task = taskTitle !== undefined;
  const last = messages.at(-1);
  if (last?.role !== 'user') return routerError(400, 'End with a question', 'invalid_request');

  const { projectId } = await params;
  let project;
  try {
    project = await loadProjectDocs(user.id, projectId);
  } catch (error) {
    if (error instanceof DocsChatAccessError) return routerError(404, error.message, 'not_found');
    throw error;
  }

  // Earlier questions still matter ("and how do I deploy it?"), so they steer the search too.
  const search = messages
    .filter((message) => message.role === 'user')
    .slice(-3)
    .map((message) => message.content)
    .join('\n');
  const TASK_ID = '__task__';
  const docs = task
    ? // The task's description stands in as the open page, next to the project's real pages.
      [
        {
          id: TASK_ID,
          slug: TASK_ID,
          title: taskTitle || 'This task',
          folder: null,
          body: currentBody ?? ''
        },
        ...project.docs
      ]
    : project.docs.map((doc) =>
        doc.slug === currentSlug && currentBody !== undefined ? { ...doc, body: currentBody } : doc
      );
  const current = task ? docs[0] : docs.find((doc) => doc.slug === currentSlug);
  const excerpts = selectContext(search, docs, { currentDocId: current?.id });
  // A rewrite is only safe when the model saw the whole page: it replaces the text.
  const editable = !!current && containsWholePage(excerpts, current);

  let codeContext: string | null = null;
  if (code) {
    try {
      codeContext = await loadCodeContext(user.id, projectId, code, search);
    } catch {
      // A provider outage should not stop the docs from answering.
    }
    if (codeContext === null) {
      return routerError(404, 'That branch is not available any more', 'not_found');
    }
  }

  const headers = new Headers(request.headers);
  headers.set('content-type', 'application/json');
  headers.delete('content-length');
  const complete = (body: Record<string, unknown>) =>
    handleChatCompletion(
      new Request(new URL('/api/ai/v1/chat/completions', request.url), {
        method: 'POST',
        headers,
        body: JSON.stringify({ model, ...body }),
        signal: request.signal
      })
    );
  const sourceHeaders = (target: Headers, canEdit: boolean, tools: string[] = []) => {
    target.set(
      'x-devone-sources',
      encodeURIComponent(
        JSON.stringify(sourcesOf(excerpts).filter((source) => source.slug !== TASK_ID))
      )
    );
    target.set('x-devone-can-edit', canEdit ? '1' : '0');
    if (tools.length) target.set('x-devone-tools', encodeURIComponent(JSON.stringify(tools)));
  };

  if (mode === 'plan') {
    const repositories = code ? await listChatRepositories(user.id, projectId).catch(() => []) : [];
    const repository = repositories.find((entry) => entry.id === code?.repositoryId);
    const branch = code && repository ? `${repository.name} @ ${code.branch}` : undefined;
    const context = [
      excerpts.map((excerpt) => `### Page: ${excerpt.title}\n${excerpt.text}`).join('\n\n'),
      codeContext
    ]
      .filter(Boolean)
      .join('\n\n');
    const planned = await runPlanTools({
      messages: buildPlanMessages(project.projectName, messages, {
        branch,
        openPage: current?.title,
        toolsAvailable: true
      }),
      complete,
      run: createPlanToolRunner(user.id, projectId, project.docs, code ?? null)
    });
    const out = new Headers({ 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
    if (planned) {
      sourceHeaders(out, false, planned.used);
      const chunk = { choices: [{ delta: { content: planned.content } }] };
      return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: out });
    }
    // The model or provider cannot call tools: plan from the excerpts alone, streamed.
    const upstream = await complete({
      stream: true,
      messages: buildPlanMessages(project.projectName, messages, {
        branch,
        openPage: current?.title,
        toolsAvailable: false,
        context
      })
    });
    const fallback = new Headers(upstream.headers);
    sourceHeaders(fallback, false);
    return new Response(upstream.body, { status: upstream.status, headers: fallback });
  }

  const upstream = await complete({
    stream: true,
    messages: buildChatMessages(project.projectName, excerpts, messages, {
      editablePage: editable ? current?.title : undefined,
      focus,
      kind: task ? 'task' : 'page',
      code: codeContext ?? undefined
    })
  });
  const responseHeaders = new Headers(upstream.headers);
  sourceHeaders(responseHeaders, editable);
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

interface ToolCall {
  id: string;
  function: { name: string; arguments: string };
}

/**
 * Lets the model call the planning tools until it answers in words. Returns null
 * when the very first call fails, which usually means the model has no tool
 * support, so the caller can fall back to a plain answer.
 */
async function runPlanTools({
  messages,
  complete,
  run
}: {
  messages: { role: string; content: string }[];
  complete: (body: Record<string, unknown>) => Promise<Response>;
  run: (name: string, args: Record<string, string>) => Promise<string>;
}): Promise<{ content: string; used: string[] } | null> {
  const conversation: Record<string, unknown>[] = [...messages];
  const used: string[] = [];
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    // The last round offers no tools, which makes the model answer with what it has.
    const response = await complete({
      stream: false,
      messages: conversation,
      ...(round < MAX_TOOL_ROUNDS ? { tools: PLAN_TOOLS } : {})
    }).catch(() => null);
    const body = response?.ok
      ? ((await response.json().catch(() => null)) as {
          choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[];
        } | null)
      : null;
    const message = body?.choices?.[0]?.message;
    if (!message) {
      if (round === 0) return null;
      return { content: 'The assistant stopped before it could answer. Try again.', used };
    }
    const calls = message.tool_calls ?? [];
    if (calls.length === 0) return { content: message.content ?? '', used };

    conversation.push({ role: 'assistant', content: message.content ?? null, tool_calls: calls });
    for (const call of calls) {
      const args = parseToolArgs(call.function.arguments);
      used.push(describeToolCall(call.function.name, args));
      conversation.push({
        role: 'tool',
        tool_call_id: call.id,
        content: await run(call.function.name, args)
      });
    }
  }
  return { content: 'The assistant used too many lookups. Try again.', used };
}
