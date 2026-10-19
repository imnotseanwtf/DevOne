'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { useT } from '@/i18n/client';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';

export function CopyResponse({ content }: { content: string }) {
  const t = useT();
  const [copied, setCopied] = useState('');
  return (
    <Button
      type='button'
      variant='ghost'
      size='icon-xs'
      aria-label={copied === content ? t('aiRouter.test.copied') : t('aiRouter.test.copy')}
      title={copied === content ? t('aiRouter.test.copied') : t('aiRouter.test.copy')}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(content);
          setCopied(content);
        } catch {
          toast.error(t('aiRouter.test.copyError'));
        }
      }}
    >
      {copied === content ? <Icons.check /> : <Icons.copy />}
    </Button>
  );
}
