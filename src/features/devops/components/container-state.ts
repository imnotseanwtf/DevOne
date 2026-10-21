export function stateVariant(state: string) {
  if (state === 'running') return 'default' as const;
  if (state === 'exited' || state === 'created') return 'secondary' as const;
  return 'destructive' as const;
}
