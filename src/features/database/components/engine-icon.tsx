import { Icons } from '@/components/icons';
import type { DatabaseProviderName } from '@/lib/database/types';
import { cn } from '@/lib/utils';

/** A glyph and brand-ish tint per engine, so a connection reads at a glance. */
const ENGINES: Record<
  DatabaseProviderName,
  { icon: (typeof Icons)[keyof typeof Icons]; tile: string }
> = {
  POSTGRES: { icon: Icons.database, tile: 'bg-sky-500/15 text-sky-600 dark:text-sky-400' },
  MYSQL: { icon: Icons.brandMysql, tile: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-400' },
  SQLITE: { icon: Icons.fileDatabase, tile: 'bg-blue-500/15 text-blue-600 dark:text-blue-400' },
  MSSQL: { icon: Icons.windows, tile: 'bg-red-500/15 text-red-600 dark:text-red-400' },
  MONGODB: { icon: Icons.brandMongodb, tile: 'bg-green-500/15 text-green-700 dark:text-green-400' },
  REDIS: { icon: Icons.bolt, tile: 'bg-rose-500/15 text-rose-600 dark:text-rose-400' },
  DYNAMODB: { icon: Icons.brandAws, tile: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' }
};

/** The engine's glyph on a tinted tile; `size` is the tile in Tailwind size units. */
export function EngineIcon({
  provider,
  className
}: {
  provider: DatabaseProviderName;
  className?: string;
}) {
  const { icon: Glyph, tile } = ENGINES[provider];
  return (
    <span
      aria-hidden='true'
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-lg',
        tile,
        className
      )}
    >
      <Glyph className='size-[60%]' />
    </span>
  );
}
