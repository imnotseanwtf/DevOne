import { execFile } from 'node:child_process';

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
  return new DockerError('Docker could not list the containers', 'failed');
}

/** Containers on the machine DevOne itself runs on. */
export function listLocalContainers(): Promise<ContainerInfo[]> {
  return new Promise((resolve, reject) => {
    execFile(
      'docker',
      [...LIST_CONTAINERS_ARGS],
      { timeout: 15_000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === 'ENOENT') {
            reject(dockerFailure('command not found', 127));
            return;
          }
          const exit = typeof code === 'number' ? code : 1;
          reject(dockerFailure(stderr, exit));
          return;
        }
        resolve(parseContainers(stdout));
      }
    );
  });
}
