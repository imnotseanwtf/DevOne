/**
 * Route handlers have no built-in CSRF check (server actions do). The session
 * cookie is SameSite=Lax, which already keeps it off cross-site POSTs; this
 * also refuses any state-changing request whose Origin is another site.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
