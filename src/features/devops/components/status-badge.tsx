import { Badge } from '@/components/ui/badge';
import { Icons } from '@/components/icons';
import { isRunning } from '@/features/devops/status';

const GOOD = new Set(['success', 'completed', 'passed']);
const BAD = new Set(['failure', 'failed', 'canceled', 'cancelled', 'timed_out', 'startup_failure']);

export function statusVariant(status: string): 'secondary' | 'destructive' | 'outline' {
  const value = status.toLowerCase();
  if (GOOD.has(value)) return 'secondary';
  if (BAD.has(value)) return 'destructive';
  return 'outline';
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={statusVariant(status)} className='gap-1'>
      {isRunning(status) && <Icons.spinner className='size-3 animate-spin' />}
      {status.replaceAll('_', ' ')}
    </Badge>
  );
}
