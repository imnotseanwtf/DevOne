import { IssueBoard } from '@/features/issues/components/issue-board';
import { CreateFirstBoard } from '@/features/issues/components/create-first-board';
import { listDrawingsForLinking } from '@/features/drawings/service';
import { ProjectWorkTabs } from '@/features/projects/components/project-work-tabs';
import PageContainer from '@/components/layout/page-container';
import { IssueFieldKind } from '@/generated/prisma/client';
import {
  listBoardColumns,
  listBoards,
  listArchivedIssues,
  listDocsForLinking,
  listIssueFieldOptions,
  listIssues
} from '@/features/issues/service';
import { listAssignableCollaborators } from '@/features/git/service';
import { listProjectMembers, listProjectsForUser } from '@/features/projects/service';
import { requireUser } from '@/lib/auth/session';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

export const metadata: Metadata = { title: 'Board' };

interface IssuesPageProps {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ board?: string | string[] }>;
}

export default async function IssuesPage({ params, searchParams }: IssuesPageProps) {
  const user = await requireUser();
  const { projectId } = await params;

  const projects = await listProjectsForUser(user.id);
  const activeProject = projects.find((entry) => entry.id === projectId);
  if (!activeProject) notFound();

  const boards = await listBoards(user.id, activeProject.id);
  const { board: requestedBoard } = await searchParams;
  const activeBoard =
    typeof requestedBoard === 'string'
      ? boards.find((board) => board.id === requestedBoard)
      : boards[0];

  if (!activeBoard) {
    if (boards.length > 0) notFound(); // a specific ?board= id that doesn't exist
    return (
      <Shell projectId={activeProject.id}>
        <CreateFirstBoard projectId={activeProject.id} />
      </Shell>
    );
  }

  const [
    issues,
    members,
    collaborators,
    columns,
    types,
    priorities,
    availableDocs,
    availableDrawings,
    archived
  ] = await Promise.all([
    listIssues(user.id, activeProject.id, activeBoard.id),
    listProjectMembers(user.id, activeProject.id).catch(() => []),
    listAssignableCollaborators(user.id, activeProject.id).catch(() => []),
    listBoardColumns(user.id, activeBoard.id),
    listIssueFieldOptions(user.id, activeProject.id, IssueFieldKind.TYPE),
    listIssueFieldOptions(user.id, activeProject.id, IssueFieldKind.PRIORITY),
    listDocsForLinking(user.id, activeProject.id),
    listDrawingsForLinking(user.id, activeProject.id),
    listArchivedIssues(user.id, activeProject.id, activeBoard.id)
  ]);

  // Project members plus any repo collaborator who already has a DevOne
  // account, deduped — so assigning a task isn't limited to people who
  // happened to join the project first.
  const assignable = new Map(
    members.map((member) => [
      member.userId,
      {
        id: member.userId,
        username: member.user.username,
        name: member.user.name
      }
    ])
  );
  for (const collaborator of collaborators) {
    if (!assignable.has(collaborator.id)) assignable.set(collaborator.id, collaborator);
  }

  return (
    <Shell projectId={activeProject.id}>
      <IssueBoard
        key={activeBoard.id}
        projectId={activeProject.id}
        boardId={activeBoard.id}
        boards={boards.map((board) => ({ id: board.id, name: board.name }))}
        projects={projects.map((entry) => ({ id: entry.id, name: entry.name }))}
        issues={issues.map((issue) => ({
          id: issue.id,
          issueKey: issue.issueKey,
          title: issue.title,
          description: issue.description,
          type: issue.type,
          status: issue.status,
          priority: issue.priority,
          assignee: issue.assignee?.username ?? null,
          assigneeName: issue.assignee?.name ?? null,
          assigneeId: issue.assignee?.id ?? null,
          creator: issue.creator.username,
          creatorName: issue.creator.name,
          sprint: issue.sprint?.name ?? null,
          sprintId: issue.sprint?.id ?? null,
          gitLinkCount: issue.gitLinkCount,
          targetDate: issue.targetDate ? issue.targetDate.toISOString().slice(0, 10) : null,
          commentCount: issue.commentCount,
          linkedDocs: issue.linkedDocs,
          linkedDrawings: issue.linkedDrawings,
          position: issue.position
        }))}
        availableDocs={availableDocs}
        availableDrawings={availableDrawings}
        archived={archived.map((issue) => ({
          id: issue.id,
          issueKey: issue.issueKey,
          title: issue.title,
          type: issue.type,
          status: issue.status,
          archivedAt: (issue.archivedAt ?? new Date()).toISOString()
        }))}
        members={[...assignable.values()]}
        columns={columns.map((column) => ({
          id: column.id,
          name: column.name,
          color: column.color,
          icon: column.icon
        }))}
        types={types.map((option) => ({
          id: option.id,
          name: option.name,
          color: option.color
        }))}
        priorities={priorities.map((option) => ({
          id: option.id,
          name: option.name,
          color: option.color
        }))}
      />
    </Shell>
  );
}

function Shell({ projectId, children }: { projectId: string; children: React.ReactNode }) {
  return (
    <PageContainer
      pageTitle='Board'
      pageDescription='Plan and track project work across its workflow.'
    >
      <div className='min-w-0 space-y-6'>
        <ProjectWorkTabs projectId={projectId} active='board' />
        {children}
      </div>
    </PageContainer>
  );
}
