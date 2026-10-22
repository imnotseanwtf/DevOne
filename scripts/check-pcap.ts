import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { captureArgs, followLocalDockerBytes } from '@/lib/docker/containers';
import { type Exchange, HttpAssembler, PcapReader } from '@/lib/docker/pcap';
import { HIDDEN, redactExchange } from '@/lib/docker/redact';

// ---- build real packet bytes -----------------------------------------------------------------
const SERVER = { ip: '10.0.2.5', port: 8080 };
const PROXY = { ip: '10.0.2.1' };

function ipv4(ip: string): Buffer {
  return Buffer.from(ip.split('.').map(Number));
}

/** An Ethernet + IPv4 + TCP frame (or Linux "cooked" SLL2 with `cooked`). */
function frame(opts: {
  from: string;
  fromPort: number;
  to: string;
  toPort: number;
  seq: number;
  data?: Buffer;
  syn?: boolean;
  cooked?: boolean;
}): Buffer {
  const data = opts.data ?? Buffer.alloc(0);
  const tcp = Buffer.alloc(20);
  tcp.writeUInt16BE(opts.fromPort, 0);
  tcp.writeUInt16BE(opts.toPort, 2);
  tcp.writeUInt32BE(opts.seq >>> 0, 4);
  tcp[12] = 5 << 4;
  tcp[13] = opts.syn ? 0x02 : 0x18;
  const ip = Buffer.alloc(20);
  ip[0] = 0x45;
  ip.writeUInt16BE(20 + 20 + data.length, 2);
  ip[8] = 64;
  ip[9] = 6;
  ipv4(opts.from).copy(ip, 12);
  ipv4(opts.to).copy(ip, 16);
  let link: Buffer;
  if (opts.cooked) {
    link = Buffer.alloc(20);
    link.writeUInt16BE(0x0800, 0);
  } else {
    link = Buffer.alloc(14);
    link.writeUInt16BE(0x0800, 12);
  }
  // Ethernet pads short frames to 60 bytes: that padding must not be read as payload.
  const body = Buffer.concat([link, ip, tcp, data]);
  return !opts.cooked && body.length < 60 ? Buffer.concat([body, Buffer.alloc(60 - body.length)]) : body;
}

function pcap(frames: { at: number; bytes: Buffer }[], linkType: number): Buffer {
  const header = Buffer.alloc(24);
  header.writeUInt32LE(0xa1b2c3d4, 0);
  header.writeUInt16LE(2, 4);
  header.writeUInt16LE(4, 6);
  header.writeUInt32LE(65535, 16);
  header.writeUInt32LE(linkType, 20);
  const records = frames.map(({ at, bytes }) => {
    const record = Buffer.alloc(16);
    record.writeUInt32LE(Math.floor(at / 1000), 0);
    record.writeUInt32LE((at % 1000) * 1000, 4);
    record.writeUInt32LE(bytes.length, 8);
    record.writeUInt32LE(bytes.length, 12);
    return Buffer.concat([record, bytes]);
  });
  return Buffer.concat([header, ...records]);
}

const T0 = Date.UTC(2026, 9, 22, 3, 0, 0);

/** A client's side of a conversation: sends requests (seq counts bytes) and receives responses. */
function conversation(clientPort: number, cooked = false) {
  let clientSeq = 1000;
  let serverSeq = 5000;
  const out: { at: number; bytes: Buffer }[] = [];
  const base = { cooked };
  out.push({ at: T0, bytes: frame({ ...base, from: PROXY.ip, fromPort: clientPort, to: SERVER.ip, toPort: SERVER.port, seq: clientSeq, syn: true }) });
  clientSeq += 1;
  out.push({ at: T0, bytes: frame({ ...base, from: SERVER.ip, fromPort: SERVER.port, to: PROXY.ip, toPort: clientPort, seq: serverSeq, syn: true }) });
  serverSeq += 1;
  return {
    out,
    /** `parts` are sent as separate segments, to test messages split across packets. */
    request(at: number, ...parts: (string | Buffer)[]) {
      for (const part of parts) {
        const data = Buffer.from(part);
        out.push({ at, bytes: frame({ ...base, from: PROXY.ip, fromPort: clientPort, to: SERVER.ip, toPort: SERVER.port, seq: clientSeq, data }) });
        clientSeq += data.length;
      }
    },
    response(at: number, ...parts: (string | Buffer)[]) {
      for (const part of parts) {
        const data = Buffer.from(part);
        out.push({ at, bytes: frame({ ...base, from: SERVER.ip, fromPort: SERVER.port, to: PROXY.ip, toPort: clientPort, seq: serverSeq, data }) });
        serverSeq += data.length;
      }
    }
  };
}

function run(frames: { at: number; bytes: Buffer }[], linkType = 1, chunk = 1 << 20): Exchange[] {
  const exchanges: Exchange[] = [];
  const assembler = new HttpAssembler(SERVER.port, (exchange) => exchanges.push(exchange));
  const reader = new PcapReader((segment) => assembler.push(segment));
  const bytes = pcap(frames, linkType);
  // The capture arrives in arbitrary pieces over a pipe.
  for (let i = 0; i < bytes.length; i += chunk) reader.push(bytes.subarray(i, i + chunk));
  assembler.end();
  return exchanges;
}

// ---- a plain JSON request and response, with padding and in awkward pieces ---------------------
{
  const c = conversation(51000);
  const body = '{"user":"ana","password":"hunter2"}';
  c.request(T0 + 10, 'POST /v1/login?next=%2F HTTP/1.1\r\nHost: api.example.com\r\nContent-Type: application/json\r\n', `Content-Length: ${body.length}\r\nAuthorization: Bearer abc.def\r\n\r\n`, body.slice(0, 10), body.slice(10));
  const answer = '{"ok":true}';
  c.response(T0 + 45, 'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n', `Content-Length: ${answer.length}\r\n\r\n`, answer);

  // Same bytes, fed to the reader a few bytes at a time.
  for (const chunk of [1 << 20, 7, 1]) {
    const [exchange] = run(c.out, 1, chunk);
    assert.ok(exchange, `an exchange (chunk ${chunk})`);
    assert.equal(exchange.client, '10.0.2.1:51000');
    assert.equal(exchange.request.method, 'POST');
    assert.equal(exchange.request.target, '/v1/login?next=%2F');
    assert.equal(exchange.request.body.text, body, 'the request body, however it was split');
    assert.deepEqual(exchange.request.headers.find(([k]) => k === 'Authorization'), ['Authorization', 'Bearer abc.def']);
    assert.equal(exchange.response?.status, 200);
    assert.equal(exchange.response?.reason, 'OK');
    assert.equal(exchange.response?.body.text, answer);
    assert.equal(exchange.durationMs, 35);
  }
}

// ---- Linux cooked capture (what `tcpdump -i any` writes), IPv4 ---------------------------------
{
  const c = conversation(51001, true);
  c.request(T0, 'GET /health HTTP/1.1\r\nHost: x\r\n\r\n');
  c.response(T0 + 5, 'HTTP/1.1 204 No Content\r\n\r\n');
  const [exchange] = run(c.out, 276);
  assert.equal(exchange.request.target, '/health');
  assert.equal(exchange.response?.status, 204);
  assert.equal(exchange.response?.body.size, 0);
}

// ---- chunked responses, and gzip ---------------------------------------------------------------
{
  const c = conversation(51002);
  c.request(T0, 'GET /stream HTTP/1.1\r\nHost: x\r\n\r\n');
  c.response(T0 + 2, 'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nContent-Type: text/plain\r\n\r\n', '5\r\nhello\r\n', '6\r\n world\r\n0\r\n\r\n');
  c.request(T0 + 3, 'GET /zipped HTTP/1.1\r\nHost: x\r\n\r\n');
  const zipped = gzipSync('{"compressed":"yes"}');
  c.response(T0 + 4, `HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\nContent-Type: application/json\r\nContent-Length: ${zipped.length}\r\n\r\n`, zipped);
  const [first, second] = run(c.out);
  assert.equal(first.response?.body.text, 'hello world');
  assert.equal(second.request.target, '/zipped', 'two requests on one connection are paired in order');
  assert.equal(second.response?.body.text, '{"compressed":"yes"}', 'gunzipped');
}

// ---- binary bodies are not shown as text -------------------------------------------------------
{
  const c = conversation(51003);
  c.request(T0, 'GET /logo.png HTTP/1.1\r\nHost: x\r\n\r\n');
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 0, 0, 0, 0]);
  c.response(T0 + 1, `HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: ${png.length}\r\n\r\n`, png);
  const [exchange] = run(c.out);
  assert.equal(exchange.response?.body.text, null);
  assert.equal(exchange.response?.body.note, 'binary');
  assert.equal(exchange.response?.body.size, png.length);
}

// ---- 100 Continue is not the answer; HEAD has headers but no body ------------------------------
{
  const c = conversation(51004);
  c.request(T0, 'PUT /f HTTP/1.1\r\nHost: x\r\nContent-Length: 2\r\nExpect: 100-continue\r\n\r\nhi');
  c.response(T0 + 1, 'HTTP/1.1 100 Continue\r\n\r\n', 'HTTP/1.1 201 Created\r\nContent-Length: 0\r\n\r\n');
  c.request(T0 + 2, 'HEAD /f HTTP/1.1\r\nHost: x\r\n\r\n');
  c.response(T0 + 3, 'HTTP/1.1 200 OK\r\nContent-Length: 999\r\n\r\n');
  c.request(T0 + 4, 'GET /g HTTP/1.1\r\nHost: x\r\n\r\n');
  c.response(T0 + 5, 'HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n');
  const exchanges = run(c.out);
  assert.deepEqual(exchanges.map((e) => e.response?.status), [201, 200, 404]);
  assert.equal(exchanges[0].request.body.text, 'hi');
}

// ---- out of order and repeated segments --------------------------------------------------------
{
  const c = conversation(51005);
  c.request(T0, 'GET /a HTTP/1.1\r\nHost: x\r\n\r\n');
  c.response(T0 + 1, 'HTTP/1.1 200 OK\r\n', 'Content-Length: 4\r\n\r\n', 'done');
  const syns = c.out.slice(0, 2);
  const data = c.out.slice(2);
  // swap the last two response segments, and send one of them twice
  const scrambled = [...syns, data[0], data[1], data[3], data[2], data[2]];
  const [exchange] = run(scrambled);
  assert.equal(exchange.response?.body.text, 'done');
}

// ---- a retransmission that overlaps bytes already received -------------------------------------
{
  const c = conversation(51010);
  c.request(T0, 'GET /o HTTP/1.1\r\nHost: x\r\n\r\n');
  const answer = Buffer.from('HTTP/1.1 200 OK\r\nContent-Length: 11\r\n\r\nhello world');
  // Server sequence numbers start at 5001 (after the SYN). Send bytes 0-24, then a retransmit of 10-end.
  const send = (from: number, to: number, at: number) =>
    c.out.push({
      at,
      bytes: frame({ from: SERVER.ip, fromPort: SERVER.port, to: PROXY.ip, toPort: 51010, seq: 5001 + from, data: answer.subarray(from, to) })
    });
  send(0, 25, T0 + 1);
  send(10, answer.length, T0 + 2);
  const [exchange] = run(c.out);
  assert.equal(exchange.response?.body.text, 'hello world', 'the overlap is trimmed, not duplicated or lost');
}

// ---- joining mid-connection, and a request that never got an answer ----------------------------
{
  const c = conversation(51006);
  c.request(T0, 'GET /x HTTP/1.1\r\nHost: x\r\n\r\n');
  const exchanges = run(c.out);
  assert.equal(exchanges.length, 1);
  assert.equal(exchanges[0].response, null, 'reported without an answer when the capture ends');
  assert.equal(exchanges[0].durationMs, null);

  // No SYN: the capture started in the middle. The tail of a message is skipped, the next one read.
  const mid = conversation(51007);
  mid.out.splice(0, 2);
  mid.request(T0, 'ders: here\r\n\r\nGET /real HTTP/1.1\r\nHost: x\r\n\r\n');
  mid.response(T0 + 1, 'HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok');
  const [joined] = run(mid.out);
  assert.equal(joined.request.target, '/real');
  assert.equal(joined.response?.body.text, 'ok');
}

// ---- other ports and non-HTTP traffic are ignored; garbage in is not a crash -------------------
{
  const other = conversation(51008);
  other.request(T0, 'GET /x HTTP/1.1\r\nHost: x\r\n\r\n');
  const wrongPort = other.out.map(({ at, bytes }) => ({ at, bytes: Buffer.from(bytes) }));
  for (const f of wrongPort) f.bytes.writeUInt16BE(9999, 14 + 20 + 2);
  assert.equal(run(wrongPort).length, 0, 'not this container’s port');

  const tls = conversation(51009);
  tls.request(T0, Buffer.from([0x16, 0x03, 0x01, 0x02, 0x00, 0x01, 0x00, 0x01, 0xfc]));
  assert.equal(run(tls.out).length, 0, 'a TLS handshake is not HTTP');

  assert.throws(() => new PcapReader(() => {}).push(Buffer.alloc(40, 7)), /Not a pcap/);
}

// ---- redaction ----------------------------------------------------------------------------------
{
  const c = conversation(51011);
  const body = JSON.stringify({ user: 'ana', password: 'hunter2', profile: { apiKey: 'k-123', city: 'Manila' }, tokens: [{ token: 't1', label: 'a' }], count: 3, pin: 1234 });
  c.request(T0, `POST /login?next=/home&access_token=abc&q=hi HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nAuthorization: Bearer secret\r\nCookie: sid=1\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
  c.response(T0 + 1, 'HTTP/1.1 200 OK\r\nSet-Cookie: sid=2; HttpOnly\r\nContent-Type: application/x-www-form-urlencoded\r\nContent-Length: 40\r\n\r\nname=ana&password=zzz&city=Manila&otp=99');
  const [raw] = run(c.out);
  const safe = redactExchange(raw);

  const header = (headers: [string, string][], name: string) => headers.find(([k]) => k.toLowerCase() === name)?.[1];
  assert.equal(header(safe.request.headers, 'authorization'), HIDDEN);
  assert.equal(header(safe.request.headers, 'cookie'), HIDDEN);
  assert.equal(header(safe.request.headers, 'host'), 'x', 'other headers are untouched');
  assert.equal(header(safe.response!.headers, 'set-cookie'), HIDDEN);
  assert.equal(safe.request.target, `/login?next=/home&access_token=${HIDDEN}&q=hi`);

  const parsed = JSON.parse(safe.request.body.text!);
  assert.equal(parsed.password, HIDDEN);
  assert.equal(parsed.profile.apiKey, HIDDEN);
  assert.equal(parsed.profile.city, 'Manila', 'ordinary values stay readable');
  assert.equal(parsed.tokens[0].token, HIDDEN, 'nested in arrays');
  assert.equal(parsed.pin, HIDDEN, 'numbers too');
  assert.equal(parsed.count, 3);
  assert.equal(parsed.user, 'ana');
  assert.equal(safe.response!.body.text, `name=ana&password=${HIDDEN}&city=Manila&otp=${HIDDEN}`);

  // The original is not changed: redaction makes a copy.
  assert.equal(header(raw.request.headers, 'authorization'), 'Bearer secret');
  assert.ok(raw.request.body.text!.includes('hunter2'));
  assert.ok(!JSON.stringify(safe).includes('hunter2') && !JSON.stringify(safe).includes('k-123'));

  // A body cut off at the size limit can't be parsed for secrets, so none of it is shown.
  const cut = redactExchange({ ...raw, request: { ...raw.request, body: { text: '{"password":"hunter2","x":"…', size: 99999, note: 'truncated' } } });
  assert.equal(cut.request.body.text, null);
  assert.equal(cut.request.body.note, 'truncated');
}

// ---- the capture command, and bytes surviving the trip through a child process -----------------------
{
  const args = captureArgs('abc123abc123', 8080, 30);
  assert.deepEqual(args.slice(0, 4), ['run', '--rm', '--net', 'container:abc123abc123'], 'joins the target\'s network, and cleans itself up');
  assert.ok(args.includes('timeout') && args[args.indexOf('timeout') + 1] === '30', 'ends on its own');
  assert.equal(args.at(-1), 'tcp port 8080', 'only that port');
  assert.ok(args.includes('-w') && args[args.indexOf('-w') + 1] === '-', 'pcap to standard output');
  for (const bad of [0, -1, 65536, 80.5, Number.NaN]) assert.throws(() => captureArgs('abc123abc123', bad, 10), /Pick a port/);

  const c = conversation(51012);
  c.request(T0, 'GET /through-a-pipe HTTP/1.1\r\nHost: x\r\n\r\n');
  // Bytes a text decoder would mangle: the capture must reach us untouched.
  const blob = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
  c.response(T0 + 3, `HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: ${blob.length}\r\n\r\n`, blob);
  const capture = pcap(c.out, 1);

  const dir = mkdtempSync(join(tmpdir(), 'devone-capture-'));
  writeFileSync(join(dir, 'capture.pcap'), capture);
  // Stands in for `docker run … tcpdump -w -`: progress on stderr, the capture on stdout.
  writeFileSync(join(dir, 'docker'), `#!/bin/sh\necho "Unable to find image 'nicolaka/netshoot:latest' locally" >&2\ncat "${join(dir, 'capture.pcap')}"\necho "tcpdump: 9 packets captured" >&2\n`);
  chmodSync(join(dir, 'docker'), 0o755);
  const previous = process.env.PATH;
  process.env.PATH = `${dir}:${previous}`;

  const received: Buffer[] = [];
  const status: string[] = [];
  const exchanges: Exchange[] = [];
  const assembler = new HttpAssembler(SERVER.port, (exchange) => exchanges.push(exchange));
  const reader = new PcapReader((segment) => assembler.push(segment));
  const stream = followLocalDockerBytes(['run'], 'Capture finished');
  stream.onData((chunk) => {
    received.push(chunk);
    reader.push(chunk);
  });
  stream.onStatus((text) => status.push(text.trim()));
  const reason = await new Promise<string | null>((resolve) => stream.onEnd(resolve));
  assembler.end();
  process.env.PATH = previous;

  assert.equal(reason, 'Capture finished');
  assert.ok(Buffer.concat(received).equals(capture), 'standard output arrives byte for byte');
  const messages = status.join('\n');
  assert.ok(messages.includes('Unable to find image') && messages.includes('packets captured'), 'error output arrives as text, apart from the capture');
  assert.ok(!Buffer.concat(received).toString('latin1').includes('Unable to find image'), 'and never inside it');
  assert.equal(exchanges.length, 1);
  assert.equal(exchanges[0].request.target, '/through-a-pipe');
  assert.equal(exchanges[0].response?.body.size, 256);
}

console.log('pcap: ok');
