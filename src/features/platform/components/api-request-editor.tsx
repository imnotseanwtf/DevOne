'use client';

import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toSnippet, type SnippetLanguage } from '@/lib/api-client/snippets';
import {
  methodHasBody,
  pathParamNames,
  type ApiAuth,
  type ApiBodyType
} from '@/lib/api-client/types';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { toast } from 'sonner';
import { ApiCodeInput } from './api-code-input';
import { toDraft, withBodyType, withParams, type RequestTab } from './api-client-state';
import { ApiKeyValueEditor, type RowHint } from './api-key-value-editor';
import { ApiOperationDocs } from './api-operation-docs';

interface ApiRequestEditorProps {
  tab: RequestTab;
  onChange: (patch: Partial<RequestTab>) => void;
  onSend: () => void;
}

const BODY_LABELS: Record<ApiBodyType, string> = {
  NONE: 'None',
  JSON: 'JSON',
  TEXT: 'Text',
  FORM: 'Form URL encoded'
};

export function ApiRequestEditor({ tab, onChange, onSend }: ApiRequestEditorProps) {
  const pathNames = pathParamNames(tab.url);
  const paramCount =
    pathNames.length + tab.params.filter((row) => row.enabled !== false && row.key.trim()).length;
  const headerCount = tab.headers.filter((row) => row.key.trim()).length;

  return (
    // Keyed by tab (and by whether its docs have loaded), so an imported request
    // opens on Docs and a plain one on Params.
    <Tabs
      key={`${tab.key}:${tab.docs ? 'docs' : 'plain'}`}
      defaultValue={tab.docs ? 'docs' : 'params'}
      className='flex h-full min-h-0 flex-col gap-0'
    >
      <TabsList variant='line' className='w-full justify-start border-b px-2'>
        {tab.docs && <TabsTrigger value='docs'>Docs</TabsTrigger>}
        <TabsTrigger value='params'>
          Params <Count value={paramCount} />
        </TabsTrigger>
        <TabsTrigger value='headers'>
          Headers <Count value={headerCount} />
        </TabsTrigger>
        <TabsTrigger value='body'>
          Body {methodHasBody(tab.method) && tab.bodyType !== 'NONE' && <Dot />}
        </TabsTrigger>
        <TabsTrigger value='auth'>Auth {tab.auth.type !== 'none' && <Dot />}</TabsTrigger>
        <TabsTrigger value='code'>Code</TabsTrigger>
      </TabsList>

      <div className='min-h-0 flex-1 overflow-auto p-3'>
        {tab.docs && (
          <TabsContent value='docs'>
            <ApiOperationDocs
              docs={tab.docs}
              onUseExample={(example) => {
                onChange({ body: example, bodyType: 'JSON' });
                toast.success('Example copied into the body');
              }}
            />
          </TabsContent>
        )}
        <TabsContent value='params' className='space-y-4'>
          {pathNames.length > 0 && (
            <PathParamsEditor tab={tab} names={pathNames} onChange={onChange} />
          )}
          <div className='space-y-2'>
            {pathNames.length > 0 && <SectionLabel>Query parameters</SectionLabel>}
            <ApiKeyValueEditor
              label='Query parameter'
              rows={tab.params}
              onChange={(params) => onChange(withParams(tab, params))}
              toggleable
              hints={parameterHints(tab, 'query')}
            />
            <Hint>
              Checked parameters are in the URL and stay in sync with it. Documented ones you
              haven&rsquo;t filled start unchecked; typing a value turns them on.
            </Hint>
          </div>
        </TabsContent>

        <TabsContent value='headers' className='space-y-2'>
          <ApiKeyValueEditor
            label='Header'
            keyPlaceholder='Header'
            rows={tab.headers}
            onChange={(headers) => onChange({ headers })}
          />
          <Hint>
            Content-Type is added for the body type unless you set one here. Use{' '}
            <code>{'{{VARIABLE}}'}</code> for values from the selected resource.
          </Hint>
        </TabsContent>

        <TabsContent value='body' className='flex h-full flex-col gap-2'>
          {!methodHasBody(tab.method) ? (
            <Hint>{tab.method} requests don&rsquo;t send a body.</Hint>
          ) : (
            <BodyEditor tab={tab} onChange={onChange} onSend={onSend} />
          )}
        </TabsContent>

        <TabsContent value='auth'>
          <AuthEditor auth={tab.auth} onChange={(auth) => onChange({ auth })} />
        </TabsContent>

        <TabsContent value='code' className='h-full'>
          <CodeSnippet tab={tab} />
        </TabsContent>
      </div>
    </Tabs>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className='text-muted-foreground text-xs font-semibold tracking-wide uppercase'>
      {children}
    </h3>
  );
}

function parameterHints(tab: RequestTab, location: 'query' | 'path'): Record<string, RowHint> {
  return Object.fromEntries(
    (tab.docs?.parameters ?? [])
      .filter((parameter) => parameter.in === location)
      .map((parameter) => [
        parameter.name,
        { type: parameter.type, required: parameter.required, description: parameter.description }
      ])
  );
}

/** One input per `{{name}}` in the URL path; the URL itself keeps the placeholder. */
function PathParamsEditor({
  tab,
  names,
  onChange
}: {
  tab: RequestTab;
  names: string[];
  onChange: (patch: Partial<RequestTab>) => void;
}) {
  const hints = parameterHints(tab, 'path');
  return (
    <div className='space-y-2'>
      <SectionLabel>Path parameters</SectionLabel>
      <div className='divide-y rounded-md border'>
        {names.map((name) => {
          const hint = hints[name];
          return (
            <div key={name} className='grid grid-cols-[minmax(8rem,1fr)_2fr] items-start'>
              <label
                htmlFor={`path-param-${name}`}
                className='space-y-0.5 px-3 py-1.5 font-mono text-xs'
              >
                <span className='block font-semibold'>{name}</span>
                {hint?.description && (
                  <span className='text-muted-foreground block font-sans text-[11px]'>
                    {hint.description}
                  </span>
                )}
              </label>
              <Input
                id={`path-param-${name}`}
                value={tab.pathParams[name] ?? ''}
                onChange={(event) =>
                  onChange({ pathParams: { ...tab.pathParams, [name]: event.target.value } })
                }
                placeholder={
                  hint?.type
                    ? `${hint.type} · or {{${name}}} from the resource`
                    : `{{${name}}} from the resource`
                }
                className='h-8 rounded-none border-0 border-l font-mono text-xs shadow-none focus-visible:ring-1'
                autoComplete='off'
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Count({ value }: { value: number }) {
  if (value === 0) return null;
  return <span className='text-muted-foreground text-[10px] tabular-nums'>{value}</span>;
}

function Dot() {
  return <span aria-hidden className='bg-primary size-1.5 rounded-full' />;
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className='text-muted-foreground text-xs'>{children}</p>;
}

function BodyEditor({ tab, onChange, onSend }: ApiRequestEditorProps) {
  const formatJson = () => {
    try {
      onChange({ body: JSON.stringify(JSON.parse(tab.body), null, 2) });
    } catch {
      toast.error('The body is not valid JSON');
    }
  };

  return (
    <>
      <div className='flex items-center gap-2'>
        <NativeSelect
          aria-label='Body type'
          size='sm'
          value={tab.bodyType}
          onChange={(event) => onChange(withBodyType(tab, event.target.value as ApiBodyType))}
        >
          {Object.entries(BODY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </NativeSelect>
        {tab.bodyType === 'JSON' && (
          <Button variant='ghost' size='sm' onClick={formatJson}>
            <Icons.braces className='size-3.5' /> Format
          </Button>
        )}
      </div>

      {tab.bodyType === 'NONE' && <Hint>This request has no body.</Hint>}

      {(tab.bodyType === 'JSON' || tab.bodyType === 'TEXT') && (
        <ApiCodeInput
          aria-label='Request body'
          language={tab.bodyType === 'JSON' ? 'json' : 'text'}
          value={tab.body}
          onChange={(body) => onChange({ body })}
          onSubmit={onSend}
          placeholder={tab.bodyType === 'JSON' ? '{ "name": "{{NAME}}" }' : undefined}
          className='bg-muted/30 min-h-48 flex-1 overflow-hidden rounded-md border'
        />
      )}

      {tab.bodyType === 'FORM' && (
        <ApiKeyValueEditor
          label='Form field'
          keyPlaceholder='Field'
          rows={tab.formRows}
          onChange={(formRows) => onChange({ formRows })}
        />
      )}
    </>
  );
}

function AuthEditor({ auth, onChange }: { auth: ApiAuth; onChange: (auth: ApiAuth) => void }) {
  const setType = (type: ApiAuth['type']) => {
    if (type === auth.type) return;
    if (type === 'none') onChange({ type });
    if (type === 'bearer') onChange({ type, token: '' });
    if (type === 'basic') onChange({ type, username: '', password: '' });
    if (type === 'apiKey') onChange({ type, name: 'X-API-Key', value: '', in: 'header' });
  };

  return (
    <div className='max-w-lg space-y-4'>
      <div className='space-y-1.5'>
        <Label htmlFor='auth-type'>Type</Label>
        <NativeSelect
          id='auth-type'
          size='sm'
          value={auth.type}
          onChange={(event) => setType(event.target.value as ApiAuth['type'])}
        >
          <option value='none'>No auth</option>
          <option value='bearer'>Bearer token</option>
          <option value='basic'>Basic auth</option>
          <option value='apiKey'>API key</option>
        </NativeSelect>
      </div>

      {auth.type === 'bearer' && (
        <Field id='auth-token' label='Token'>
          <Input
            id='auth-token'
            value={auth.token}
            onChange={(event) => onChange({ ...auth, token: event.target.value })}
            placeholder='{{TOKEN}}'
            className='font-mono text-xs'
            autoComplete='off'
          />
        </Field>
      )}

      {auth.type === 'basic' && (
        <>
          <Field id='auth-username' label='Username'>
            <Input
              id='auth-username'
              value={auth.username}
              onChange={(event) => onChange({ ...auth, username: event.target.value })}
              className='font-mono text-xs'
              autoComplete='off'
            />
          </Field>
          <Field id='auth-password' label='Password'>
            <Input
              id='auth-password'
              type='password'
              value={auth.password}
              onChange={(event) => onChange({ ...auth, password: event.target.value })}
              placeholder='{{PASSWORD}}'
              className='font-mono text-xs'
              autoComplete='off'
            />
          </Field>
        </>
      )}

      {auth.type === 'apiKey' && (
        <>
          <Field id='auth-key-name' label='Key'>
            <Input
              id='auth-key-name'
              value={auth.name}
              onChange={(event) => onChange({ ...auth, name: event.target.value })}
              className='font-mono text-xs'
            />
          </Field>
          <Field id='auth-key-value' label='Value'>
            <Input
              id='auth-key-value'
              value={auth.value}
              onChange={(event) => onChange({ ...auth, value: event.target.value })}
              placeholder='{{API_KEY}}'
              className='font-mono text-xs'
              autoComplete='off'
            />
          </Field>
          <Field id='auth-key-in' label='Add to'>
            <NativeSelect
              id='auth-key-in'
              size='sm'
              value={auth.in}
              onChange={(event) =>
                onChange({ ...auth, in: event.target.value as 'header' | 'query' })
              }
            >
              <option value='header'>Header</option>
              <option value='query'>Query parameter</option>
            </NativeSelect>
          </Field>
        </>
      )}

      {auth.type === 'none' ? (
        <Hint>
          Uses the selected resource&apos;s auth, if it has one (set it with the gear next to the
          resource picker).
        </Hint>
      ) : (
        <Hint>
          Saved requests store these fields as typed. To keep a token encrypted, set it as the
          resource&apos;s auth instead, or reference a resource value as <code>{'{{TOKEN}}'}</code>.
        </Hint>
      )}
    </div>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className='space-y-1.5'>
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function CodeSnippet({ tab }: { tab: RequestTab }) {
  const [language, setLanguage] = useState<SnippetLanguage>('curl');
  const draft = toDraft(tab);
  const code = draft.url ? toSnippet(language, draft) : '';

  return (
    <div className='flex h-full flex-col gap-2'>
      <div className='flex items-center gap-2'>
        <NativeSelect
          aria-label='Snippet language'
          size='sm'
          value={language}
          onChange={(event) => setLanguage(event.target.value as SnippetLanguage)}
        >
          <option value='curl'>Shell (cURL)</option>
          <option value='fetch'>JavaScript (fetch)</option>
        </NativeSelect>
        <Button
          variant='ghost'
          size='sm'
          disabled={!code}
          onClick={() => {
            void navigator.clipboard.writeText(code);
            toast.success('Copied to clipboard');
          }}
        >
          <Icons.copy className='size-3.5' /> Copy
        </Button>
      </div>
      {code ? (
        <ApiCodeInput
          aria-label='Code snippet'
          readOnly
          language={language === 'fetch' ? 'javascript' : 'text'}
          value={code}
          className={cn('bg-muted/30 min-h-40 flex-1 overflow-hidden rounded-md border')}
        />
      ) : (
        <Hint>Enter a URL to generate a snippet.</Hint>
      )}
      <Hint>
        <code>{'{{VARIABLES}}'}</code> are left as-is, so copied snippets never include secrets.
      </Hint>
    </div>
  );
}
