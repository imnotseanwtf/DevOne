import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { Client, ClientChannel } from 'ssh2';
import type { OpenShell } from '@/lib/ssh/connection';
import { DockerError } from '@/lib/docker/containers';

/** Bash if the image has it, otherwise sh. */
export const CONTAINER_SHELL_SCRIPT = 'command -v bash >/dev/null 2>&1 && exec bash || exec sh';

/**
 * An interactive `docker exec -it` on the machine DevOne runs on.
 *
 * Node has no built-in pseudo-terminal, so util-linux/BSD `script` provides one
 * (no native module to build). It looks like an SSH shell to the session store:
 * the adapter below carries only the few members that store uses. The terminal
 * is sized once; later resizes are ignored.
 */
export function openLocalContainerShell(
  containerId: string,
  size: { cols: number; rows: number }
): Promise<OpenShell> {
  // The id is validated as hex by the caller; sizes are integers from the schema.
  const inner = `stty cols ${size.cols} rows ${size.rows}; exec docker exec -it ${containerId} sh -c '${CONTAINER_SHELL_SCRIPT}'`;
  const args =
    process.platform === 'darwin'
      ? ['-q', '/dev/null', 'sh', '-c', inner]
      : ['-q', '-f', '-e', '-c', inner, '/dev/null'];

  return new Promise((resolve, reject) => {
    const child = spawn('script', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const channel = new EventEmitter() as EventEmitter & {
      stderr: EventEmitter;
      write: (data: string) => void;
      setWindow: () => void;
    };
    channel.stderr = new EventEmitter();
    channel.write = (data) => void child.stdin.write(data);
    channel.setWindow = () => {};
    const client = new EventEmitter() as EventEmitter & { end: () => void };
    client.end = () => void child.kill('SIGHUP');

    // The session store attaches its listener a tick after this resolves; hold early output for it.
    const early: Buffer[] = [];
    channel.on('newListener', (event) => {
      if (event !== 'data' || early.length === 0) return;
      queueMicrotask(() => {
        for (const chunk of early.splice(0)) channel.emit('data', chunk);
      });
    });
    child.stdout.on('data', (data: Buffer) => {
      if (channel.listenerCount('data') > 0) channel.emit('data', data);
      else early.push(data);
    });
    child.stderr.on('data', (data: Buffer) => channel.stderr.emit('data', data));
    child.on('close', () => {
      channel.emit('close');
      client.emit('close');
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      reject(
        error.code === 'ENOENT'
          ? new DockerError(
              "This machine can't open a terminal (the script command is missing)",
              'missing'
            )
          : new DockerError('Could not open a terminal in the container', 'failed')
      );
    });
    // `script` is running; a missing docker or container ends it right away and
    // the session reports that through its normal exit path.
    child.on('spawn', () =>
      resolve({
        client: client as unknown as Client,
        channel: channel as unknown as ClientChannel,
        fingerprint: ''
      })
    );
  });
}
