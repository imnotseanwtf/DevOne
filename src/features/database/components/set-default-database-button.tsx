'use client';

import { Button } from '@/components/ui/button';
import { setDefaultDatabaseAction } from '@/features/database/actions';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

export function SetDefaultDatabaseButton({
  connectionId,
  database
}: {
  connectionId: string;
  database: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const makeDefault = () => {
    startTransition(async () => {
      const result = await setDefaultDatabaseAction({ connectionId, database });
      if (result.ok) router.refresh();
    });
  };

  return (
    <Button type='button' variant='outline' size='sm' disabled={pending} onClick={makeDefault}>
      {pending ? 'Setting…' : 'Set as default'}
    </Button>
  );
}
