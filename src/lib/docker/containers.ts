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

export function inspectArgs(containerId: string): string[] {
  return ['inspect', '--type', 'container', containerId];
}

export function statsArgs(containerId: string): string[] {
  return ['stats', '--no-stream', '--format', '{{json .}}', containerId];
}

export const CONTAINER_ACTIONS = ['start', 'stop', 'restart', 'remove'] as const;
export type ContainerAction = (typeof CONTAINER_ACTIONS)[number];

export function controlArgs(action: ContainerAction, containerId: string): string[] {
  return action === 'remove' ? ['rm', '-f', containerId] : [action, containerId];
}

export interface ContainerMount {
  type: string;
  source: string;
  destination: string;
  readWrite: boolean;
}

export interface ContainerDetails {
  id: string;
  name: string;
  image: string;
  imageId: string;
  state: string;
  health: string | null;
  exitCode: number;
  startedAt: string;
  finishedAt: string;
  createdAt: string;
  command: string;
  workingDir: string;
  user: string;
  restartPolicy: string;
  env: { key: string; value: string }[];
  labels: { key: string; value: string }[];
  mounts: ContainerMount[];
  ports: { container: string; host: string }[];
  networks: { name: string; ip: string; gateway: string; mac: string }[];
}

interface InspectJson {
  Id?: string;
  Name?: string;
  Created?: string;
  Path?: string;
  Args?: string[];
  Image?: string;
  State?: {
    Status?: string;
    ExitCode?: number;
    StartedAt?: string;
    FinishedAt?: string;
    Health?: { Status?: string };
  };
  Config?: {
    Image?: string;
    Env?: string[] | null;
    Labels?: Record<string, string> | null;
    WorkingDir?: string;
    User?: string;
  };
  HostConfig?: { RestartPolicy?: { Name?: string } };
  Mounts?: { Type?: string; Source?: string; Destination?: string; RW?: boolean }[] | null;
  NetworkSettings?: {
    Ports?: Record<string, { HostIp?: string; HostPort?: string }[] | null> | null;
    Networks?: Record<string, { IPAddress?: string; Gateway?: string; MacAddress?: string }> | null;
  };
}

const NEVER = '0001-01-01T00:00:00Z';

const pairs = (entries: [string, string][]) =>
  entries.map(([key, value]) => ({ key, value })).toSorted((a, b) => a.key.localeCompare(b.key));

export function parseInspect(output: string): ContainerDetails | null {
  let row: InspectJson | undefined;
  try {
    row = (JSON.parse(output) as InspectJson[])[0];
  } catch {
    return null;
  }
  if (!row?.Id) return null;
  const env = (row.Config?.Env ?? []).map((line): [string, string] => {
    const at = line.indexOf('=');
    return at < 0 ? [line, ''] : [line.slice(0, at), line.slice(at + 1)];
  });
  return {
    id: row.Id,
    name: (row.Name ?? '').replace(/^\//, '') || row.Id.slice(0, 12),
    image: row.Config?.Image ?? '',
    imageId: row.Image ?? '',
    state: row.State?.Status ?? '',
    health: row.State?.Health?.Status ?? null,
    exitCode: row.State?.ExitCode ?? 0,
    startedAt: row.State?.StartedAt && row.State.StartedAt !== NEVER ? row.State.StartedAt : '',
    finishedAt: row.State?.FinishedAt && row.State.FinishedAt !== NEVER ? row.State.FinishedAt : '',
    createdAt: row.Created ?? '',
    command: [row.Path, ...(row.Args ?? [])].filter(Boolean).join(' '),
    workingDir: row.Config?.WorkingDir ?? '',
    user: row.Config?.User ?? '',
    restartPolicy: row.HostConfig?.RestartPolicy?.Name || 'no',
    env: pairs(env),
    labels: pairs(Object.entries(row.Config?.Labels ?? {})),
    mounts: (row.Mounts ?? []).map((mount) => ({
      type: mount.Type ?? '',
      source: mount.Source ?? '',
      destination: mount.Destination ?? '',
      readWrite: mount.RW ?? true
    })),
    ports: Object.entries(row.NetworkSettings?.Ports ?? {}).flatMap(([container, bindings]) =>
      bindings && bindings.length > 0
        ? bindings.map((binding) => ({
            container,
            host: `${binding.HostIp ?? ''}:${binding.HostPort ?? ''}`
          }))
        : [{ container, host: '' }]
    ),
    networks: Object.entries(row.NetworkSettings?.Networks ?? {}).map(([name, network]) => ({
      name,
      ip: network.IPAddress ?? '',
      gateway: network.Gateway ?? '',
      mac: network.MacAddress ?? ''
    }))
  };
}

export interface ContainerStats {
  cpuPercent: number;
  memoryPercent: number;
  memoryUsage: string;
  networkIo: string;
  blockIo: string;
  pids: number;
}

const percent = (value: string | undefined) => Number.parseFloat(value ?? '') || 0;

export function parseStats(output: string): ContainerStats | null {
  const line = output.split('\n').find((entry) => entry.trim().startsWith('{'));
  if (!line) return null;
  try {
    const row = JSON.parse(line) as Record<string, string>;
    return {
      cpuPercent: percent(row.CPUPerc),
      memoryPercent: percent(row.MemPerc),
      memoryUsage: row.MemUsage ?? '',
      networkIo: row.NetIO ?? '',
      blockIo: row.BlockIO ?? '',
      pids: Number.parseInt(row.PIDs ?? '', 10) || 0
    };
  } catch {
    return null;
  }
}

/** `docker` plus quoted arguments, as one line for the remote shell. */
export function remoteDockerCommand(args: string[]): string {
  return ['docker', ...args.map(shellQuote)].join(' ');
}
