import { handleChatCompletion } from '@/features/ai-router/request';
import { DocsChatAccessError, loadProjectDocs } from '@/features/docs-chat/service';
import { routerError } from '@/lib/ai-router/forward';
import { getCurrentUser } from '@/lib/auth/session';
import { DEMO_DISABLED_MESSAGE, isDemoMode } from '@/lib/demo';
import {
  buildChatMessages,
  containsWholePage,
  selectContext,
  sourcesOf
} from '@/lib/docs-chat/retrieval';
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
  /** The passage the person is pointing at in the page, if any. */
  focus: z.string().max(2_000).optional(),
  /** A router model name; "auto" unless the person picked one. */
  model: z.string().trim().min(1).max(200).default('auto')
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
  const { messages, currentSlug, currentBody, focus, model } = parsed.data;
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
  const docs = project.docs.map((doc) =>
    doc.slug === currentSlug && currentBody !== undefined ? { ...doc, body: currentBody } : doc
  );
  const current = docs.find((doc) => doc.slug === currentSlug);
  const excerpts = selectContext(search, docs, { currentDocId: current?.id });
  // A rewrite is only safe when the model saw the whole page: it replaces the page's text.
  const editable = !!current && current.body.trim() !== '' && containsWholePage(excerpts, current);

  const headers = new Headers(request.headers);
  headers.set('content-type', 'application/json');
  headers.delete('content-length');
  const upstream = await handleChatCompletion(
    new Request(new URL('/api/ai/v1/chat/completions', request.url), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        stream: true,
        messages: buildChatMessages(
          project.projectName,
          excerpts,
          messages,
          editable ? current?.title : undefined,
          focus
        )
      }),
      signal: request.signal
    })
  );

  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.set('x-devone-sources', encodeURIComponent(JSON.stringify(sourcesOf(excerpts))));
  responseHeaders.set('x-devone-can-edit', editable ? '1' : '0');
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}
