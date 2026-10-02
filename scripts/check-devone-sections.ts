import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEVONE_SECTIONS, getDevOneSection } from '../src/config/devone-sections';
import { navGroups } from '../src/config/nav-config';

assert.deepEqual(
  DEVONE_SECTIONS.map((section) => section.slug),
  ['issues', 'resources', 'database', 'api', 'erd', 'git', 'docs', 'devops', 'settings']
);
assert.equal(getDevOneSection('git')?.title, 'Git');
assert.equal(getDevOneSection('unknown'), undefined);
assert.equal(
  navGroups.flatMap((group) => group.items).some((item) => item.title === 'Docs'),
  false
);

const issueBoard = await readFile(
  new URL('../src/features/issues/components/issue-board.tsx', import.meta.url),
  'utf8'
);
assert.match(issueBoard, /aria-label=["']Backlog["']/);
// The backlog's own "add task" starts the new task in the backlog.
assert.match(issueBoard, /openCreate\(["']BACKLOG["']\)/);
assert.equal(issueBoard.match(/<RichMarkdownEditor/g)?.length, 2);
assert.match(issueBoard, /onSave\(\{[\s\S]*description: description\.trim\(\),/);

const docsPage = await readFile(
  new URL('../src/app/projects/[projectId]/docs/page.tsx', import.meta.url),
  'utf8'
);
assert.match(docsPage, /<ProjectWorkTabs projectId=\{activeProject\.id\} active=["']docs["'] \/>/);
assert.doesNotMatch(docsPage, /<CardTitle>Preview<\/CardTitle>/);
assert.match(docsPage, /<Collapsible\s+defaultOpen/);
assert.match(docsPage, /docId=\{active\.id\}/);

const docEditor = await readFile(
  new URL('../src/features/platform/components/doc-editor.tsx', import.meta.url),
  'utf8'
);
assert.match(docEditor, /<RichMarkdownEditor/);
assert.match(docEditor, /editorRef\.current\?\.getMarkdown\(\) \?\? body/);
assert.match(docEditor, /setTimeout\([\s\S]*1000/);
assert.doesNotMatch(docEditor, /Edit page/);
assert.match(docEditor, /initialTitle = 'Untitled'/);
assert.doesNotMatch(docEditor, /Save page/);
assert.match(docEditor, /deleteDocAction/);

const platformActions = await readFile(
  new URL('../src/features/platform/actions.ts', import.meta.url),
  'utf8'
);
assert.match(platformActions, /export async function deleteDocAction/);

const platformService = await readFile(
  new URL('../src/features/platform/service.ts', import.meta.url),
  'utf8'
);
assert.match(platformService, /export async function deleteDoc/);

const markdownEditor = await readFile(
  new URL('../src/components/markdown-editor.tsx', import.meta.url),
  'utf8'
);
assert.match(markdownEditor, /Full screen\s*<\/Button>/);
assert.match(markdownEditor, /<Dialog open=\{fullScreen\}/);

const richMarkdownEditor = await readFile(
  new URL('../src/components/rich-markdown-editor.tsx', import.meta.url),
  'utf8'
);
assert.match(richMarkdownEditor, /<Dialog open=\{fullScreen\}/);

const globalStyles = await readFile(new URL('../src/styles/globals.css', import.meta.url), 'utf8');
assert.match(globalStyles, /\.mdxeditor-popup-container[\s\S]*z-index:\s*60/);
