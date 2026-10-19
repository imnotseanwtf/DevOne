'use client';

import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger
} from '@/components/ui/combobox';
import { modelLabel } from '@/lib/ai-router/model-label';
import { useT } from '@/i18n/client';
import { cn } from '@/lib/utils';

interface ModelPickerProps {
  models: string[];
  value: string;
  onValueChange(value: string): void;
  isLoading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  disabled?: boolean;
  label?: string;
  id?: string;
  className?: string;
}

/** Shared model search; labels are readable and request values remain exact. */
export function ModelPicker({
  models: options,
  value: model,
  onValueChange: setModel,
  isLoading: modelsLoading = false,
  error: modelsError = false,
  onRetry: retryModels,
  disabled = false,
  label = 'AI model',
  id,
  className
}: ModelPickerProps) {
  const t = useT();
  return (
    <div className={cn('min-w-0', className)}>
      <Combobox
        items={options}
        disabled={disabled}
        value={model}
        onValueChange={(value) => {
          if (value) setModel(value);
        }}
        itemToStringLabel={(id) => modelLabel(id, true)}
      >
        <ComboboxTrigger
          render={
            <Button
              type='button'
              variant='ghost'
              size='sm'
              className='max-w-full justify-start'
              id={id}
              aria-label={label}
              aria-busy={modelsLoading}
            />
          }
        >
          {modelsLoading && (
            <Icons.spinner
              className='size-3.5 animate-spin motion-reduce:animate-none'
              aria-hidden='true'
            />
          )}
          <span className='truncate'>
            {modelsLoading ? t('aiRouter.test.loadingModels') : modelLabel(model, true)}
          </span>
        </ComboboxTrigger>
        <ComboboxContent className='w-80 max-w-[calc(100vw-2rem)]'>
          <ComboboxInput
            placeholder={t('aiRouter.test.searchModels')}
            aria-label={t('aiRouter.test.searchModelsLabel')}
            showTrigger={false}
          />
          {modelsLoading && (
            <p
              role='status'
              className='text-muted-foreground flex items-center gap-2 px-3 py-2 text-xs'
            >
              <Icons.spinner className='size-3.5 animate-spin motion-reduce:animate-none' />
              {t('aiRouter.test.loadingModels')}
            </p>
          )}
          {modelsError && !modelsLoading && (
            <div role='alert' className='flex items-center justify-between gap-2 px-3 py-2 text-xs'>
              <span>{t('aiRouter.test.modelsError')}</span>
              {retryModels && (
                <Button type='button' variant='outline' size='xs' onClick={retryModels}>
                  {t('aiRouter.test.retry')}
                </Button>
              )}
            </div>
          )}
          <ComboboxEmpty>
            {!modelsLoading && !modelsError ? t('aiRouter.test.noResults') : null}
          </ComboboxEmpty>
          <ComboboxList>
            {(id: string) => (
              <ComboboxItem key={id} value={id}>
                {modelLabel(id, true)}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  );
}
