'use client';

import { ModelPicker } from '@/features/ai-router/components/model-picker';
import { useOptionalDocsAssistant } from '@/features/docs-chat/components/docs-assistant';
import { DEFAULT_MODEL } from '@/lib/docs-chat/models';
import { useEffect } from 'react';

export function ModelSelect({ className }: { className?: string }) {
  const assistant = useOptionalDocsAssistant();
  const loadModels = assistant?.loadModels;
  useEffect(() => loadModels?.(), [loadModels]);
  if (!assistant) return null;
  return (
    <ModelPicker
      value={assistant.model}
      onValueChange={assistant.setModel}
      models={assistant.models ?? [...new Set([DEFAULT_MODEL, assistant.model])]}
      isLoading={assistant.modelsLoading}
      error={assistant.modelsError}
      onRetry={assistant.retryModels}
      className={className}
    />
  );
}
