import { UserRole } from '@/generated/prisma/client';
import { recordAudit } from '@/lib/audit/record';
import { getPrisma } from '@/lib/db/prisma';

export class AdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminError';
  }
}

async function requireAdmin(userId: string) {
  const user = await getPrisma().user.findUnique({ where: { id: userId }, select: { role: true } });
  if (user?.role !== UserRole.ADMIN) throw new AdminError('Administrators only');
}

export async function listUsers(adminId: string) {
  await requireAdmin(adminId);
  const users = await getPrisma().user.findMany({
    select: {
      id: true,
      username: true,
      name: true,
      avatarUrl: true,
      provider: true,
      role: true,
      disabledAt: true,
      lastLoginAt: true,
      createdAt: true,
      _count: { select: { memberships: true } }
    },
    orderBy: { username: 'asc' }
  });
  return users.map(({ _count, ...user }) => ({ ...user, projectCount: _count.memberships }));
}

export type AdminUser = Awaited<ReturnType<typeof listUsers>>[number];

async function activeAdminCount() {
  return getPrisma().user.count({ where: { role: UserRole.ADMIN, disabledAt: null } });
}

export async function setUserRole(adminId: string, userId: string, role: UserRole) {
  await requireAdmin(adminId);
  if (userId === adminId) throw new AdminError('You cannot change your own role');
  const target = await getPrisma().user.findUnique({
    where: { id: userId },
    select: { username: true, role: true }
  });
  if (!target) throw new AdminError('User not found');
  if (
    target.role === UserRole.ADMIN &&
    role !== UserRole.ADMIN &&
    (await activeAdminCount()) <= 1
  ) {
    throw new AdminError('There must be at least one administrator');
  }
  await getPrisma().user.update({ where: { id: userId }, data: { role } });
  await recordAudit({
    actorId: adminId,
    action: 'admin.user.role',
    target: target.username,
    details: { role }
  });
}

/** Disabling signs the person out everywhere and refuses their next sign-in. */
export async function setUserDisabled(adminId: string, userId: string, disabled: boolean) {
  await requireAdmin(adminId);
  if (userId === adminId) throw new AdminError('You cannot disable yourself');
  const target = await getPrisma().user.findUnique({
    where: { id: userId },
    select: { username: true }
  });
  if (!target) throw new AdminError('User not found');
  await getPrisma().$transaction([
    getPrisma().user.update({
      where: { id: userId },
      data: { disabledAt: disabled ? new Date() : null }
    }),
    ...(disabled ? [getPrisma().session.deleteMany({ where: { userId } })] : [])
  ]);
  await recordAudit({
    actorId: adminId,
    action: disabled ? 'admin.user.disable' : 'admin.user.enable',
    target: target.username
  });
}

export async function listAuditEvents(adminId: string, take = 200) {
  await requireAdmin(adminId);
  return getPrisma().auditEvent.findMany({
    include: {
      actor: { select: { username: true } },
      project: { select: { id: true, name: true } }
    },
    orderBy: { createdAt: 'desc' },
    take
  });
}

/** The sign-in rules set by environment variables, for a read-only overview. */
const envList = (value: string | undefined) =>
  (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

export function signInPolicy() {
  return {
    providers: envList(process.env.DEVONE_AUTH_PROVIDERS ?? 'github,gitlab'),
    allowRegistration: process.env.DEVONE_ALLOW_REGISTRATION === 'true',
    allowBootstrap: process.env.DEVONE_ALLOW_BOOTSTRAP === 'true',
    githubOrganizations: envList(process.env.DEVONE_GITHUB_ALLOWED_ORGS),
    gitlabGroups: envList(process.env.DEVONE_GITLAB_ALLOWED_GROUPS),
    trustProxy: process.env.DEVONE_TRUST_PROXY === 'true'
  };
}
