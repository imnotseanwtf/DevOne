'use client';

import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  completionStatus
} from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { MySQL, PostgreSQL, sql, type SQLNamespace } from '@codemirror/lang-sql';
import {
  bracketMatching,
  foldGutter,
  HighlightStyle,
  indentOnInput,
  syntaxHighlighting
} from '@codemirror/language';
import { Compartment, EditorState, Prec } from '@codemirror/state';
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  placeholder as placeholderExtension,
  rectangularSelection
} from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { useTheme } from 'next-themes';
import { useEffect, useRef } from 'react';

// A fixed syntax palette, independent of the app theme, same as most code
// editors (GitHub, VS Code) - matches what "psql colors" is really asking for.
const lightHighlight = HighlightStyle.define([
  { tag: t.keyword, color: '#9333ea', fontWeight: '600' },
  { tag: [t.typeName, t.attributeName], color: '#0369a1' },
  { tag: [t.string, t.special(t.string)], color: '#15803d' },
  { tag: t.number, color: '#c2410c' },
  { tag: t.comment, color: '#71717a', fontStyle: 'italic' },
  { tag: [t.operator, t.punctuation], color: '#52525b' },
  { tag: t.bool, color: '#c2410c' },
  { tag: t.null, color: '#c2410c' }
]);

const darkHighlight = HighlightStyle.define([
  { tag: t.keyword, color: '#c084fc', fontWeight: '600' },
  { tag: [t.typeName, t.attributeName], color: '#7dd3fc' },
  { tag: [t.string, t.special(t.string)], color: '#86efac' },
  { tag: t.number, color: '#fdba74' },
  { tag: t.comment, color: '#a1a1aa', fontStyle: 'italic' },
  { tag: [t.operator, t.punctuation], color: '#d4d4d8' },
  { tag: t.bool, color: '#fdba74' },
  { tag: t.null, color: '#fdba74' }
]);

const baseTheme = EditorView.theme({
  '&': { fontSize: '0.8125rem' },
  '.cm-content': { fontFamily: 'var(--font-mono, monospace)', padding: '0' },
  '.cm-scroller': { fontFamily: 'var(--font-mono, monospace)' },
  '&.cm-editor': { outline: 'none', backgroundColor: 'transparent' },
  '&.cm-editor.cm-focused': { outline: 'none' },
  '.cm-tooltip-autocomplete': {
    borderRadius: 'var(--radius-lg)',
    overflow: 'hidden'
  }
});

interface SqlInputProps {
  value: string;
  onChange: (value: string) => void;
  dialect: 'POSTGRES' | 'MYSQL';
  /** Table name -> column names, for schema-aware completion. */
  schema?: SQLNamespace;
  /** Lets bare column names complete without a `table.` prefix. */
  defaultTable?: string;
  placeholder?: string;
  /** Enter submits instead of inserting a newline; pasted newlines are stripped. */
  singleLine?: boolean;
  /** Enter (singleLine) or Mod-Enter (multiline), only when no completion is open. */
  onSubmit?: () => void;
  className?: string;
  'aria-label'?: string;
}

export function SqlInput({
  value,
  onChange,
  dialect,
  schema,
  defaultTable,
  placeholder,
  singleLine = false,
  onSubmit,
  className,
  'aria-label': ariaLabel
}: SqlInputProps) {
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

    const submitKeymap = Prec.highest(
      keymap.of([
        {
          key: singleLine ? 'Enter' : 'Mod-Enter',
          run: (view) => {
            if (completionStatus(view.state)) return false;
            onSubmitRef.current?.();
            return true;
          }
        }
      ])
    );

    const view = new EditorView({
      doc: value,
      parent: containerRef.current,
      extensions: [
        history(),
        highlightSpecialChars(),
        drawSelection(),
        dropCursor(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        ...(singleLine
          ? [
              EditorState.transactionFilter.of((tr) => (tr.newDoc.lines > 1 ? [] : tr)),
              EditorView.lineWrapping
            ]
          : [lineNumbers(), foldGutter()]),
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...completionKeymap
        ]),
        submitKeymap,
        sql({
          dialect: dialect === 'POSTGRES' ? PostgreSQL : MySQL,
          schema,
          defaultTable,
          upperCaseKeywords: true
        }),
        themeCompartment.current.of(syntaxHighlighting(lightHighlight)),
        baseTheme,
        EditorView.contentAttributes.of({
          'aria-label': ariaLabel ?? 'SQL',
          'aria-multiline': singleLine ? 'false' : 'true'
        }),
        ...(placeholder ? [placeholderExtension(placeholder)] : []),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString());
        })
      ]
    });

    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Only the identity of these shape the editor's extensions; `value`,
    // `onChange` and `onSubmit` flow through refs instead of rebuilding it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialect, singleLine, placeholder, ariaLabel, defaultTable]);

  // Reconfigures the syntax colors without rebuilding the editor.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: themeCompartment.current.reconfigure(
        syntaxHighlighting(resolvedTheme === 'dark' ? darkHighlight : lightHighlight)
      )
    });
  }, [resolvedTheme]);

  // Keeps the doc in sync when `value` changes from outside (e.g. picking a
  // saved query), without fighting the view while the user is typing.
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
