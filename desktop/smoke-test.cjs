// Starts the desktop app's embedded PostgreSQL in a fresh folder, applies the
// migrations, stops it and starts it again: what a first and second launch do.
// Also checks the setup screen's connection test (settings.js) against it.
// Run by CI on each desktop platform: `node desktop/smoke-test.cjs`.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Client } = require('pg');
const { migrate, startDatabase } = require('./database');
const {
  canDecrypt,
  databaseUrl,
  needsSetup,
  parseDatabaseInput,
  testConnection
} = require('./settings');

const migrationsDir = path.join(__dirname, '..', 'prisma', 'migrations');
const migrationCount = fs
  .readdirSync(migrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;

async function launch(dataDir, secrets) {
  const database = await startDatabase({
    dataDir,
    secret: (name) => (secrets[name] ??= crypto.randomBytes(32).toString('base64')),
    log: (message) => process.stdout.write(`[postgres] ${message}\n`)
  });
  try {
    await migrate(database.url, migrationsDir);
    const client = new Client({ connectionString: database.url });
    await client.connect();
    const { rows } = await client.query(
      'SELECT count(*)::int AS applied FROM "_prisma_migrations" WHERE finished_at IS NOT NULL'
    );
    await client.end();
    assert.equal(rows[0].applied, migrationCount);
    await checkSetupScreen(database.url);
  } finally {
    await database.stop();
  }
}

// What the setup screen does with a server's details, run against the built-in database.
async function checkSetupScreen(url) {
  const { hostname, port, username, password } = new URL(url);
  const { settings } = parseDatabaseInput({
    mode: 'external',
    host: hostname,
    port,
    database: 'devone',
    user: username,
    password: decodeURIComponent(password),
    ssl: 'disable'
  });
  assert.equal(databaseUrl(settings, decodeURIComponent(password)), `${url}?sslmode=disable`);

  const found = await testConnection(settings, decodeURIComponent(password));
  assert.equal(found.ok, true, found.error);
  assert.equal(found.hasDevOne, true);
  assert.equal(found.keyMatches, null);

  const wrongPassword = await testConnection(settings, 'not-the-password');
  assert.equal(wrongPassword.ok, false);
  const missing = await testConnection(
    { ...settings, database: 'no_such_db' },
    decodeURIComponent(password)
  );
  assert.match(missing.error, /doesn't exist/);

  assert.throws(() => parseDatabaseInput({ mode: 'external', host: '', database: 'd', user: 'u' }));
  assert.throws(() =>
    parseDatabaseInput({ ...settings, mode: 'external', encryptionKey: 'too-short' })
  );
  assert.equal(needsSetup({}, false), true);
  assert.equal(needsSetup({}, true), false);
  assert.equal(needsSetup({ database: { mode: 'builtin' } }, false), false);

  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update('token'), cipher.final()]);
  const sealed = ['v1', iv, cipher.getAuthTag(), ciphertext]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join('.');
  assert.equal(canDecrypt(sealed, key.toString('base64')), true);
  assert.equal(canDecrypt(sealed, crypto.randomBytes(32).toString('base64')), false);
}

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devone-smoke-'));
  const secrets = {};
  await launch(dataDir, secrets);
  await launch(dataDir, secrets);
  process.stdout.write(`Desktop database smoke test passed (${migrationCount} migrations)\n`);
})().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
