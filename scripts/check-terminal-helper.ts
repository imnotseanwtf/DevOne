import assert from 'node:assert/strict';
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

console.log('terminal-helper: ok');
