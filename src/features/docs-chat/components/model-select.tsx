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
import { useOptionalDocsAssistant } from '@/features/docs-chat/components/docs-assistant';
import { DEFAULT_MODEL, modelLabel } from '@/lib/docs-chat/models';
import { cn } from '@/lib/utils';
import { useEffect } from 'react';

/** Picks which of the AI router's models answers; the list is whatever the router offers. */
export function ModelSelect({ className }: { className?: string }) {
  const assistant = useOptionalDocsAssistant();
  const loadModels = assistant?.loadModels;
  useEffect(() => loadModels?.(), [loadModels]);
  if (!assistant) return null;

  const { model, setModel, models, modelsLoading, modelsError, retryModels } = assistant;
  // The list isn't known yet (or the router can't list): offer only what is selected.
  const options = models ?? [...new Set([DEFAULT_MODEL, model])];

  return (
    <div className={cn('min-w-0', className)}>
      <Combobox
        items={options}
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
              aria-label='AI model'
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
            {modelsLoading && !models ? 'Loading models…' : modelLabel(model, true)}
          </span>
        </ComboboxTrigger>
        <ComboboxContent className='w-80 max-w-[calc(100vw-2rem)]'>
          <ComboboxInput
            placeholder='Search models…'
            aria-label='Search models'
            showTrigger={false}
          />
          {modelsLoading && (
            <p
              role='status'
              className='text-muted-foreground flex items-center gap-2 px-3 py-2 text-xs'
            >
              <Icons.spinner className='size-3.5 animate-spin motion-reduce:animate-none' />
              Loading models…
            </p>
          )}
          {modelsError && !modelsLoading && (
            <div role='alert' className='flex items-center justify-between gap-2 px-3 py-2 text-xs'>
              <span>Could not load models.</span>
              <Button type='button' variant='outline' size='xs' onClick={retryModels}>
                Retry
              </Button>
            </div>
          )}
          <ComboboxEmpty>
            {!modelsLoading && !modelsError ? 'No models found.' : null}
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
