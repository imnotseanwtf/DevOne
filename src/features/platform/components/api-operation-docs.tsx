'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type {
  OperationDocs,
  ParameterDocs,
  ResponseDocs,
  SchemaDocs,
  SchemaField
} from '@/lib/api-client/openapi';
import { cn } from '@/lib/utils';
import { statusTone } from './api-method-badge';

interface ApiOperationDocsProps {
  docs: OperationDocs;
  /** Replaces the request body with the documented example. */
  onUseExample?: (example: string) => void;
}

/** Scalar-style reference for one imported operation: what to send, what comes back. */
export function ApiOperationDocs({ docs, onUseExample }: ApiOperationDocsProps) {
  const groups = (['path', 'query', 'header', 'cookie'] as const)
    .map((location) => ({
      location,
      parameters: docs.parameters.filter((parameter) => parameter.in === location)
    }))
    .filter((group) => group.parameters.length > 0);

  return (
    <div className='space-y-6 text-sm'>
      <header className='space-y-1'>
        <div className='flex flex-wrap items-center gap-2'>
          <code className='font-mono text-xs font-semibold'>
            {docs.method} {docs.path}
          </code>
          {docs.deprecated && <Badge variant='destructive'>Deprecated</Badge>}
        </div>
        {docs.summary && <p className='font-medium'>{docs.summary}</p>}
        {docs.description && (
          <p className='text-muted-foreground whitespace-pre-line'>{docs.description}</p>
        )}
      </header>

      {groups.map((group) => (
        <Section key={group.location} title={`${capitalize(group.location)} parameters`}>
          <ul className='divide-y rounded-md border'>
            {group.parameters.map((parameter) => (
              <ParameterRow key={parameter.name} parameter={parameter} />
            ))}
          </ul>
        </Section>
      ))}

      {docs.requestBody && (
        <Section
          title='Request body'
          aside={
            <>
              <span className='text-muted-foreground font-mono text-xs'>
                {docs.requestBody.contentType}
              </span>
              {docs.requestBody.required && <Required />}
            </>
          }
        >
          {docs.requestBody.description && (
            <p className='text-muted-foreground mb-2'>{docs.requestBody.description}</p>
          )}
          <SchemaBlock
            schema={docs.requestBody}
            action={
              docs.requestBody.example && onUseExample ? (
                <Button
                  variant='outline'
                  size='sm'
                  className='h-6 text-xs'
                  onClick={() => onUseExample(docs.requestBody?.example ?? '')}
                >
                  Use as body
                </Button>
              ) : undefined
            }
          />
        </Section>
      )}

      {docs.responses.length > 0 && (
        <Section title='Responses'>
          <ul className='space-y-2'>
            {docs.responses.map((response) => (
              <ResponseItem key={response.status} response={response} />
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function Section({
  title,
  aside,
  children
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className='space-y-2'>
      <div className='flex items-center gap-2'>
        <h3 className='text-muted-foreground text-xs font-semibold tracking-wide uppercase'>
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Required() {
  return <span className='text-[10px] font-medium text-red-600 dark:text-red-400'>required</span>;
}

function ParameterRow({ parameter }: { parameter: ParameterDocs }) {
  return (
    <li className='space-y-0.5 px-3 py-2'>
      <div className='flex flex-wrap items-baseline gap-2'>
        <code className='font-mono text-xs font-semibold'>{parameter.name}</code>
        <span className='text-muted-foreground font-mono text-xs'>{parameter.type}</span>
        {parameter.required && <Required />}
      </div>
      {parameter.description && (
        <p className='text-muted-foreground text-xs'>{parameter.description}</p>
      )}
    </li>
  );
}

function ResponseItem({ response }: { response: ResponseDocs }) {
  const hasSchema = Boolean(response.fields?.length || response.example);
  const summary = (
    <span className='flex min-w-0 flex-1 items-baseline gap-2'>
      <span className={cn('font-mono text-xs font-semibold', statusTone(Number(response.status)))}>
        {response.status}
      </span>
      <span className='truncate'>{response.description ?? ''}</span>
      {response.type && (
        <span className='text-muted-foreground ml-auto shrink-0 font-mono text-xs'>
          {response.type}
        </span>
      )}
    </span>
  );

  if (!hasSchema) {
    return <li className='flex rounded-md border px-3 py-2'>{summary}</li>;
  }

  return (
    <li>
      <details className='group rounded-md border'>
        <summary className='hover:bg-muted/40 flex cursor-pointer list-none items-center gap-2 px-3 py-2'>
          <span className='text-muted-foreground text-xs transition-transform group-open:rotate-90'>
            ▸
          </span>
          {summary}
        </summary>
        <div className='border-t p-3'>
          <SchemaBlock schema={response as SchemaDocs} />
        </div>
      </details>
    </li>
  );
}

/** A schema's fields, then its example, the two things Scalar shows for every body. */
export function SchemaBlock({ schema, action }: { schema: SchemaDocs; action?: React.ReactNode }) {
  return (
    <div className='space-y-3'>
      {schema.fields.length > 0 ? (
        <div className='rounded-md border'>
          <div className='text-muted-foreground bg-muted/40 border-b px-3 py-1.5 font-mono text-xs'>
            {schema.type}
          </div>
          <FieldList fields={schema.fields} />
        </div>
      ) : (
        <p className='text-muted-foreground font-mono text-xs'>{schema.type}</p>
      )}
      {schema.example && (
        <div className='space-y-1'>
          <div className='flex items-center justify-between'>
            <span className='text-muted-foreground text-xs'>Example</span>
            {action}
          </div>
          <pre className='bg-muted/40 max-h-72 overflow-auto rounded-md border p-3 font-mono text-xs'>
            {schema.example}
          </pre>
        </div>
      )}
    </div>
  );
}

function FieldList({ fields, depth = 0 }: { fields: SchemaField[]; depth?: number }) {
  return (
    <ul className={cn('divide-y', depth > 0 && 'border-l ml-3')}>
      {fields.map((field) => (
        <FieldRow key={field.name} field={field} depth={depth} />
      ))}
    </ul>
  );
}

function FieldRow({ field, depth }: { field: SchemaField; depth: number }) {
  const line = (
    <div className='space-y-0.5'>
      <div className='flex flex-wrap items-baseline gap-2'>
        <code className='font-mono text-xs font-semibold'>{field.name}</code>
        <span className='text-muted-foreground font-mono text-xs'>
          {field.type}
          {field.nullable && ' | null'}
        </span>
        {field.required && <Required />}
      </div>
      {field.description && <p className='text-muted-foreground text-xs'>{field.description}</p>}
      {field.enum && (
        <p className='text-muted-foreground text-xs'>
          One of:{' '}
          {field.enum.map((value, index) => (
            <span key={value}>
              {index > 0 && ', '}
              <code className='font-mono'>{value}</code>
            </span>
          ))}
        </p>
      )}
    </div>
  );

  if (!field.children?.length) return <li className='px-3 py-1.5'>{line}</li>;

  // Nested objects start folded below the top level, so big DTOs stay scannable.
  return (
    <li className='py-1.5'>
      <details open={depth === 0 && field.children.length <= 8} className='group'>
        <summary className='flex cursor-pointer list-none items-start gap-1.5 px-3'>
          <span className='text-muted-foreground mt-0.5 text-xs transition-transform group-open:rotate-90'>
            ▸
          </span>
          {line}
        </summary>
        <div className='pt-1.5'>
          <FieldList fields={field.children} depth={depth + 1} />
        </div>
      </details>
    </li>
  );
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
