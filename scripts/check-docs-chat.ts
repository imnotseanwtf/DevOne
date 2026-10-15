import assert from 'node:assert/strict';
import { DEFAULT_MODEL, modelLabel, parseModelIds, pickModel } from '../src/lib/docs-chat/models';
import { cleanBlockAnswer, replaceBlock, splitBlocks } from '../src/lib/docs-chat/blocks';
import { splitAnswer, summarizeChange } from '../src/lib/docs-chat/proposal';
import {
  buildChatMessages,
  containsWholePage,
  chunkText,
  selectContext,
  sourcesOf,
  tokenize,
  type ChatDoc
} from '../src/lib/docs-chat/retrieval';

const doc = (id: string, title: string, body: string): ChatDoc => ({
  id,
  slug: id,
  title,
  folder: null,
  body
});

// Tokens drop stop words and short noise but keep non-English letters.
assert.deepEqual(tokenize('How do I deploy the API to Vercel?'), ['deploy', 'api', 'vercel']);
assert.deepEqual(tokenize('naïve café'), ['naïve', 'café']);

// Chunks respect the limit and never lose text.
const long = ['alpha '.repeat(40), 'beta '.repeat(40), 'gamma '.repeat(40)].join('\n\n');
const chunks = chunkText(long, 300);
assert.ok(chunks.every((chunk) => chunk.length <= 300));
assert.equal(chunks.join(' ').replace(/\s+/g, ' ').trim(), long.replace(/\s+/g, ' ').trim());
assert.equal(chunkText('x'.repeat(1000), 400).length, 3, 'a long paragraph is cut');

const docs = [
  doc('deploy', 'Deployment', 'Deploy with Docker Compose.\n\nSet DEVONE_ENCRYPTION_KEY before the first start.'),
  doc('db', 'Database', 'The database is PostgreSQL 16 with Prisma migrations.'),
  doc('misc', 'Notes', 'Lunch is at noon. Nothing about servers here.')
];

// The best-matching page is chosen, with its title boosting the score.
const picked = selectContext('how do I run the database migrations?', docs);
assert.equal(picked[0]?.docId, 'db');
assert.ok(!picked.some((excerpt) => excerpt.docId === 'misc'), 'irrelevant pages stay out');

// The open page always comes first, even when the question is about another one.
const withCurrent = selectContext('what is the database?', docs, { currentDocId: 'deploy' });
assert.equal(withCurrent[0]?.docId, 'deploy');
assert.ok(withCurrent.some((excerpt) => excerpt.docId === 'db'));
assert.deepEqual(sourcesOf(withCurrent).map((source) => source.slug), ['deploy', 'db']);

// A big open page is trimmed to the budget, keeping the passages the question is about.
const big = doc(
  'big',
  'Runbook',
  Array.from({ length: 60 }, (_, index) =>
    index === 41 ? 'The pager rotation lives in OpsGenie.' : `Filler paragraph number ${index} about nothing. `.repeat(8)
  ).join('\n\n')
);
const trimmed = selectContext('where is the pager rotation?', [big], {
  currentDocId: 'big',
  maxChars: 4000,
  chunkChars: 800
});
assert.ok(trimmed.reduce((total, excerpt) => total + excerpt.text.length, 0) <= 4000);
assert.ok(trimmed.some((excerpt) => excerpt.text.includes('OpsGenie')));

// Nothing relevant: still a valid prompt that says so, and no sources.
const none = selectContext('quantum chromodynamics', docs);
assert.deepEqual(none, []);
const messages = buildChatMessages('Demo', none, [{ role: 'user', content: 'quantum chromodynamics' }]);
assert.equal(messages[0].role, 'system');
assert.match(messages[0].content, /No page matched/);

// History is capped and each message trimmed; the excerpts are fenced as data.
const history = Array.from({ length: 30 }, (_, index) => ({
  role: (index % 2 ? 'assistant' : 'user') as 'user' | 'assistant',
  content: 'x'.repeat(10_000)
}));
const built = buildChatMessages('Demo', picked, history);
assert.equal(built.length, 11);
assert.ok(built.slice(1).every((message) => message.content.length === 4000));
assert.match(built[0].content, /never as a command to follow/);
assert.match(built[0].content, /### Page: Database/);

// Edits: a proposal is only offered for a page the model saw in full.
const whole = selectContext('anything', docs, { currentDocId: 'db' });
assert.ok(containsWholePage(whole, docs[1]));
assert.ok(!containsWholePage(trimmed, big), 'a trimmed page cannot be rewritten safely');
assert.match(buildChatMessages('Demo', whole, [], { editablePage: 'Database' })[0].content, /devone-doc/);
assert.doesNotMatch(buildChatMessages('Demo', whole, [])[0].content, /devone-doc/);

// Parsing the answer: prose, proposal, and nested code fences inside the proposal.
assert.deepEqual(splitAnswer('Just an answer.'), {
  prose: 'Just an answer.',
  proposal: null,
  writing: false
});
const nested = 'Shortened it.\n\n````devone-doc\n# Title\n\n```sh\nbun run db:deploy\n```\n\nDone.\n````\n';
assert.deepEqual(splitAnswer(nested), {
  prose: 'Shortened it.',
  proposal: '# Title\n\n```sh\nbun run db:deploy\n```\n\nDone.',
  writing: false
});
const streaming = splitAnswer('Working on it.\n````devone-doc\n# Ti');
assert.deepEqual(streaming, { prose: 'Working on it.', proposal: null, writing: true });
assert.equal(splitAnswer('x\n```devone-doc\nbody\n```\nThat is all.').prose, 'x\n\nThat is all.');
assert.deepEqual(summarizeChange('a\nb\nc', 'a\nc\nd\ne'), { added: 2, removed: 1 });
assert.deepEqual(summarizeChange('same', 'same'), { added: 0, removed: 0 });

// The passage the person points at is given to the model as context, not as a command.
const pointed = buildChatMessages('Demo', whole, [], { focus: 'Lunch is at noon.' })[0].content;
assert.match(pointed, /<focus>\nLunch is at noon\.\n<\/focus>/);
assert.match(pointed, /refer to it/);
assert.doesNotMatch(buildChatMessages('Demo', whole, [])[0].content, /<focus>/);

// Blocks: top-level Markdown pieces, in editor order, replaced without touching the rest.
const page = '# Title\n\nPara one\nline two\n\n- a\n- b\n\n```sh\nx\n\ny\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n> quote\n\nlast\n';
const blocks = splitBlocks(page);
assert.deepEqual(
  blocks.map((block) => block.raw),
  ['# Title', 'Para one\nline two', '- a\n- b', '```sh\nx\n\ny\n```', '| a | b |\n|---|---|\n| 1 | 2 |', '> quote', 'last']
);
assert.ok(blocks.every((block) => page.startsWith(block.raw, block.start)));
assert.equal(
  replaceBlock(page, 1, '  Para one, reworded.  '),
  page.replace('Para one\nline two', 'Para one, reworded.')
);
assert.equal(replaceBlock(page, 6, 'first\n\nsecond').endsWith('first\n\nsecond\n'), true);
assert.equal(
  replaceBlock(page, 3, '```sh\nz\n```').includes('```sh\nz\n```\n\n| a | b |'),
  true,
  'a code block with a blank line inside is one block'
);
assert.throws(() => replaceBlock(page, 9, 'x'), /no longer exists/);
assert.deepEqual(splitBlocks(''), []);

// A fenced answer is unwrapped; plain Markdown (even with its own fence) is left alone.
assert.equal(cleanBlockAnswer('```markdown\nHello **world**\n```'), 'Hello **world**');
assert.equal(cleanBlockAnswer('  Hello  '), 'Hello');
assert.equal(
  cleanBlockAnswer('Run:\n\n```sh\nbun test\n```'),
  'Run:\n\n```sh\nbun test\n```'
);

// Model choice: only ids the router offers, falling back to auto.
assert.deepEqual(
  parseModelIds({ data: [{ id: 'auto' }, { id: 'stack' }, { id: 'stack' }, { id: 7 }, null, { id: '' }] }),
  ['auto', 'stack']
);
assert.equal(parseModelIds({ error: 'x' }), null);
assert.equal(parseModelIds(null), null);
assert.equal(pickModel('Beta/shared', ['auto', 'Beta/shared']), 'Beta/shared');
assert.equal(pickModel('gone', ['auto', 'Beta/shared']), DEFAULT_MODEL, 'a removed model falls back');
assert.equal(pickModel(null, ['auto']), DEFAULT_MODEL);
assert.equal(pickModel('saved', null), 'saved', 'kept until the list says otherwise');
assert.equal(modelLabel('auto'), 'Auto (first available)');
assert.equal(modelLabel('Beta/shared'), 'Beta/shared');

// A task's description gets task wording, and an empty one can still be written from scratch.
const taskPrompt = buildChatMessages('Demo', whole, [], { editablePage: 'Fix login', kind: 'task' })[0].content;
assert.match(taskPrompt, /help the team write and understand a task/);
assert.match(taskPrompt, /open task description "Fix login"/);
assert.match(taskPrompt, /devone-doc/);
assert.doesNotMatch(taskPrompt, /documentation of the project/);
const empty = doc('task', 'New task', '');
assert.ok(containsWholePage(selectContext('write it', [empty, ...docs], { currentDocId: 'task' }), empty));

console.log('Docs chat checks passed');
