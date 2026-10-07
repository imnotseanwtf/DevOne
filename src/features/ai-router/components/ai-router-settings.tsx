'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { saveRouterSettingsAction } from '@/features/ai-router/actions';
import type { RouterSettings } from '@/features/ai-router/service';
import { useT } from '@/i18n/client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

export function AiRouterSettings({ settings }: { settings: RouterSettings }) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [defaultModel, setDefaultModel] = useState(settings.defaultModel ?? '');
  const [compress, setCompress] = useState(settings.compressToolOutput);
  const [maxChars, setMaxChars] = useState(String(settings.maxToolOutputChars));

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('aiRouter.settings.title')}</CardTitle>
        <CardDescription>{t('aiRouter.settings.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className='max-w-xl space-y-4'
          onSubmit={(event) => {
            event.preventDefault();
            startTransition(async () => {
              const result = await saveRouterSettingsAction({
                defaultModel: defaultModel.trim() || null,
                compressToolOutput: compress,
                maxToolOutputChars: Number(maxChars)
              });
              if (result.ok) {
                toast.success(t('aiRouter.settings.saved'));
                router.refresh();
              } else {
                toast.error(result.error);
              }
            });
          }}
        >
          <div className='space-y-2'>
            <Label htmlFor='ai-default-model'>{t('aiRouter.settings.defaultModel')}</Label>
            <Input
              id='ai-default-model'
              value={defaultModel}
              placeholder='free-stack'
              onChange={(event) => setDefaultModel(event.target.value)}
            />
            <p className='text-muted-foreground text-xs'>
              {t('aiRouter.settings.defaultModelHint')}
            </p>
          </div>
          <div className='flex items-center gap-3'>
            <Switch id='ai-compress' checked={compress} onCheckedChange={setCompress} />
            <Label htmlFor='ai-compress'>{t('aiRouter.settings.compress')}</Label>
          </div>
          <div className='space-y-2'>
            <Label htmlFor='ai-max-chars'>{t('aiRouter.settings.maxChars')}</Label>
            <Input
              id='ai-max-chars'
              type='number'
              min={1000}
              max={200000}
              value={maxChars}
              disabled={!compress}
              onChange={(event) => setMaxChars(event.target.value)}
            />
            <p className='text-muted-foreground text-xs'>{t('aiRouter.settings.compressHint')}</p>
          </div>
          <Button type='submit' disabled={pending}>
            {t('aiRouter.settings.save')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
