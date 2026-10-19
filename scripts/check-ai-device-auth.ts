import assert from 'node:assert/strict';
import { requestCodexDeviceCode, pollCodexDeviceCode } from '../src/lib/ai-router/device-auth';
import { getProviderDefinition } from '../src/lib/ai-router/registry';
import { parseOAuthCode } from '../src/lib/ai-router/oauth';

const config = getProviderDefinition('codex', {})!.oauth!;
const requested: { url: string; body: Record<string, unknown> }[] = [];
let status = 200;
let payload: unknown = { device_auth_id: 'device-secret', user_code: 'ABCD-1234', interval: '5' };
const fetchImpl: typeof fetch = async (url, init) => {
  requested.push({ url: String(url), body: JSON.parse(String(init?.body)) });
  assert.equal(init?.redirect, 'error');
  assert.equal(init?.cache, 'no-store');
  return Response.json(payload, { status });
};
const device = await requestCodexDeviceCode(config, fetchImpl);
assert.equal(device.deviceAuthId, 'device-secret');
assert.equal(device.userCode, 'ABCD-1234');
assert.equal(device.intervalMs, 5000);
assert.equal(device.verificationUrl, 'https://auth.openai.com/codex/device');
assert.equal(device.redirectUri, 'https://auth.openai.com/deviceauth/callback');
assert.deepEqual(requested[0], { url: 'https://auth.openai.com/api/accounts/deviceauth/usercode', body: { client_id: config.clientId } });
for (status of [403, 404]) assert.equal(await pollCodexDeviceCode(config, device, fetchImpl), null);
status = 200;
payload = { authorization_code: 'grant', code_verifier: 'verifier' };
assert.deepEqual(await pollCodexDeviceCode(config, device, fetchImpl), { code: 'grant', verifier: 'verifier' });
assert.deepEqual(requested.at(-1), { url: 'https://auth.openai.com/api/accounts/deviceauth/token', body: { device_auth_id: 'device-secret', user_code: 'ABCD-1234' } });
payload = { device_auth_id: '', user_code: 'ABCD' };
await assert.rejects(requestCodexDeviceCode(config, fetchImpl), /device/i);
payload = { error: 'upstream-secret-must-not-leak' };
status = 500;
await assert.rejects(pollCodexDeviceCode(config, device, fetchImpl), (error: Error) => !error.message.includes('upstream-secret'));

const redirect = 'https://platform.claude.com/oauth/code/callback';
assert.equal(parseOAuthCode(' code#state ', redirect, 'state'), 'code');
assert.equal(parseOAuthCode(`${redirect}?code=code&state=state`, redirect, 'state'), 'code');
assert.equal(parseOAuthCode('code', redirect, 'state'), 'code');
for (const input of ['code#other', `${redirect}?code=code&state=other`, `${redirect}?code=code`, 'https://evil.example/?code=code&state=state', `${redirect}?code=a&code=b&state=state`]) {
  assert.throws(() => parseOAuthCode(input, redirect, 'state'), /code|callback|state/i);
}
console.log('Hosted OAuth primitives passed: device initiation, pending/completion, safe errors and pasted-code state binding');
