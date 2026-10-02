import { Prisma, ProjectRole, TerminalAccess } from '@/generated/prisma/client';
import type { DevopsSettings } from '@/features/project-settings/schema';
import { ProjectAccessError } from '@/features/projects/service';
import { recordAudit } from '@/lib/audit/record';
import { getPrisma } from '@/lib/db/prisma';

/** The caller's role in the project; throws when they aren't a member. */
export async function requireProjectRole(userId: string, projectId: string): Promise<ProjectRole> {
  const membership = await getPrisma().projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: { role: true }
  });
  if (!membership) throw new ProjectAccessError();
  return membership.role;
}

async function requireOwner(userId: string, projectId: string) {
  if ((await requireProjectRole(userId, projectId)) !== ProjectRole.OWNER) {
    throw new ProjectAccessError('Owners only');
  }
}

export async function getProjectSettings(userId: string, projectId: string) {
  const role = await requireProjectRole(userId, projectId);
  const project = await getPrisma().project.findUniqueOrThrow({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      description: true,
      issuePrefix: true,
      terminalAccess: true,
      sshAllowedHosts: true,
      hiddenPipelineBranches: true,
      createdAt: true
    }
  });
  return { project, role };
}

export class PrefixTakenError extends Error {
  constructor() {
    super('That prefix is used by another project');
    this.name = 'PrefixTakenError';
  }
}

export async function updateGeneralSettings(
  userId: string,
  projectId: string,
  input: { name: string; description: string; issuePrefix: string }
) {
  await requireOwner(userId, projectId);
  const before = await getPrisma().project.findUniqueOrThrow({
    where: { id: projectId },
    select: { name: true, issuePrefix: true }
  });
  try {
    await getPrisma().project.update({
      where: { id: projectId },
      data: {
        name: input.name,
        description: input.description || null,
        issuePrefix: input.issuePrefix
      }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new PrefixTakenError();
    }
    throw error;
  }
  await recordAudit({
    actorId: userId,
    projectId,
    action: 'project.update',
    target: input.name,
    details: { before, after: { name: input.name, issuePrefix: input.issuePrefix } }
  });
}

export async function updateDevopsSettings(
  userId: string,
  projectId: string,
  input: DevopsSettings
) {
  await requireOwner(userId, projectId);
  await getPrisma().project.update({
    where: { id: projectId },
    data: {
      terminalAccess: input.terminalAccess as TerminalAccess,
      sshAllowedHosts: input.sshAllowedHosts,
      hiddenPipelineBranches: input.hiddenPipelineBranches
    }
  });
  await recordAudit({
    actorId: userId,
    projectId,
    action: 'project.devops.update',
    details: { ...input }
  });
}

/** Leaving: an owner may only leave while another owner remains. */
export async function leaveProject(userId: string, projectId: string) {
  const role = await requireProjectRole(userId, projectId);
  if (role === ProjectRole.OWNER) {
    const owners = await getPrisma().projectMember.count({
      where: { projectId, role: ProjectRole.OWNER }
    });
    if (owners <= 1) throw new ProjectAccessError('Make someone else an owner before leaving');
  }
  await getPrisma().projectMember.delete({
    where: { projectId_userId: { projectId, userId } }
  });
  await recordAudit({ actorId: userId, projectId, action: 'project.member.leave' });
}

export async function listProjectRepositorySettings(userId: string, projectId: string) {
  await requireProjectRole(userId, projectId);
  const links = await getPrisma().projectRepository.findMany({
    where: { projectId },
    include: {
      repository: {
        select: {
          id: true,
          fullName: true,
          defaultBranch: true,
          webUrl: true,
          connection: { select: { provider: true } }
        }
      }
    },
    orderBy: { createdAt: 'asc' }
  });
  return links.map((link) => ({
    repositoryId: link.repository.id,
    fullName: link.repository.fullName,
    defaultBranch: link.repository.defaultBranch,
    webUrl: link.repository.webUrl,
    provider: link.repository.connection.provider,
    productionBranch: link.productionBranch,
    linkedAt: link.createdAt
  }));
}

export async function setProductionBranch(
  userId: string,
  projectId: string,
  repositoryId: string,
  branch: string | null
) {
  await requireOwner(userId, projectId);
  const link = await getPrisma().projectRepository.update({
    where: { projectId_repositoryId: { projectId, repositoryId } },
    data: { productionBranch: branch },
    include: { repository: { select: { fullName: true } } }
  });
  await recordAudit({
    actorId: userId,
    projectId,
    action: 'project.repository.production',
    target: link.repository.fullName,
    details: { branch }
  });
}

export async function listProjectActivity(userId: string, projectId: string, take = 100) {
  await requireOwner(userId, projectId);
  return getPrisma().auditEvent.findMany({
    where: { projectId },
    include: { actor: { select: { username: true } } },
    orderBy: { createdAt: 'desc' },
    take
  });
}

/** Who may use the terminal, checked before every connection. */
export async function getTerminalPolicy(userId: string, projectId: string) {
  const role = await requireProjectRole(userId, projectId);
  const project = await getPrisma().project.findUniqueOrThrow({
    where: { id: projectId },
    select: { terminalAccess: true, sshAllowedHosts: true }
  });
  const allowed =
    project.terminalAccess === TerminalAccess.MEMBERS ||
    (project.terminalAccess === TerminalAccess.OWNERS && role === ProjectRole.OWNER);
  return { ...project, role, allowed };
}
