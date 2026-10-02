import assert from 'node:assert/strict';
// @ts-expect-error Bun provides this runtime module; the app tsconfig omits Bun test types.
import { mock } from 'bun:test';

interface Doc {
  id: string;
  projectId: string;
  slug: string;
  title: string;
  body: string;
  createdById: string;
}

const memberships = new Set(['user-1:project-1', 'user-1:project-2']);
const docs = new Map<string, Doc>();
let nextId = 1;

const prisma = {
  projectMember: {
    findFirst: async ({ where }: { where: { projectId: string; userId: string } }) =>
      memberships.has(`${where.userId}:${where.projectId}`) ? { id: 'member-1' } : null
  },
  docPage: {
    create: async ({ data }: { data: Omit<Doc, 'id'> }) => {
      const doc = { id: `doc-${nextId++}`, ...data };
      docs.set(doc.id, doc);
      return doc;
    },
    update: async ({
      where,
      data
    }: {
      where: { id: string; projectId: string };
      data: Pick<Doc, 'title' | 'body'>;
    }) => {
      const doc = docs.get(where.id);
      if (!doc || doc.projectId !== where.projectId) throw new Error('Record not found');
      Object.assign(doc, data);
      return doc;
    },
    delete: async ({ where }: { where: { id: string; projectId: string } }) => {
      const doc = docs.get(where.id);
      if (!doc || doc.projectId !== where.projectId) throw new Error('Record not found');
      docs.delete(doc.id);
      return doc;
    }
  }
};

mock.module('@/lib/db/prisma', () => ({ getPrisma: () => prisma as never }));

const { deleteDoc, saveDoc } = await import('../src/features/platform/service');

const first = await saveDoc('user-1', 'project-1', 'untitled', 'Untitled', 'first');
const second = await saveDoc('user-1', 'project-1', 'untitled', 'Untitled', 'second');
assert.notEqual(first.id, second.id);
assert.notEqual(first.slug, second.slug);
assert.equal(docs.size, 2);

const renamed = await saveDoc('user-1', 'project-1', 'renamed', 'Renamed', '', first.id);
assert.equal(renamed.slug, first.slug);
assert.equal(renamed.title, 'Renamed');
assert.equal(renamed.body, '');

await assert.rejects(() => saveDoc('stranger', 'project-1', 'nope', 'Nope', ''));
await assert.rejects(() => saveDoc('user-1', 'project-2', 'nope', 'Nope', '', first.id));
await assert.rejects(() => deleteDoc('user-1', 'project-2', first.id));

await deleteDoc('user-1', 'project-1', first.id);
assert.equal(docs.has(first.id), false);
assert.equal(docs.has(second.id), true);

console.log('Docs service checks passed');
