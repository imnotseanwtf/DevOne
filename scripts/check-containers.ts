import assert from 'node:assert/strict';
import {
  controlArgs,
  dockerFailure,
  parseContainers,
  parseInspect,
  parseStats,
  remoteDockerCommand,
  shellQuote
} from '@/lib/docker/containers';

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

assert.equal(dockerFailure('Error: No such container: abc', 1).message, 'That container no longer exists');

assert.equal(shellQuote("it's"), `'it'\\''s'`);
assert.equal(
  remoteDockerCommand(['exec', '-it', 'abc123abc123', 'sh', '-c', "echo 'hi'; ls"]),
  `docker 'exec' '-it' 'abc123abc123' 'sh' '-c' 'echo '\\''hi'\\''; ls'`
);

assert.deepEqual(controlArgs('remove', 'abc123abc123'), ['rm', '-f', 'abc123abc123']);
assert.deepEqual(controlArgs('stop', 'abc123abc123'), ['stop', 'abc123abc123']);

const inspected = parseInspect(
  JSON.stringify([
    {
      Id: 'abc123abc123abc123',
      Name: '/web',
      Created: '2026-10-01T00:00:00Z',
      Path: 'nginx',
      Args: ['-g', 'daemon off;'],
      Image: 'sha256:deadbeef',
      State: { Status: 'running', ExitCode: 0, StartedAt: '2026-10-01T00:00:01Z', FinishedAt: '0001-01-01T00:00:00Z' },
      Config: { Image: 'nginx:1', Env: ['B=2', 'A=x=y', 'NOEQ'], Labels: { z: '1', a: '2' }, WorkingDir: '/', User: '' },
      HostConfig: { RestartPolicy: { Name: '' } },
      Mounts: [{ Type: 'bind', Source: '/srv', Destination: '/data', RW: false }],
      NetworkSettings: {
        Ports: { '80/tcp': [{ HostIp: '0.0.0.0', HostPort: '8080' }], '443/tcp': null },
        Networks: { bridge: { IPAddress: '172.17.0.2', Gateway: '172.17.0.1', MacAddress: 'aa:bb' } }
      }
    }
  ])
);
assert.ok(inspected);
assert.equal(inspected.name, 'web');
assert.equal(inspected.command, 'nginx -g daemon off;');
assert.equal(inspected.finishedAt, '', 'the zero date means never');
assert.equal(inspected.restartPolicy, 'no');
assert.deepEqual(inspected.env, [
  { key: 'A', value: 'x=y' },
  { key: 'B', value: '2' },
  { key: 'NOEQ', value: '' }
]);
assert.deepEqual(inspected.ports, [
  { container: '80/tcp', host: '0.0.0.0:8080' },
  { container: '443/tcp', host: '' }
]);
assert.equal(inspected.mounts[0].readWrite, false);
assert.equal(parseInspect('not json'), null);
assert.equal(parseInspect('[]'), null);

const stats = parseStats(
  '{"CPUPerc":"12.50%","MemPerc":"3.10%","MemUsage":"31MiB / 1GiB","NetIO":"1kB / 2kB","BlockIO":"0B / 0B","PIDs":"7"}'
);
assert.deepEqual(stats, {
  cpuPercent: 12.5,
  memoryPercent: 3.1,
  memoryUsage: '31MiB / 1GiB',
  networkIo: '1kB / 2kB',
  blockIo: '0B / 0B',
  pids: 7
});
assert.equal(parseStats('garbage'), null);


{
  const { compactPorts, shortImage } = await import('@/features/devops/container-format');
  assert.equal(shortImage('postgres:15-alpine'), 'postgres:15-alpine');
  assert.equal(
    shortImage('sha256:6f30057d31f5861b66f3545d4821f987aacf1dd920765f0acadea0c58ff975b1'),
    'sha256:6f30057d31f5…'
  );
  assert.equal(
    shortImage('kwg4kcss00sc0cs84sogog04_api:7228ee1992d69fed4d1a130c0f91c5184700046e'),
    'kwg4kcss00sc0cs84sogog04_api:7228ee1992d6…'
  );
  assert.equal(shortImage('ghcr.io/coollabsio/coolify:4.0.0-beta.462'), 'ghcr.io/coollabsio/coolify:4.0.0-beta.462');
  assert.equal(shortImage('registry:5000/app'), 'registry:5000/app', 'a registry port is not a tag');

  assert.deepEqual(compactPorts(''), []);
  assert.deepEqual(compactPorts('8080/tcp'), [{ label: '8080', published: false }]);
  assert.deepEqual(
    compactPorts('8000/tcp, 8443/tcp, 9000/tcp, 0.0.0.0:8000->8080/tcp, [::]:8000->8080/tcp'),
    [
      { label: '8000', published: false },
      { label: '8443', published: false },
      { label: '9000', published: false },
      { label: '8000:8080', published: true }
    ],
    'IPv4 and IPv6 bindings fold into one'
  );
  assert.deepEqual(
    compactPorts('0.0.0.0:80->80/tcp, [::]:80->80/tcp, 0.0.0.0:443->443/udp, [::]:443->443/udp'),
    [
      { label: '80:80', published: true },
      { label: '443:443/udp', published: true }
    ]
  );
  assert.deepEqual(compactPorts('0.0.0.0:6001-6002->6001-6002/tcp'), [{ label: '6001-6002:6001-6002', published: true }]);
}

console.log('containers: ok');
