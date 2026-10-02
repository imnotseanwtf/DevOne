import { getLocale, getT } from '@/i18n/server';
import type { TKey } from '@/i18n/messages';
import { auditKey } from '@/i18n/translate';
import Link from 'next/link';

export interface AuditListEvent {
  id: string;
  action: string;
  target: string | null;
  createdAt: Date;
  actor: { username: string } | null;
  project?: { id: string; name: string } | null;
}

interface AuditListProps {
  events: AuditListEvent[];
  empty: string;
  /** Show which project each event belongs to (the admin log spans projects). */
  showProject?: boolean;
}

/** "@sean added a member · alice · 2 minutes ago", one line per event. */
export async function AuditList({ events, empty, showProject = false }: AuditListProps) {
  const t = await getT();
  const locale = await getLocale();
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });

  if (events.length === 0) return <p className='text-muted-foreground text-sm'>{empty}</p>;

  return (
    <ol className='divide-border divide-y'>
      {events.map((event) => {
        const key = auditKey(event.action) as TKey;
        const label = t(key);
        return (
          <li key={event.id} className='flex flex-wrap items-baseline gap-x-2 gap-y-1 py-2 text-sm'>
            <span className='font-medium'>@{event.actor?.username ?? '—'}</span>
            <span>{label === key ? event.action : label}</span>
            {event.target && (
              <code className='bg-muted rounded px-1.5 py-0.5 text-xs'>{event.target}</code>
            )}
            {showProject && event.project && (
              <Link
                href={`/projects/${event.project.id}`}
                className='text-muted-foreground text-xs underline underline-offset-4'
              >
                {event.project.name}
              </Link>
            )}
            <time
              dateTime={event.createdAt.toISOString()}
              className='text-muted-foreground ml-auto text-xs'
            >
              {dateFormat.format(event.createdAt)}
            </time>
          </li>
        );
      })}
    </ol>
  );
}
