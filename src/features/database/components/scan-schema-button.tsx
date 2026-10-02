'use client';

import { Button } from '@/components/ui/button';
import { scanSchemaAction } from '@/features/database/actions';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

export function ScanSchemaButton({ connectionId }: { connectionId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  const scan = () => {
    setError(undefined);
    startTransition(async () => {
      const result = await scanSchemaAction({ connectionId });
      if (!result.ok) {
        setError(result.error ?? 'Could not read the schema');
        return;
      }
      router.refresh();
    });
  };

  return (
    <span className='flex items-center gap-2'>
      <Button type='button' variant='outline' size='sm' disabled={pending} onClick={scan}>
        {pending ? 'Scanning…' : 'Rescan schema'}
      </Button>
      {error && (
        <span className='text-destructive text-xs' title={error}>
          Failed
        </span>
      )}
    </span>
  );
}
