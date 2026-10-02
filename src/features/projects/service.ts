import { IssueFieldKind, Prisma, ProjectRole } from '@/generated/prisma/client';
import { DEMO_DISABLED_MESSAGE, isDemoMode } from '@/lib/demo';
import { getPrisma } from '@/lib/db/prisma';
import { toProjectSlug, withSlugSuffix } from '@/lib/projects/slug';
import { toIssuePrefix, withPrefixSuffix } from '@/lib/issues/keys';
import type { ParsedProjectInput } from '@/features/projects/schema';

export async function listProjectsForUser(userId: string) {
  const projects = await getPrisma().project.findMany({
    where: { members: { some: { userId } } },
    include: { _count: { select: { members: true } } },
    orderBy: { updatedAt: 'desc' }
  });

  return projects.map(({ _count, ...project }) => ({
    ...project,
    memberCount: _count.members
  }));
}

export function countProjectsForUser(userId: string): Promise<number> {
  return getPrisma().project.count({ where: { members: { some: { userId } } } });
}

const DEFAULT_ISSUE_TYPES = [
  { name: 'TASK', color: '#3b82f6' },
  { name: 'BUG', color: '#ef4444' },
  { name: 'STORY', color: '#22c55e' },
  { name: 'EPIC', color: '#8b5cf6' }
];
const DEFAULT_ISSUE_PRIORITIES = [
  { name: 'LOW', color: '#64748b' },
  { name: 'MEDIUM', color: '#3b82f6' },
  { name: 'HIGH', color: '#f97316' },
  { name: 'CRITICAL', color: '#ef4444' }
];

export async function createProjectForUser(userId: string, input: ParsedProjectInput) {
  const baseSlug = toProjectSlug(input.name);
  const basePrefix = toIssuePrefix(input.name);

  // Slug and issue prefix are both unique, so retry until a free pair is found.
  for (let attempt = 1; attempt <= 100; attempt += 1) {
    try {
      return await getPrisma().project.create({
        data: {
          name: input.name,
          slug: withSlugSuffix(baseSlug, attempt),
          issuePrefix: withPrefixSuffix(basePrefix, attempt),
          description: input.description,
          createdById: userId,
          members: { create: { userId, role: ProjectRole.OWNER } },
          fieldOptions: {
            createMany: {
              data: [
                ...DEFAULT_ISSUE_TYPES.map((option, position) => ({
                  kind: IssueFieldKind.TYPE,
                  ...option,
                  position
                })),
                ...DEFAULT_ISSUE_PRIORITIES.map((option, position) => ({
                  kind: IssueFieldKind.PRIORITY,
                  ...option,
                  position
                }))
              ]
            }
          }
        }
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002')
        throw error;
    }
  }

  throw new Error('Could not allocate a project slug');
}

export class ProjectAccessError extends Error {
  constructor(message = 'Project not found') {
    super(message);
    this.name = 'ProjectAccessError';
  }
}

async function requireProjectOwner(userId: string, projectId: string) {
  const membership = await getPrisma().projectMember.findFirst({
    where: { projectId, userId },
    select: { role: true }
  });
  if (!membership) throw new ProjectAccessError();
  if (membership.role !== ProjectRole.OWNER) throw new ProjectAccessError('Owners only');
}

export async function updateProjectForUser(
  userId: string,
  projectId: string,
  input: ParsedProjectInput
) {
  await requireProjectOwner(userId, projectId);
  return getPrisma().project.update({
    where: { id: projectId },
    data: { name: input.name, description: input.description }
  });
}

export async function deleteProjectForUser(userId: string, projectId: string) {
  await requireProjectOwner(userId, projectId);
  const project = await getPrisma().project.delete({ where: { id: projectId } });
  return project;
}

export async function listProjectMembers(userId: string, projectId: string) {
  const membership = await getPrisma().projectMember.findFirst({
    where: { projectId, userId },
    select: { id: true }
  });
  if (!membership) throw new ProjectAccessError();
  return getPrisma().projectMember.findMany({
    where: { projectId },
    include: { user: { select: { id: true, username: true, name: true } } },
    orderBy: { createdAt: 'asc' }
  });
}

export async function addProjectMemberByUsername(
  userId: string,
  projectId: string,
  username: string,
  role: ProjectRole = ProjectRole.MEMBER
) {
  // Every demo account is called "demo": adding one would pull in another visitor.
  if (isDemoMode()) throw new ProjectAccessError(DEMO_DISABLED_MESSAGE);
  await requireProjectOwner(userId, projectId);
  const target = await getPrisma().user.findFirst({
    where: { username: { equals: username.trim(), mode: 'insensitive' } },
    select: { id: true }
  });
  if (!target) throw new ProjectAccessError('No user with that username has signed in yet');
  if (target.id === userId) throw new ProjectAccessError('You are already a member');
  return getPrisma().projectMember.upsert({
    where: { projectId_userId: { projectId, userId: target.id } },
    create: { projectId, userId: target.id, role },
    update: { role }
  });
}

export async function updateProjectMemberRole(
  userId: string,
  projectId: string,
  memberUserId: string,
  role: ProjectRole
) {
  await requireProjectOwner(userId, projectId);
  if (memberUserId === userId) throw new ProjectAccessError('You cannot change your own role');
  return getPrisma().projectMember.update({
    where: { projectId_userId: { projectId, userId: memberUserId } },
    data: { role }
  });
}

export async function removeProjectMember(userId: string, projectId: string, memberUserId: string) {
  await requireProjectOwner(userId, projectId);
  if (memberUserId === userId) throw new ProjectAccessError('Transfer ownership first');
  await getPrisma().projectMember.delete({
    where: { projectId_userId: { projectId, userId: memberUserId } }
  });
}

export interface ProjectPanelInfo {
  id: string;
  name: string;
  issuePrefix: string;
  openIssues: number;
  databaseCount: number;
  repos: { id: string; fullName: string }[];
  members: { userId: string; username: string; role: string }[];
}

/** Everything the sidebar panel needs about one project, membership-checked. */
export async function getProjectPanelInfo(
  userId: string,
  projectId: string
): Promise<ProjectPanelInfo> {
  const membership = await getPrisma().projectMember.findFirst({
    where: { projectId, userId },
    select: { id: true }
  });
  if (!membership) throw new ProjectAccessError();

  const [project, openIssues, databaseCount, links, members] = await Promise.all([
    getPrisma().project.findUniqueOrThrow({
      where: { id: projectId },
      select: { id: true, name: true, issuePrefix: true }
    }),
    getPrisma().issue.count({
      where: { projectId, status: { not: 'DONE' }, archivedAt: null }
    }),
    getPrisma().databaseConnection.count({ where: { projectId } }),
    getPrisma().projectRepository.findMany({
      where: { projectId },
      include: { repository: { select: { id: true, fullName: true } } },
      orderBy: { createdAt: 'asc' },
      take: 20
    }),
    getPrisma().projectMember.findMany({
      where: { projectId },
      include: { user: { select: { id: true, username: true } } },
      orderBy: { createdAt: 'asc' },
      take: 20
    })
  ]);

  return {
    ...project,
    openIssues,
    databaseCount,
    repos: links.map((link) => link.repository),
    members: members.map((member) => ({
      userId: member.userId,
      username: member.user.username,
      role: member.role
    }))
  };
}
