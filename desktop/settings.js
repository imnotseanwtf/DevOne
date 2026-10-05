// Database settings for the desktop app: its built-in PostgreSQL, or one the user
// connects to on the setup screen (setup.html). Kept apart from main.js, with no
// Electron imports, so the smoke test can exercise it with plain Node.
//
// config.json keeps them under "database":
//   { "mode": "builtin" }
//   { "mode": "external", "host", "port", "database", "user", "ssl" }
// The external database's password is never in config.json; main.js stores it
// with the OS keychain like the app's other secrets.
const crypto = require('node:crypto');
const { Client } = require('pg');

const SSL_MODES = ['disable', 'verify-full', 'no-verify'];
const CONNECT_TIMEOUT_MS = 10_000;

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * Checks what the setup screen sent. Returns { settings, password, encryptionKey }
 * or throws an Error whose message is shown on the form. `encryptionKey` is
 * undefined when the field was left empty (keep this computer's key).
 */
function parseDatabaseInput(input) {
  if (!input || typeof input !== 'object') throw new Error('Missing database settings');
  if (input.mode === 'builtin') return { settings: { mode: 'builtin' } };
  if (input.mode !== 'external') throw new Error('Choose a database');

  const host = text(input.host);
  const database = text(input.database);
  const user = text(input.user);
  const port = Number(text(String(input.port ?? '')) || 5432);
  const ssl = SSL_MODES.includes(input.ssl) ? input.ssl : 'disable';
  const password = typeof input.password === 'string' ? input.password : '';

  if (!host) throw new Error('Enter the database host');
  if (/[\s/?#@]/.test(host)) throw new Error('The host should be a name or IP address only');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Enter a valid port');
  if (!database) throw new Error('Enter the database name');
  if (!user) throw new Error('Enter the database user');

  const key = text(input.encryptionKey);
  if (key && !isEncryptionKey(key)) {
    throw new Error('The encryption key should be 44 characters of base64 (32 bytes)');
  }

  return {
    settings: { mode: 'external', host, port, database, user, ssl },
    password,
    encryptionKey: key || undefined
  };
}

/** DEVONE_ENCRYPTION_KEY's format: 32 bytes as base64 (src/lib/encryption/secrets.ts). */
function isEncryptionKey(value) {
  return /^[A-Za-z0-9+/]{43}=$/.test(value) && Buffer.from(value, 'base64').length === 32;
}

/** The connection URL the DevOne server (Prisma's pg adapter) and the migrations use. */
function databaseUrl(settings, password) {
  const host = settings.host.includes(':') ? `[${settings.host}]` : settings.host;
  const auth = password
    ? `${encodeURIComponent(settings.user)}:${encodeURIComponent(password)}`
    : encodeURIComponent(settings.user);
  return `postgresql://${auth}@${host}:${settings.port}/${encodeURIComponent(settings.database)}?sslmode=${settings.ssl}`;
}

/** AES-256-GCM, the "v1.<iv>.<tag>.<ciphertext>" format of src/lib/encryption/secrets.ts. */
function canDecrypt(value, encryptionKey) {
  try {
    const [version, iv, tag, ciphertext] = value.split('.');
    if (version !== 'v1') return false;
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      Buffer.from(encryptionKey, 'base64'),
      Buffer.from(iv, 'base64url')
    );
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    decipher.update(Buffer.from(ciphertext, 'base64url'));
    decipher.final();
    return true;
  } catch {
    return false;
  }
}

/** PostgreSQL and network errors, in words for the setup screen. */
function describeError(error, settings) {
  const where = `${settings.host}:${settings.port}`;
  switch (error?.code) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return `Can't find the host "${settings.host}". Check the name, or your network or VPN.`;
    case 'ECONNREFUSED':
      return `Nothing is accepting connections on ${where}. Is PostgreSQL running, and is the port right?`;
    case 'ETIMEDOUT':
    case 'ECONNRESET':
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return `Can't reach ${where}. A firewall, VPN or network setting may be blocking it.`;
    case '28P01':
    case '28000':
      return `PostgreSQL refused the user "${settings.user}": ${error.message}`;
    case '3D000':
      return `The database "${settings.database}" doesn't exist on this server. Create it first.`;
    default:
      break;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout/i.test(message)) {
    return `No answer from ${where} within ${CONNECT_TIMEOUT_MS / 1000} seconds. Check the host, port and firewall.`;
  }
  if (/ssl|certificate|self[- ]signed/i.test(message)) {
    return `SSL problem: ${message}. Try another SSL setting.`;
  }
  return message;
}

/**
 * Connects with these settings and reports what it found:
 * { ok: true, version, hasDevOne, keyMatches } or { ok: false, error }.
 * `keyMatches` is null when there's nothing encrypted to check the key against.
 */
async function testConnection(settings, password, encryptionKey) {
  const client = new Client({
    connectionString: databaseUrl(settings, password),
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS
  });
  try {
    await client.connect();
    const { rows } = await client.query(
      `SELECT current_setting('server_version') AS version,
              to_regclass('public."_prisma_migrations"') IS NOT NULL AS has_devone,
              to_regclass('public."GitConnection"') IS NOT NULL AS has_tokens`
    );
    const { has_devone: hasDevOne, has_tokens: hasTokens } = rows[0];
    // "16.4 (Ubuntu 16.4-1)" -> "16.4"
    const version = String(rows[0].version).split(' ')[0];

    let keyMatches = null;
    if (hasTokens && encryptionKey) {
      const tokens = await client.query('SELECT "encryptedToken" FROM "GitConnection" LIMIT 1');
      if (tokens.rows.length) keyMatches = canDecrypt(tokens.rows[0].encryptedToken, encryptionKey);
    }
    return { ok: true, version, hasDevOne, keyMatches };
  } catch (error) {
    return { ok: false, error: describeError(error, settings) };
  } finally {
    await client.end().catch(() => {});
  }
}

/** Whether the setup screen still has to be shown: nothing chosen yet. */
function needsSetup(config, hasBuiltinData) {
  if (config.databaseUrl) return false;
  if (config.database?.mode === 'builtin' || config.database?.mode === 'external') return false;
  // Installs from before the setup screen already use the built-in database.
  return !hasBuiltinData;
}

module.exports = {
  SSL_MODES,
  canDecrypt,
  databaseUrl,
  isEncryptionKey,
  needsSetup,
  parseDatabaseInput,
  testConnection
};
