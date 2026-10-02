'use client';

import type { MDXEditorMethods, MDXEditorProps } from '@mdxeditor/editor';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import dynamic from 'next/dynamic';
import { forwardRef, useState } from 'react';

const Editor = dynamic(() => import('./rich-markdown-editor-initialized'), {
  ssr: false,
  loading: () => <div className='bg-muted min-h-96 animate-pulse rounded-lg' />
});

interface RichMarkdownEditorProps extends MDXEditorProps {
  /** Controls full screen from outside; the editor then drops its own "Full screen" bar. */
  fullScreen?: boolean;
  onFullScreenChange?: (open: boolean) => void;
}

export const RichMarkdownEditor = forwardRef<MDXEditorMethods, RichMarkdownEditorProps>(
  function RichMarkdownEditor(
    { fullScreen: controlledFullScreen, onFullScreenChange, ...props },
    ref
  ) {
    const [ownFullScreen, setOwnFullScreen] = useState(false);
    const controlled = onFullScreenChange !== undefined;
    const fullScreen = controlled ? Boolean(controlledFullScreen) : ownFullScreen;
    const setFullScreen = controlled ? onFullScreenChange : setOwnFullScreen;

    return (
      <>
        <div className='rounded-lg border'>
          {!controlled && (
            <div className='bg-muted/40 flex items-center justify-end border-b px-2 py-1.5'>
              <Button type='button' variant='outline' size='sm' onClick={() => setFullScreen(true)}>
                Full screen
              </Button>
            </div>
          )}
          {!fullScreen && <Editor {...props} editorRef={ref} />}
        </div>

        <Dialog open={fullScreen} onOpenChange={setFullScreen}>
          <DialogContent className='h-[calc(100svh-2rem)] max-w-[calc(100vw-2rem)] grid-rows-[auto_1fr] sm:max-w-[calc(100vw-2rem)]'>
            <DialogHeader>
              <DialogTitle>Document editor</DialogTitle>
              <DialogDescription>Edit the document in full screen.</DialogDescription>
            </DialogHeader>
            <div className='min-h-0 overflow-auto rounded-lg border'>
              <Editor {...props} editorRef={ref} />
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  }
);
