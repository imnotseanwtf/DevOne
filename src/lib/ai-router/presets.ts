/**
 * Starting points for the "Add provider" form. Every one speaks the OpenAI
 * chat completions API. Free tiers change often: check each provider's terms
 * and what it does with your prompts before relying on it.
 */
export interface AiProviderPreset {
  id: string;
  name: string;
  baseUrl: string;
  /** Some models to start with; "Fetch models" lists the rest. */
  models: string[];
  needsKey: boolean;
  /** Where to get a key, or what to know before using it. */
  hint: string;
}

export const AI_PROVIDER_PRESETS: AiProviderPreset[] = [
  {
    id: 'opencode-zen',
    name: 'OpenCode Zen',
    baseUrl: 'https://opencode.ai/zen/v1',
    models: ['big-pickle'],
    needsKey: true,
    hint: 'Key from opencode.ai/auth. Free models such as Big Pickle may log prompts and can change at any time.'
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: [],
    needsKey: true,
    hint: 'Key from openrouter.ai/keys. Model ids ending in ":free" cost nothing but are rate-limited.'
  },
  {
    id: 'groq',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: [],
    needsKey: true,
    hint: 'Key from console.groq.com. Has a free tier with daily limits.'
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: [],
    needsKey: true,
    hint: 'Key from aistudio.google.com. Has a free tier with daily limits.'
  },
  {
    id: 'cerebras',
    name: 'Cerebras',
    baseUrl: 'https://api.cerebras.ai/v1',
    models: [],
    needsKey: true,
    hint: 'Key from cloud.cerebras.ai. Has a free tier with daily limits.'
  },
  {
    id: 'mistral',
    name: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    models: [],
    needsKey: true,
    hint: 'Key from console.mistral.ai.'
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat'],
    needsKey: true,
    hint: 'Key from platform.deepseek.com. Paid, but cheap.'
  },
  {
    id: 'ollama',
    name: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    models: [],
    needsKey: false,
    hint: 'Models running on your own machine. The address is as the DevOne server sees it.'
  },
  {
    id: 'custom',
    name: '',
    baseUrl: '',
    models: [],
    needsKey: true,
    hint: 'Any API that speaks the OpenAI chat completions format.'
  }
];
