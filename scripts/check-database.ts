import assert from 'node:assert/strict';
import { GitProvider } from '../src/generated/prisma/client';
import { getPrisma } from '../src/lib/db/prisma';
import {
  countProjectsForUser,
  createProjectForUser,
  listProjectsForUser
} from '../src/features/projects/service';
import { clearAuthAttempts, consumeAuthAttempt } from '../src/lib/auth/rate-limit';
import {
  listProjectRepositories,
  openRepository,
  RepositoryAccessError,
  unlinkRepositoryFromProject
} from '../src/features/git/service';
import { encryptSecret, getEncryptionKey } from '../src/lib/encryption/secrets';
import { DatabaseEnvironment, DatabaseProvider } from '../src/generated/prisma/client';
import {
  createBoard,
  createBoardColumn,
  createIssue,
  createIssueFieldOption,
  deleteBoardColumn,
  deleteIssueFieldOption,
  IssueAccessError,
  listBoardColumns,
  listBoards,
  listIssueFieldOptions,
  listIssues,
  moveIssueBefore,
  renameBoardColumn,
  renameIssueFieldOption,
  syncIssueLinks
} from '../src/features/issues/service';
import { IssueFieldKind, IssueLinkType } from '../src/generated/prisma/client';
import {
  DatabaseAccessError,
  getLatestSchema,
  ReadOnlyConnectionError,
  runQuery,
  scanSchema
} from '../src/features/database/service';

const prisma = getPrisma();
const smokeIds = ['devone-db-smoke-owner', 'devone-db-smoke-other'];
const rateLimitKey = 'devone-db-smoke-rate-limit';

async function cleanup() {
  await prisma.auditEvent.deleteMany({
    where: { actor: { providerUserId: { in: smokeIds } } }
  });
  await prisma.issue.deleteMany({
    where: { project: { creator: { providerUserId: { in: smokeIds } } } }
  });
  await prisma.databaseConnection.deleteMany({
    where: { project: { creator: { providerUserId: { in: smokeIds } } } }
  });
  await prisma.repository.deleteMany({
    where: { connection: { user: { providerUserId: { in: smokeIds } } } }
  });
  await prisma.project.deleteMany({
    where: { creator: { providerUserId: { in: smokeIds } } }
  });
  await prisma.user.deleteMany({ where: { providerUserId: { in: smokeIds } } });
  await clearAuthAttempts(rateLimitKey);
}

try {
  assert.strictEqual(getPrisma(), prisma);
  await cleanup();
  const owner = await prisma.user.create({
    data: {
      provider: GitProvider.GITHUB,
      providerUserId: smokeIds[0],
      username: 'smoke-owner'
    }
  });
  const other = await prisma.user.create({
    data: {
      provider: GitProvider.GITLAB,
      providerUserId: smokeIds[1],
      username: 'smoke-other'
    }
  });

  const project = await createProjectForUser(owner.id, {
    name: 'Database Smoke',
    description: 'Temporary verification record'
  });

  assert.equal(project.slug, 'database-smoke');
  assert.equal(await countProjectsForUser(owner.id), 1);
  assert.equal(await countProjectsForUser(other.id), 0);
  assert.equal((await listProjectsForUser(owner.id))[0]?.name, 'Database Smoke');
  assert.equal((await listProjectsForUser(other.id)).length, 0);
  // New projects start with no boards until the user makes one.
  assert.equal((await listBoards(owner.id, project.id)).length, 0);
  const defaultBoard = await createBoard(owner.id, project.id, 'Board');
  const secondBoard = await createBoard(owner.id, project.id, 'Release board');
  await assert.rejects(() => listBoards(other.id, project.id), IssueAccessError);

  // A new board is seeded with the five default workflow stages, and every
  // one of them is an ordinary, rename-/removable BoardColumn row now.
  const seededColumns = await listBoardColumns(owner.id, defaultBoard.id);
  assert.deepEqual(
    seededColumns.map((column) => ({ name: column.name, color: column.color })),
    [
      { name: 'To Do', color: '#64748b' },
      { name: 'In Progress', color: '#3b82f6' },
      { name: 'In Review', color: '#8b5cf6' },
      { name: 'Ready for QA', color: '#f59e0b' },
      { name: 'Done', color: '#22c55e' }
    ]
  );
  // Status names are unique case-insensitively within a board, but the same
  // workflow name can be reused on another board.
  await assert.rejects(() => createBoardColumn(owner.id, defaultBoard.id, 'to do'), IssueAccessError);
  const sharedStatus = await createBoardColumn(owner.id, defaultBoard.id, 'Deploying');
  const secondSharedStatus = await createBoardColumn(owner.id, secondBoard.id, 'Deploying');
  assert.equal(sharedStatus.name, secondSharedStatus.name);
  await assert.rejects(
    () => createBoardColumn(owner.id, secondBoard.id, 'deploying'),
    IssueAccessError
  );
  await assert.rejects(() => createBoard(owner.id, project.id, 'release board'), IssueAccessError);

  // A repository linked to the owner's project must stay invisible to a non-member.
  const connection = await prisma.gitConnection.create({
    data: {
      userId: owner.id,
      provider: GitProvider.GITHUB,
      providerUserId: smokeIds[0],
      baseUrl: 'https://github.com',
      encryptedToken: encryptSecret('smoke-token', getEncryptionKey())
    }
  });
  const repository = await prisma.repository.create({
    data: {
      gitConnectionId: connection.id,
      providerRepositoryId: 'acme/smoke',
      name: 'smoke',
      fullName: 'acme/smoke',
      defaultBranch: 'main',
      visibility: 'private',
      webUrl: 'https://github.com/acme/smoke'
    }
  });
  await prisma.projectRepository.create({
    data: { projectId: project.id, repositoryId: repository.id }
  });

  assert.equal((await listProjectRepositories(owner.id, project.id)).length, 1);
  await assert.rejects(
    () => listProjectRepositories(other.id, project.id),
    RepositoryAccessError
  );
  await assert.rejects(() => openRepository(other.id, repository.id), RepositoryAccessError);
  assert.equal((await openRepository(owner.id, repository.id)).token, 'smoke-token');

  // Unlinking must not let a non-member detach another project's repository.
  await assert.rejects(
    () => unlinkRepositoryFromProject(other.id, project.id, repository.id),
    RepositoryAccessError
  );
  assert.equal((await listProjectRepositories(owner.id, project.id)).length, 1);

  // Point a DevOne connection at DevOne's own PostgreSQL to exercise the adapter.
  const dsn = new URL(process.env.DATABASE_URL ?? '');
  const dbConnection = await prisma.databaseConnection.create({
    data: {
      projectId: project.id,
      name: 'Smoke Postgres',
      provider: DatabaseProvider.POSTGRES,
      host: dsn.hostname,
      port: Number(dsn.port || 5432),
      databaseName: dsn.pathname.replace(/^\//, ''),
      username: decodeURIComponent(dsn.username),
      encryptedPassword: encryptSecret(decodeURIComponent(dsn.password), getEncryptionKey()),
      sslEnabled: false,
      environment: DatabaseEnvironment.LOCAL,
      readOnly: true
    }
  });

  // A non-member must not reach the connection at all.
  await assert.rejects(
    () => runQuery(other.id, dbConnection.id, 'SELECT 1', false),
    DatabaseAccessError
  );

  const selected = await runQuery(owner.id, dbConnection.id, 'SELECT 1 AS one', false);
  assert.deepEqual(selected.columns, ['one']);
  assert.equal(selected.rowCount, 1);

  // Asking for writes on a read-only connection is refused before any SQL runs.
  await assert.rejects(
    () => runQuery(owner.id, dbConnection.id, 'SELECT 1', true),
    ReadOnlyConnectionError
  );

  // And the database itself refuses the write even though the statement is valid SQL.
  await assert.rejects(
    () => runQuery(owner.id, dbConnection.id, 'CREATE TABLE devone_smoke_should_not_exist (id int)', false),
    (error: unknown) => /read-only transaction/i.test(String(error))
  );
  const leaked = await prisma.$queryRaw<
    { count: bigint }[]
  >`SELECT count(*) FROM information_schema.tables WHERE table_name = 'devone_smoke_should_not_exist'`;
  assert.equal(Number(leaked[0].count), 0, 'read-only transaction must not create the table');

  // Introspection produces a schema, and re-scanning it deduplicates the snapshot.
  const scanned = (await scanSchema(owner.id, dbConnection.id)).schema;
  assert.ok(scanned.tables.some((t) => t.name === 'User'), 'expected DevOne User table');
  const users = scanned.tables.find((t) => t.name === 'User')!;
  assert.deepEqual(users.primaryKeys, ['id']);
  assert.ok(users.columns.some((c) => c.name === 'provider'));

  const sessions = scanned.tables.find((t) => t.name === 'Session')!;
  assert.ok(
    sessions.foreignKeys.some((k) => k.referencedTable === 'User' && k.columns.includes('userId')),
    'expected Session.userId foreign key from real metadata'
  );

  await scanSchema(owner.id, dbConnection.id);
  assert.equal(
    await prisma.schemaSnapshot.count({ where: { databaseConnectionId: dbConnection.id } }),
    1,
    'an unchanged schema must not create a second snapshot'
  );
  assert.ok((await getLatestSchema(owner.id, dbConnection.id))!.tables.length > 0);

  // Issue keys come from the project prefix and an atomically incremented counter.
  const first = await createIssue(owner.id, project.id, {
    title: 'Add product bidding',
    type: 'TASK',
    status: 'TODO',
    priority: 'HIGH'
  });
  const second = await createIssue(owner.id, project.id, {
    title: 'Fix login token refresh',
    type: 'BUG',
    status: 'BACKLOG',
    priority: 'CRITICAL'
  });
  assert.equal(first.number, 1);
  assert.equal(second.number, 2);
  assert.notEqual(first.issueKey, second.issueKey);
  assert.ok(first.issueKey.endsWith('-1'), `unexpected key ${first.issueKey}`);

  // Concurrent creates must not collide on the same key.
  const concurrent = await Promise.all(
    Array.from({ length: 5 }, (_, index) =>
      createIssue(owner.id, project.id, {
        title: `Concurrent ${index}`,
        type: 'TASK',
        status: 'BACKLOG',
        priority: 'LOW'
      })
    )
  );
  assert.equal(new Set(concurrent.map((issue) => issue.issueKey)).size, 5);

  await assert.rejects(() => listIssues(other.id, project.id), IssueAccessError);
  assert.equal((await listIssues(owner.id, project.id)).length, 7);
  const releaseIssue = await createIssue(owner.id, project.id, {
    boardId: secondBoard.id,
    title: 'Release checklist',
    type: 'TASK',
    status: 'TODO',
    priority: 'MEDIUM'
  });
  assert.equal(releaseIssue.boardId, secondBoard.id);
  assert.equal((await listIssues(owner.id, project.id, defaultBoard.id)).length, 7);
  assert.deepEqual((await listIssues(owner.id, project.id, secondBoard.id)).map((issue) => issue.id), [releaseIssue.id]);
  await assert.rejects(
    () => moveIssueBefore(owner.id, releaseIssue.id, { status: 'TODO' }, first.id),
    IssueAccessError
  );
  await assert.rejects(
    () => createIssue(owner.id, project.id, {
      boardId: 'missing-board', title: 'Wrong board', type: 'TASK',
      status: 'TODO', priority: 'MEDIUM'
    }),
    IssueAccessError
  );

  // Git auto-linking: a branch naming the issue links it and advances its status.
  const prefix = (await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).issuePrefix;
  await prisma.issueGitLink.create({
    data: {
      issueId: second.id,
      repositoryId: repository.id,
      linkType: IssueLinkType.BRANCH,
      reference: `feature/${second.issueKey}-fix-refresh`
    }
  });
  const links = await prisma.issueGitLink.findMany({ where: { issueId: second.id } });
  assert.equal(links.length, 1);
  assert.ok(links[0].reference.includes(prefix));

  // Re-recording the same link is refused by the unique constraint, which is what
  // makes syncIssueLinks safe to run repeatedly.
  await assert.rejects(() =>
    prisma.issueGitLink.create({
      data: {
        issueId: second.id,
        repositoryId: repository.id,
        linkType: IssueLinkType.BRANCH,
        reference: `feature/${second.issueKey}-fix-refresh`
      }
    })
  );

  await assert.rejects(
    () => syncIssueLinks(other.id, project.id, repository.id),
    IssueAccessError
  );

  await unlinkRepositoryFromProject(owner.id, project.id, repository.id);
  assert.equal((await listProjectRepositories(owner.id, project.id)).length, 0);

  // Board columns: rename cascades to every issue in it, delete falls them
  // back to BACKLOG instead of blocking.
  const staging = await createBoardColumn(owner.id, defaultBoard.id, 'Staging', '#2563eb');
  assert.equal(staging.color, '#2563eb');
  const stagingIssue = await createIssue(owner.id, project.id, {
    boardId: defaultBoard.id,
    title: 'Sits in Staging',
    type: 'TASK',
    status: 'Staging',
    priority: 'MEDIUM'
  });
  await renameBoardColumn(owner.id, defaultBoard.id, staging.id, 'Staging2', '#16a34a');
  assert.equal(
    (await getPrisma().issue.findUniqueOrThrow({ where: { id: stagingIssue.id } })).status,
    'Staging2'
  );
  assert.equal(
    (await getPrisma().boardColumn.findUniqueOrThrow({ where: { id: staging.id } })).color,
    '#16a34a'
  );
  await deleteBoardColumn(owner.id, defaultBoard.id, staging.id);
  assert.equal(
    (await getPrisma().issue.findUniqueOrThrow({ where: { id: stagingIssue.id } })).status,
    'BACKLOG'
  );

  // Types and priorities: same add/rename/delete shape, scoped to the project,
  // refused while in use, and never deletable down to zero options.
  const types = await listIssueFieldOptions(owner.id, project.id, IssueFieldKind.TYPE);
  assert.deepEqual(
    types.map((type) => ({ name: type.name, color: type.color })),
    [
      { name: 'TASK', color: '#3b82f6' },
      { name: 'BUG', color: '#ef4444' },
      { name: 'STORY', color: '#22c55e' },
      { name: 'EPIC', color: '#8b5cf6' }
    ]
  );
  assert.deepEqual(
    (await listIssueFieldOptions(owner.id, project.id, IssueFieldKind.PRIORITY)).map(
      (priority) => ({ name: priority.name, color: priority.color })
    ),
    [
      { name: 'LOW', color: '#64748b' },
      { name: 'MEDIUM', color: '#3b82f6' },
      { name: 'HIGH', color: '#f97316' },
      { name: 'CRITICAL', color: '#ef4444' }
    ]
  );
  await assert.rejects(
    () => createIssueFieldOption(owner.id, project.id, IssueFieldKind.TYPE, 'task'),
    IssueAccessError
  );
  const spike = await createIssueFieldOption(
    owner.id,
    project.id,
    IssueFieldKind.TYPE,
    'Spike',
    '#7c3aed'
  );
  assert.equal(spike.color, '#7c3aed');
  const spikeIssue = await createIssue(owner.id, project.id, {
    boardId: defaultBoard.id,
    title: 'A spike',
    type: 'Spike',
    status: 'To Do',
    priority: 'MEDIUM'
  });
  await renameIssueFieldOption(
    owner.id,
    project.id,
    IssueFieldKind.TYPE,
    spike.id,
    'Spike2',
    '#9333ea'
  );
  assert.equal(
    (await getPrisma().issue.findUniqueOrThrow({ where: { id: spikeIssue.id } })).type,
    'Spike2'
  );
  assert.equal(
    (await getPrisma().issueFieldOption.findUniqueOrThrow({ where: { id: spike.id } })).color,
    '#9333ea'
  );
  await assert.rejects(
    () => deleteIssueFieldOption(owner.id, project.id, IssueFieldKind.TYPE, spike.id),
    IssueAccessError
  );
  await getPrisma().issue.update({ where: { id: spikeIssue.id }, data: { type: 'TASK' } });
  await deleteIssueFieldOption(owner.id, project.id, IssueFieldKind.TYPE, spike.id);
  for (const type of types) {
    if (type.name === 'TASK') continue;
    await getPrisma().issue.updateMany({ where: { projectId: project.id, type: type.name }, data: { type: 'TASK' } });
    await deleteIssueFieldOption(owner.id, project.id, IssueFieldKind.TYPE, type.id);
  }
  const lastType = (await listIssueFieldOptions(owner.id, project.id, IssueFieldKind.TYPE))[0];
  await assert.rejects(
    () => deleteIssueFieldOption(owner.id, project.id, IssueFieldKind.TYPE, lastType.id),
    IssueAccessError
  );


  // Settings: who may change what, terminal policy, and the audit trail.
  {
    const settings = await import('../src/features/project-settings/service');
    const { connectNewSsh, TerminalPolicyError } = await import('../src/features/devops/ssh-service');
    const admin = await import('../src/features/admin/service');
    const { ProjectAccessError } = await import('../src/features/projects/service');

    await prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: project.id, userId: other.id } },
      create: { projectId: project.id, userId: other.id, role: 'MEMBER' },
      update: { role: 'MEMBER' }
    });
    await assert.rejects(
      () =>
        settings.updateGeneralSettings(other.id, project.id, {
          name: 'Taken over',
          description: '',
          issuePrefix: 'TKO'
        }),
      ProjectAccessError
    );
    await settings.updateGeneralSettings(owner.id, project.id, {
      name: 'Database Smoke',
      description: 'Renamed prefix',
      issuePrefix: 'SMK'
    });
    assert.equal((await settings.getProjectSettings(owner.id, project.id)).project.issuePrefix, 'SMK');

    // Members can use the terminal by default; owners-only and off are enforced.
    assert.equal((await settings.getTerminalPolicy(other.id, project.id)).allowed, true);
    await settings.updateDevopsSettings(owner.id, project.id, {
      terminalAccess: 'OWNERS',
      sshAllowedHosts: ['*.internal'],
      hiddenPipelineBranches: ['dependabot/*']
    });
    assert.equal((await settings.getTerminalPolicy(other.id, project.id)).allowed, false);
    assert.equal((await settings.getTerminalPolicy(owner.id, project.id)).allowed, true);
    const connection = {
      host: '203.0.113.9',
      port: 22,
      username: 'deploy',
      authMethod: 'password' as const,
      password: 'pw',
      privateKey: '',
      passphrase: '',
      save: false,
      name: ''
    };
    const size = { cols: 80, rows: 24 };
    // Refused before any network connection is attempted.
    await assert.rejects(
      () => connectNewSsh(other.id, project.id, connection, size),
      (error: unknown) => error instanceof TerminalPolicyError && error.reason === 'owners'
    );
    await assert.rejects(
      () => connectNewSsh(owner.id, project.id, connection, size),
      (error: unknown) => error instanceof TerminalPolicyError && error.reason === 'host'
    );

    // The last owner can't leave; a member can.
    await assert.rejects(() => settings.leaveProject(owner.id, project.id), ProjectAccessError);
    await settings.leaveProject(other.id, project.id);
    assert.equal(await countProjectsForUser(other.id), 0);

    const activity = await settings.listProjectActivity(owner.id, project.id);
    assert.deepEqual(
      activity.map((event) => event.action).toSorted(),
      ['project.devops.update', 'project.member.leave', 'project.update']
    );
    await assert.rejects(() => settings.listProjectActivity(other.id, project.id), ProjectAccessError);

    // Admin: never zero administrators, and disabling signs the person out.
    await assert.rejects(() => admin.listUsers(owner.id), admin.AdminError);
    await prisma.user.update({ where: { id: owner.id }, data: { role: 'ADMIN' } });
    await prisma.user.updateMany({
      where: { role: 'ADMIN', id: { not: owner.id } },
      data: { role: 'MEMBER' }
    });
    await assert.rejects(() => admin.setUserRole(owner.id, owner.id, 'MEMBER'), admin.AdminError);
    await prisma.session.create({
      data: { userId: other.id, tokenHash: 'smoke-other-session', expiresAt: new Date(Date.now() + 60_000) }
    });
    await admin.setUserDisabled(owner.id, other.id, true);
    assert.equal(await prisma.session.count({ where: { userId: other.id } }), 0);
    assert.ok((await prisma.user.findUniqueOrThrow({ where: { id: other.id } })).disabledAt);
    await admin.setUserDisabled(owner.id, other.id, false);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: other.id } })).disabledAt, null);
  }

  // Public demo accounts: each gets its own sample project, and expired ones are deleted.
  {
    const { createDemoAccount, deleteExpiredDemoAccounts } = await import('../src/features/demo/service');
    const realUsers = await prisma.user.count({ where: { demoExpiresAt: null } });
    const realProjects = await prisma.project.count();
    // Demo accounts only exist in demo mode, where the sample integrations are built in.
    process.env.DEVONE_DEMO_MODE = 'true';
    const first = await createDemoAccount();
    const second = await createDemoAccount();
    delete process.env.DEVONE_DEMO_MODE;
    assert.notEqual(first.projectId, second.projectId);

    const demoUser = await prisma.user.findUniqueOrThrow({ where: { id: first.userId } });
    assert.equal(demoUser.role, 'MEMBER');
    assert.ok(demoUser.demoExpiresAt && demoUser.demoExpiresAt > new Date());
    const demoProject = await prisma.project.findUniqueOrThrow({ where: { id: first.projectId } });
    assert.equal(demoProject.name, 'Acme web app');
    assert.equal(await prisma.issue.count({ where: { projectId: first.projectId } }), 14);
    assert.equal(await prisma.projectRepository.count({ where: { projectId: first.projectId } }), 1);
    assert.equal(await prisma.projectResource.count({ where: { projectId: first.projectId } }), 5);
    assert.equal(await prisma.drawing.count({ where: { projectId: first.projectId } }), 2);
    const sampleDb = await prisma.databaseConnection.findFirstOrThrow({
      where: { projectId: first.projectId },
      include: { _count: { select: { snapshots: true, savedQueries: true } } }
    });
    assert.equal(sampleDb._count.snapshots, 2);
    assert.equal(sampleDb._count.savedQueries, 2);
    assert.equal(await prisma.docPage.count({ where: { projectId: first.projectId } }), 2);
    const collection = await prisma.apiCollection.findFirstOrThrow({ where: { projectId: first.projectId } });
    assert.equal(await prisma.apiRequest.count({ where: { collectionId: collection.id } }), 3);

    assert.equal(await deleteExpiredDemoAccounts(new Date()), 0);
    assert.equal(await deleteExpiredDemoAccounts(new Date(Date.now() + 25 * 3_600_000)), 2);
    assert.equal(await prisma.user.count({ where: { id: { in: [first.userId, second.userId] } } }), 0);
    assert.equal(await prisma.project.count(), realProjects);
    assert.equal(await prisma.user.count({ where: { demoExpiresAt: null } }), realUsers);
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    assert.equal(await consumeAuthAttempt(rateLimitKey), true);
  }
  assert.equal(await consumeAuthAttempt(rateLimitKey), false);
} finally {
  await cleanup();
  await prisma.$disconnect();
}
