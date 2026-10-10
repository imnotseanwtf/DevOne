import type { TKey } from '@/i18n/messages';
import type { ProviderAuthType, ProviderFormat } from './types';

/** Starting points; models can be fetched or entered manually. */
export interface AiProviderPreset {
  id: string;
  name: string;
  baseUrl: string;
  /** Some models to start with; "Fetch models" lists the rest. */
  models: string[];
  needsKey: boolean;
  category?: 'free';
  /** Where to get a key, or what to know before using it. */
  hintKey: TKey;
  providerType?: string;
  format?: ProviderFormat;
  authType?: ProviderAuthType;
}

export const AI_PROVIDER_PRESETS: AiProviderPreset[] = [
  {
    id: 'opencode',
    providerType: 'opencode',
    name: 'OpenCode Free',
    baseUrl: 'https://opencode.ai/zen/v1',
    models: ['big-pickle'],
    authType: 'none',
    needsKey: false,
    category: 'free',
    hintKey: 'aiRouter.presets.opencodeFree'
  },
  {
    id: 'opencode-zen',
    name: 'OpenCode Zen',
    baseUrl: 'https://opencode.ai/zen/v1',
    models: [],
    needsKey: true,
    hintKey: 'aiRouter.presets.opencodeZen'
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: [],
    needsKey: true,
    hintKey: 'aiRouter.presets.openrouter'
  },
  {
    id: 'groq',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: [],
    needsKey: true,
    hintKey: 'aiRouter.presets.groq'
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: [],
    needsKey: true,
    hintKey: 'aiRouter.presets.gemini'
  },
  {
    id: 'cerebras',
    name: 'Cerebras',
    baseUrl: 'https://api.cerebras.ai/v1',
    models: [],
    needsKey: true,
    hintKey: 'aiRouter.presets.cerebras'
  },
  {
    id: 'mistral',
    name: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    models: [],
    needsKey: true,
    hintKey: 'aiRouter.presets.mistral'
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    models: [],
    needsKey: true,
    hintKey: 'aiRouter.presets.deepseek'
  },
  {
    id: 'ollama',
    providerType: 'ollama',
    authType: 'none',
    name: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    models: [],
    needsKey: false,
    hintKey: 'aiRouter.presets.ollama'
  },
  {
    id: 'openai',
    name: 'OpenAI',
    providerType: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    models: [],
    needsKey: true,
    hintKey: 'aiRouter.presets.openai'
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    providerType: 'anthropic',
    format: 'claude',
    baseUrl: 'https://api.anthropic.com/v1',
    models: [],
    needsKey: true,
    hintKey: 'aiRouter.presets.anthropic'
  },
  {
    id: 'claude',
    name: 'Claude',
    providerType: 'claude',
    format: 'claude',
    authType: 'oauth',
    baseUrl: 'https://api.anthropic.com/v1',
    models: [],
    needsKey: false,
    hintKey: 'aiRouter.presets.oauth'
  },
  {
    id: 'codex',
    name: 'Codex',
    providerType: 'codex',
    format: 'openai-responses',
    authType: 'oauth',
    baseUrl: 'https://chatgpt.com/backend-api/codex',
    models: [],
    needsKey: false,
    hintKey: 'aiRouter.presets.oauth'
  },
  {
    id: 'custom',
    name: '',
    baseUrl: '',
    models: [],
    needsKey: true,
    hintKey: 'aiRouter.presets.custom'
  }
];
