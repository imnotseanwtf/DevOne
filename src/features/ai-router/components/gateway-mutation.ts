'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useT } from '@/i18n/client';
import { aiGatewayKeys } from '../api/queries';

export function useGatewayMutation(onSaved?: () => void) {
  const t = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (action: () => Promise<{ ok: boolean; error?: string }>) => {
      const result = await action();
      if (!result.ok) throw new Error(result.error ?? t('common.somethingWrong'));
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: aiGatewayKeys.all });
      router.refresh();
      onSaved?.();
    },
    onError: (error) => toast.error(error.message)
  });
}

export async function authorizeProvider(providerId: string): Promise<void> {
  const response = await fetch(`/api/ai/oauth/${encodeURIComponent(providerId)}/authorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  });
  const result: unknown = await response.json();
  if (
    !response.ok ||
    typeof result !== 'object' ||
    result === null ||
    !('url' in result) ||
    typeof result.url !== 'string'
  ) {
    throw new Error('oauth');
  }
  window.location.assign(result.url);
}
