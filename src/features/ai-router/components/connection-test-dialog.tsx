'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { Icons } from '@/components/icons';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Bubble, BubbleContent } from '@/components/ui/bubble';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { FieldGroup } from '@/components/ui/field';
import { Message, MessageContent, MessageHeader } from '@/components/ui/message';
import {
  MessageScroller,
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
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className='flex max-h-[90dvh] flex-col overflow-y-auto sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>{t('aiRouter.test.title', { name: connection.name })}</DialogTitle>
          <DialogDescription>
            {t('aiRouter.test.description', { provider: provider.name })}
          </DialogDescription>
        </DialogHeader>
        <MessageScrollerProvider>
          <MessageScroller className='h-[min(32dvh,16rem)] shrink-0 rounded-md border'>
            <MessageScrollerViewport>
              <MessageScrollerContent
                className='p-3'
                role='log'
                aria-label={t('aiRouter.test.conversation')}
                aria-live='polite'
              >
                {messages.length ? (
                  messages.map((message, index) => (
                    <MessageScrollerItem key={index}>
                      <Message align={message.role === 'user' ? 'end' : 'start'}>
                        <MessageContent>
                          <MessageHeader>
                            {message.role === 'user' ? t('aiRouter.test.you') : connection.name}
                          </MessageHeader>
                          <Bubble variant={message.role === 'user' ? 'default' : 'muted'}>
                            <BubbleContent className='whitespace-pre-wrap'>
                              {message.content}
                            </BubbleContent>
                          </Bubble>
                        </MessageContent>
                      </Message>
                    </MessageScrollerItem>
                  ))
                ) : (
                  <p className='text-muted-foreground text-sm'>{t('aiRouter.test.empty')}</p>
                )}
              </MessageScrollerContent>
            </MessageScrollerViewport>
          </MessageScroller>
        </MessageScrollerProvider>
        {mutation.isSuccess && (
          <p role='status' className='text-muted-foreground text-sm'>
            {t('aiRouter.test.connected', {
              model: mutation.data.result.model,
              time: (mutation.data.result.elapsedMs / 1000).toFixed(2)
            })}
            {mutation.data.result.truncated && (
              <span className='block'>{t('aiRouter.test.truncated')}</span>
            )}
          </p>
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
        <form
          className='flex min-h-0 flex-col gap-4 overflow-y-auto'
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <fieldset disabled={mutation.isPending || Boolean(unavailable) || !models.length}>
            <FieldGroup>
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
              <form.AppField
                name='message'
                children={(field) => (
                  <field.TextareaField
                    label={t('aiRouter.test.message')}
                    placeholder={t('aiRouter.test.placeholder')}
                    rows={2}
                    maxLength={8000}
                    required
                  />
                )}
              />
            </FieldGroup>
          </fieldset>
          <DialogFooter className='flex-wrap'>
            <Button
              type='button'
              variant='outline'
              disabled={mutation.isPending}
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
                  variant='outline'
                  isLoading={mutation.isPending && !mutation.variables?.clearComposer}
                  disabled={mutation.isPending || Boolean(unavailable) || !models.includes(model)}
                  onClick={() => mutation.mutate({ model, message: t('aiRouter.test.probe') })}
                >
                  {t('aiRouter.test.quick')}
                </Button>
              )}
            </form.Subscribe>
            <Button
              type='submit'
              isLoading={mutation.isPending && Boolean(mutation.variables?.clearComposer)}
              disabled={mutation.isPending || Boolean(unavailable) || !models.length}
            >
              <Icons.send />
              {t('aiRouter.test.send')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
