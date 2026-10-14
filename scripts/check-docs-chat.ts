import assert from 'node:assert/strict';
import {
  buildChatMessages,
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

console.log('Docs chat checks passed');
