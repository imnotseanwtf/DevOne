import assert from 'node:assert/strict';
import { forgetSessionUser, recallSessionUser, rememberSessionUser } from '@/lib/auth/session-cache';
import { createCoalescer } from '@/lib/ssh/coalesce';
import type { User } from '@/generated/prisma/client';

// Output that arrives together leaves together; a lone chunk is not held back.
{
  const sent: string[] = [];
  const queue: (() => void)[] = [];
  const out = createCoalescer(
    (data) => sent.push(data.toString()),
    (run) => queue.push(run)
  );
  out.push(Buffer.from('a'));
  out.push(Buffer.from('b'));
  out.push(Buffer.from('c'));
  assert.equal(queue.length, 1, 'one flush is scheduled for the whole burst');
  assert.deepEqual(sent, []);
  queue.shift()!();
  assert.deepEqual(sent, ['abc']);

  out.push(Buffer.from('d'));
  queue.shift()!();
  assert.deepEqual(sent, ['abc', 'd'], 'a later chunk is its own message');

  out.push(Buffer.from('e'));
  out.flush();
  assert.deepEqual(sent, ['abc', 'd', 'e'], 'flush sends what is waiting now');
  queue.shift()!();
  assert.deepEqual(sent, ['abc', 'd', 'e'], 'the scheduled flush then finds nothing');
}

// The keystroke endpoint's session lookup is remembered briefly, and sign-out forgets it at once.
{
  const alice = { id: 'alice' } as User;
  const t0 = 1_000_000;
  assert.equal(recallSessionUser('token-a', t0), null);
  rememberSessionUser('token-a', alice, t0);
  assert.equal(recallSessionUser('token-a', t0 + 14_000), alice, 'still known within the window');
  assert.equal(recallSessionUser('token-a', t0 + 15_001), null, 'asked again after it');
  rememberSessionUser('token-a', alice, t0);
  forgetSessionUser('token-a');
  assert.equal(recallSessionUser('token-a', t0), null, 'forgotten on sign-out');
  assert.equal(recallSessionUser('token-b', t0), null, 'another cookie is another entry');

  // A flood of distinct cookies can't grow the cache without bound.
  for (let i = 0; i < 2000; i++) rememberSessionUser(`flood-${i}`, alice, t0);
  const kept = Array.from({ length: 2000 }, (_, i) => recallSessionUser(`flood-${i}`, t0)).filter(Boolean);
  assert.ok(kept.length <= 500, `kept ${kept.length}`);
  assert.equal(recallSessionUser('flood-1999', t0), alice, 'the newest entries survive');
}

console.log('terminal-perf: ok');
