import { getT } from '@/i18n/server';
import Link from 'next/link';
import { cn } from '@/lib/utils';

interface DevOpsTabsProps {
  projectId: string;
  active: 'pipelines' | 'terminal';
}

const tabs = [
  { id: 'pipelines' as const, path: 'devops' },
  { id: 'terminal' as const, path: 'devops/terminal' }
];

export async function DevOpsTabs({ projectId, active }: DevOpsTabsProps) {
  const t = await getT();
  return (
    <nav aria-label='DevOps views' className='border-b'>
      <div className='flex gap-5'>
        {tabs.map((tab) => (
          <Link
            key={tab.id}
            href={`/projects/${projectId}/${tab.path}`}
            aria-current={active === tab.id ? 'page' : undefined}
            className={cn(
              'text-muted-foreground -mb-px border-b-2 border-transparent px-1 pb-2 text-sm font-medium hover:text-foreground',
              active === tab.id && 'border-foreground text-foreground'
            )}
          >
            {t(`devops.tabs.${tab.id}`)}
          </Link>
        ))}
      </div>
    </nav>
  );
}
