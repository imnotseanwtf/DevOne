import { cn } from '@/lib/utils';
import Link from 'next/link';

interface SettingsTabsProps {
  /** The page the tabs belong to; each tab is `?tab=<id>` on it. */
  basePath: string;
  tabs: { id: string; label: string }[];
  active: string;
  label: string;
}

/** Underlined link tabs, like the project work tabs, driven by the `tab` search param. */
export function SettingsTabs({ basePath, tabs, active, label }: SettingsTabsProps) {
  return (
    <nav aria-label={label} className='border-b'>
      <div className='-mb-px flex gap-5 overflow-x-auto'>
        {tabs.map((tab) => (
          <Link
            key={tab.id}
            href={`${basePath}?tab=${tab.id}`}
            aria-current={active === tab.id ? 'page' : undefined}
            className={cn(
              'text-muted-foreground shrink-0 border-b-2 border-transparent px-1 pb-2 text-sm font-medium whitespace-nowrap hover:text-foreground',
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
