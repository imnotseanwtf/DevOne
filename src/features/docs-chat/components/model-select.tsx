'use client';

import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
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

  const { model, setModel, models } = assistant;
  // The list isn't known yet (or the router can't list): offer only what is selected.
  const options = models ?? [...new Set([DEFAULT_MODEL, model])];

  return (
    <label className={cn('flex items-center gap-2 text-xs', className)}>
      <span className='text-muted-foreground hidden shrink-0 sm:inline'>Model</span>
      <NativeSelect
        value={model}
        onChange={(event) => setModel(event.target.value)}
        aria-label='AI model'
        className='h-8 min-w-0 flex-1 text-xs'
      >
        {options.map((id) => (
          <NativeSelectOption key={id} value={id}>
            {modelLabel(id, true)}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </label>
  );
}
