'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { importOpenApiAction } from '@/features/platform/actions';
import { CurlParseError, parseCurl } from '@/lib/api-client/curl';
import type { ApiRequestDraft } from '@/lib/api-client/types';
import { Icons } from '@/components/icons';
import { useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';

export type ImportKind = 'curl' | 'openapi';

interface ApiImportDialogProps {
  projectId: string;
  kind: ImportKind | null;
  onClose: () => void;
  onCurlImported: (draft: ApiRequestDraft) => void;
}

export function ApiImportDialog({
  projectId,
  kind,
  onClose,
  onCurlImported
}: ApiImportDialogProps) {
  const [source, setSource] = useState('');
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const [fileName, setFileName] = useState<string>();
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  /** A chosen or dropped file goes into the text box, so it can be checked before importing. */
  const readFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError('That file is larger than 5 MB');
      return;
    }
    setError(undefined);
    setFileName(file.name);
    setSource(await file.text());
  };

  const close = () => {
    setSource('');
    setError(undefined);
    setFileName(undefined);
    onClose();
  };

  const submit = () => {
    setError(undefined);
    if (kind === 'curl') {
      try {
        onCurlImported(parseCurl(source));
        close();
      } catch (caught) {
        setError(caught instanceof CurlParseError ? caught.message : 'Could not read that command');
      }
      return;
    }

    startTransition(async () => {
      const result = await importOpenApiAction({ projectId, source });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const imported = result.imported;
      toast.success(
        imported?.format === 'postman'
          ? `Postman collection imported: ${imported.requests} request${imported.requests === 1 ? '' : 's'}${
              imported.environment ? `, variables in the “${imported.environment}” resource` : ''
            }`
          : `API imported: ${imported?.requests ?? 0} request${imported?.requests === 1 ? '' : 's'} in a new collection`
      );
      close();
    });
  };

  return (
    <Dialog open={kind !== null} onOpenChange={(open) => !open && !pending && close()}>
      <DialogContent className='sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>{kind === 'curl' ? 'Import cURL' : 'Import JSON'}</DialogTitle>
          <DialogDescription>
            {kind === 'curl'
              ? 'Paste a curl command, for example from “Copy as cURL” in the browser dev tools. It opens as a new request.'
              : 'Choose a .json file, drop it here, or paste a URL or the document itself. OpenAPI 3, Swagger 2 and Postman collections (v2.0/v2.1) are recognized automatically. Every request lands in a new collection; Postman variables become a resource with those keys.'}
          </DialogDescription>
        </DialogHeader>

        {kind === 'openapi' && (
          <div className='flex items-center gap-2'>
            <Button
              type='button'
              variant='outline'
              size='sm'
              disabled={pending}
              onClick={() => fileInput.current?.click()}
            >
              <Icons.upload aria-hidden='true' />
              Choose file…
            </Button>
            <span className='text-muted-foreground truncate text-xs'>
              {fileName ?? '.json, .yaml or .yml'}
            </span>
            <input
              ref={fileInput}
              type='file'
              accept='.json,.yaml,.yml,application/json,application/yaml,text/yaml'
              className='hidden'
              aria-label='Document file'
              onChange={(event) => {
                void readFile(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
          </div>
        )}

        <Textarea
          aria-label={kind === 'curl' ? 'curl command' : 'OpenAPI or Postman URL or document'}
          value={source}
          onChange={(event) => {
            setSource(event.target.value);
            setFileName(undefined);
          }}
          onDragOver={(event) => {
            if (kind !== 'openapi' || !event.dataTransfer.types.includes('Files')) return;
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            if (kind !== 'openapi' || event.dataTransfer.files.length === 0) return;
            event.preventDefault();
            setDragging(false);
            void readFile(event.dataTransfer.files[0]);
          }}
          rows={kind === 'curl' ? 8 : 12}
          spellCheck={false}
          placeholder={
            kind === 'curl'
              ? "curl https://api.example.com/users \\\n  -H 'Authorization: Bearer {{TOKEN}}'"
              : 'https://petstore3.swagger.io/api/v3/openapi.json\n\n…or drop a Postman / OpenAPI .json file here'
          }
          className={cn(
            'max-h-[50vh] font-mono text-xs',
            dragging && 'border-primary bg-primary/5 ring-primary/30 ring-2'
          )}
        />

        {error && (
          <Alert variant='destructive'>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button variant='outline' disabled={pending} onClick={close}>
            Cancel
          </Button>
          <Button disabled={pending || !source.trim()} onClick={submit}>
            {pending ? 'Importing…' : 'Import'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
