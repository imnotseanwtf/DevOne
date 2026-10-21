import assert from 'node:assert/strict';
import { dockerFailure, parseContainers } from '@/lib/docker/containers';

const output = [
  'WARNING: something on stdout',
  '{"ID":"b","Names":"web","Image":"nginx","State":"exited","Status":"Exited (0) 2 days ago","Ports":""}',
  '{"ID":"a","Names":"api","Image":"node:22","State":"running","Status":"Up 3 hours","Ports":"0.0.0.0:3000->3000/tcp"}',
  '{"ID":"c","Names":"cache","Image":"redis","State":"running","Status":"Up 1 hour","Ports":""}'
].join('\n');

const containers = parseContainers(output);
assert.deepEqual(
  containers.map((entry) => entry.name),
  ['api', 'cache', 'web'],
  'running containers first, then by name'
);
assert.equal(containers[0].ports, '0.0.0.0:3000->3000/tcp');
assert.deepEqual(parseContainers(''), []);

assert.equal(dockerFailure('bash: docker: command not found', 127).code, 'missing');
assert.equal(dockerFailure('permission denied while trying to connect', 1).code, 'permission');
assert.equal(
  dockerFailure('Cannot connect to the Docker daemon at unix:///var/run/docker.sock', 1).code,
  'daemon'
);
assert.equal(dockerFailure('boom', 1).code, 'failed');

console.log('containers: ok');
