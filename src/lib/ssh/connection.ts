import { Client, type ClientChannel, type ConnectConfig } from 'ssh2';
import { DEMO_DISABLED_MESSAGE, isDemoMode } from '@/lib/demo';
import { hostKeyFingerprint } from '@/lib/ssh/fingerprint';

export type SshCredentials =
  | { method: 'password'; password: string }
  | { method: 'privateKey'; privateKey: string; passphrase?: string };

export interface SshTarget {
  host: string;
  port: number;
  username: string;
  credentials: SshCredentials;
  /** Refuse to connect unless the server presents this key. */
  expectedFingerprint?: string | null;
}

export interface OpenShell {
  client: Client;
  channel: ClientChannel;
  fingerprint: string;
  /** A terminal on the machine DevOne runs on: `client` is then a stand-in, not an SSH connection. */
  local?: boolean;
}

/** Why a connection failed, worded for the person at the terminal. */
export class SshConnectError extends Error {
  constructor(
    message: string,
    readonly code: 'auth' | 'host-key' | 'unreachable' | 'timeout' | 'key' | 'shell'
  ) {
    super(message);
    this.name = 'SshConnectError';
  }
}

function describe(error: Error & { level?: string; code?: string }): SshConnectError {
  if (error.level === 'client-authentication') {
    return new SshConnectError('Authentication failed: check the username and credentials', 'auth');
  }
  if (error.level === 'client-timeout' || /timed out/i.test(error.message)) {
    return new SshConnectError('The server did not answer in time', 'timeout');
  }
  if (/private key|passphrase|unsupported key/i.test(error.message)) {
    return new SshConnectError(
      'The private key could not be read; check its format and passphrase',
      'key'
    );
  }
  if (error.code === 'ENOTFOUND') return new SshConnectError('Unknown host', 'unreachable');
  if (error.code === 'ECONNREFUSED') {
    return new SshConnectError('The server refused the connection', 'unreachable');
  }
  return new SshConnectError(`Could not connect: ${error.message}`, 'unreachable');
}

/** Connects and authenticates, pinning nothing: the caller decides what to do with the fingerprint. */
function connectClient(target: SshTarget): Promise<{ client: Client; fingerprint: string }> {
  if (isDemoMode())
    return Promise.reject(new SshConnectError(DEMO_DISABLED_MESSAGE, 'unreachable'));
  return new Promise((resolve, reject) => {
    const client = new Client();
    let fingerprint = '';
    let settled = false;

    const fail = (error: SshConnectError) => {
      if (settled) return;
      settled = true;
      client.end();
      reject(error);
    };

    const config: ConnectConfig = {
      host: target.host,
      port: target.port,
      username: target.username,
      readyTimeout: 15_000,
      keepaliveInterval: 30_000,
      keepaliveCountMax: 3,
      hostVerifier: (key: Buffer) => {
        fingerprint = hostKeyFingerprint(key);
        return !target.expectedFingerprint || target.expectedFingerprint === fingerprint;
      }
    };
    if (target.credentials.method === 'password') {
      config.password = target.credentials.password;
      // Many servers only offer keyboard-interactive for passwords.
      config.tryKeyboard = true;
    } else {
      config.privateKey = target.credentials.privateKey;
      if (target.credentials.passphrase) config.passphrase = target.credentials.passphrase;
    }

    if (target.credentials.method === 'password') {
      const { password } = target.credentials;
      client.on('keyboard-interactive', (_name, _instructions, _lang, prompts, finish) => {
        finish(prompts.map(() => password));
      });
    }

    client.on('error', (error) => {
      if (target.expectedFingerprint && fingerprint && fingerprint !== target.expectedFingerprint) {
        fail(
          new SshConnectError(
            `The server's host key changed (now ${fingerprint}). If the server was rebuilt, remove the saved host and add it again.`,
            'host-key'
          )
        );
        return;
      }
      fail(describe(error));
    });

    client.on('ready', () => {
      if (settled) return;
      settled = true;
      // ssh2 leaves Nagle's algorithm on, which holds back small packets (keystrokes) until the
      // previous one is acknowledged. OpenSSH turns it off for interactive sessions, so do the same.
      client.setNoDelay(true);
      resolve({ client, fingerprint });
    });

    try {
      client.connect(config);
    } catch (error) {
      // ssh2 throws synchronously for a key it cannot parse.
      fail(describe(error as Error));
    }
  });
}

/**
 * Connects and opens an interactive shell with a pseudo-terminal, or runs
 * `command` in one (the way `ssh -t host command` does). Resolves once it is
 * ready, so a failed login never leaves a half-open session.
 */
export async function openShell(
  target: SshTarget,
  size: { cols: number; rows: number },
  command?: string
): Promise<OpenShell> {
  const { client, fingerprint } = await connectClient(target);
  return new Promise((resolve, reject) => {
    const ready = (error: Error | undefined, channel: ClientChannel) => {
      if (error) {
        client.end();
        reject(
          new SshConnectError(
            command
              ? 'The server refused to run the command'
              : 'The server refused to open a shell',
            'shell'
          )
        );
        return;
      }
      resolve({ client, channel, fingerprint });
    };
    const pty = { term: 'xterm-256color', cols: size.cols, rows: size.rows };
    if (command) client.exec(command, { pty }, ready);
    else client.shell(pty, ready);
  });
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  /** Null when the command was killed by a signal. */
  code: number | null;
  fingerprint: string;
}

const COMMAND_TIMEOUT_MS = 20_000;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

/** Runs one command on an already-connected client; the connection stays open. */
export function execOnClient(
  client: Client,
  command: string,
  timeoutMs = COMMAND_TIMEOUT_MS
): Promise<Omit<CommandResult, 'fingerprint'>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new SshConnectError('The command took too long', 'timeout')),
      timeoutMs
    );
    client.exec(command, (error, channel) => {
      if (error) {
        clearTimeout(timer);
        reject(new SshConnectError('The server refused to run the command', 'shell'));
        return;
      }
      let stdout = '';
      let stderr = '';
      channel.on('data', (data: Buffer) => {
        if (stdout.length < MAX_OUTPUT_BYTES) stdout += data.toString('utf8');
      });
      channel.stderr.on('data', (data: Buffer) => {
        if (stderr.length < MAX_OUTPUT_BYTES) stderr += data.toString('utf8');
      });
      channel.on('close', (code: number | null) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, code });
      });
    });
  });
}

/** Runs one command on the server over its own connection and closes it afterwards. */
export async function runCommand(target: SshTarget, command: string): Promise<CommandResult> {
  const { client, fingerprint } = await connectClient(target);
  try {
    return { ...(await execOnClient(client, command)), fingerprint };
  } finally {
    client.end();
  }
}

export interface ExecStream {
  channel: ClientChannel;
  client: Client;
  fingerprint: string;
}

/** Starts a command with no terminal and leaves it running: the caller reads its output and ends it. */
export async function openExecStream(target: SshTarget, command: string): Promise<ExecStream> {
  const { client, fingerprint } = await connectClient(target);
  return new Promise((resolve, reject) => {
    client.exec(command, (error, channel) => {
      if (error) {
        client.end();
        reject(new SshConnectError('The server refused to run the command', 'shell'));
        return;
      }
      resolve({ channel, client, fingerprint });
    });
  });
}
