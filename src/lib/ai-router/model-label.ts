/** Display names only: the original id remains the request and storage value. */
export function modelLabel(id: string, includeProvider = false): string {
  if (id === 'auto') return 'Auto (first available)';
  const slash = id.lastIndexOf('/');
  const model = id.slice(slash + 1);
  const normalized = model.replace(
    /^claude-(\d+(?:[.-]\d{1,2})?)-(sonnet|opus|haiku|fable)/i,
    'claude-$2-$1'
  );
  const claude = /^claude-(sonnet|opus|haiku|fable)-(\d+(?:[.-]\d{1,2}(?=-|$))?)(.*)$/i.exec(
    normalized
  );
  let label: string;
  if (claude) {
    const [, family, version, variant] = claude;
    const suffix = variant.replace(/^-/, '').replaceAll('-', ' ');
    label = `Claude ${family[0].toUpperCase()}${family.slice(1).toLowerCase()} ${version.replace('-', '.')}${suffix ? ` (${suffix})` : ''}`;
  } else if (/^gpt-[\w.-]+$/i.test(model)) {
    label = `GPT ${model
      .slice(4)
      .replaceAll('-', ' ')
      .replace(/\b[a-z]/g, (letter) => letter.toUpperCase())}`;
  } else {
    return id;
  }
  if (!includeProvider || slash < 0) return label;
  const provider = id.slice(0, slash);
  const providerNames: Record<string, string> = {
    cc: 'Claude Code',
    cx: 'Codex',
    oa: 'OpenAI',
    an: 'Anthropic',
    oc: 'OpenCode Free',
    ol: 'Ollama'
  };
  return `${label} (via ${providerNames[provider.toLowerCase()] ?? provider})`;
}
