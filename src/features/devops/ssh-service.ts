import { SshAuthMethod } from '@/generated/prisma/client';
import type { NewSshConnection } from '@/features/devops/schema';
import { getTerminalPolicy } from '@/features/project-settings/service';
import { recordAudit } from '@/lib/audit/record';
import { getPrisma } from '@/lib/db/prisma';
import { matchesAnyGlob } from '@/lib/glob';
import { decryptSecret, encryptSecret, getEncryptionKey } from '@/lib/encryption/secrets';
import {
  openExecStream,
  openShell,
  runCommand,
  SshConnectError,
  type SshCredentials
} from '@/lib/ssh/connection';
import {
  type ContainerInfo,
  DockerError,
  dockerFailure,
  controlArgs,
  followEventsArgs,
  followLocalDocker,
  followLogsArgs,
  followRawLogsArgs,
  type LogStream,
  type ContainerAction,
  type ContainerDetails,
  type ContainerStats,
  inspectArgs,
  LIST_CONTAINERS_ARGS,
  parseContainers,
  parseInspect,
  parseStats,
  remoteDockerCommand,
  runLocalDocker,
  statsArgs,
  type DockerResult
} from '@/lib/docker/containers';
import { CONTAINER_SHELL_SCRIPT, openLocalContainerShell } from '@/lib/docker/local-shell';
import { type TrafficTarget, trafficTarget } from '@/lib/docker/access-log';
import { isDemoMode } from '@/lib/demo';
import {
  countSshSessions,
  createSshSession,
  MAX_SESSIONS_PER_USER,
  type SshSession
} from '@/lib/ssh/session-store';

export class SshHostAccessError extends Error {
  constructor() {
    super('Saved host not found');
    this.name = 'SshHostAccessError';
  }
}

async function requireMembership(userId: string, projectId: string) {
  const member = await getPrisma().projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: { id: true }
  });
  if (!member) throw new SshHostAccessError();
}

/** Why the project's settings refuse this connection, worded for the terminal. */
export class TerminalPolicyError extends Error {
  constructor(readonly reason: 'disabled' | 'owners' | 'host') {
    super(
      reason === 'disabled'
        ? 'The terminal is turned off for this project'
        : reason === 'owners'
          ? 'Only project owners can use the terminal'
          : "This host isn't in the project's allowed hosts"
    );
    this.name = 'TerminalPolicyError';
  }
}

async function requireTerminalAccess(userId: string, projectId: string, host: string) {
  const policy = await getTerminalPolicy(userId, projectId).catch(() => {
    throw new SshHostAccessError();
  });
  if (!policy.allowed) {
    throw new TerminalPolicyError(policy.terminalAccess === 'DISABLED' ? 'disabled' : 'owners');
  }
  if (policy.sshAllowedHosts.length > 0 && !matchesAnyGlob(host, policy.sshAllowedHosts)) {
    throw new TerminalPolicyError('host');
  }
}

/** The caller's saved hosts in a project, without their secrets. */
export async function listSshHosts(userId: string, projectId: string) {
  await requireMembership(userId, projectId);
  return getPrisma().sshHost.findMany({
    where: { projectId, ownerId: userId },
    select: {
      id: true,
      name: true,
      host: true,
      port: true,
      username: true,
      authMethod: true,
      hostKeyFingerprint: true,
      lastConnectedAt: true
    },
    orderBy: { name: 'asc' }
  });
}

export type SavedSshHost = Awaited<ReturnType<typeof listSshHosts>>[number];

export async function deleteSshHost(userId: string, hostId: string): Promise<void> {
  const host = await getPrisma().sshHost.findFirst({
    where: { id: hostId, ownerId: userId },
    select: { name: true, projectId: true }
  });
  if (!host) throw new SshHostAccessError();
  await getPrisma().sshHost.delete({ where: { id: hostId } });
  await recordAudit({
    actorId: userId,
    projectId: host.projectId,
    action: 'terminal.host.delete',
    target: host.name
  });
}

/** Every saved host of the caller, across projects, for My account. */
export async function listAllSshHosts(userId: string) {
  return getPrisma().sshHost.findMany({
    where: { ownerId: userId },
    select: {
      id: true,
      name: true,
      host: true,
      port: true,
      username: true,
      authMethod: true,
      hostKeyFingerprint: true,
      lastConnectedAt: true,
      project: { select: { id: true, name: true } }
    },
    orderBy: [{ project: { name: 'asc' } }, { name: 'asc' }]
  });
}

export async function renameSshHost(userId: string, hostId: string, name: string) {
  const host = await getPrisma().sshHost.findFirst({
    where: { id: hostId, ownerId: userId },
    select: { projectId: true }
  });
  if (!host) throw new SshHostAccessError();
  const taken = await getPrisma().sshHost.findFirst({
    where: { projectId: host.projectId, ownerId: userId, name, id: { not: hostId } },
    select: { id: true }
  });
  if (taken) throw new SshConnectError('You already have a saved server with that name', 'shell');
  await getPrisma().sshHost.update({ where: { id: hostId }, data: { name } });
}

/** Forgets the pinned host key: the next connection pins whatever the server presents. */
export async function resetSshHostKey(userId: string, hostId: string) {
  const host = await getPrisma().sshHost.findFirst({
    where: { id: hostId, ownerId: userId },
    select: { name: true, projectId: true }
  });
  if (!host) throw new SshHostAccessError();
  await getPrisma().sshHost.update({ where: { id: hostId }, data: { hostKeyFingerprint: null } });
  await recordAudit({
    actorId: userId,
    projectId: host.projectId,
    action: 'terminal.host.reset-key',
    target: host.name
  });
}

function credentialsOf(connection: NewSshConnection): SshCredentials {
  return connection.authMethod === 'password'
    ? { method: 'password', password: connection.password }
    : {
        method: 'privateKey',
        privateKey: connection.privateKey,
        passphrase: connection.passphrase || undefined
      };
}

/** A name not yet used by this person in this project: "web-1", "web-1 (2)", … */
async function freeHostName(userId: string, projectId: string, wanted: string) {
  const taken = new Set(
    (
      await getPrisma().sshHost.findMany({
        where: { projectId, ownerId: userId },
        select: { name: true }
      })
    ).map((host) => host.name)
  );
  if (!taken.has(wanted)) return wanted;
  for (let suffix = 2; ; suffix++) {
    const name = `${wanted} (${suffix})`;
    if (!taken.has(name)) return name;
  }
}

function assertSessionCapacity(userId: string) {
  if (countSshSessions(userId) >= MAX_SESSIONS_PER_USER) {
    throw new SshConnectError(
      `You already have ${MAX_SESSIONS_PER_USER} terminals open. Close one first.`,
      'shell'
    );
  }
}

interface Size {
  cols: number;
  rows: number;
}

export interface ConnectedSession {
  session: SshSession;
  fingerprint: string;
  /** Set when the credentials were saved (or came from a saved host). */
  hostId: string | null;
}

/** Connects with credentials typed in now, and saves them only if the login worked. */
export async function connectNewSsh(
  userId: string,
  projectId: string,
  connection: NewSshConnection,
  size: Size
): Promise<ConnectedSession> {
  await requireTerminalAccess(userId, projectId, connection.host);
  assertSessionCapacity(userId);

  const shell = await openShell(
    {
      host: connection.host,
      port: connection.port,
      username: connection.username,
      credentials: credentialsOf(connection)
    },
    size
  );
  const label = `${connection.username}@${connection.host}`;

  let hostId: string | null = null;
  if (connection.save)
    hostId = await saveHost(userId, projectId, connection, label, shell.fingerprint).catch(
      (error: unknown) => {
        shell.client.end();
        throw error;
      }
    );

  const session = createSshSession({ userId, projectId, label, shell });
  await recordAudit({
    actorId: userId,
    projectId,
    action: 'terminal.connect',
    target: `${label}:${connection.port}`,
    details: { saved: hostId !== null }
  });
  return { session, fingerprint: shell.fingerprint, hostId };
}

async function saveHost(
  userId: string,
  projectId: string,
  connection: NewSshConnection,
  label: string,
  fingerprint: string
): Promise<string> {
  {
    const key = getEncryptionKey();
    const secret =
      connection.authMethod === 'password' ? connection.password : connection.privateKey;
    const saved = await getPrisma().sshHost.create({
      data: {
        projectId,
        ownerId: userId,
        name: await freeHostName(userId, projectId, connection.name || label),
        host: connection.host,
        port: connection.port,
        username: connection.username,
        authMethod:
          connection.authMethod === 'password' ? SshAuthMethod.PASSWORD : SshAuthMethod.PRIVATE_KEY,
        encryptedSecret: encryptSecret(secret, key),
        encryptedPassphrase:
          connection.authMethod === 'privateKey' && connection.passphrase
            ? encryptSecret(connection.passphrase, key)
            : null,
        hostKeyFingerprint: fingerprint,
        lastConnectedAt: new Date()
      },
      select: { id: true, name: true }
    });
    await recordAudit({
      actorId: userId,
      projectId,
      action: 'terminal.host.save',
      target: saved.name
    });
    return saved.id;
  }
}

type SavedHostRow = NonNullable<Awaited<ReturnType<typeof findSavedHost>>>;

function findSavedHost(userId: string, projectId: string, hostId: string) {
  return getPrisma().sshHost.findFirst({ where: { id: hostId, projectId, ownerId: userId } });
}

function savedCredentials(host: SavedHostRow): SshCredentials {
  const key = getEncryptionKey();
  const secret = decryptSecret(host.encryptedSecret, key);
  return host.authMethod === SshAuthMethod.PASSWORD
    ? { method: 'password', password: secret }
    : {
        privateKey: secret,
        method: 'privateKey',
        passphrase: host.encryptedPassphrase
          ? decryptSecret(host.encryptedPassphrase, key)
          : undefined
      };
}

/** Connects to a saved host without asking for anything. */
export async function connectSavedSsh(
  userId: string,
  projectId: string,
  hostId: string,
  size: Size
): Promise<ConnectedSession> {
  const host = await findSavedHost(userId, projectId, hostId);
  if (!host) throw new SshHostAccessError();
  await requireTerminalAccess(userId, projectId, host.host);
  assertSessionCapacity(userId);

  const credentials = savedCredentials(host);

  const shell = await openShell(
    {
      host: host.host,
      port: host.port,
      username: host.username,
      credentials,
      expectedFingerprint: host.hostKeyFingerprint
    },
    size
  );
  // Pins the key on the first connection; later ones were already verified against it.
  await getPrisma()
    .sshHost.update({
      where: { id: host.id },
      data: { lastConnectedAt: new Date(), hostKeyFingerprint: shell.fingerprint }
    })
    .catch((error: unknown) => {
      shell.client.end();
      throw error;
    });

  const session = createSshSession({ userId, projectId, label: host.name, shell });
  await recordAudit({
    actorId: userId,
    projectId,
    action: 'terminal.connect',
    target: `${host.username}@${host.host}:${host.port}`,
    details: { saved: true, name: host.name }
  });
  return { session, fingerprint: shell.fingerprint, hostId: host.id };
}

export type ContainerSource = { kind: 'local' } | { kind: 'host'; hostId: string };

/**
 * Checks the caller may run commands on `source`: the terminal permission for
 * a saved server too, since Docker access is shell access. The local machine is
 * DevOne's own host, so it is for project owners only. Returns the saved host.
 */
async function authorizeSource(
  userId: string,
  projectId: string,
  source: ContainerSource
): Promise<SavedHostRow | null> {
  if (isDemoMode()) throw new DockerError('Containers are turned off in the public demo', 'failed');

  if (source.kind === 'local') {
    const policy = await getTerminalPolicy(userId, projectId).catch(() => {
      throw new SshHostAccessError();
    });
    if (!policy.allowed) {
      throw new TerminalPolicyError(policy.terminalAccess === 'DISABLED' ? 'disabled' : 'owners');
    }
    if (policy.role !== 'OWNER') throw new TerminalPolicyError('owners');
    return null;
  }

  const host = await findSavedHost(userId, projectId, source.hostId);
  if (!host) throw new SshHostAccessError();
  await requireTerminalAccess(userId, projectId, host.host);
  return host;
}

const sshTarget = (host: SavedHostRow) => ({
  host: host.host,
  port: host.port,
  username: host.username,
  credentials: savedCredentials(host),
  expectedFingerprint: host.hostKeyFingerprint
});

/** Runs `docker <args>` on this machine or on one of the caller's saved servers. */
async function runDocker(
  userId: string,
  projectId: string,
  source: ContainerSource,
  args: string[]
): Promise<DockerResult> {
  const host = await authorizeSource(userId, projectId, source);
  if (!host) return runLocalDocker(args);

  const result = await runCommand(sshTarget(host), `${remoteDockerCommand(args)} 2>&1`);
  if (!host.hostKeyFingerprint) {
    await getPrisma()
      .sshHost.update({ where: { id: host.id }, data: { hostKeyFingerprint: result.fingerprint } })
      .catch(() => undefined);
  }
  return result;
}

async function runDockerChecked(
  userId: string,
  projectId: string,
  source: ContainerSource,
  args: string[]
): Promise<string> {
  const result = await runDocker(userId, projectId, source, args);
  if (result.code !== 0) throw dockerFailure(result.stdout + result.stderr, result.code);
  return result.stdout;
}

export async function listContainers(
  userId: string,
  projectId: string,
  source: ContainerSource
): Promise<ContainerInfo[]> {
  return parseContainers(
    await runDockerChecked(userId, projectId, source, [...LIST_CONTAINERS_ARGS])
  );
}

export async function inspectContainer(
  userId: string,
  projectId: string,
  source: ContainerSource,
  containerId: string
): Promise<ContainerDetails> {
  const details = parseInspect(
    await runDockerChecked(userId, projectId, source, inspectArgs(containerId))
  );
  if (!details) throw new DockerError('Docker returned something unexpected', 'failed');
  return details;
}

export async function readContainerStats(
  userId: string,
  projectId: string,
  source: ContainerSource,
  containerId: string
): Promise<ContainerStats> {
  const stats = parseStats(
    await runDockerChecked(userId, projectId, source, statsArgs(containerId))
  );
  if (!stats) throw new DockerError('Docker returned something unexpected', 'failed');
  return stats;
}

export async function controlContainer(
  userId: string,
  projectId: string,
  source: ContainerSource,
  containerId: string,
  action: ContainerAction
): Promise<void> {
  await runDockerChecked(userId, projectId, source, controlArgs(action, containerId));
  await recordAudit({
    actorId: userId,
    projectId,
    action: `container.${action}`,
    target: containerId.slice(0, 12)
  });
}

/** An interactive shell inside the container, on this machine or over SSH. */
export async function connectContainerShell(
  userId: string,
  projectId: string,
  source: ContainerSource,
  containerId: string,
  size: Size
): Promise<ConnectedSession> {
  const host = await authorizeSource(userId, projectId, source);
  assertSessionCapacity(userId);

  const shell = host
    ? await openShell(
        sshTarget(host),
        size,
        remoteDockerCommand(['exec', '-it', containerId, 'sh', '-c', CONTAINER_SHELL_SCRIPT])
      )
    : await openLocalContainerShell(containerId, size);

  // Pins the key on the first connection, like the terminal does.
  if (host && !host.hostKeyFingerprint) {
    await getPrisma()
      .sshHost.update({ where: { id: host.id }, data: { hostKeyFingerprint: shell.fingerprint } })
      .catch(() => undefined);
  }

  const label = `docker ${containerId.slice(0, 12)}`;
  const session = createSshSession({ userId, projectId, label, shell });
  await recordAudit({
    actorId: userId,
    projectId,
    action: 'container.shell',
    target: containerId.slice(0, 12),
    details: { server: host ? host.name : 'local' }
  });
  return { session, fingerprint: shell.fingerprint, hostId: host?.id ?? null };
}

/** Follows the container's logs live. The stream stays open until `close()` or the container goes away. */
export function followContainerLogs(
  userId: string,
  projectId: string,
  source: ContainerSource,
  containerId: string
): Promise<LogStream> {
  return followContainerDocker(
    userId,
    projectId,
    source,
    followLogsArgs(containerId),
    'The container stopped writing logs'
  );
}

/** What happened to the container: the last day's events, then new ones live. */
export function followContainerEvents(
  userId: string,
  projectId: string,
  source: ContainerSource,
  containerId: string
): Promise<LogStream> {
  return followContainerDocker(
    userId,
    projectId,
    source,
    followEventsArgs(containerId),
    'Docker stopped sending events'
  );
}

/**
 * The reverse proxy's access log, live, with what identifies this container's
 * traffic in it. The proxy is found by its image (Traefik); the container's own
 * Traefik labels and addresses say which lines are its.
 */
export async function followContainerRequests(
  userId: string,
  projectId: string,
  source: ContainerSource,
  containerId: string
): Promise<{ stream: LogStream; target: TrafficTarget; proxy: string }> {
  const [details, containers] = await Promise.all([
    inspectContainer(userId, projectId, source, containerId),
    listContainers(userId, projectId, source)
  ]);
  const proxy = containers.find(
    (entry) => entry.state === 'running' && /traefik/i.test(entry.image)
  );
  if (!proxy) {
    throw new DockerError('No running Traefik proxy was found on this server', 'failed');
  }
  const stream = await followContainerDocker(
    userId,
    projectId,
    source,
    // Some history first, so the tab isn't empty until the next request arrives.
    followRawLogsArgs(proxy.id, 2000),
    'The proxy stopped writing logs'
  );
  return { stream, target: trafficTarget(details.labels, details.networks), proxy: proxy.name };
}

async function followContainerDocker(
  userId: string,
  projectId: string,
  source: ContainerSource,
  args: string[],
  endedReason: string
): Promise<LogStream> {
  const host = await authorizeSource(userId, projectId, source);
  if (!host) return followLocalDocker(args, endedReason);

  const { channel, client, fingerprint } = await openExecStream(
    sshTarget(host),
    `${remoteDockerCommand(args)} 2>&1`
  );
  if (!host.hostKeyFingerprint) {
    await getPrisma()
      .sshHost.update({ where: { id: host.id }, data: { hostKeyFingerprint: fingerprint } })
      .catch(() => undefined);
  }
  let closed = false;
  return {
    onData: (listener) => {
      channel.setEncoding('utf8');
      channel.stderr.setEncoding('utf8');
      channel.on('data', (chunk: string) => listener(chunk));
      channel.stderr.on('data', (chunk: string) => listener(chunk));
    },
    onEnd: (listener) => {
      const done = (reason: string) => listener(closed ? null : reason);
      channel.on('close', () => done(endedReason));
      client.on('error', (error: Error) => done(error.message));
    },
    close() {
      closed = true;
      client.end();
    }
  };
}
