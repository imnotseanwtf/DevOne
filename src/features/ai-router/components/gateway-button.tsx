'use client';

import { LoadingButton } from '@/components/ui/loading-button';
import type { ComponentProps } from 'react';
import { useT } from '@/i18n/client';

interface GatewayButtonProps extends Omit<ComponentProps<typeof LoadingButton>, 'loading'> {
  isLoading?: boolean;
}

export function Button({ isLoading, ...props }: GatewayButtonProps) {
  const t = useT();
  return <LoadingButton loading={isLoading} loadingLabel={t('common.loading')} {...props} />;
}
