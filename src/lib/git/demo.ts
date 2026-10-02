import type {
  GitBranch,
  GitCommit,
  GitIdentity,
  GitMergeRequest,
  GitPipeline,
  GitPipelineJob,
  GitProviderClient,
  GitRepository,
  GitTreeEntry
} from '@/lib/git/provider';

/**
 * The Git provider used in the public demo: one sample repository with
 * branches, merge requests, files and CI runs, all made up and kept in memory.
 * It never contacts GitHub or GitLab. Edits made in the demo live only as long
 * as this server process.
 */

export const DEMO_REPOSITORY_ID = 'acme/web-app';
const WEB_URL = 'https://github.com/imnotseanwtf/devone';

const HOUR = 3_600_000;
const ago = (hours: number) => new Date(Date.now() - hours * HOUR);

const REPOSITORY: GitRepository = {
  providerRepositoryId: DEMO_REPOSITORY_ID,
  name: 'web-app',
  fullName: DEMO_REPOSITORY_ID,
  defaultBranch: 'main',
  visibility: 'private',
  webUrl: WEB_URL
};

const COMMITS: Record<string, [string, string, string, number][]> = {
  main: [
    ['9d01b3a4c2', 'Release 1.8.2', 'Mara Santos', 5],
    ['a1c9e2f7b0', 'Rate-limit the login endpoint', 'Jo Reyes', 9],
    ['7be0d41c33', 'Export orders to CSV', 'Ali Cruz', 20],
    ['3f8a6c0e91', 'Analytics dashboard: weekly revenue chart', 'Mara Santos', 30],
    ['e52b9d7f44', 'Set up the staging database', 'Sam Lee', 52],
    ['1c7f3a9b20', 'Upgrade to Next.js 16', 'Jo Reyes', 75]
  ],
  'feat/saved-cards': [
    ['b4e8a1d902', 'Checkout: pay with a saved card', 'Mara Santos', 2],
    ['6d2c9f0a17', 'Store card fingerprints, never numbers', 'Mara Santos', 4],
    ['c0a7e3b5d8', 'Add the saved_cards table', 'Mara Santos', 6],
    ['9d01b3a4c2', 'Release 1.8.2', 'Mara Santos', 5]
  ],
  'fix/mobile-menu': [
    ['f3b2d8c1e6', 'Close the mobile menu after navigating', 'Ali Cruz', 3],
    ['9d01b3a4c2', 'Release 1.8.2', 'Mara Santos', 5]
  ],
  'chore/deps': [
    ['2e9c4b7a15', 'Bump dependencies', 'Dependabot', 1],
    ['9d01b3a4c2', 'Release 1.8.2', 'Mara Santos', 5]
  ]
};

const MERGE_REQUESTS: GitMergeRequest[] = [
  {
    number: 42,
    title: 'Checkout with saved cards',
    state: 'open',
    sourceBranch: 'feat/saved-cards',
    targetBranch: 'main',
    author: 'mara',
    webUrl: WEB_URL,
    createdAt: ago(6)
  },
  {
    number: 41,
    title: 'Close the mobile menu after navigating',
    state: 'open',
    sourceBranch: 'fix/mobile-menu',
    targetBranch: 'main',
    author: 'ali',
    webUrl: WEB_URL,
    createdAt: ago(3)
  },
  {
    number: 40,
    title: 'Bump dependencies',
    state: 'open',
    sourceBranch: 'chore/deps',
    targetBranch: 'main',
    author: 'dependabot',
    webUrl: WEB_URL,
    createdAt: ago(1)
  },
  {
    number: 39,
    title: 'Rate-limit the login endpoint',
    state: 'merged',
    sourceBranch: 'fix/login-rate-limit',
    targetBranch: 'main',
    author: 'jo',
    webUrl: WEB_URL,
    createdAt: ago(30)
  }
];

const FILES: Record<string, string> = {
  'README.md':
    '# Acme web app\n\nThe Acme storefront and admin.\n\n## Development\n\n```bash\nbun install\nbun run dev\n```\n\n## Deploying\n\nMerges to `main` deploy to production after CI passes.\n',
  'package.json':
    '{\n  "name": "acme-web-app",\n  "version": "1.8.2",\n  "private": true,\n  "scripts": {\n    "dev": "next dev",\n    "build": "next build",\n    "test": "vitest run"\n  }\n}\n',
  'src/app/page.tsx':
    "import { listFeaturedProducts } from '@/lib/products';\n\nexport default async function Home() {\n  const products = await listFeaturedProducts();\n  return (\n    <main>\n      <h1>Acme</h1>\n      {products.map((product) => (\n        <a key={product.id} href={`/products/${product.slug}`}>\n          {product.name}\n        </a>\n      ))}\n    </main>\n  );\n}\n",
  'src/lib/orders.ts':
    "import { db } from '@/lib/db';\n\nexport async function listOrders(limit = 20) {\n  return db.order.findMany({ orderBy: { createdAt: 'desc' }, take: limit });\n}\n\nexport async function markShipped(orderId: string) {\n  return db.order.update({ where: { id: orderId }, data: { status: 'shipped' } });\n}\n",
  'src/lib/products.ts':
    "import { db } from '@/lib/db';\n\nexport function listFeaturedProducts() {\n  return db.product.findMany({ where: { featured: true }, take: 8 });\n}\n",
  'prisma/schema.prisma':
    'model Customer {\n  id     String  @id\n  email  String  @unique\n  name   String\n  orders Order[]\n}\n\nmodel Order {\n  id         String   @id\n  customer   Customer @relation(fields: [customerId], references: [id])\n  customerId String\n  status     String\n  total      Decimal\n  createdAt  DateTime @default(now())\n}\n',
  'prisma/migrations/20261001_saved_cards/migration.sql':
    'CREATE TABLE "saved_cards" (\n  "id" TEXT PRIMARY KEY,\n  "customer_id" TEXT NOT NULL REFERENCES "customers"("id"),\n  "fingerprint" TEXT NOT NULL,\n  "last4" CHAR(4) NOT NULL\n);\n',
  '.github/workflows/ci.yml':
    'name: CI\non: [push, pull_request]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: bun install\n      - run: bun run test\n'
};

interface DemoPipeline extends GitPipeline {
  jobs: [string, string, string][];
}

/** Pipelines keyed by the branch they ran on. Jobs: [name, stage, status]. */
const PIPELINES: Record<string, DemoPipeline[]> = {
  'feat/saved-cards': [
    {
      id: '1042',
      name: 'CI',
      status: 'running',
      ref: 'feat/saved-cards',
      webUrl: WEB_URL,
      createdAt: ago(0.1),
      jobs: [
        ['install', 'build', 'success'],
        ['lint', 'test', 'success'],
        ['unit tests', 'test', 'running'],
        ['deploy preview', 'deploy', 'pending']
      ]
    },
    {
      id: '1038',
      name: 'CI',
      status: 'failed',
      ref: 'feat/saved-cards',
      webUrl: WEB_URL,
      createdAt: ago(4),
      jobs: [
        ['install', 'build', 'success'],
        ['lint', 'test', 'success'],
        ['unit tests', 'test', 'failed'],
        ['deploy preview', 'deploy', 'skipped']
      ]
    }
  ],
  'fix/mobile-menu': [
    {
      id: '1040',
      name: 'CI',
      status: 'success',
      ref: 'fix/mobile-menu',
      webUrl: WEB_URL,
      createdAt: ago(3),
      jobs: [
        ['install', 'build', 'success'],
        ['lint', 'test', 'success'],
        ['unit tests', 'test', 'success'],
        ['deploy preview', 'deploy', 'success']
      ]
    }
  ],
  'chore/deps': [
    {
      id: '1041',
      name: 'CI',
      status: 'success',
      ref: 'chore/deps',
      webUrl: WEB_URL,
      createdAt: ago(1),
      jobs: [
        ['install', 'build', 'success'],
        ['lint', 'test', 'success'],
        ['unit tests', 'test', 'success']
      ]
    }
  ],
  main: [
    {
      id: '1036',
      name: 'Deploy',
      status: 'success',
      ref: 'main',
      webUrl: WEB_URL,
      createdAt: ago(5),
      jobs: [
        ['install', 'build', 'success'],
        ['unit tests', 'test', 'success'],
        ['deploy production', 'deploy', 'success']
      ]
    }
  ]
};

const ALL_PIPELINES = Object.values(PIPELINES).flat();

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

function jobLog(name: string, status: string): string {
  const header = `${DIM}Running on runner-acme-2 (ubuntu-24.04)${RESET}\n${DIM}$ git checkout --force ${'9d01b3a4c2'}${RESET}\n`;
  if (name === 'install') {
    return `${header}${BOLD}$ bun install --frozen-lockfile${RESET}\nbun install v1.3.14\n\n + next@16.2.12\n + react@19.2.0\n + prisma@7.10.0\n\n812 packages installed [8.21s]\n${GREEN}Job succeeded${RESET}\n`;
  }
  if (name === 'lint') {
    return `${header}${BOLD}$ bun run lint${RESET}\nFound 0 warnings and 0 errors.\nFinished in 412ms on 286 files.\n${GREEN}Job succeeded${RESET}\n`;
  }
  if (name === 'unit tests') {
    if (status === 'failed') {
      return `${header}${BOLD}$ bun run test${RESET}\n\n ${GREEN}✓${RESET} src/lib/orders.test.ts (12 tests) 48ms\n ${GREEN}✓${RESET} src/lib/products.test.ts (6 tests) 21ms\n ${RED}✗${RESET} src/lib/checkout.test.ts (9 tests | 1 failed) 63ms\n   ${RED}✗ charges a saved card${RESET}\n     AssertionError: expected 'requires_action' to be 'succeeded'\n       at src/lib/checkout.test.ts:84:31\n\n Test Files  ${RED}1 failed${RESET} | 2 passed (3)\n      Tests  ${RED}1 failed${RESET} | 26 passed (27)\n${RED}ERROR: Job failed: exit code 1${RESET}\n`;
    }
    if (status === 'running') {
      return `${header}${BOLD}$ bun run test${RESET}\n\n ${GREEN}✓${RESET} src/lib/orders.test.ts (12 tests) 48ms\n ${GREEN}✓${RESET} src/lib/products.test.ts (6 tests) 21ms\n ${DIM}… src/lib/checkout.test.ts${RESET}\n`;
    }
    return `${header}${BOLD}$ bun run test${RESET}\n\n ${GREEN}✓${RESET} src/lib/orders.test.ts (12 tests) 48ms\n ${GREEN}✓${RESET} src/lib/products.test.ts (6 tests) 21ms\n ${GREEN}✓${RESET} src/lib/checkout.test.ts (9 tests) 63ms\n\n Test Files  ${GREEN}3 passed${RESET} (3)\n      Tests  ${GREEN}27 passed${RESET} (27)\n${GREEN}Job succeeded${RESET}\n`;
  }
  if (status === 'pending' || status === 'skipped') return '';
  return `${header}${BOLD}$ ./scripts/deploy.sh${RESET}\nBuilding image ghcr.io/acme/web-app:${'9d01b3a'}…\nPushing image… done\nRolling out to ${name.includes('production') ? 'production' : 'a preview environment'}…\n${GREEN}✓ Live at https://${name.includes('production') ? 'acme.example' : 'preview-42.acme.example'}${RESET}\n${GREEN}Job succeeded${RESET}\n`;
}

/** Edits made in the demo, keyed by `branch:path`; null means deleted. */
interface DemoState {
  files: Map<string, string | null>;
  branches: Map<string, string>;
}

function state(): DemoState {
  const globalState = globalThis as typeof globalThis & { devoneDemoGit?: DemoState };
  globalState.devoneDemoGit ??= { files: new Map(), branches: new Map() };
  return globalState.devoneDemoGit;
}

function fileText(branch: string, path: string): string | undefined {
  const edited = state().files.get(`${branch}:${path}`);
  if (edited === null) return undefined;
  return edited ?? FILES[path];
}

function allPaths(branch: string): string[] {
  const paths = new Set(Object.keys(FILES));
  for (const [key, value] of state().files) {
    const [keyBranch, ...rest] = key.split(':');
    if (keyBranch !== branch) continue;
    const path = rest.join(':');
    if (value === null) paths.delete(path);
    else paths.add(path);
  }
  return [...paths];
}

function revision(): string {
  return Math.random().toString(16).slice(2, 12);
}

function branchCommits(branch: string): GitCommit[] {
  const base = state().branches.get(branch) ?? branch;
  return (COMMITS[base] ?? COMMITS.main).map(([sha, message, authorName, hours]) => ({
    sha,
    message,
    authorName,
    committedAt: ago(hours)
  }));
}

export function createDemoGitProvider(): GitProviderClient {
  return {
    async getIdentity(): Promise<GitIdentity> {
      return {
        provider: 'github',
        providerUserId: 'demo',
        username: 'demo',
        name: 'Demo visitor',
        avatarUrl: null,
        baseUrl: 'https://github.com'
      };
    },
    async getMemberships() {
      return ['acme'];
    },
    async getRepositories() {
      return [REPOSITORY];
    },
    async getBranches(): Promise<GitBranch[]> {
      const names = [...Object.keys(COMMITS), ...state().branches.keys()];
      return names.map((name) => ({ name, sha: branchCommits(name)[0]?.sha ?? '9d01b3a4c2' }));
    },
    async getCommits(_token, _repositoryId, branch) {
      return branchCommits(branch);
    },
    async getMergeRequests() {
      return MERGE_REQUESTS;
    },
    async getTree(_token, _repositoryId, path, ref): Promise<GitTreeEntry[]> {
      const prefix = path ? `${path.replace(/\/$/, '')}/` : '';
      const entries = new Map<string, GitTreeEntry>();
      for (const file of allPaths(ref)) {
        if (!file.startsWith(prefix)) continue;
        const [name, ...below] = file.slice(prefix.length).split('/');
        entries.set(name, {
          name,
          path: `${prefix}${name}`,
          type: below.length > 0 ? 'dir' : 'file'
        });
      }
      return [...entries.values()].toSorted((a, b) =>
        a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1
      );
    },
    async getFile(_token, _repositoryId, path, ref) {
      const text = fileText(ref, path);
      if (text === undefined) throw new Error('File not found');
      return { path, text, truncated: false, revision: 'demo' };
    },
    async updateFile(_token, _repositoryId, input) {
      state().files.set(`${input.branch}:${input.path}`, input.content);
      return { revision: revision() };
    },
    async createFile(_token, _repositoryId, input) {
      state().files.set(`${input.branch}:${input.path}`, input.content);
      return { revision: revision() };
    },
    async deleteFile(_token, _repositoryId, input) {
      state().files.set(`${input.branch}:${input.path}`, null);
    },
    async createBranch(_token, _repositoryId, name) {
      state().branches.set(name, 'main');
    },
    async getMergeRequestFiles(_token, _repositoryId, number) {
      if (number === 42) {
        return [
          'prisma/migrations/20261001_saved_cards/migration.sql',
          'src/lib/checkout.ts',
          'src/app/checkout/page.tsx'
        ];
      }
      return number === 41 ? ['src/components/mobile-menu.tsx'] : ['package.json', 'bun.lock'];
    },
    async getPipelines() {
      return ALL_PIPELINES.map(({ jobs: _jobs, ...pipeline }) => pipeline);
    },
    async getMergeRequestPipelines(_token, _repositoryId, number) {
      const request = MERGE_REQUESTS.find((entry) => entry.number === number);
      return (PIPELINES[request?.sourceBranch ?? ''] ?? []).map(
        ({ jobs: _jobs, ...pipeline }) => pipeline
      );
    },
    async getPipelineJobs(_token, _repositoryId, pipelineId): Promise<GitPipelineJob[]> {
      const pipeline = ALL_PIPELINES.find((entry) => entry.id === pipelineId);
      return (pipeline?.jobs ?? []).map(([name, stage, status], index) => ({
        id: `${pipelineId}:${index}`,
        name,
        stage,
        status,
        webUrl: WEB_URL,
        startedAt: status === 'pending' || status === 'skipped' ? null : pipeline!.createdAt,
        finishedAt:
          status === 'success' || status === 'failed'
            ? new Date(pipeline!.createdAt.getTime() + (index + 1) * 40_000)
            : null
      }));
    },
    async getJobLog(_token, _repositoryId, jobId) {
      const [pipelineId, index] = jobId.split(':');
      const job = ALL_PIPELINES.find((entry) => entry.id === pipelineId)?.jobs[Number(index)];
      const text = job ? jobLog(job[0], job[2]) : '';
      return { text, truncated: false, available: text.length > 0 };
    },
    async getTags() {
      return [
        { name: 'v1.8.2', sha: '9d01b3a4c2', committedAt: ago(5) },
        { name: 'v1.8.1', sha: '1c7f3a9b20', committedAt: ago(75) },
        { name: 'v1.8.0', sha: '0b4f8e2d61', committedAt: ago(240) }
      ];
    },
    async getCollaborators() {
      return [{ providerUserId: 'demo', username: 'demo' }];
    }
  };
}
