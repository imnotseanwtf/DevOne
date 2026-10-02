import type { Icons } from '@/components/icons';

interface DevOneSection {
  slug: string;
  title: string;
  description: string;
  icon: keyof typeof Icons;
}

export const DEVONE_SECTIONS: DevOneSection[] = [
  {
    slug: 'issues',
    title: 'Board',
    description: 'Plan work and connect it to branches, commits, and reviews.',
    icon: 'kanban'
  },
  {
    slug: 'resources',
    title: 'Resources',
    description: 'Record where the app runs: URLs, environments, hosting, and builds.',
    icon: 'server'
  },
  {
    slug: 'database',
    title: 'Database',
    description: 'Browse connected databases, tables, queries, and schema history.',
    icon: 'product'
  },
  {
    slug: 'api',
    title: 'API',
    description: 'Organize and run requests within the current project context.',
    icon: 'code'
  },
  {
    slug: 'erd',
    title: 'ERD',
    description: 'Understand database structure through automatically generated diagrams.',
    icon: 'galleryVerticalEnd'
  },
  {
    slug: 'git',
    title: 'Git',
    description: 'Review repositories, branches, commits, pull requests, and pipelines.',
    icon: 'github'
  },
  {
    slug: 'docs',
    title: 'Docs',
    description: 'Keep architecture, API, database, and deployment documentation together.',
    icon: 'page'
  },
  {
    slug: 'devops',
    title: 'DevOps',
    description: 'Track deployments, services, logs, and environment health.',
    icon: 'settings'
  },
  {
    slug: 'settings',
    title: 'Settings',
    description: 'Configure workspace connections, access, and preferences.',
    icon: 'adjustments'
  }
];

export function getDevOneSection(slug: string): DevOneSection | undefined {
  return DEVONE_SECTIONS.find((section) => section.slug === slug);
}
