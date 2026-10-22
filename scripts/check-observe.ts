import assert from 'node:assert/strict';
import {
  createLineReader,
  isForTarget,
  parseAccessLogLine,
  trafficTarget
} from '@/lib/docker/access-log';
import { parseDockerEvent } from '@/lib/docker/events';

// ---- docker events
{
  const start = parseDockerEvent(
    '{"status":"start","id":"abc","from":"nginx","Type":"container","Action":"start","Actor":{"ID":"abc","Attributes":{"image":"nginx","name":"web"}},"scope":"local","time":1761102000,"timeNano":1761102000123456789}'
  );
  assert.deepEqual(start, { time: 1761102000123, action: 'start', detail: '', attributes: {} });

  const exec = parseDockerEvent(
    '{"Action":"exec_start: sh -c ls -la /app","Actor":{"Attributes":{"execID":"e1","name":"web"}},"time":1761102001}'
  );
  assert.equal(exec?.action, 'exec_start');
  assert.equal(exec?.detail, 'sh -c ls -la /app');
  assert.equal(exec?.time, 1761102001000, 'falls back to whole seconds');
  assert.deepEqual(exec?.attributes, { execID: 'e1' });

  const died = parseDockerEvent('{"Action":"die","Actor":{"Attributes":{"exitCode":"137","name":"web"}},"time":1}');
  assert.deepEqual(died?.attributes, { exitCode: '137' });

  const health = parseDockerEvent('{"Action":"health_status: healthy","Actor":{"Attributes":{}},"time":1}');
  assert.equal(health?.action, 'health_status');
  assert.equal(health?.detail, 'healthy');

  assert.equal(parseDockerEvent('Error: something'), null);
  assert.equal(parseDockerEvent('{not json'), null);
  assert.equal(parseDockerEvent('{"time":1}'), null, 'no action, no event');
  assert.equal(parseDockerEvent('\u001b[2J{"Action":"stop","time":2}')?.action, 'stop', 'leading junk is skipped');
}

// ---- Traefik access log, JSON
const json =
  '{"ClientAddr":"203.0.113.9:51234","ClientHost":"203.0.113.9","DownstreamStatus":502,"Duration":12345678,"RequestHost":"api.example.com","RequestMethod":"POST","RequestPath":"/v1/login?next=%2F","RouterName":"http-0-kwg4kcss00sc0cs84sogog04@docker","ServiceAddr":"10.0.2.5:8080","ServiceName":"http-0-kwg4kcss00sc0cs84sogog04@docker","StartUTC":"2026-10-22T03:00:00.123456789Z"}';
{
  const request = parseAccessLogLine(json);
  assert.deepEqual(request, {
    time: Date.parse('2026-10-22T03:00:00.123Z'),
    method: 'POST',
    path: '/v1/login?next=%2F',
    status: 502,
    durationMs: 12.35,
    client: '203.0.113.9',
    host: 'api.example.com',
    router: 'http-0-kwg4kcss00sc0cs84sogog04@docker',
    backend: '10.0.2.5:8080'
  });
  assert.equal(parseAccessLogLine('{"level":"info","msg":"Configuration loaded","time":"2026-10-22T03:00:00Z"}'), null, "Traefik's own message");
  assert.equal(parseAccessLogLine('{broken'), null);
}

// ---- Traefik access log, Common Log Format (the default)
const clf =
  '203.0.113.9 - - [22/Oct/2026:03:00:00 +0000] "GET /health HTTP/1.1" 200 2 "-" "curl/8.5" 14 "http-0-kwg4kcss00sc0cs84sogog04@docker" "http://10.0.2.5:8080" 12ms';
{
  assert.deepEqual(parseAccessLogLine(clf), {
    time: Date.UTC(2026, 9, 22, 3, 0, 0),
    method: 'GET',
    path: '/health',
    status: 200,
    durationMs: 12,
    client: '203.0.113.9',
    host: '',
    router: 'http-0-kwg4kcss00sc0cs84sogog04@docker',
    backend: '10.0.2.5:8080'
  });
  assert.equal(
    parseAccessLogLine(clf.replace('+0000', '+0200'))?.time,
    Date.UTC(2026, 9, 22, 1, 0, 0),
    'a +02:00 stamp is two hours before UTC'
  );
  assert.equal(parseAccessLogLine('time="2026-10-22T03:00:00Z" level=info msg="Server up"'), null);
  assert.equal(parseAccessLogLine(''), null);
}

// ---- which requests belong to a container
{
  const target = trafficTarget(
    [
      { key: 'traefik.enable' },
      { key: 'traefik.http.routers.http-0-kwg4kcss00sc0cs84sogog04.rule' },
      { key: 'traefik.http.routers.http-0-kwg4kcss00sc0cs84sogog04.entryPoints' },
      { key: 'traefik.http.services.api-svc.loadbalancer.server.port' },
      { key: 'coolify.managed' }
    ],
    [{ ip: '10.0.2.5' }, { ip: '172.18.0.3' }, { ip: '' }]
  );
  assert.deepEqual([...target.names].toSorted(), ['api-svc', 'http-0-kwg4kcss00sc0cs84sogog04']);
  assert.deepEqual([...target.ips].toSorted(), ['10.0.2.5', '172.18.0.3']);

  const mine = parseAccessLogLine(json)!;
  assert.equal(isForTarget(mine, target), true, 'by router name');
  assert.equal(isForTarget({ ...mine, router: 'other@docker', backend: '10.0.2.5:8080' }, target), true, 'by backend address');
  assert.equal(isForTarget({ ...mine, router: 'other@docker', backend: '10.0.9.9:8080' }, target), false);
  assert.equal(isForTarget({ ...mine, router: '', backend: '' }, target), false);
  const noLabels = trafficTarget([], [{ ip: '10.0.2.5' }]);
  assert.equal(isForTarget({ ...mine, router: 'x@docker' }, noLabels), true, 'works without labels, by address');
}

// ---- partial lines wait for their end
{
  const lines: string[] = [];
  const feed = createLineReader((line) => lines.push(line));
  feed('{"a":1}\n{"b"');
  feed(':2}\n\n');
  feed('tail');
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}']);
  feed('\n');
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}', 'tail']);
}

console.log('observe: ok');
