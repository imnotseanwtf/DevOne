import Link from 'next/link';
import { cn } from '@/lib/utils';

interface ProjectWorkTabsProps {
  projectId: string;
  active: 'board' | 'docs' | 'drawings';
}

const tabs = [
  { id: 'board' as const, label: 'Board', path: 'issues' },
  { id: 'docs' as const, label: 'Docs', path: 'docs' },
  { id: 'drawings' as const, label: 'Drawings', path: 'drawings' }
];

export function ProjectWorkTabs({ projectId, active }: ProjectWorkTabsProps) {
  return (
    <nav aria-label='Project work views' className='border-b'>
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
            {tab.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
