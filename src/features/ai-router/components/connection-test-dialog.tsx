'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty';
import { InputGroup, InputGroupAddon, InputGroupTextarea } from '@/components/ui/input-group';
import { Marker, MarkerContent } from '@/components/ui/marker';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Bubble, BubbleContent } from '@/components/ui/bubble';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Message, MessageAvatar, MessageContent } from '@/components/ui/message';
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport
} from '@/components/ui/message-scroller';
import { useT } from '@/i18n/client';
import { useAppForm } from '@/lib/form';
import { aiGatewayKeys } from '../api/queries';
import { testConnection } from '../api/connection-test/service';
import type { AiConnectionSummary, AiProviderSummary, AiTestMessage } from '../api/types';
import { Button } from './gateway-button';

interface ConnectionTestDialogProps {
  provider: AiProviderSummary;
  connection: AiConnectionSummary;
  onClose: () => void;
}

export function ConnectionTestDialog({ provider, connection, onClose }: ConnectionTestDialogProps) {
  const t = useT();
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<AiTestMessage[]>([]);
  const [conversationModel, setConversationModel] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const models = provider.models.filter(
    (model) => !connection.allowedModels.length || connection.allowedModels.includes(model)
  );
  const unavailable =
    !provider.enabled ||
    !connection.isActive ||
    (connection.rateLimitedUntil && new Date(connection.rateLimitedUntil).getTime() > Date.now());
  const mutation = useMutation({
    mutationFn: async ({
      model,
      message,
      clearComposer = false
    }: {
      model: string;
      message: string;
      clearComposer?: boolean;
    }) => {
      controller.current = new AbortController();
      const history = model === conversationModel ? messages.slice(-20) : [];
      const conversation: AiTestMessage[] = [...history, { role: 'user', content: message }];
      const result = await testConnection(
        connection.id,
        { model, messages: conversation },
        controller.current.signal
      );
      return { result, conversation, model, clearComposer };
    },
    onSuccess: ({ result, conversation, model, clearComposer }) => {
      setConversationModel(model);
      setMessages([
        ...conversation,
        { role: 'assistant', content: result.message || t('aiRouter.test.noText') }
      ]);
      if (clearComposer) form.setFieldValue('message', '');
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: aiGatewayKeys.all });
    }
  });
  const form = useAppForm({
    defaultValues: { model: models[0] ?? '', message: '' },
    validators: {
      onSubmit: z.object({
        model: z.string().refine((model) => models.includes(model), t('aiRouter.test.chooseModel')),
        message: z.string().trim().min(1, t('aiRouter.test.enterMessage')).max(8000)
      })
    },
    onSubmit: async ({ value }) => {
      await mutation.mutateAsync({ ...value, clearComposer: true }).catch(() => undefined);
    }
  });
  const close = () => {
    controller.current?.abort();
    onClose();
  };
  const visibleMessages: AiTestMessage[] =
    mutation.isPending && mutation.variables
      ? [
          ...(mutation.variables.model === conversationModel ? messages : []),
          { role: 'user', content: mutation.variables.message }
        ]
      : messages;
  const status = mutation.isPending
    ? t('aiRouter.test.thinking')
    : mutation.isError
      ? t('aiRouter.test.failed')
      : mutation.isSuccess
        ? t('aiRouter.test.readyConnected')
        : t('aiRouter.test.ready');
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className='bg-card flex h-[min(44rem,90dvh)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl'>
        <DialogHeader className='flex shrink-0 flex-row items-center gap-3 border-b px-4 py-3 pr-12 text-left'>
          <div className='bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-lg'>
            <Icons.sparkles className='size-4' />
          </div>
          <div className='min-w-0 flex-1'>
            <DialogTitle className='truncate text-sm'>
              {t('aiRouter.test.title', { name: connection.name })}
            </DialogTitle>
            <DialogDescription className='truncate text-xs'>{provider.name}</DialogDescription>
          </div>
          <Badge variant={mutation.isError ? 'destructive' : 'outline'} role='status'>
            {status}
          </Badge>
        </DialogHeader>
        <form
          className='flex min-h-0 flex-1 flex-col'
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <fieldset
            disabled={mutation.isPending || Boolean(unavailable) || !models.length}
            className='shrink-0 border-b px-4 py-3'
          >
            <form.AppField
              name='model'
              children={(field) => (
                <field.SelectField
                  label={t('aiRouter.test.model')}
                  options={models.map((model) => ({ value: model, label: model }))}
                  required
                />
              )}
            />
          </fieldset>
          <MessageScrollerProvider defaultScrollPosition='end' scrollPreviousItemPeek={64}>
            <MessageScroller className='min-h-0 flex-1'>
              <MessageScrollerViewport>
                <MessageScrollerContent
                  className='px-4 py-4'
                  role='log'
                  aria-label={t('aiRouter.test.conversation')}
                  aria-live='polite'
                >
                  {visibleMessages.length ? (
                    visibleMessages.map((message, index) => {
                      const isUser = message.role === 'user';
                      return (
                        <MessageScrollerItem
                          key={index}
                          messageId={String(index)}
                          scrollAnchor={isUser}
                        >
                          <Message align={isUser ? 'end' : 'start'}>
                            <MessageAvatar
                              className={cn(
                                'size-8 self-start',
                                isUser
                                  ? 'bg-primary text-primary-foreground'
                                  : 'bg-primary/10 text-primary'
                              )}
                            >
                              {isUser ? (
                                <Icons.user className='size-4' />
                              ) : (
                                <Icons.sparkles className='size-4' />
                              )}
                              <span className='sr-only'>
                                {isUser ? t('aiRouter.test.you') : connection.name}
                              </span>
                            </MessageAvatar>
                            <MessageContent>
                              <Bubble
                                variant={isUser ? 'default' : 'muted'}
                                align={isUser ? 'end' : 'start'}
                              >
                                <BubbleContent className='whitespace-pre-wrap'>
                                  {message.content}
                                </BubbleContent>
                              </Bubble>
                            </MessageContent>
                          </Message>
                        </MessageScrollerItem>
                      );
                    })
                  ) : (
                    <MessageScrollerItem messageId='empty' className='flex min-h-48 items-center'>
                      <Empty>
                        <EmptyHeader>
                          <EmptyMedia variant='icon'>
                            <Icons.sparkles />
                          </EmptyMedia>
                          <EmptyTitle>{t('aiRouter.test.assistant')}</EmptyTitle>
                          <EmptyDescription>{t('aiRouter.test.empty')}</EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                    </MessageScrollerItem>
                  )}
                  {mutation.isPending && (
                    <MessageScrollerItem messageId='pending'>
                      <Message>
                        <MessageAvatar className='bg-primary/10 text-primary size-8 self-start'>
                          <Icons.sparkles className='size-4' />
                        </MessageAvatar>
                        <MessageContent>
                          <Marker>
                            <MarkerContent className='shimmer'>
                              {t('aiRouter.test.thinking')}
                            </MarkerContent>
                          </Marker>
                        </MessageContent>
                      </Message>
                    </MessageScrollerItem>
                  )}
                </MessageScrollerContent>
              </MessageScrollerViewport>
              <MessageScrollerButton>
                <Icons.chevronDown />
                <span className='sr-only'>{t('aiRouter.test.latest')}</span>
              </MessageScrollerButton>
            </MessageScroller>
          </MessageScrollerProvider>
          <div className='flex shrink-0 flex-col gap-3 border-t px-4 py-3'>
            {mutation.isSuccess && (
              <Marker role='status'>
                <MarkerContent>
                  {t('aiRouter.test.connected', {
                    model: mutation.data.result.model,
                    time: (mutation.data.result.elapsedMs / 1000).toFixed(2)
                  })}
                  {mutation.data.result.truncated && (
                    <span className='block'>{t('aiRouter.test.truncated')}</span>
                  )}
                </MarkerContent>
              </Marker>
            )}
            {mutation.isError && (
              <Alert variant='destructive'>
                <AlertDescription>{mutation.error.message}</AlertDescription>
              </Alert>
            )}
            {(unavailable || !models.length) && (
              <Alert>
                <AlertDescription>
                  {t(!models.length ? 'aiRouter.test.noModels' : 'aiRouter.test.unavailable')}
                </AlertDescription>
              </Alert>
            )}
            <form.Field
              name='message'
              children={(field) => {
                const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
                return (
                  <Field data-invalid={invalid}>
                    <FieldLabel htmlFor='connection-test-message' className='sr-only'>
                      {t('aiRouter.test.message')}
                    </FieldLabel>
                    <InputGroup>
                      <InputGroupTextarea
                        id='connection-test-message'
                        name={field.name}
                        value={field.state.value}
                        onChange={(event) => field.handleChange(event.target.value)}
                        onBlur={field.handleBlur}
                        placeholder={t('aiRouter.test.placeholder')}
                        rows={2}
                        maxLength={8000}
                        aria-invalid={invalid}
                        aria-describedby={invalid ? 'connection-test-message-error' : undefined}
                        disabled={mutation.isPending || Boolean(unavailable) || !models.length}
                      />
                      <InputGroupAddon align='block-end' className='flex-wrap gap-2'>
                        <Button
                          type='button'
                          size='sm'
                          variant='ghost'
                          disabled={mutation.isPending || !messages.length}
                          onClick={() => {
                            setMessages([]);
                            setConversationModel('');
                            mutation.reset();
                          }}
                        >
                          {t('aiRouter.test.clear')}
                        </Button>
                        <form.Subscribe selector={(state) => state.values.model}>
                          {(model) => (
                            <Button
                              type='button'
                              size='sm'
                              variant='outline'
                              className='ml-auto'
                              isLoading={mutation.isPending && !mutation.variables?.clearComposer}
                              disabled={
                                mutation.isPending ||
                                Boolean(unavailable) ||
                                !models.includes(model)
                              }
                              onClick={() =>
                                mutation.mutate({ model, message: t('aiRouter.test.probe') })
                              }
                            >
                              {t('aiRouter.test.quick')}
                            </Button>
                          )}
                        </form.Subscribe>
                        <Button
                          type='submit'
                          size='sm'
                          isLoading={
                            mutation.isPending && Boolean(mutation.variables?.clearComposer)
                          }
                          disabled={mutation.isPending || Boolean(unavailable) || !models.length}
                        >
                          <Icons.send />
                          {t('aiRouter.test.send')}
                        </Button>
                      </InputGroupAddon>
                    </InputGroup>
                    {invalid && (
                      <FieldError
                        id='connection-test-message-error'
                        errors={field.state.meta.errors}
                      />
                    )}
                  </Field>
                );
              }}
            />
            <p className='text-muted-foreground text-center text-xs'>
              {t('aiRouter.test.usageHint')}
            </p>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
