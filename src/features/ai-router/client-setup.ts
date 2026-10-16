import type { ProviderFormat } from '@/lib/ai-router/types';

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
export function gatewayRequestExample(
  endpoint: string,
  model: string,
  format: ProviderFormat
): string {
  const messages = [{ role: 'user', content: 'Hello' }];
  const path =
    format === 'claude'
      ? '/messages'
      : format === 'openai-responses'
        ? '/responses'
        : '/chat/completions';
  const payload =
    format === 'claude'
      ? { model, max_tokens: 1024, messages }
      : format === 'openai-responses'
        ? { model, input: 'Hello' }
        : { model, messages };
  return [
    `curl ${quote(endpoint + path)} \\`,
    '  -H "Authorization: Bearer $DEVONE_AI_KEY" \\',
    '  -H "Content-Type: application/json" \\',
    `  -d ${quote(JSON.stringify(payload))}`
  ].join('\n');
}
