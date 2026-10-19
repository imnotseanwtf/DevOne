/** OpenCode's public catalog includes paid models and non-chat endpoints. */
export function openCodeFreeModels(models: string[]): string[] {
  return models.filter(
    (model) =>
      (model === 'big-pickle' || model.endsWith('-free')) &&
      !model.startsWith('jev-') &&
      !model.includes('-contributor-free')
  );
}
