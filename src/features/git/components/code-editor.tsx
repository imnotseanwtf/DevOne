'use client';

import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap
} from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  HighlightStyle,
  indentOnInput,
  LanguageDescription,
  syntaxHighlighting
} from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { MergeView } from '@codemirror/merge';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection
} from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { useTheme } from 'next-themes';
import { cn } from '@/lib/utils';
import { useEffect, useRef } from 'react';

// VS Code's Light+ / Dark+ token colors, independent of the app theme.
const lightHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword], color: '#af00db' },
  { tag: [t.definitionKeyword, t.bool, t.null], color: '#0000ff' },
  { tag: [t.typeName, t.className], color: '#267f99' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#795e26' },
  { tag: [t.propertyName, t.attributeName], color: '#001080' },
  { tag: [t.string, t.special(t.string)], color: '#a31515' },
  { tag: t.number, color: '#098658' },
  { tag: t.comment, color: '#008000', fontStyle: 'italic' },
  { tag: [t.tagName, t.angleBracket], color: '#800000' },
  { tag: [t.atom, t.special(t.variableName)], color: '#0000ff' },
  { tag: [t.meta, t.annotation, t.processingInstruction], color: '#795e26' },
  { tag: [t.regexp, t.escape], color: '#811f3f' },
  { tag: t.heading, color: '#800000', fontWeight: 'bold' },
  { tag: [t.link, t.url], color: '#0451a5', textDecoration: 'underline' },
  { tag: t.inserted, color: '#098658' },
  { tag: t.deleted, color: '#a31515' },
  { tag: t.invalid, color: '#cd3131' }
]);

const darkHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword], color: '#c586c0' },
  { tag: [t.definitionKeyword, t.bool, t.null], color: '#569cd6' },
  { tag: [t.typeName, t.className], color: '#4ec9b0' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#dcdcaa' },
  { tag: [t.propertyName, t.attributeName], color: '#9cdcfe' },
  { tag: [t.string, t.special(t.string)], color: '#ce9178' },
  { tag: t.number, color: '#b5cea8' },
  { tag: t.comment, color: '#6a9955', fontStyle: 'italic' },
  { tag: [t.tagName, t.angleBracket], color: '#569cd6' },
  { tag: [t.atom, t.special(t.variableName)], color: '#569cd6' },
  { tag: [t.meta, t.annotation, t.processingInstruction], color: '#dcdcaa' },
  { tag: [t.regexp, t.escape], color: '#d16969' },
  { tag: t.heading, color: '#569cd6', fontWeight: 'bold' },
  { tag: [t.link, t.url], color: '#3794ff', textDecoration: 'underline' },
  { tag: t.inserted, color: '#b5cea8' },
  { tag: t.deleted, color: '#ce9178' },
  { tag: t.invalid, color: '#f44747' }
]);

const baseTheme = EditorView.theme({
  '&': { fontSize: '0.8125rem', height: '100%' },
  '.cm-scroller': { fontFamily: 'var(--font-mono, monospace)', lineHeight: '1.6' },
  '&.cm-editor': { outline: 'none', backgroundColor: 'transparent' },
  '&.cm-editor.cm-focused': { outline: 'none' },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    border: 'none',
    color: 'var(--muted-foreground)'
  },
  '.cm-activeLine, .cm-activeLineGutter': {
    backgroundColor: 'color-mix(in oklch, var(--muted) 60%, transparent)'
  }
});

/** Files the language list doesn't know by name, mapped to the closest language it has. */
const LANGUAGE_ALIASES: Record<string, string> = {
  csproj: 'XML',
  fsproj: 'XML',
  vbproj: 'XML',
  sln: 'Properties files',
  props: 'XML',
  targets: 'XML',
  config: 'XML',
  xaml: 'XML',
  axaml: 'XML',
  resx: 'XML',
  nuspec: 'XML',
  plist: 'XML',
  svg: 'XML',
  cshtml: 'HTML',
  razor: 'HTML',
  vbhtml: 'HTML',
  svelte: 'HTML',
  astro: 'HTML',
  ini: 'Properties files',
  cfg: 'Properties files',
  conf: 'Nginx',
  env: 'Properties files',
  editorconfig: 'Properties files',
  gitignore: 'Shell',
  dockerignore: 'Shell',
  gitattributes: 'Properties files',
  prisma: 'ProtoBuf',
  graphql: 'JavaScript',
  gql: 'JavaScript',
  mk: 'Shell',
  bat: 'Shell',
  cmd: 'Shell',
  ps1: 'PowerShell',
  jsonc: 'JSON',
  json5: 'JSON',
  lock: 'YAML',
  bicep: 'TypeScript',
  tf: 'Properties files',
  hcl: 'Properties files'
};

const FILE_ALIASES: Record<string, string> = {
  makefile: 'Shell',
  gnumakefile: 'Shell',
  procfile: 'Shell',
  gemfile: 'Ruby',
  rakefile: 'Ruby',
  jenkinsfile: 'Groovy',
  vagrantfile: 'Ruby',
  brewfile: 'Ruby',
  podfile: 'Ruby'
};

/** The language a file is highlighted as, if any; the syntax itself loads on demand. */
export function describeLanguage(path: string): LanguageDescription | null {
  const name = path.split('/').pop() ?? path;
  const known = LanguageDescription.matchFilename(languages, name);
  if (known) return known;
  const lower = name.toLowerCase();
  const extension = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : '';
  const alias =
    FILE_ALIASES[lower] ??
    (lower.startsWith('.env') || lower.startsWith('dockerfile')
      ? lower.startsWith('.env')
        ? 'Properties files'
        : 'Dockerfile'
      : LANGUAGE_ALIASES[extension]);
  return alias ? LanguageDescription.matchLanguageName(languages, alias, false) : null;
}

export function languageLabel(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  if (extension === 'prisma') return 'Prisma';
  if (extension === 'cshtml' || extension === 'razor') return 'Razor';
  return describeLanguage(path)?.name ?? 'Plain Text';
}

/** Loads the file's language into `compartment` once its (lazy) syntax arrives. */
function loadLanguage(view: EditorView, compartment: Compartment, path: string) {
  void describeLanguage(path)
    ?.load()
    .then((support) => {
      // The view may be gone by the time the chunk arrives.
      if (view.dom.isConnected) view.dispatch({ effects: compartment.reconfigure(support) });
    })
    .catch(() => {});
}

const highlightFor = (theme: string | undefined) =>
  syntaxHighlighting(theme === 'dark' ? darkHighlight : lightHighlight);

interface EditorCallbacks {
  onChange?: { current: ((value: string) => void) | undefined };
  onCursorChange?: { current: ((line: number, column: number) => void) | undefined };
  onSave?: { current: (() => void) | undefined };
}

/** Everything but the document: keys, gutters, language and theme slots. */
function editorExtensions(
  path: string,
  readOnly: boolean,
  language: Compartment,
  theme: Compartment,
  resolvedTheme: string | undefined,
  callbacks: EditorCallbacks
): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    foldGutter(),
    history(),
    highlightSpecialChars(),
    drawSelection(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    autocompletion(),
    rectangularSelection(),
    highlightActiveLine(),
    keymap.of([
      {
        key: 'Mod-s',
        preventDefault: true,
        run: () => {
          callbacks.onSave?.current?.();
          return true;
        }
      },
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...completionKeymap,
      indentWithTab
    ]),
    language.of([]),
    theme.of(highlightFor(resolvedTheme)),
    baseTheme,
    EditorState.readOnly.of(readOnly),
    EditorView.editable.of(!readOnly),
    EditorView.contentAttributes.of({ 'aria-label': `${readOnly ? 'View' : 'Edit'} ${path}` }),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) callbacks.onChange?.current?.(update.state.doc.toString());
      if (update.docChanged || update.selectionSet) {
        const head = update.state.selection.main.head;
        const line = update.state.doc.lineAt(head);
        callbacks.onCursorChange?.current?.(line.number, head - line.from + 1);
      }
    })
  ];
}

interface CodeEditorProps {
  /** Identifies the document; a new path rebuilds the editor (and its undo history). */
  path: string;
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  /** 1-based line and column of the main cursor, for the status bar. */
  onCursorChange?: (line: number, column: number) => void;
  /** Mod-S; the browser's own save dialog is suppressed either way. */
  onSave?: () => void;
  autoFocus?: boolean;
  className?: string;
}

export function CodeEditor({
  path,
  value,
  onChange,
  readOnly = false,
  onCursorChange,
  onSave,
  autoFocus = false,
  className
}: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView>(null);
  const onChangeRef = useRef(onChange);
  const onCursorChangeRef = useRef(onCursorChange);
  const onSaveRef = useRef(onSave);
  const themeCompartment = useRef(new Compartment());
  const languageCompartment = useRef(new Compartment());
  const { resolvedTheme } = useTheme();

  onChangeRef.current = onChange;
  onCursorChangeRef.current = onCursorChange;
  onSaveRef.current = onSave;

  useEffect(() => {
    if (!containerRef.current) return;

    const view = new EditorView({
      doc: value,
      parent: containerRef.current,
      extensions: editorExtensions(
        path,
        readOnly,
        languageCompartment.current,
        themeCompartment.current,
        resolvedTheme,
        { onChange: onChangeRef, onCursorChange: onCursorChangeRef, onSave: onSaveRef }
      )
    });
    loadLanguage(view, languageCompartment.current, path);

    viewRef.current = view;
    onCursorChangeRef.current?.(1, 1);
    if (autoFocus) view.focus();
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // `value`, `onChange` and the theme flow through refs and effects below
    // instead of rebuilding the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, readOnly]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: themeCompartment.current.reconfigure(highlightFor(resolvedTheme))
    });
  }, [resolvedTheme]);

  // Picks up outside changes (a branch switch reloading the file, a discard)
  // without fighting the view while the user types.
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

interface DiffEditorProps {
  path: string;
  /** The file on the branch; empty for a new file. */
  original: string;
  /** Your version; empty for a deleted file. */
  modified: string;
  /** Edits on the right-hand side; omit to make both sides read-only. */
  onChange?: (value: string) => void;
  onCursorChange?: (line: number, column: number) => void;
  onSave?: () => void;
  className?: string;
}

/** VS Code's side-by-side diff: the branch on the left, your changes (editable) on the right. */
export function DiffEditor({
  path,
  original,
  modified,
  onChange,
  onCursorChange,
  onSave,
  className
}: DiffEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mergeRef = useRef<MergeView>(null);
  const onChangeRef = useRef(onChange);
  const onCursorChangeRef = useRef(onCursorChange);
  const onSaveRef = useRef(onSave);
  const themes = useRef([new Compartment(), new Compartment()]);
  const languagesRef = useRef([new Compartment(), new Compartment()]);
  const { resolvedTheme } = useTheme();
  const readOnly = !onChange;

  onChangeRef.current = onChange;
  onCursorChangeRef.current = onCursorChange;
  onSaveRef.current = onSave;

  useEffect(() => {
    if (!containerRef.current) return;
    const [leftTheme, rightTheme] = themes.current;
    const [leftLanguage, rightLanguage] = languagesRef.current;
    const merge = new MergeView({
      parent: containerRef.current,
      a: {
        doc: original,
        extensions: editorExtensions(path, true, leftLanguage, leftTheme, resolvedTheme, {
          onSave: onSaveRef
        })
      },
      b: {
        doc: modified,
        extensions: editorExtensions(path, readOnly, rightLanguage, rightTheme, resolvedTheme, {
          onChange: onChangeRef,
          onCursorChange: onCursorChangeRef,
          onSave: onSaveRef
        })
      },
      highlightChanges: true,
      gutter: true
    });
    loadLanguage(merge.a, leftLanguage, path);
    loadLanguage(merge.b, rightLanguage, path);
    mergeRef.current = merge;
    return () => {
      merge.destroy();
      mergeRef.current = null;
    };
    // The documents seed the view once; later edits come from the view itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, readOnly, original]);

  useEffect(() => {
    const merge = mergeRef.current;
    if (!merge) return;
    const [leftTheme, rightTheme] = themes.current;
    merge.a.dispatch({ effects: leftTheme.reconfigure(highlightFor(resolvedTheme)) });
    merge.b.dispatch({ effects: rightTheme.reconfigure(highlightFor(resolvedTheme)) });
  }, [resolvedTheme]);

  // Outside changes (a discard) reach the right-hand side without fighting the user.
  useEffect(() => {
    const view = mergeRef.current?.b;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== modified) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: modified } });
    }
  }, [modified]);

  return <div ref={containerRef} className={cn('diff-editor', className)} />;
}
