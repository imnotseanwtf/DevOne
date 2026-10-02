import {
  DatabaseEnvironment,
  DatabaseProvider,
  DrawingKind,
  GitProvider,
  IssueLinkType,
  ResourceKind,
  UserRole
} from '@/generated/prisma/client';
import { createConnection, saveQuery, scanSchema } from '@/features/database/service';
import { architectureDiagram, checkoutSketch } from '@/features/demo/sample-drawings';
import { createBoard, createIssue, listBoardColumns } from '@/features/issues/service';
import { createApiRequest, createCollection, saveDoc } from '@/features/platform/service';
import { createProjectForUser } from '@/features/projects/service';
import { getPrisma } from '@/lib/db/prisma';
import { DEMO_LIFETIME_MS } from '@/lib/demo';
import { encryptSecret, getEncryptionKey } from '@/lib/encryption/secrets';
import { DEMO_REPOSITORY_ID } from '@/lib/git/demo';
import { createDemoAdapter } from '@/lib/database/demo';
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
    ['Order search in the admin', 'TASK', done, 'MEDIUM', true, -12],
    ['Serve product images from the CDN', 'TASK', done, 'LOW', false, -18],
    ['Password reset emails', 'STORY', done, 'HIGH', true, -25],
    ['Dark mode for emails', 'TASK', 'BACKLOG', 'LOW', false, null],
    ['Customer feedback survey', 'STORY', 'BACKLOG', 'MEDIUM', false, 14]
  ];
  const issueIds = new Map<string, string>();
  for (const [title, type, status, priority, mine, due] of issues) {
    const issue = await createIssue(userId, project.id, {
      boardId: board.id,
      title,
      type,
      status: status ?? 'BACKLOG',
      priority,
      assigneeId: mine ? userId : null,
      targetDate: due === null ? null : daysFromNow(now, due)
    });
    issueIds.set(title, issue.id);
    // Finished work gets a history, so the dashboard's throughput and lead time have data.
    if (status === done && due !== null) {
      await getPrisma().issue.update({
        where: { id: issue.id },
        data: { createdAt: daysFromNow(now, due - 6) }
      });
      await getPrisma().issueEvent.create({
        data: {
          issueId: issue.id,
          actorId: userId,
          type: 'STATUS',
          fromValue: inProgress,
          toValue: done,
          createdAt: daysFromNow(now, due)
        }
      });
    }
  }

  await seedDemoIntegrations(userId, project.id, issueIds);

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

/**
 * The sample repository, resources, database and drawings. None of it reaches
 * outside DevOne: in demo mode the Git provider, database adapter and terminal
 * are built-in stand-ins (src/lib/git/demo.ts, src/lib/database/demo.ts,
 * src/features/demo/fake-shell.ts).
 */
async function seedDemoIntegrations(
  userId: string,
  projectId: string,
  issueIds: Map<string, string>
) {
  const db = getPrisma();

  const connection = await db.gitConnection.create({
    data: {
      userId,
      provider: GitProvider.GITHUB,
      providerUserId: `demo-${userId}`,
      baseUrl: 'https://github.com',
      encryptedToken: encryptSecret('demo', getEncryptionKey())
    }
  });
  const repository = await db.repository.create({
    data: {
      gitConnectionId: connection.id,
      providerRepositoryId: DEMO_REPOSITORY_ID,
      name: 'web-app',
      fullName: DEMO_REPOSITORY_ID,
      defaultBranch: 'main',
      visibility: 'private',
      webUrl: 'https://github.com/imnotseanwtf/devone'
    }
  });
  await db.projectRepository.create({
    data: { projectId, repositoryId: repository.id, productionBranch: 'main' }
  });
  const links: [string, IssueLinkType, string, string][] = [
    ['Checkout with saved cards', IssueLinkType.BRANCH, 'feat/saved-cards', 'feat/saved-cards'],
    ['Checkout with saved cards', IssueLinkType.MERGE_REQUEST, '42', 'Checkout with saved cards'],
    [
      'Mobile menu stays open after navigating',
      IssueLinkType.MERGE_REQUEST,
      '41',
      'Close the mobile menu after navigating'
    ],
    [
      'Rate-limit the login endpoint',
      IssueLinkType.MERGE_REQUEST,
      '39',
      'Rate-limit the login endpoint'
    ]
  ];
  for (const [title, linkType, reference, linkTitle] of links) {
    const issueId = issueIds.get(title);
    if (!issueId) continue;
    await db.issueGitLink.create({
      data: {
        issueId,
        repositoryId: repository.id,
        linkType,
        reference,
        title: linkTitle,
        webUrl: repository.webUrl
      }
    });
  }

  const production = await db.projectResource.create({
    data: {
      projectId,
      name: 'Production API',
      environment: DatabaseEnvironment.PRODUCTION,
      kind: ResourceKind.API,
      url: 'https://api.acme.example',
      hostedOn: 'AWS ECS (us-east-1)',
      builtBy: 'GitHub Actions',
      repositoryId: repository.id,
      branch: 'main',
      notes: 'Deploys automatically when CI passes on main.'
    }
  });
  await db.projectResource.createMany({
    data: [
      {
        projectId,
        name: 'Staging API',
        environment: DatabaseEnvironment.STAGING,
        kind: ResourceKind.API,
        url: 'https://staging-api.acme.example',
        hostedOn: 'AWS ECS (us-east-1)',
        builtBy: 'GitHub Actions',
        repositoryId: repository.id,
        branch: 'main'
      },
      {
        projectId,
        name: 'Storefront',
        environment: DatabaseEnvironment.PRODUCTION,
        kind: ResourceKind.APP,
        url: 'https://acme.example',
        hostedOn: 'Vercel'
      },
      {
        projectId,
        name: 'Releases',
        environment: DatabaseEnvironment.PRODUCTION,
        kind: ResourceKind.GIT_TAG,
        repositoryId: repository.id,
        tagPattern: 'v*'
      },
      {
        projectId,
        name: 'Web image',
        environment: DatabaseEnvironment.PRODUCTION,
        kind: ResourceKind.DOCKER_IMAGE,
        image: 'ghcr.io/acme/web-app',
        imageTag: '1.8.2'
      }
    ]
  });

  const database = await createConnection(userId, projectId, {
    projectId,
    name: 'Acme production',
    provider: DatabaseProvider.POSTGRES,
    host: 'db-1.acme.internal',
    port: 5432,
    username: 'readonly',
    password: 'demo',
    sslEnabled: true,
    environment: DatabaseEnvironment.PRODUCTION,
    resourceId: production.id,
    readOnly: true
  });
  await db.databaseConnection.update({
    where: { id: database.id },
    data: { databaseName: 'acme' }
  });
  // A week-old snapshot without the newest columns and index, so Schema diff has a change to show.
  const current = await createDemoAdapter().getSchema();
  const previous = {
    tables: current.tables.map((table) => ({
      ...table,
      columns: table.columns.filter(
        (column) =>
          !(table.name === 'products' && column.name === 'featured') &&
          !(table.name === 'customers' && column.name === 'country')
      ),
      indexes: table.indexes.filter((index) => index.name !== 'order_items_order_id_idx')
    }))
  };
  await db.schemaSnapshot.create({
    data: {
      databaseConnectionId: database.id,
      contentHash: 'demo-previous',
      schemaJson: previous as never,
      createdAt: new Date(Date.now() - 7 * 86_400_000),
      lastSeenAt: new Date(Date.now() - 7 * 86_400_000)
    }
  });
  await scanSchema(userId, database.id);
  await saveQuery(
    userId,
    database.id,
    'Latest orders',
    'SELECT id, customer_id, status, total, created_at FROM orders ORDER BY created_at DESC LIMIT 10;'
  );
  await saveQuery(
    userId,
    database.id,
    'Low stock',
    'SELECT sku, name, stock FROM products WHERE stock < 50 ORDER BY stock;'
  );

  await db.drawing.create({
    data: {
      projectId,
      title: 'Checkout with saved cards',
      kind: DrawingKind.EXCALIDRAW,
      scene: checkoutSketch(),
      createdById: userId
    }
  });
  await db.drawing.create({
    data: {
      projectId,
      title: 'Production architecture',
      kind: DrawingKind.DRAWIO,
      scene: { xml: architectureDiagram() },
      createdById: userId
    }
  });
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
