'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Icons } from '@/components/icons';
import { deleteComboAction, saveComboAction } from '@/features/ai-router/actions';
import type { AiProviderRow } from '@/features/ai-router/components/ai-providers-settings';
import { useT } from '@/i18n/client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

export interface AiComboRow {
  id: string;
  name: string;
  steps: { providerId: string; model: string }[];
}

type ProviderOption = Pick<AiProviderRow, 'id' | 'name' | 'models' | 'enabled'>;
type Editing = { mode: 'add' } | { mode: 'edit'; combo: AiComboRow } | null;

export function AiCombosSettings({
  combos,
  providers
}: {
  combos: AiComboRow[];
  providers: ProviderOption[];
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<Editing>(null);
  const [removing, setRemoving] = useState<AiComboRow | null>(null);
  const providerName = (id: string) => providers.find((provider) => provider.id === id)?.name;

  return (
    <Card>
      <CardHeader className='flex flex-row flex-wrap items-start justify-between gap-4'>
        <div className='space-y-1.5'>
          <CardTitle>{t('aiRouter.combos.title')}</CardTitle>
          <CardDescription>{t('aiRouter.combos.description')}</CardDescription>
        </div>
        <Button
          size='sm'
          disabled={providers.length === 0}
          title={providers.length === 0 ? t('aiRouter.combos.noProviders') : undefined}
          onClick={() => setEditing({ mode: 'add' })}
        >
          <Icons.add /> {t('aiRouter.combos.add')}
        </Button>
      </CardHeader>
      <CardContent>
        {combos.length === 0 ? (
          <p className='text-muted-foreground text-sm'>{t('aiRouter.combos.empty')}</p>
        ) : (
          <ul className='divide-border divide-y rounded-md border'>
            {combos.map((combo) => (
              <li key={combo.id} className='flex flex-wrap items-center gap-x-4 gap-y-2 p-3'>
                <div className='min-w-48 flex-1 space-y-1'>
                  <p className='text-sm font-medium'>
                    <code>{combo.name}</code>
                  </p>
                  <ol className='flex flex-wrap items-center gap-1 text-xs'>
                    {combo.steps.map((step, index) => (
                      <li key={index} className='flex items-center gap-1'>
                        {index > 0 && <Icons.arrowRight className='text-muted-foreground size-3' />}
                        <Badge variant='outline'>
                          {providerName(step.providerId) ?? '?'} / {step.model}
                        </Badge>
                      </li>
                    ))}
                  </ol>
                </div>
                <div className='flex gap-1'>
                  <Button
                    variant='ghost'
                    size='icon'
                    aria-label={t('aiRouter.combos.editTitle', { name: combo.name })}
                    disabled={pending}
                    onClick={() => setEditing({ mode: 'edit', combo })}
                  >
                    <Icons.edit />
                  </Button>
                  <Button
                    variant='ghost'
                    size='icon'
                    aria-label={t('common.remove')}
                    disabled={pending}
                    onClick={() => setRemoving(combo)}
                  >
                    <Icons.trash />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {editing && (
        <ComboDialog
          combo={editing.mode === 'edit' ? editing.combo : null}
          providers={providers}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            toast.success(t('aiRouter.combos.saved'));
            router.refresh();
          }}
        />
      )}

      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('aiRouter.combos.removeTitle', { name: removing?.name ?? '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('aiRouter.combos.removeDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={() => {
                const target = removing;
                setRemoving(null);
                if (!target) return;
                startTransition(async () => {
                  const result = await deleteComboAction({ comboId: target.id });
                  if (!result.ok) {
                    toast.error(result.error);
                    return;
                  }
                  toast.success(t('aiRouter.combos.removed'));
                  router.refresh();
                });
              }}
            >
              {t('common.remove')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function ComboDialog({
  combo,
  providers,
  onClose,
  onSaved
}: {
  combo: AiComboRow | null;
  providers: ProviderOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const firstStep = () => ({
    providerId: providers[0]?.id ?? '',
    model: providers[0]?.models[0] ?? ''
  });
  const [name, setName] = useState(combo?.name ?? '');
  const [steps, setSteps] = useState(combo?.steps ?? [firstStep()]);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  const update = (index: number, change: Partial<AiComboRow['steps'][number]>) =>
    setSteps((current) =>
      current.map((step, position) => (position === index ? { ...step, ...change } : step))
    );
  const move = (index: number, by: -1 | 1) =>
    setSteps((current) => {
      const next = [...current];
      [next[index], next[index + by]] = [next[index + by], next[index]];
      return next;
    });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-xl'>
        <form
          className='space-y-4'
          autoComplete='off'
          onSubmit={(event) => {
            event.preventDefault();
            setError(undefined);
            startTransition(async () => {
              const result = await saveComboAction({ id: combo?.id, name, steps });
              if (!result.ok) {
                setError(result.error);
                return;
              }
              onSaved();
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {combo
                ? t('aiRouter.combos.editTitle', { name: combo.name })
                : t('aiRouter.combos.addTitle')}
            </DialogTitle>
            <DialogDescription>{t('aiRouter.combos.description')}</DialogDescription>
          </DialogHeader>
          <div className='space-y-2'>
            <Label htmlFor='ai-combo-name'>{t('aiRouter.combos.name')}</Label>
            <Input
              id='ai-combo-name'
              required
              maxLength={60}
              placeholder='free-stack'
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <p className='text-muted-foreground text-xs'>{t('aiRouter.combos.nameHint')}</p>
          </div>
          <fieldset className='space-y-2'>
            <legend className='mb-2 text-sm font-medium'>{t('aiRouter.combos.steps')}</legend>
            {steps.map((step, index) => {
              const provider = providers.find((candidate) => candidate.id === step.providerId);
              const listId = `ai-combo-models-${index}`;
              return (
                <div key={index} className='flex flex-wrap items-center gap-2'>
                  <span className='text-muted-foreground w-5 text-right text-xs'>{index + 1}.</span>
                  <NativeSelect
                    aria-label={t('aiRouter.combos.provider')}
                    value={step.providerId}
                    onChange={(event) => {
                      const next = providers.find(
                        (candidate) => candidate.id === event.target.value
                      );
                      update(index, {
                        providerId: event.target.value,
                        model: next?.models[0] ?? ''
                      });
                    }}
                  >
                    {providers.map((candidate) => (
                      <NativeSelectOption key={candidate.id} value={candidate.id}>
                        {candidate.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <Input
                    aria-label={t('aiRouter.combos.model')}
                    className='min-w-40 flex-1'
                    list={listId}
                    required
                    value={step.model}
                    onChange={(event) => update(index, { model: event.target.value })}
                  />
                  <datalist id={listId}>
                    {provider?.models.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </datalist>
                  <div className='flex'>
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon'
                      aria-label={t('aiRouter.combos.moveUp')}
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <Icons.chevronUp />
                    </Button>
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon'
                      aria-label={t('aiRouter.combos.moveDown')}
                      disabled={index === steps.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <Icons.chevronDown />
                    </Button>
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon'
                      aria-label={t('aiRouter.combos.removeStep')}
                      disabled={steps.length === 1}
                      onClick={() =>
                        setSteps((current) => current.filter((_, position) => position !== index))
                      }
                    >
                      <Icons.close />
                    </Button>
                  </div>
                </div>
              );
            })}
            <Button
              type='button'
              variant='outline'
              size='sm'
              disabled={steps.length >= 20}
              onClick={() => setSteps((current) => [...current, firstStep()])}
            >
              <Icons.add /> {t('aiRouter.combos.addStep')}
            </Button>
          </fieldset>
          {error && <p className='text-destructive text-sm'>{error}</p>}
          <DialogFooter>
            <Button type='button' variant='outline' onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type='submit' disabled={pending}>
              {pending && <Icons.spinner className='animate-spin' />}
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
