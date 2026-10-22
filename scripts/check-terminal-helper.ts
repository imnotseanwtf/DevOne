import assert from 'node:assert/strict';
import { complete, inputAfterPrompt } from '@/features/devops/terminal-helper/complete';
import {
  closest,
  correctLine,
  detectMistake,
  distance,
  KNOWN_COMMANDS,
  LineTracker,
  stripAnsi
} from '@/features/devops/terminal-helper/suggest';

assert.equal(distance('dokcer', 'docker'), 1, 'a swapped pair is one slip');
assert.equal(distance('sytemctl', 'systemctl'), 1);
assert.equal(closest('dokcer', KNOWN_COMMANDS), 'docker');
assert.equal(closest('gti', KNOWN_COMMANDS), 'git');
assert.equal(closest('docker', KNOWN_COMMANDS), null, 'already right');
assert.equal(closest('zzzzzz', KNOWN_COMMANDS), null, 'nothing near');
assert.equal(closest('lz', KNOWN_COMMANDS), 'ls', 'short words get one slip');
assert.equal(closest('qq', KNOWN_COMMANDS), null);

const bash = detectMistake('user@host:~$ dokcer ps\r\nbash: dokcer: command not found\r\nuser@host:~$ ');
assert.deepEqual(bash, { typed: 'dokcer', suggestion: 'docker', kind: 'command' });
assert.deepEqual(detectMistake('sh: 1: sytemctl: not found\n'), {
  typed: 'sytemctl',
  suggestion: 'systemctl',
  kind: 'command'
});
assert.deepEqual(detectMistake('zsh: command not found: gti\n'), {
  typed: 'gti',
  suggestion: 'git',
  kind: 'command'
});
assert.deepEqual(detectMistake("docker: 'pss' is not a docker command.\nSee 'docker --help'"), {
  typed: 'pss',
  suggestion: 'ps',
  kind: 'docker'
});
assert.equal(detectMistake('bash: frobnicate: command not found'), null, 'no obvious fix');
assert.equal(detectMistake('all good\n'), null);

const mistake = { typed: 'dokcer', suggestion: 'docker', kind: 'command' } as const;
assert.equal(correctLine('dokcer ps -a', mistake), 'docker ps -a');
assert.equal(correctLine('ls -la', mistake), null);

const tracker = new LineTracker();
tracker.push('dokcer psx');
tracker.push('\u007f');
tracker.push(' -a\r');
assert.equal(tracker.last, 'dokcer ps -a');
tracker.push('\u001b[A');
tracker.push('ls\r');
assert.equal(tracker.last, 'ls');

assert.equal(stripAnsi('\u001b[1;32mok\u001b[0m \u001b]0;title\u0007done'), 'ok done');

const labels = (input: string, history: string[] = []) =>
  complete(input, history).map((item) => item.label);

assert.equal(inputAfterPrompt('deploy@prod-1:~$ docker ps'), 'docker ps');
assert.equal(inputAfterPrompt('root@vm:/srv# '), '');
assert.equal(inputAfterPrompt('[user@host app]$ ls -l'), 'ls -l');
assert.equal(inputAfterPrompt('echo hello'), null, 'not a prompt line');

assert.deepEqual(labels('doc'), ['docker', 'docker-compose']);
assert.deepEqual(labels('docker lo'), ['logs']);
assert.deepEqual(labels('docker ').slice(0, 3), ['ps', 'logs', 'exec']);
assert.equal(labels('docker ').length, 8, 'the menu is capped');
assert.deepEqual(labels('docker logs -'), ['-f', '--follow', '--tail', '--since', '-t', '--timestamps']);
assert.deepEqual(labels('docker compose u'), ['up']);
assert.deepEqual(labels('sudo systemctl re'), ['restart', 'reload']);
assert.deepEqual(labels('docker logs mycontainer '), [], 'after a positional there is nothing to suggest');
assert.deepEqual(labels('git commit --a'), ['--amend']);
assert.deepEqual(labels('docker system pr'), ['prune']);
assert.deepEqual(labels(''), []);
assert.deepEqual(labels('zzzz'), []);

const accepted = complete('docker lo')[0];
assert.equal(accepted.insert, 'gs ', 'only the untyped rest, plus a space');
assert.deepEqual(labels('docker'), ['docker-compose'], 'the exact word is not offered back');
assert.deepEqual(labels('ls'), [], 'a finished word with nothing longer has nothing to add');

const fromHistory = complete('curl -I ht', ['curl -I https://example.com/status', 'ls']);
assert.deepEqual(
  fromHistory.map((item) => [item.kind, item.insert]),
  [['history', 'tps://example.com/status']]
);
assert.ok(
  !complete('d', ['docker ps -a']).some((item) => item.kind === 'history'),
  'one character is too little for history'
);

const history = new LineTracker();
history.push('ls\r');
history.push('docker ps\r');
history.push('ls\r');
assert.deepEqual(history.history, ['ls', 'docker ps']);

console.log('terminal-helper: ok');
