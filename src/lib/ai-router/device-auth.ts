import type { ProviderOAuthConfig } from './types';

export interface CodexDeviceCode {
  deviceAuthId: string;
  userCode: string;
  intervalMs: number;
  verificationUrl: string;
  redirectUri: string;
}

function issuer(config: ProviderOAuthConfig): string {
  const url = new URL(config.authorizeUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash)
    throw new Error('Invalid device authorization endpoint');
  return url.origin;
}

async function deviceRequest(
  config: ProviderOAuthConfig,
  path: string,
  fields: Record<string, string>,
  fetchImpl: typeof fetch
): Promise<Response> {
  return fetchImpl(`${issuer(config)}/api/accounts/deviceauth/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(fields),
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(10_000)
  });
}

/** Same device-code protocol as the official Codex CLI; no localhost listener is needed. */
export async function requestCodexDeviceCode(
  config: ProviderOAuthConfig,
  fetchImpl: typeof fetch = fetch
): Promise<CodexDeviceCode> {
  try {
    const response = await deviceRequest(
      config,
      'usercode',
      { client_id: config.clientId },
      fetchImpl
    );
    if (!response.ok) throw new Error();
    const data = await response.json();
    const userCode = data.user_code ?? data.usercode;
    if (
      typeof data.device_auth_id !== 'string' ||
      !data.device_auth_id ||
      data.device_auth_id.length > 1024 ||
      typeof userCode !== 'string' ||
      !userCode ||
      userCode.length > 256
    )
      throw new Error();
    const interval = Number(data.interval);
    return {
      deviceAuthId: data.device_auth_id,
      userCode,
      intervalMs: Number.isFinite(interval)
        ? Math.min(60_000, Math.max(5000, interval * 1000))
        : 5000,
      verificationUrl: `${issuer(config)}/codex/device`,
      redirectUri: `${issuer(config)}/deviceauth/callback`
    };
  } catch {
    throw new Error('Could not start Codex device sign-in');
  }
}

export async function pollCodexDeviceCode(
  config: ProviderOAuthConfig,
  device: CodexDeviceCode,
  fetchImpl: typeof fetch = fetch
): Promise<{ code: string; verifier: string } | null> {
  try {
    const response = await deviceRequest(
      config,
      'token',
      {
        device_auth_id: device.deviceAuthId,
        user_code: device.userCode
      },
      fetchImpl
    );
    if (response.status === 403 || response.status === 404) return null;
    if (!response.ok) throw new Error();
    const data = await response.json();
    if (
      typeof data.authorization_code !== 'string' ||
      !data.authorization_code ||
      typeof data.code_verifier !== 'string' ||
      !data.code_verifier
    )
      throw new Error();
    return { code: data.authorization_code, verifier: data.code_verifier };
  } catch {
    throw new Error('Could not complete Codex device sign-in');
  }
}
