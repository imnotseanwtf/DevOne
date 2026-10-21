import { execFile } from 'node:child_process';
import { LOG_TAIL_LINES } from '@/lib/docker/limits';

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  /** running, exited, paused, restarting, created, dead */
  state: string;
  /** Docker's human text, e.g. "Up 3 hours" or "Exited (0) 2 days ago". */
  status: string;
  ports: string;
  createdAt: string;
}

export class DockerError extends Error {
  constructor(
    message: string,
    readonly code: 'missing' | 'permission' | 'daemon' | 'failed'
  ) {
    super(message);
    this.name = 'DockerError';
  }
}

/** One JSON object per line: stable across Docker versions, unlike the table output. */
export const LIST_CONTAINERS_ARGS = ['ps', '-a', '--no-trunc', '--format', '{{json .}}'] as const;
export const LIST_CONTAINERS_COMMAND = `docker ${LIST_CONTAINERS_ARGS.map((arg) => `'${arg}'`).join(' ')}`;

interface PsLine {
  ID?: string;
  Names?: string;
  Image?: string;
  State?: string;
  Status?: string;
  Ports?: string;
  CreatedAt?: string;
}

export function parseContainers(output: string): ContainerInfo[] {
  const containers: ContainerInfo[] = [];
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const row = JSON.parse(trimmed) as PsLine;
      if (!row.ID) continue;
      containers.push({
        id: row.ID,
        name: row.Names ?? row.ID.slice(0, 12),
        image: row.Image ?? '',
        state: row.State ?? '',
        status: row.Status ?? '',
        ports: row.Ports ?? '',
        createdAt: row.CreatedAt ?? ''
      });
    } catch {
      // Not a container row (a warning line, say): skip it.
    }
  }
  // Running first, then by name.
  return containers.toSorted(
    (a, b) =>
      Number(b.state === 'running') - Number(a.state === 'running') || a.name.localeCompare(b.name)
  );
}

/** Turns a failed `docker ps` into something the person can act on. */
export function dockerFailure(stderr: string, code: number | null): DockerError {
  if (code === 127 || /command not found|not found|no such file|not recognized/i.test(stderr)) {
    return new DockerError("Docker isn't installed on this machine", 'missing');
  }
  if (/permission denied/i.test(stderr)) {
    return new DockerError(
      "This user can't use Docker. Add it to the docker group or use a user that can.",
      'permission'
    );
  }
  if (/cannot connect to the docker daemon|is the docker daemon running/i.test(stderr)) {
    return new DockerError("Docker is installed but isn't running", 'daemon');
  }
  if (/no such container/i.test(stderr)) {
    return new DockerError('That container no longer exists', 'failed');
  }
  return new DockerError('Docker returned an error', 'failed');
}

export interface DockerResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

/** Runs `docker <args>` on the machine DevOne itself runs on. */
export function runLocalDocker(args: string[], timeoutMs = 20_000): Promise<DockerResult> {
  return new Promise((resolve, reject) => {
    execFile(
      'docker',
      args,
      { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ stdout, stderr, code: 0 });
          return;
        }
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          reject(dockerFailure('command not found', 127));
          return;
        }
        if (error.killed) {
          reject(new DockerError('The command took too long', 'failed'));
          return;
        }
        resolve({ stdout, stderr, code: typeof code === 'number' ? code : 1 });
      }
    );
  });
}

/** Containers on the machine DevOne itself runs on. */
export async function listLocalContainers(): Promise<ContainerInfo[]> {
  const result = await runLocalDocker([...LIST_CONTAINERS_ARGS], 15_000);
  if (result.code !== 0) throw dockerFailure(result.stderr, result.code);
  return parseContainers(result.stdout);
}

/** Full ids are 64 hex characters; `docker ps` prints them whole with --no-trunc. */
export const CONTAINER_ID = /^[a-f0-9]{12,64}$/;

/** Quotes one argument for a POSIX shell, for commands sent over SSH. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function logsArgs(containerId: string, tail = LOG_TAIL_LINES): string[] {
  return ['logs', '--tail', String(tail), '--timestamps', containerId];
}

export function execArgs(containerId: string, command: string): string[] {
  return ['exec', containerId, 'sh', '-c', command];
}

/** `docker` plus quoted arguments, as one line for the remote shell. */
export function remoteDockerCommand(args: string[]): string {
  return ['docker', ...args.map(shellQuote)].join(' ');
}
