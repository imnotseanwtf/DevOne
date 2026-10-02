'use client';

import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import {
  bracketMatching,
  foldGutter,
  HighlightStyle,
  indentOnInput,
  syntaxHighlighting
} from '@codemirror/language';
import { Compartment, EditorState, Prec, type Extension } from '@codemirror/state';
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  keymap,
  lineNumbers,
  placeholder as placeholderExtension
} from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { useTheme } from 'next-themes';
import { useEffect, useRef } from 'react';

export type CodeLanguage = 'json' | 'javascript' | 'text';

const lightHighlight = HighlightStyle.define([
  { tag: t.propertyName, color: '#0369a1' },
  { tag: [t.string, t.special(t.string)], color: '#15803d' },
  { tag: t.number, color: '#c2410c' },
  { tag: [t.bool, t.null], color: '#9333ea' },
  { tag: t.keyword, color: '#9333ea', fontWeight: '600' },
  { tag: t.comment, color: '#71717a', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#1d4ed8' },
  { tag: [t.operator, t.punctuation, t.bracket], color: '#52525b' }
]);

const darkHighlight = HighlightStyle.define([
  { tag: t.propertyName, color: '#7dd3fc' },
  { tag: [t.string, t.special(t.string)], color: '#86efac' },
  { tag: t.number, color: '#fdba74' },
  { tag: [t.bool, t.null], color: '#c084fc' },
  { tag: t.keyword, color: '#c084fc', fontWeight: '600' },
  { tag: t.comment, color: '#a1a1aa', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#93c5fd' },
  { tag: [t.operator, t.punctuation, t.bracket], color: '#d4d4d8' }
]);

const baseTheme = EditorView.theme({
  '&': { fontSize: '0.8125rem', height: '100%' },
  '.cm-content': { fontFamily: 'var(--font-mono, monospace)' },
  '.cm-scroller': { fontFamily: 'var(--font-mono, monospace)', overflow: 'auto' },
  '.cm-gutters': { backgroundColor: 'transparent', border: 'none' },
  '&.cm-editor': { outline: 'none', backgroundColor: 'transparent' },
  '&.cm-editor.cm-focused': { outline: 'none' }
});

const languages: Record<CodeLanguage, () => Extension> = {
  json: () => json(),
  javascript: () => javascript(),
  text: () => []
};

interface ApiCodeInputProps {
  value: string;
  onChange?: (value: string) => void;
  language?: CodeLanguage;
  readOnly?: boolean;
  placeholder?: string;
  /** Mod-Enter inside the editor, so sending works without leaving the body. */
  onSubmit?: () => void;
  className?: string;
  'aria-label'?: string;
}

/** A small CodeMirror editor for request bodies, snippets and responses. */
export function ApiCodeInput({
  value,
  onChange,
  language = 'json',
  readOnly = false,
  placeholder,
  onSubmit,
  className,
  'aria-label': ariaLabel
}: ApiCodeInputProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView>(null);
  const onChangeRef = useRef(onChange);
  const onSubmitRef = useRef(onSubmit);
  const themeCompartment = useRef(new Compartment());
  const { resolvedTheme } = useTheme();

  onChangeRef.current = onChange;
  onSubmitRef.current = onSubmit;

  useEffect(() => {
    if (!containerRef.current) return;

    const view = new EditorView({
      doc: value,
      parent: containerRef.current,
      extensions: [
        lineNumbers(),
        foldGutter(),
        drawSelection(),
        bracketMatching(),
        EditorView.lineWrapping,
        ...(readOnly
          ? [EditorState.readOnly.of(true)]
          : [
              history(),
              indentOnInput(),
              closeBrackets(),
              highlightActiveLine(),
              keymap.of([
                ...closeBracketsKeymap,
                ...defaultKeymap,
                ...historyKeymap,
                indentWithTab
              ]),
              Prec.highest(
                keymap.of([
                  {
                    key: 'Mod-Enter',
                    run: () => {
                      onSubmitRef.current?.();
                      return true;
                    }
                  }
                ])
              )
            ]),
        languages[language](),
        themeCompartment.current.of(
          syntaxHighlighting(resolvedTheme === 'dark' ? darkHighlight : lightHighlight)
        ),
        baseTheme,
        EditorView.contentAttributes.of({ 'aria-label': ariaLabel ?? 'Code' }),
        ...(placeholder ? [placeholderExtension(placeholder)] : []),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current?.(update.state.doc.toString());
        })
      ]
    });

    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // `value` and the callbacks flow through refs and the sync effect below
    // instead of rebuilding the editor on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, readOnly, placeholder, ariaLabel]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: themeCompartment.current.reconfigure(
        syntaxHighlighting(resolvedTheme === 'dark' ? darkHighlight : lightHighlight)
      )
    });
  }, [resolvedTheme]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  return <div ref={containerRef} className={className} />;
}
