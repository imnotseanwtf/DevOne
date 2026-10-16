import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { getPrisma } from '@/lib/db/prisma';

export const CODEX_LOOPBACK_URI = 'http://localhost:1455/auth/callback';

interface CallbackSession {
  providerId: string;
  redirectUri: string;
  expiresAt: Date;
  provider: { providerType: string };
}

/** Relay only a saved, live Codex state to the normal authenticated callback. */
export function createCodexLoopbackServer(
  appUrl: string,
  lookupSession: (stateHash: string) => Promise<CallbackSession | null> = (stateHash) =>
    getPrisma().aiOAuthSession.findUnique({
      where: { stateHash },
      include: { provider: { select: { providerType: true } } }
    })
): Server {
  const app = new URL(appUrl);
  if (
    !['http:', 'https:'].includes(app.protocol) ||
    !['localhost', '127.0.0.1'].includes(app.hostname) ||
    app.username ||
    app.password ||
    app.search ||
    app.hash
  )
    throw new Error('Codex loopback sign-in requires a local DevOne URL');
  return createServer({ maxHeaderSize: 16_384 }, async (request, response) => {
    response.setHeader('cache-control', 'no-store');
    response.setHeader('referrer-policy', 'no-referrer');
    const reject = (status: number) => {
      response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Invalid Codex callback');
    };
    let url: URL;
    try {
      url = new URL(request.url ?? '/', CODEX_LOOPBACK_URI);
    } catch {
      return reject(400);
    }
    if (request.method !== 'GET' || url.pathname !== '/auth/callback') return reject(404);
    const params = url.searchParams;
    const state = params.get('state') ?? '';
    const code = params.get('code') ?? '';
    if (
      !['localhost:1455', '127.0.0.1:1455'].includes(request.headers.host ?? '') ||
      !state ||
      state.length > 256 ||
      code.length > 10000 ||
      (!code && !params.has('error')) ||
      ['state', 'code', 'error'].some((key) => params.getAll(key).length > 1)
    )
      return reject(400);
    try {
      const session = await lookupSession(createHash('sha256').update(state).digest('hex'));
      if (
        !session ||
        session.expiresAt <= new Date() ||
        session.redirectUri !== CODEX_LOOPBACK_URI ||
        session.provider.providerType !== 'codex'
      )
        return reject(400);
      const callback = new URL(
        `/api/ai/oauth/${encodeURIComponent(session.providerId)}/callback`,
        app.origin
      );
      callback.searchParams.set('state', state);
      if (params.has('error')) callback.searchParams.set('error', 'access_denied');
      else callback.searchParams.set('code', code);
      response.writeHead(302, { location: callback.toString() });
      response.end();
    } catch {
      reject(500);
    }
  });
}

const globalForCodex = globalThis as unknown as {
  codexLoopback?: {
    server: Server;
    starting: Promise<void>;
    expiry?: ReturnType<typeof setTimeout>;
  };
};

/** One native callback port per process, leased for the same ten minutes as PKCE sessions. */
export async function ensureCodexLoopbackListener(appUrl: string): Promise<void> {
  let listener = globalForCodex.codexLoopback;
  if (!listener || !listener.server.listening) {
    if (listener && !listener.server.listening) await listener.starting;
    if (!listener?.server.listening) {
      const server = createCodexLoopbackServer(appUrl);
      const starting = new Promise<void>((resolve, reject) => {
        server.once('error', () => {
          globalForCodex.codexLoopback = undefined;
          reject(
            new Error(
              'Could not open Codex callback port 1455. Finish any other Codex sign-in and retry.'
            )
          );
        });
        server.listen(1455, '127.0.0.1', () => {
          server.unref();
          resolve();
        });
      });
      listener = { server, starting };
      globalForCodex.codexLoopback = listener;
    }
  }
  await listener.starting;
  clearTimeout(listener.expiry);
  const active = listener;
  listener.expiry = setTimeout(() => {
    active.server.close();
    active.server.closeIdleConnections();
    if (globalForCodex.codexLoopback === active) globalForCodex.codexLoopback = undefined;
  }, 10 * 60_000);
  listener.expiry.unref();
}
