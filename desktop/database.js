// The desktop app's own PostgreSQL: a real Postgres server (embedded-postgres
// ships its binaries per platform) whose data lives in the app's data folder.
// Started with the app, stopped when it quits; DevOne's Prisma migrations are
// applied on every start, so updates migrate the database too.
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { Client } = require('pg');

const DATABASE = 'devone';
const USER = 'devone';

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/**
 * Starts the embedded Postgres in `dataDir` and returns its connection URL and
 * a stop function. `secret(name)` returns a stored random secret, creating it once.
 */
async function startDatabase({ dataDir, secret, log }) {
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const databaseDir = path.join(dataDir, 'postgres');
  const isNew = !fs.existsSync(path.join(databaseDir, 'PG_VERSION'));
  const password = secret('database-password');
  const port = await freePort();

  const postgres = new EmbeddedPostgres({
    databaseDir,
    port,
    user: USER,
    password,
    persistent: true,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    // Listen on loopback only; nothing outside this computer can reach it.
    postgresFlags: ['-c', 'listen_addresses=127.0.0.1'],
    onLog: (message) => log(String(message).trimEnd()),
    onError: (error) => log(String(error).trimEnd())
  });

  if (isNew) await postgres.initialise();
  await postgres.start();
  if (isNew) await postgres.createDatabase(DATABASE);

  const url = `postgresql://${USER}:${encodeURIComponent(password)}@127.0.0.1:${port}/${DATABASE}`;
  return { url, stop: () => postgres.stop() };
}

/**
 * Applies prisma/migrations/<name>/migration.sql that haven't run yet, recording
 * them in _prisma_migrations the way `prisma migrate deploy` does, so the two
 * stay interchangeable.
 */
async function migrate(databaseUrl, migrationsDir) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" VARCHAR(36) PRIMARY KEY NOT NULL,
      "checksum" VARCHAR(64) NOT NULL,
      "finished_at" TIMESTAMPTZ,
      "migration_name" VARCHAR(255) NOT NULL,
      "logs" TEXT,
      "rolled_back_at" TIMESTAMPTZ,
      "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0
    )`);
    const { rows } = await client.query(
      'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL'
    );
    const applied = new Set(rows.map((row) => row.migration_name));

    const names = fs
      .readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .toSorted();

    for (const name of names) {
      if (applied.has(name)) continue;
      const sql = fs.readFileSync(path.join(migrationsDir, name, 'migration.sql'), 'utf8');
      const id = crypto.randomUUID();
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');
      await client.query(
        'INSERT INTO "_prisma_migrations" (id, checksum, migration_name) VALUES ($1, $2, $3)',
        [id, checksum, name]
      );
      await client.query(sql);
      await client.query(
        'UPDATE "_prisma_migrations" SET finished_at = now(), applied_steps_count = 1 WHERE id = $1',
        [id]
      );
    }
  } finally {
    await client.end();
  }
}

module.exports = { startDatabase, migrate };
