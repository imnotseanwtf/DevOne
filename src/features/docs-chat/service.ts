import { getPrisma } from '@/lib/db/prisma';
import type { ChatDoc } from '@/lib/docs-chat/retrieval';

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
