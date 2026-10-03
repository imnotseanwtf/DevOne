// Starts the desktop app's embedded PostgreSQL in a fresh folder, applies the
// migrations, stops it and starts it again: what a first and second launch do.
// Run by CI on each desktop platform: `node desktop/smoke-test.cjs`.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Client } = require('pg');
const { migrate, startDatabase } = require('./database');

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
  } finally {
    await database.stop();
  }
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
