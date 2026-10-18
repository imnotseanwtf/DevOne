const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const repo = createRequire(process.cwd() + '/package.json');
const { chromium } = require(process.env.DEVONE_PLAYWRIGHT_PATH || 'playwright');
const env = { ...repo('dotenv').parse(fs.readFileSync('.env')), ...process.env };
const config = repo('./src/lib/ai-router/registry.ts').getProviderDefinition('codex', env).oauth;
assert.ok(['localhost', '127.0.0.1'].includes(new URL(env.DEVONE_APP_URL).hostname));
assert.equal(config.redirectUri, 'http://localhost:1455/auth/callback');
const { Pool } = repo('pg');
const { createSessionToken, hashSessionToken } = repo('./src/lib/auth/session-token.ts');
const db = new Pool({ connectionString: env.DATABASE_URL });
const id = 'codex-ui-' + crypto.randomBytes(6).toString('hex');
const token = createSessionToken();
let browser;
(async () => {
  await db.query('INSERT INTO "User" (id,provider,"providerUserId",username,role,"updatedAt") VALUES ($1,\'GITHUB\',$1,$1,\'ADMIN\',now())', [id]);
  await db.query('INSERT INTO "Session" (id,"tokenHash","userId","expiresAt") VALUES ($1,$2,$1,now()+interval \'10 minutes\')', [id, hashSessionToken(token)]);
  await db.query('INSERT INTO "AiProvider" (id,name,"providerType",format,"authType","baseUrl",models,"updatedAt") VALUES ($1,$1,\'codex\',\'openai-responses\',\'oauth\',\'https://chatgpt.com/backend-api/codex\',ARRAY[\'gpt-6.1-sol\',\'gpt-6-astra\'],now())', [id]);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.addCookies([{ name: 'devone_session', value: token, url: env.DEVONE_APP_URL, httpOnly: true, sameSite: 'Lax' }]);
  // Exercise app navigation and PKCE storage; external consent remains the user's step.
  await context.route('https://auth.openai.com/oauth/authorize**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Controlled Codex consent page</h1>' }));
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const states = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.goto(env.DEVONE_APP_URL + '/router?tab=providers&provider=' + id, { waitUntil: 'networkidle' });
    await Promise.all([
      page.waitForURL('https://auth.openai.com/oauth/authorize**'),
      page.getByRole('button', { name: 'Add account', exact: true }).click()
    ]);
    const auth = new URL(page.url());
    assert.equal(auth.searchParams.get('client_id'), config.clientId);
    assert.equal(auth.searchParams.get('redirect_uri'), config.redirectUri);
    assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(auth.searchParams.get('originator'), 'codex_cli_rs');
    assert.equal(auth.searchParams.get('id_token_add_organizations'), 'true');
    assert.equal(auth.searchParams.get('codex_cli_simplified_flow'), 'true');
    const state = auth.searchParams.get('state');
    assert.ok(state && auth.searchParams.get('code_challenge'));
    states.push(state);
    const saved = (await db.query('SELECT "providerId","userId","redirectUri","encryptedCodeVerifier" FROM "AiOAuthSession" WHERE "stateHash"=$1', [crypto.createHash('sha256').update(state).digest('hex')])).rows[0];
    assert.equal(saved.userId, id);
    assert.equal(saved.providerId, id);
    assert.equal(saved.redirectUri, config.redirectUri);
    assert.ok(saved.encryptedCodeVerifier.startsWith('v1.'));
    await page.goto(config.redirectUri + '?state=' + encodeURIComponent(state) + '&error=access_denied', { waitUntil: 'networkidle' });
    assert.equal(new URL(page.url()).pathname, '/router');
    assert.equal(new URL(page.url()).searchParams.get('aiOAuth'), 'error');
  }
  assert.notEqual(states[0], states[1]);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM "AiConnection" WHERE "providerId"=$1', [id])).rows[0].count, 0);
  const unknown = await context.request.get(config.redirectUri + '?state=unknown&code=fixture', { maxRedirects: 0 });
  assert.equal(unknown.status(), 400);
  assert.deepEqual(errors, []);
  console.log('Codex browser checks passed: native sign-in, encrypted PKCE, reusable Add account, callback relay, cancellation and unknown state');
})().catch(() => {
  console.error('Codex browser check failed; no sign-in URLs or credentials printed');
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  await db.query('DELETE FROM "AiProvider" WHERE id=$1', [id]);
  await db.query('DELETE FROM "AuditEvent" WHERE "actorId"=$1', [id]);
  await db.query('DELETE FROM "User" WHERE id=$1', [id]);
  await db.end();
});
