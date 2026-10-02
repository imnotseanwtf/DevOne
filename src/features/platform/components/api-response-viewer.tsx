'use client';

import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { SendRequestResult } from '@/features/platform/actions';
import { cn } from '@/lib/utils';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { OperationDocs } from '@/lib/api-client/openapi';
import { ApiCodeInput } from './api-code-input';
import { SchemaBlock } from './api-operation-docs';
import { statusTone } from './api-method-badge';

interface ApiResponseViewerProps {
  result?: SendRequestResult;
  sending: boolean;
  /** The imported operation's docs, to show the schema expected for the status. */
  docs?: OperationDocs | null;
}

export function ApiResponseViewer({ result, sending, docs }: ApiResponseViewerProps) {
  if (sending) {
    return (
      <Placeholder>
        <Icons.spinner className='size-4 animate-spin' /> Sending request…
      </Placeholder>
    );
  }

  if (!result) {
    return (
      <Placeholder>
        <span>
          Send a request to see the response here. <kbd className='font-mono'>⌘/Ctrl + Enter</kbd>
        </span>
      </Placeholder>
    );
  }

  if (!result.ok || !result.response) {
    return (
      <Placeholder>
        <span className='text-destructive flex items-center gap-2'>
          <Icons.alertCircle className='size-4' /> {result.error ?? 'The request failed'}
        </span>
      </Placeholder>
    );
  }

  return <ResponseDetails response={result.response} docs={docs ?? null} />;
}

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <div className='text-muted-foreground flex h-full min-h-40 items-center justify-center gap-2 p-6 text-center text-sm'>
      {children}
    </div>
  );
}

type Response = NonNullable<SendRequestResult['response']>;

/** The documented response for a status: exact match, then `4XX` style, then `default`. */
function expectedResponse(docs: OperationDocs | null, status: number) {
  if (!docs) return undefined;
  const code = String(status);
  return (
    docs.responses.find((entry) => entry.status === code) ??
    docs.responses.find((entry) => entry.status.toUpperCase() === `${code[0]}XX`) ??
    docs.responses.find((entry) => entry.status === 'default')
  );
}

function ResponseDetails({ response, docs }: { response: Response; docs: OperationDocs | null }) {
  const [raw, setRaw] = useState(false);
  const expected = expectedResponse(docs, response.status);

  const contentType =
    response.headers.find(([name]) => name.toLowerCase() === 'content-type')?.[1] ?? '';

  const pretty = useMemo(() => {
    try {
      return JSON.stringify(JSON.parse(response.body), null, 2);
    } catch {
      return null;
    }
  }, [response.body]);

  const isJson = pretty !== null;
  const shown = isJson && !raw ? pretty : response.body;
  const isHtml =
    !!response.body &&
    (/html/i.test(contentType) || /^\s*(<!doctype html|<html)/i.test(response.body));

  return (
    // Keyed so a new response opens on Preview again when it's HTML.
    <Tabs
      key={`${response.baseUrl}-${response.durationMs}`}
      defaultValue={isHtml ? 'preview' : 'body'}
      className='flex h-full min-h-0 flex-col gap-0'
    >
      <div className='flex items-center gap-3 border-b px-2'>
        <TabsList variant='line' className='justify-start'>
          {isHtml && <TabsTrigger value='preview'>Preview</TabsTrigger>}
          <TabsTrigger value='body'>Body</TabsTrigger>
          <TabsTrigger value='headers'>
            Headers{' '}
            <span className='text-muted-foreground text-[10px]'>{response.headers.length}</span>
          </TabsTrigger>
          {expected && (expected.fields?.length || expected.example) && (
            <TabsTrigger value='expected'>Expected</TabsTrigger>
          )}
          {response.cookies.length > 0 && (
            <TabsTrigger value='cookies'>
              Cookies{' '}
              <span className='text-muted-foreground text-[10px]'>{response.cookies.length}</span>
            </TabsTrigger>
          )}
        </TabsList>
        <div className='ml-auto flex items-center gap-3 font-mono text-xs'>
          <span className={cn('font-semibold', statusTone(response.status))}>
            {response.status} {response.statusText}
          </span>
          <span className='text-muted-foreground'>{response.durationMs} ms</span>
          <span className='text-muted-foreground'>{formatBytes(response.sizeBytes)}</span>
        </div>
      </div>

      <TabsContent value='body' className='flex min-h-0 flex-1 flex-col'>
        <div className='flex items-center gap-1 px-2 py-1'>
          <span className='text-muted-foreground truncate text-xs'>
            {contentType || 'No content type'}
          </span>
          <div className='ml-auto flex items-center'>
            {isJson && (
              <Button variant='ghost' size='sm' onClick={() => setRaw((value) => !value)}>
                {raw ? 'Pretty' : 'Raw'}
              </Button>
            )}
            <Button
              variant='ghost'
              size='sm'
              disabled={!response.body}
              onClick={() => {
                void navigator.clipboard.writeText(response.body);
                toast.success('Copied to clipboard');
              }}
            >
              <Icons.copy className='size-3.5' /> Copy
            </Button>
          </div>
        </div>
        {response.body ? (
          <ApiCodeInput
            aria-label='Response body'
            readOnly
            language={isJson && !raw ? 'json' : 'text'}
            value={shown}
            className='min-h-0 flex-1 overflow-hidden'
          />
        ) : (
          <Placeholder>The response has no body.</Placeholder>
        )}
        {response.truncated && (
          <p className='text-muted-foreground border-t px-3 py-1.5 text-xs'>
            Showing the first 512 KB of {formatBytes(response.sizeBytes)}.
          </p>
        )}
      </TabsContent>

      {isHtml && (
        <TabsContent value='preview' className='flex min-h-0 flex-1 flex-col'>
          <p className='text-muted-foreground border-b px-3 py-1.5 text-xs'>
            Rendered without scripts, forms or pop-ups, so it may look different from a browser.
          </p>
          <iframe
            title='Response preview'
            // An empty sandbox: no scripts, no forms, no top navigation, and a
            // unique origin, so the page can't reach DevOne or its cookies.
            sandbox=''
            referrerPolicy='no-referrer'
            srcDoc={withBase(response.body, response.baseUrl)}
            className='min-h-80 w-full flex-1 bg-white'
          />
        </TabsContent>
      )}

      {expected && (
        <TabsContent value='expected' className='min-h-0 flex-1 space-y-2 overflow-auto p-3'>
          <p className='text-muted-foreground text-xs'>
            What the spec documents for <span className='font-mono'>{expected.status}</span>
            {expected.description ? ` (${expected.description})` : ''}.
          </p>
          <SchemaBlock
            schema={{
              type: expected.type ?? 'any',
              fields: expected.fields ?? [],
              example: expected.example
            }}
          />
        </TabsContent>
      )}

      <TabsContent value='headers' className='min-h-0 flex-1 overflow-auto'>
        <NameValueTable rows={response.headers} />
      </TabsContent>

      <TabsContent value='cookies' className='min-h-0 flex-1 overflow-auto'>
        <NameValueTable
          rows={response.cookies.map((cookie) => {
            const [pair] = cookie.split(';');
            const equals = pair.indexOf('=');
            return [pair.slice(0, equals), cookie.slice(equals + 1)] as [string, string];
          })}
        />
      </TabsContent>
    </Tabs>
  );
}

function NameValueTable({ rows }: { rows: [string, string][] }) {
  return (
    <table className='w-full font-mono text-xs'>
      <tbody>
        {rows.map(([name, value], index) => (
          <tr key={`${name}-${index}`} className='border-b last:border-b-0'>
            <td className='text-muted-foreground w-1/3 px-3 py-1.5 align-top break-all'>{name}</td>
            <td className='px-3 py-1.5 break-all'>{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Adds a `<base>` so relative images and styles load from the server that answered. */
function withBase(html: string, baseUrl: string): string {
  const escaped = baseUrl.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
  const tag = `<base href="${escaped}"><meta name="referrer" content="no-referrer">`;
  const head = html.match(/<head[^>]*>/i);
  if (head?.index !== undefined) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + tag + html.slice(at);
  }
  return tag + html;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
