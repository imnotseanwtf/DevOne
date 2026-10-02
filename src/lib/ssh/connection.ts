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

/**
 * Connects and opens an interactive shell with a pseudo-terminal. Resolves once
 * the shell is ready, so a failed login never leaves a half-open session.
 */
export function openShell(
  target: SshTarget,
  size: { cols: number; rows: number }
): Promise<OpenShell> {
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
      client.shell(
        { term: 'xterm-256color', cols: size.cols, rows: size.rows },
        (error, channel) => {
          if (error) {
            fail(new SshConnectError('The server refused to open a shell', 'shell'));
            return;
          }
          settled = true;
          resolve({ client, channel, fingerprint });
        }
      );
    });

    try {
      client.connect(config);
    } catch (error) {
      // ssh2 throws synchronously for a key it cannot parse.
      fail(describe(error as Error));
    }
  });
}
