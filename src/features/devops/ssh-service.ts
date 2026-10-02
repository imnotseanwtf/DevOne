import { SshAuthMethod } from '@/generated/prisma/client';
import type { NewSshConnection } from '@/features/devops/schema';
import { getTerminalPolicy } from '@/features/project-settings/service';
import { recordAudit } from '@/lib/audit/record';
import { getPrisma } from '@/lib/db/prisma';
import { matchesAnyGlob } from '@/lib/glob';
import { decryptSecret, encryptSecret, getEncryptionKey } from '@/lib/encryption/secrets';
import { openShell, SshConnectError, type SshCredentials } from '@/lib/ssh/connection';
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

/** Connects to a saved host without asking for anything. */
export async function connectSavedSsh(
  userId: string,
  projectId: string,
  hostId: string,
  size: Size
): Promise<ConnectedSession> {
  const host = await getPrisma().sshHost.findFirst({
    where: { id: hostId, projectId, ownerId: userId }
  });
  if (!host) throw new SshHostAccessError();
  await requireTerminalAccess(userId, projectId, host.host);
  assertSessionCapacity(userId);

  const key = getEncryptionKey();
  const secret = decryptSecret(host.encryptedSecret, key);
  const credentials: SshCredentials =
    host.authMethod === SshAuthMethod.PASSWORD
      ? { method: 'password', password: secret }
      : {
          method: 'privateKey',
          privateKey: secret,
          passphrase: host.encryptedPassphrase
            ? decryptSecret(host.encryptedPassphrase, key)
            : undefined
        };

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
