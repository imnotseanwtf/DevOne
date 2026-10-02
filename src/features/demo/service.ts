import { GitProvider, UserRole } from '@/generated/prisma/client';
import { createBoard, createIssue, listBoardColumns } from '@/features/issues/service';
import { createApiRequest, createCollection, saveDoc } from '@/features/platform/service';
import { createProjectForUser } from '@/features/projects/service';
import { getPrisma } from '@/lib/db/prisma';
import { DEMO_LIFETIME_MS } from '@/lib/demo';
import { NO_AUTH } from '@/lib/api-client/types';
import { randomInt, randomUUID } from 'node:crypto';

/**
 * Public demo accounts: every visitor gets their own throwaway user and sample
 * workspace, so nobody can change what another visitor sees. They expire after
 * DEMO_LIFETIME_MS and are deleted, with everything in them, by
 * `deleteExpiredDemoAccounts`, which runs whenever a new demo starts.
 */

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

/** A random five-letter code, so each demo project gets its own slug and issue keys. */
function demoCode(): string {
  return Array.from({ length: 5 }, () => LETTERS[randomInt(LETTERS.length)]).join('');
}

function daysFromNow(now: Date, days: number): Date {
  const date = new Date(now);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

export interface DemoAccount {
  userId: string;
  projectId: string;
}

/** Creates a demo user with a sample project to explore. */
export async function createDemoAccount(now = new Date()): Promise<DemoAccount> {
  const user = await getPrisma().user.create({
    data: {
      // Real GitHub ids are numeric, so these can never collide with a real account.
      provider: GitProvider.GITHUB,
      providerUserId: `demo-${randomUUID()}`,
      username: 'demo',
      name: 'Demo visitor',
      role: UserRole.MEMBER,
      demoExpiresAt: new Date(now.getTime() + DEMO_LIFETIME_MS)
    }
  });

  try {
    const projectId = await seedDemoWorkspace(user.id, now);
    return { userId: user.id, projectId };
  } catch (error) {
    await deleteDemoAccounts([user.id]);
    throw error;
  }
}

async function seedDemoWorkspace(userId: string, now: Date): Promise<string> {
  // The random code keeps the slug and issue prefix unique across all demo projects.
  const code = demoCode();
  const created = await createProjectForUser(userId, {
    name: code,
    description: 'A sample project for the DevOne demo.'
  });
  const project = await getPrisma().project.update({
    where: { id: created.id },
    data: { name: 'Acme web app' }
  });

  const board = await createBoard(userId, project.id, 'Launch');
  const columns = (await listBoardColumns(userId, board.id)).map((column) => column.name);
  const [todo, inProgress, inReview, readyForQa, done] = columns;
  const issues: [string, string, string | undefined, string, boolean, number | null][] = [
    ['Redesign the pricing page', 'STORY', todo, 'HIGH', true, 5],
    ['Write the launch announcement', 'TASK', todo, 'MEDIUM', false, 9],
    ['Mobile menu stays open after navigating', 'BUG', todo, 'HIGH', true, -1],
    ['Checkout with saved cards', 'STORY', inProgress, 'HIGH', true, 3],
    ['Export orders to CSV', 'TASK', inProgress, 'MEDIUM', false, null],
    ['Pricing copy: final review', 'TASK', inReview, 'MEDIUM', true, 1],
    ['Rate-limit the login endpoint', 'BUG', readyForQa, 'CRITICAL', true, 0],
    ['Set up the staging database', 'TASK', done, 'MEDIUM', true, -4],
    ['Analytics dashboard', 'EPIC', done, 'LOW', false, -8],
    ['Dark mode for emails', 'TASK', 'BACKLOG', 'LOW', false, null],
    ['Customer feedback survey', 'STORY', 'BACKLOG', 'MEDIUM', false, 14]
  ];
  for (const [title, type, status, priority, mine, due] of issues) {
    await createIssue(userId, project.id, {
      boardId: board.id,
      title,
      type,
      status: status ?? 'BACKLOG',
      priority,
      assigneeId: mine ? userId : null,
      targetDate: due === null ? null : daysFromNow(now, due)
    });
  }

  await saveDoc(
    userId,
    project.id,
    'welcome',
    'Welcome to the DevOne demo',
    [
      '# Welcome to the DevOne demo',
      '',
      'This is your own sample project. Change anything you like: it is yours alone and is deleted after 24 hours.',
      '',
      '## Things to try',
      '',
      '- Drag cards between columns on the **Board**, then switch to **List** and **Calendar**.',
      '- Open a task to change its status, priority, assignee or due date.',
      '- Write a page here in **Docs**, or sketch something in **Drawings**.',
      '- Browse the saved requests in the **API** client.',
      '',
      '## Turned off in the demo',
      '',
      'Anything that connects to other machines is off, so the demo cannot be used to reach them: SSH terminals, database connections, sending API requests, and connecting GitHub or GitLab accounts.',
      '',
      'To use those, [self-host DevOne](https://github.com/imnotseanwtf/devone#self-hosting).'
    ].join('\n')
  );
  await saveDoc(
    userId,
    project.id,
    'release-checklist',
    'Release checklist',
    [
      '# Release checklist',
      '',
      '1. All tasks for the release are in **Done**.',
      '2. CI is green on `main`.',
      '3. Database migrations are tested on staging.',
      '4. The changelog is updated.',
      '5. Tag the release and publish the notes.'
    ].join('\n')
  );

  const collection = await createCollection(userId, project.id, 'Acme API');
  const requests: [string, 'GET' | 'POST' | 'PATCH', string, string][] = [
    ['List orders', 'GET', 'https://api.acme.example/v1/orders?limit=20', ''],
    [
      'Create an order',
      'POST',
      'https://api.acme.example/v1/orders',
      JSON.stringify({ customerId: 'cus_42', items: [{ sku: 'TSHIRT-M', quantity: 2 }] }, null, 2)
    ],
    [
      'Mark an order as shipped',
      'PATCH',
      'https://api.acme.example/v1/orders/{{orderId}}',
      JSON.stringify({ status: 'shipped' }, null, 2)
    ]
  ];
  for (const [name, method, url, body] of requests) {
    await createApiRequest(userId, collection.id, name, {
      method,
      url,
      headers: {},
      body,
      bodyType: body ? 'JSON' : 'NONE',
      auth: NO_AUTH,
      pathParams: {}
    });
  }

  return project.id;
}

/** Deletes demo users and everything they created. */
async function deleteDemoAccounts(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  const db = getPrisma();
  // Only ever demo accounts, whatever the caller passed.
  const demoIds = (
    await db.user.findMany({
      where: { id: { in: userIds }, demoExpiresAt: { not: null } },
      select: { id: true }
    })
  ).map((user) => user.id);
  if (demoIds.length === 0) return;
  // Projects (and their tasks, docs and drawings) go first: they keep their creator.
  await db.project.deleteMany({ where: { createdById: { in: demoIds } } });
  await db.user.deleteMany({ where: { id: { in: demoIds } } });
}

/** Removes demo accounts whose time is up. Returns how many were deleted. */
export async function deleteExpiredDemoAccounts(now = new Date(), limit = 50): Promise<number> {
  const expired = await getPrisma().user.findMany({
    where: { demoExpiresAt: { lte: now } },
    select: { id: true },
    take: limit
  });
  const ids = expired.map((user) => user.id);
  await deleteDemoAccounts(ids);
  return ids.length;
}
