'use client';

import { Icons } from '@/components/icons';
import { LoadingButton } from '@/components/ui/loading-button';
import { saveDocAction } from '@/features/platform/actions';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';

export function NewDocButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <LoadingButton
      type='button'
      variant='ghost'
      size='sm'
      className='mt-3'
      loading={pending}
      loadingLabel='Creating page…'
      onClick={() => {
        startTransition(async () => {
          try {
            const result = await saveDocAction({ projectId, title: 'Untitled', body: '' });
            if (!result.ok || !result.slug) {
              toast.error(result.error ?? 'Could not create the page');
              return;
            }
            router.push(`/projects/${projectId}/docs?page=${result.slug}`);
          } catch {
            toast.error('Could not create the page. Please try again.');
          }
        });
      }}
    >
      <Icons.add data-icon='inline-start' />
      New page
    </LoadingButton>
  );
}
