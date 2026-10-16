import { getRepositoryBranches, openRepository } from '@/features/git/service';
import { getPrisma } from '@/lib/db/prisma';
import {
  MAX_CODE_FILES,
  formatCodeContext,
  isSafeBranchName,
  pathsMentioned,
  pickEntries,
  type CodeFile,
  type CodeSelection,
  type CodeTreeEntry
} from '@/lib/docs-chat/code';
import { clipToolResult } from '@/lib/docs-chat/plan';
import { selectContext, type ChatDoc } from '@/lib/docs-chat/retrieval';

export class DocsChatAccessError extends Error {
  constructor() {
    super('Project not found');
    this.name = 'DocsChatAccessError';
  }
}

/** Every page of a project the person belongs to, with bodies, for the chatbot to read. */
export async function loadProjectDocs(
  userId: string,
  projectId: string
): Promise<{ projectName: string; docs: ChatDoc[] }> {
  const project = await getPrisma().project.findFirst({
    where: { id: projectId, members: { some: { userId } } },
    select: {
      name: true,
      docs: { select: { id: true, slug: true, title: true, folder: true, body: true } }
    }
  });
  if (!project) throw new DocsChatAccessError();
  return { projectName: project.name, docs: project.docs };
}

/** Throws unless the person belongs to the project; the inline editor needs no page contents. */
export async function requireDocsMember(userId: string, projectId: string): Promise<void> {
  const member = await getPrisma().projectMember.findFirst({
    where: { projectId, userId },
    select: { id: true }
  });
  if (!member) throw new DocsChatAccessError();
}

export interface ChatRepository {
  id: string;
  name: string;
  defaultBranch: string;
  branches: string[];
}

/** The repositories linked to the project with their branches, for the chat's Code picker. */
export async function listChatRepositories(
  userId: string,
  projectId: string
): Promise<ChatRepository[]> {
  await requireDocsMember(userId, projectId);
  const links = await getPrisma().projectRepository.findMany({
    where: { projectId },
    select: { repository: { select: { id: true, fullName: true, defaultBranch: true } } },
    orderBy: { createdAt: 'asc' }
  });
  const repositories = await Promise.all(
    links.map(async ({ repository }) => {
      // A repository whose provider is down or whose token expired just offers no branches.
      const branches = await getRepositoryBranches(userId, repository.id).catch(() => []);
      return {
        id: repository.id,
        name: repository.fullName,
        defaultBranch: repository.defaultBranch,
        branches: branches.map((branch) => branch.name)
      };
    })
  );
  return repositories.filter((repository) => repository.branches.length > 0);
}

const MAX_FOLDERS = 2;

/**
 * What the model reads from the chosen branch: its latest commits, the top of the
 * tree, and the files or folders the question names. Returns null when the
 * repository is not linked to this project or the branch does not exist.
 */
export async function loadCodeContext(
  userId: string,
  projectId: string,
  selection: CodeSelection,
  question: string
): Promise<string | null> {
  if (!isSafeBranchName(selection.branch)) return null;
  const linked = await getPrisma().projectRepository.findFirst({
    where: { projectId, repositoryId: selection.repositoryId },
    select: { id: true }
  });
  if (!linked) return null;

  const { client, token, repository } = await openRepository(userId, selection.repositoryId);
  const id = repository.providerRepositoryId;
  const branches = await client.getBranches(token, id);
  if (!branches.some((branch) => branch.name === selection.branch)) return null;

  const [commits, root] = await Promise.all([
    client.getCommits(token, id, selection.branch).catch(() => []),
    client.getTree(token, id, '', selection.branch)
  ]);

  const entries = pickEntries(question, root);
  const folders: { path: string; entries: CodeTreeEntry[] }[] = [];
  for (const dir of entries.filter((entry) => entry.type === 'dir').slice(0, MAX_FOLDERS)) {
    const inside = await client.getTree(token, id, dir.path, selection.branch).catch(() => null);
    if (inside) folders.push({ path: dir.path, entries: inside });
  }
  // Paths typed out in full ("src/lib/x.ts") are tried even when they are not at the root.
  const paths = [
    ...new Set([
      ...pathsMentioned(question).filter((path) => path.includes('/')),
      ...entries.filter((entry) => entry.type === 'file').map((entry) => entry.path)
    ])
  ].slice(0, MAX_CODE_FILES);
  const files = (
    await Promise.all(
      paths.map(
        (path): Promise<CodeFile | null> =>
          client
            .getFile(token, id, path, selection.branch)
            .then(({ text, truncated }) => ({ path, text, truncated }))
            .catch(() => null)
      )
    )
  ).filter((file): file is CodeFile => file !== null);

  return formatCodeContext({
    repository: repository.fullName,
    branch: selection.branch,
    commits,
    root,
    folders,
    files
  });
}

/**
 * Runs the planning assistant's tools for one answer. Everything is scoped to the
 * project: a repository must be linked to it, and a branch must exist.
 */
export function createPlanToolRunner(
  userId: string,
  projectId: string,
  docs: ChatDoc[],
  picked: CodeSelection | null
) {
  const verified = new Map<string, boolean>();
  let repositories: Promise<ChatRepository[]> | null = null;
  const linked = () => (repositories ??= listChatRepositories(userId, projectId));

  /** The repository and branch a call means: its own arguments, else the picked branch. */
  const resolve = async (args: Record<string, string>) => {
    let repositoryId = picked?.repositoryId;
    let branch = picked?.branch;
    if (args.repository || args.branch) {
      const all = await linked();
      const repository =
        all.find((entry) => entry.id === args.repository || entry.name === args.repository) ??
        (args.repository ? undefined : all.find((entry) => entry.id === repositoryId));
      if (!repository) throw new Error('Unknown repository. Call list_branches first.');
      repositoryId = repository.id;
      branch = args.branch ?? (args.repository ? repository.defaultBranch : branch);
    }
    if (!repositoryId || !branch || !isSafeBranchName(branch)) {
      throw new Error('No branch is picked. Call list_branches, then pass repository and branch.');
    }
    const key = `${repositoryId}\n${branch}`;
    if (!verified.has(key)) {
      const all = await linked();
      verified.set(
        key,
        !!all.find((entry) => entry.id === repositoryId)?.branches.includes(branch)
      );
    }
    if (!verified.get(key)) throw new Error('That branch does not exist in this project.');
    return { ...(await openRepository(userId, repositoryId)), branch };
  };

  const tools: Record<string, (args: Record<string, string>) => Promise<string>> = {
    async search_docs({ query = '' }) {
      const found = selectContext(query, docs, { maxChars: 6_000, maxExcerpts: 5 });
      return found.length
        ? found.map((excerpt) => `### ${excerpt.title}\n${excerpt.text}`).join('\n\n')
        : 'No page matched.';
    },
    async read_doc({ title = '' }) {
      const wanted = title.trim().toLowerCase();
      const doc = docs.find((entry) => entry.title.toLowerCase() === wanted);
      if (!doc) return `No page titled "${title}". Pages: ${docs.map((d) => d.title).join(', ')}`;
      return `# ${doc.title}\n${doc.body}`;
    },
    async list_branches() {
      const all = await linked();
      return all.length
        ? all
            .map(
              (r) => `${r.name} (id ${r.id}, default ${r.defaultBranch}): ${r.branches.join(', ')}`
            )
            .join('\n')
        : 'No repository is linked to this project.';
    },
    async list_files(args) {
      const { client, token, repository, branch } = await resolve(args);
      const entries = await client.getTree(
        token,
        repository.providerRepositoryId,
        args.path ?? '',
        branch
      );
      return entries
        .slice(0, 150)
        .map((entry) => `${entry.type === 'dir' ? '[dir] ' : ''}${entry.path}`)
        .join('\n');
    },
    async read_file(args) {
      const { client, token, repository, branch } = await resolve(args);
      const file = await client.getFile(
        token,
        repository.providerRepositoryId,
        args.path ?? '',
        branch
      );
      return file.text || (file.truncated ? '(too large to read)' : '(empty)');
    }
  };

  return async (name: string, args: Record<string, string>): Promise<string> => {
    const run = tools[name];
    if (!run) return `Unknown tool "${name}".`;
    try {
      return clipToolResult(await run(args));
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : 'the tool failed'}`;
    }
  };
}
