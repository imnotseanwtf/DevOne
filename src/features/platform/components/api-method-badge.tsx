import type { ApiMethod } from '@/lib/api-client/types';
import { cn } from '@/lib/utils';

/** The per-method colors Scalar, Postman and most API tools share. */
export const METHOD_COLORS: Record<ApiMethod, string> = {
  GET: 'text-emerald-600 dark:text-emerald-400',
  POST: 'text-sky-600 dark:text-sky-400',
  PUT: 'text-orange-600 dark:text-orange-400',
  PATCH: 'text-amber-600 dark:text-amber-400',
  DELETE: 'text-red-600 dark:text-red-400',
  HEAD: 'text-violet-600 dark:text-violet-400',
  OPTIONS: 'text-fuchsia-600 dark:text-fuchsia-400'
};

const SHORT: Record<ApiMethod, string> = {
  GET: 'GET',
  POST: 'POST',
  PUT: 'PUT',
  PATCH: 'PATCH',
  DELETE: 'DEL',
  HEAD: 'HEAD',
  OPTIONS: 'OPT'
};

export function MethodBadge({ method, className }: { method: ApiMethod; className?: string }) {
  return (
    <span
      className={cn(
        'inline-block w-10 shrink-0 font-mono text-[10px] font-semibold tracking-tight',
        METHOD_COLORS[method],
        className
      )}
    >
      {SHORT[method]}
    </span>
  );
}

export function statusTone(status: number | null | undefined): string {
  if (status == null) return 'text-muted-foreground';
  if (status < 300) return 'text-emerald-600 dark:text-emerald-400';
  if (status < 400) return 'text-sky-600 dark:text-sky-400';
  if (status < 500) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}
