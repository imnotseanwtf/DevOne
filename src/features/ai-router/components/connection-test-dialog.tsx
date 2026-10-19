'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useIsFetching, useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { Icons } from '@/components/icons';
import { Markdown } from '@/components/markdown-editor';
import { modelLabel } from '@/lib/ai-router/model-label';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea
} from '@/components/ui/input-group';
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
import { Message, MessageContent } from '@/components/ui/message';
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
import { CopyResponse } from './copy-response';
import { ModelPicker } from './model-picker';

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
  const [stopped, setStopped] = useState(false);
  const modelsLoading = useIsFetching({ queryKey: aiGatewayKeys.all }) > 0;
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const models = useMemo(
    () =>
      provider.models.filter(
        (model) => !connection.allowedModels.length || connection.allowedModels.includes(model)
      ),
    [provider.models, connection.allowedModels]
  );
  const unavailable =
    !provider.enabled ||
    !connection.isActive ||
    (connection.rateLimitedUntil && new Date(connection.rateLimitedUntil).getTime() > Date.now());
  const mutation = useMutation({
    mutationFn: async ({
      model,
      conversation,
      signal,
      clearComposer = false
    }: {
      model: string;
      conversation: AiTestMessage[];
      signal: AbortSignal;
      clearComposer?: boolean;
    }) => {
      const result = await testConnection(connection.id, { model, messages: conversation }, signal);
      return { result, conversation, model, clearComposer };
    },
    onMutate: () => setStopped(false),
    onSuccess: ({ result, conversation, model, clearComposer }) => {
      setConversationModel(model);
      setMessages([
        ...conversation,
        { role: 'assistant', content: result.message || t('aiRouter.test.noText') }
      ]);
      if (clearComposer && form.state.values.message.trim() === conversation.at(-1)?.content.trim())
        form.setFieldValue('message', '');
    },
    onError: (_error, variables) => {
      if (variables.signal.aborted) setStopped(true);
    },
    onSettled: () => {
      controller.current = null;
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
      await sendMessage(value.model, value.message, true);
    }
  });
  useEffect(() => {
    if (!models.includes(form.state.values.model)) form.setFieldValue('model', models[0] ?? '');
  }, [models, form]);
  const run = async (model: string, conversation: AiTestMessage[], clearComposer = false) => {
    if (controller.current || mutation.isPending || unavailable || !models.includes(model)) return;
    const active = new AbortController();
    controller.current = active;
    await mutation
      .mutateAsync({ model, conversation, clearComposer, signal: active.signal })
      .catch(() => undefined);
  };
  const sendMessage = async (
    model: string,
    message: string,
    clearComposer = false,
    regenerate = false
  ) => {
    const history =
      model === conversationModel ? (regenerate ? messages.slice(0, -2) : messages).slice(-20) : [];
    await run(model, [...history, { role: 'user', content: message.trim() }], clearComposer);
  };
  const close = () => {
    controller.current?.abort();
    onClose();
  };
  const visibleMessages: AiTestMessage[] =
    (mutation.isPending || mutation.isError) && mutation.variables
      ? mutation.variables.conversation
      : messages;
  const status = mutation.isPending
    ? t('aiRouter.test.thinking')
    : stopped
      ? t('aiRouter.test.stopped')
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
          <Badge variant={mutation.isError && !stopped ? 'destructive' : 'outline'} role='status'>
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
            <form.Field
              name='model'
              children={(field) => (
                <Field>
                  <FieldLabel htmlFor='connection-test-model'>
                    {t('aiRouter.test.model')}
                  </FieldLabel>
                  <ModelPicker
                    id='connection-test-model'
                    label={t('aiRouter.test.model')}
                    models={models}
                    value={field.state.value}
                    isLoading={modelsLoading}
                    disabled={mutation.isPending || Boolean(unavailable)}
                    onValueChange={(value) => {
                      field.handleChange(value);
                      field.handleBlur();
                    }}
                  />
                  {field.state.meta.isTouched && !field.state.meta.isValid && (
                    <FieldError errors={field.state.meta.errors} />
                  )}
                </Field>
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
                            <MessageContent>
                              {!isUser && (
                                <div className='text-muted-foreground flex items-center gap-2 text-xs'>
                                  <Icons.sparkles className='size-3.5' />
                                  <span>{connection.name}</span>
                                </div>
                              )}
                              <Bubble
                                variant={isUser ? 'muted' : 'ghost'}
                                align={isUser ? 'end' : 'start'}
                                className={cn(!isUser && 'w-full')}
                              >
                                <BubbleContent
                                  className={cn(
                                    isUser
                                      ? 'rounded-2xl rounded-tr-sm whitespace-pre-wrap'
                                      : 'w-full'
                                  )}
                                >
                                  {isUser ? (
                                    message.content
                                  ) : (
                                    <Markdown
                                      source={message.content}
                                      className='text-sm leading-relaxed [&_pre]:max-w-full [&_pre]:text-xs [&_table]:block [&_table]:overflow-x-auto'
                                    />
                                  )}
                                </BubbleContent>
                              </Bubble>
                              {!isUser && (
                                <div className='text-muted-foreground flex items-center gap-1'>
                                  <CopyResponse content={message.content} />
                                  {index === visibleMessages.length - 1 && !mutation.isPending && (
                                    <form.Subscribe selector={(state) => state.values.model}>
                                      {(model) => (
                                        <Button
                                          type='button'
                                          variant='ghost'
                                          size='xs'
                                          disabled={
                                            Boolean(unavailable) || model !== conversationModel
                                          }
                                          onClick={() =>
                                            void sendMessage(
                                              model,
                                              messages.at(-2)?.content ?? '',
                                              false,
                                              true
                                            )
                                          }
                                        >
                                          <Icons.refresh className='size-3.5' />
                                          {t('aiRouter.test.regenerate')}
                                        </Button>
                                      )}
                                    </form.Subscribe>
                                  )}
                                </div>
                              )}
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
                        <MessageContent>
                          <Marker>
                            <MarkerContent role='status' className='flex items-center gap-2'>
                              <span className='bg-foreground size-2 rounded-full motion-safe:animate-pulse' />
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
                    model: modelLabel(mutation.data.result.model),
                    time: (mutation.data.result.elapsedMs / 1000).toFixed(2)
                  })}
                  {mutation.data.result.truncated && (
                    <span className='block'>{t('aiRouter.test.truncated')}</span>
                  )}
                </MarkerContent>
              </Marker>
            )}
            {mutation.isError && !stopped && (
              <Alert variant='destructive'>
                <AlertDescription>{mutation.error.message}</AlertDescription>
              </Alert>
            )}
            {stopped && (
              <p role='status' className='text-muted-foreground text-xs'>
                {t('aiRouter.test.stopped')}
              </p>
            )}
            {mutation.isError && !mutation.isPending && mutation.variables && (
              <Button
                type='button'
                size='xs'
                variant='outline'
                disabled={Boolean(unavailable) || !models.includes(mutation.variables.model)}
                onClick={() =>
                  mutation.variables &&
                  void run(
                    mutation.variables.model,
                    mutation.variables.conversation,
                    mutation.variables.clearComposer
                  )
                }
              >
                <Icons.refresh />
                {t('aiRouter.test.retry')}
              </Button>
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
                    <InputGroup className='rounded-2xl'>
                      <InputGroupTextarea
                        id='connection-test-message'
                        name={field.name}
                        value={field.state.value}
                        onChange={(event) => field.handleChange(event.target.value)}
                        onBlur={field.handleBlur}
                        placeholder={t('aiRouter.test.placeholder')}
                        rows={1}
                        className='max-h-40 min-h-12 px-3 pt-3'
                        maxLength={8000}
                        aria-invalid={invalid}
                        aria-describedby={invalid ? 'connection-test-message-error' : undefined}
                        disabled={Boolean(unavailable) || !models.length}
                        onKeyDown={(event) => {
                          if (
                            event.key === 'Enter' &&
                            !event.shiftKey &&
                            !event.nativeEvent.isComposing
                          ) {
                            event.preventDefault();
                            if (!mutation.isPending && field.state.value.trim())
                              void form.handleSubmit();
                          }
                        }}
                      />
                      <InputGroupAddon align='block-end' className='justify-between gap-2'>
                        <form.Subscribe selector={(state) => state.values.model}>
                          {(model) => (
                            <span className='min-w-0 truncate text-xs font-normal'>
                              {modelLabel(model)}
                            </span>
                          )}
                        </form.Subscribe>
                        {mutation.isPending ? (
                          <InputGroupButton
                            type='button'
                            variant='default'
                            size='icon-sm'
                            className='rounded-full'
                            aria-label={t('aiRouter.test.stop')}
                            onClick={() => controller.current?.abort()}
                          >
                            <Icons.stop />
                          </InputGroupButton>
                        ) : (
                          <InputGroupButton
                            type='button'
                            variant='default'
                            size='icon-sm'
                            className='rounded-full'
                            aria-label={t('aiRouter.test.send')}
                            aria-disabled={
                              !field.state.value.trim() || Boolean(unavailable) || !models.length
                            }
                            onClick={() => {
                              if (field.state.value.trim()) void form.handleSubmit();
                            }}
                          >
                            <Icons.arrowUp />
                          </InputGroupButton>
                        )}
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
            <div className='flex flex-wrap items-center gap-2'>
              <Button
                type='button'
                size='sm'
                variant='ghost'
                disabled={mutation.isPending || !visibleMessages.length}
                onClick={() => {
                  setMessages([]);
                  setConversationModel('');
                  setStopped(false);
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
                    isLoading={
                      mutation.isPending &&
                      mutation.variables?.conversation.at(-1)?.content === t('aiRouter.test.probe')
                    }
                    disabled={mutation.isPending || Boolean(unavailable) || !models.includes(model)}
                    onClick={() => void sendMessage(model, t('aiRouter.test.probe'))}
                  >
                    {t('aiRouter.test.quick')}
                  </Button>
                )}
              </form.Subscribe>
            </div>
            <p className='text-muted-foreground text-center text-[10px]'>
              {t('aiRouter.test.composerHint')}
            </p>
            <p className='text-muted-foreground text-center text-xs'>
              {t('aiRouter.test.usageHint')}
            </p>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
