import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib';

/** One TCP segment that carries data, with the link and IP layers stripped. */
export interface Segment {
  /** Milliseconds since the epoch. */
  time: number;
  srcIp: string;
  dstIp: string;
  srcPort: number;
  dstPort: number;
  seq: number;
  syn: boolean;
  payload: Buffer;
}

const LINKTYPE_ETHERNET = 1;
const LINKTYPE_RAW = 101;
const LINKTYPE_LINUX_SLL = 113;
const LINKTYPE_LINUX_SLL2 = 276;

function ipv4(bytes: Buffer, offset: number): string {
  return `${bytes[offset]}.${bytes[offset + 1]}.${bytes[offset + 2]}.${bytes[offset + 3]}`;
}

function ipv6(bytes: Buffer, offset: number): string {
  const groups: string[] = [];
  for (let i = 0; i < 16; i += 2) groups.push(bytes.readUInt16BE(offset + i).toString(16));
  return groups.join(':');
}

/** Where the IP packet starts in a captured frame, and what kind it is; null for anything that isn't IP. */
function ipStart(frame: Buffer, linkType: number): { offset: number; version: 4 | 6 } | null {
  let offset = 0;
  let protocol = 0;
  if (linkType === LINKTYPE_ETHERNET) {
    if (frame.length < 14) return null;
    protocol = frame.readUInt16BE(12);
    offset = 14;
    // A VLAN tag sits in front of the real type.
    if (protocol === 0x8100 && frame.length >= 18) {
      protocol = frame.readUInt16BE(16);
      offset = 18;
    }
  } else if (linkType === LINKTYPE_LINUX_SLL) {
    if (frame.length < 16) return null;
    protocol = frame.readUInt16BE(14);
    offset = 16;
  } else if (linkType === LINKTYPE_LINUX_SLL2) {
    if (frame.length < 20) return null;
    protocol = frame.readUInt16BE(0);
    offset = 20;
  } else if (linkType === LINKTYPE_RAW) {
    if (frame.length < 1) return null;
    protocol = frame[0] >> 4 === 6 ? 0x86dd : 0x0800;
  } else {
    return null;
  }
  if (protocol === 0x0800) return { offset, version: 4 };
  if (protocol === 0x86dd) return { offset, version: 6 };
  return null;
}

/** Reads one captured frame as a TCP segment, or null if it isn't TCP over IP. */
export function parseSegment(frame: Buffer, linkType: number, time: number): Segment | null {
  const start = ipStart(frame, linkType);
  if (!start) return null;
  const { offset, version } = start;

  let tcpOffset: number;
  let srcIp: string;
  let dstIp: string;
  let end: number;
  if (version === 4) {
    if (frame.length < offset + 20) return null;
    const headerLength = (frame[offset] & 0x0f) * 4;
    if (frame[offset + 9] !== 6) return null;
    tcpOffset = offset + headerLength;
    srcIp = ipv4(frame, offset + 12);
    dstIp = ipv4(frame, offset + 16);
    // The IP length ends the data: Ethernet pads short frames and that padding isn't payload.
    end = Math.min(frame.length, offset + frame.readUInt16BE(offset + 2));
  } else {
    if (frame.length < offset + 40) return null;
    if (frame[offset + 6] !== 6) return null;
    tcpOffset = offset + 40;
    srcIp = ipv6(frame, offset + 8);
    dstIp = ipv6(frame, offset + 24);
    end = Math.min(frame.length, tcpOffset + frame.readUInt16BE(offset + 4));
  }
  if (frame.length < tcpOffset + 20) return null;

  const dataOffset = (frame[tcpOffset + 12] >> 4) * 4;
  return {
    time,
    srcIp,
    dstIp,
    srcPort: frame.readUInt16BE(tcpOffset),
    dstPort: frame.readUInt16BE(tcpOffset + 2),
    seq: frame.readUInt32BE(tcpOffset + 4),
    syn: (frame[tcpOffset + 13] & 0x02) !== 0,
    payload: frame.subarray(tcpOffset + dataOffset, Math.max(tcpOffset + dataOffset, end))
  };
}

/**
 * Reads the classic pcap format that `tcpdump -w -` writes, as it streams in:
 * feed it chunks and it calls back with each TCP segment it completes.
 */
export class PcapReader {
  private buffer: Buffer = Buffer.alloc(0);
  private littleEndian = true;
  private nanos = false;
  private linkType = 0;
  private headerRead = false;

  constructor(private readonly onSegment: (segment: Segment) => void) {}

  push(chunk: Buffer): void {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);

    if (!this.headerRead) {
      if (this.buffer.length < 24) return;
      const magic = this.buffer.readUInt32LE(0);
      if (magic === 0xa1b2c3d4) this.littleEndian = true;
      else if (magic === 0xd4c3b2a1) this.littleEndian = false;
      else if (magic === 0xa1b23c4d) [this.littleEndian, this.nanos] = [true, true];
      else if (magic === 0x4d3cb2a1) [this.littleEndian, this.nanos] = [false, true];
      else throw new Error('Not a pcap stream');
      this.linkType = this.u32(20);
      this.buffer = this.buffer.subarray(24);
      this.headerRead = true;
    }

    for (;;) {
      if (this.buffer.length < 16) return;
      const included = this.u32(8);
      if (this.buffer.length < 16 + included) return;
      const seconds = this.u32(0);
      const fraction = this.u32(4);
      const time = seconds * 1000 + Math.floor(fraction / (this.nanos ? 1e6 : 1e3));
      const frame = this.buffer.subarray(16, 16 + included);
      this.buffer = this.buffer.subarray(16 + included);
      const segment = parseSegment(frame, this.linkType, time);
      if (segment) this.onSegment(segment);
    }
  }

  private u32(offset: number): number {
    return this.littleEndian ? this.buffer.readUInt32LE(offset) : this.buffer.readUInt32BE(offset);
  }
}

// ---------------------------------------------------------------------------------------------
// HTTP/1.x over the reassembled byte streams

export interface HttpMessageBody {
  /** The text, or null for a body that isn't text. */
  text: string | null;
  /** Size on the wire after decoding, in bytes. */
  size: number;
  /** Why the text is not the whole body. */
  note?: 'binary' | 'truncated' | 'undecoded';
}

export interface HttpRequest {
  time: number;
  method: string;
  target: string;
  headers: [string, string][];
  body: HttpMessageBody;
}

export interface HttpResponse {
  time: number;
  status: number;
  reason: string;
  headers: [string, string][];
  body: HttpMessageBody;
}

export interface Exchange {
  client: string;
  request: HttpRequest;
  /** Null when the capture ended before an answer. */
  response: HttpResponse | null;
  durationMs: number | null;
}

const MAX_BODY_CHARS = 32_000;
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;
const REQUEST_LINE = /^([A-Z]{3,10}) (\S+) HTTP\/1\.[01]\r\n/;
const STATUS_LINE = /^HTTP\/1\.[01] (\d{3})(?: ([^\r\n]*))?\r\n/;

function headerValue(headers: [string, string][], name: string): string | undefined {
  return headers.find(([key]) => key.toLowerCase() === name)?.[1];
}

function looksLikeText(bytes: Buffer, contentType: string | undefined): boolean {
  if (
    contentType &&
    /(?:text\/|json|xml|javascript|x-www-form-urlencoded|yaml|html|graphql)/i.test(contentType)
  ) {
    return true;
  }
  if (contentType && /(?:image|audio|video|octet-stream|pdf|zip|font)/i.test(contentType))
    return false;
  const sample = bytes.subarray(0, 512);
  let odd = 0;
  for (const byte of sample) if (byte < 9 || (byte > 13 && byte < 32)) odd++;
  return sample.length === 0 || odd / sample.length < 0.05;
}

/** The body as it is shown: decompressed if it was, and as text only if it reads as text. */
export function describeBody(raw: Buffer, headers: [string, string][]): HttpMessageBody {
  let bytes = raw;
  let note: HttpMessageBody['note'];
  const encoding = headerValue(headers, 'content-encoding')?.toLowerCase().trim();
  if (encoding && encoding !== 'identity' && raw.length > 0) {
    try {
      bytes =
        encoding === 'gzip' || encoding === 'x-gzip'
          ? gunzipSync(raw)
          : encoding === 'deflate'
            ? inflateSync(raw)
            : encoding === 'br'
              ? brotliDecompressSync(raw)
              : raw;
      if (bytes === raw) note = 'undecoded';
    } catch {
      note = 'undecoded';
    }
  }
  if (note === 'undecoded') return { text: null, size: raw.length, note };
  if (!looksLikeText(bytes, headerValue(headers, 'content-type'))) {
    return { text: null, size: bytes.length, note: 'binary' };
  }
  const text = bytes.toString('utf8');
  return text.length > MAX_BODY_CHARS
    ? { text: text.slice(0, MAX_BODY_CHARS), size: bytes.length, note: 'truncated' }
    : { text, size: bytes.length };
}

interface ParsedHead {
  start: RegExpExecArray;
  headers: [string, string][];
  headLength: number;
}

function parseHead(buffer: Buffer, startLine: RegExp): ParsedHead | 'wait' | 'skip' {
  const end = buffer.indexOf('\r\n\r\n');
  if (end < 0) return buffer.length > 64 * 1024 ? 'skip' : 'wait';
  const head = buffer.subarray(0, end + 4).toString('latin1');
  const start = startLine.exec(head);
  if (!start) return 'skip';
  const headers: [string, string][] = [];
  for (const line of head.slice(start[0].length, -4).split('\r\n')) {
    const colon = line.indexOf(':');
    if (colon > 0) headers.push([line.slice(0, colon).trim(), line.slice(colon + 1).trim()]);
  }
  return { start, headers, headLength: end + 4 };
}

/** Decodes `Transfer-Encoding: chunked` from the start of `buffer`; 'wait' until the last chunk has arrived. */
function readChunked(buffer: Buffer): { body: Buffer; used: number } | 'wait' | 'skip' {
  const parts: Buffer[] = [];
  let position = 0;
  for (;;) {
    const lineEnd = buffer.indexOf('\r\n', position);
    if (lineEnd < 0) return 'wait';
    const size = Number.parseInt(
      buffer.subarray(position, lineEnd).toString('latin1').split(';')[0],
      16
    );
    if (Number.isNaN(size)) return 'skip';
    position = lineEnd + 2;
    if (size === 0) {
      // Optional trailer headers, then a blank line.
      if (buffer.length < position + 2) return 'wait';
      if (buffer[position] === 13 && buffer[position + 1] === 10) {
        return { body: Buffer.concat(parts), used: position + 2 };
      }
      const trailerEnd = buffer.indexOf('\r\n\r\n', position);
      return trailerEnd < 0 ? 'wait' : { body: Buffer.concat(parts), used: trailerEnd + 4 };
    }
    if (buffer.length < position + size + 2) return 'wait';
    parts.push(buffer.subarray(position, position + size));
    position += size + 2;
  }
}

/** One direction of one TCP connection: in-order bytes, cut into HTTP messages. */
class Direction {
  private expected: number | null = null;
  private pending = new Map<number, Buffer>();
  private pendingBytes = 0;
  private data: Buffer = Buffer.alloc(0);
  private firstTime = 0;
  dead = false;

  /** Adds a segment; returns the in-order bytes that became available. */
  add(segment: Segment): void {
    if (this.dead) return;
    if (segment.syn) this.expected = (segment.seq + 1) >>> 0;
    if (segment.payload.length === 0) return;
    // Joined mid-connection (no SYN seen): start from the first data we get.
    if (this.expected === null) this.expected = segment.seq;

    const behind = (this.expected - segment.seq) >>> 0;
    if (behind < 0x80000000 && behind > 0) {
      // Retransmission, or overlap: keep only the part we have not seen.
      if (behind >= segment.payload.length) return;
      segment = { ...segment, seq: this.expected, payload: segment.payload.subarray(behind) };
    }
    if (segment.seq !== this.expected) {
      this.pending.set(segment.seq, segment.payload);
      this.pendingBytes += segment.payload.length;
      if (this.pendingBytes > MAX_BUFFERED_BYTES) this.dead = true;
      return;
    }
    this.append(segment.payload, segment.time);
    let next = this.pending.get(this.expected);
    while (next) {
      this.pending.delete(this.expected);
      this.pendingBytes -= next.length;
      this.append(next, segment.time);
      next = this.pending.get(this.expected);
    }
  }

  private append(payload: Buffer, time: number) {
    if (this.data.length === 0) this.firstTime = time;
    this.data = this.data.length === 0 ? payload : Buffer.concat([this.data, payload]);
    this.expected = ((this.expected ?? 0) + payload.length) >>> 0;
    if (this.data.length > MAX_BUFFERED_BYTES) this.dead = true;
  }

  /** Cuts complete messages off the front. `method` is the request's, for a response to HEAD. */
  take<T>(
    startLine: RegExp,
    build: (start: RegExpExecArray, headers: [string, string][], body: Buffer, time: number) => T,
    hasBody: (start: RegExpExecArray, headers: [string, string][]) => boolean
  ): T[] {
    const messages: T[] = [];
    while (this.data.length > 0) {
      const head = parseHead(this.data, startLine);
      if (head === 'wait') break;
      if (head === 'skip') {
        // Not at a message boundary (we joined mid-stream): look for the next start line.
        const next = this.data
          .subarray(1)
          .toString('latin1')
          .search(/(?:^|\r\n)(?:[A-Z]{3,10} \S+ HTTP\/1\.[01]|HTTP\/1\.[01] \d{3})/);
        if (next < 0) {
          this.data = Buffer.alloc(0);
          break;
        }
        this.data = this.data.subarray(
          1 + next + (this.data.subarray(1 + next, 3 + next).toString() === '\r\n' ? 2 : 0)
        );
        continue;
      }
      const { start, headers, headLength } = head;
      const rest = this.data.subarray(headLength);
      let body: Buffer = Buffer.alloc(0);
      let used = 0;
      if (hasBody(start, headers)) {
        if (headerValue(headers, 'transfer-encoding')?.toLowerCase().includes('chunked')) {
          const chunked = readChunked(rest);
          if (chunked === 'wait') break;
          if (chunked === 'skip') {
            this.data = Buffer.alloc(0);
            break;
          }
          ({ body, used } = chunked);
        } else {
          const length = Number(headerValue(headers, 'content-length') ?? 0);
          if (!Number.isFinite(length) || length < 0) {
            this.data = Buffer.alloc(0);
            break;
          }
          if (rest.length < length) break;
          body = rest.subarray(0, length);
          used = length;
        }
      }
      messages.push(build(start, headers, body, this.firstTime));
      this.data = this.data.subarray(headLength + used);
      // The next message starts at the time its first bytes arrived, which we no longer know exactly.
    }
    return messages;
  }
}

interface Connection {
  client: string;
  requests: Direction;
  responses: Direction;
  /** Requests read but not yet answered, oldest first. */
  waiting: HttpRequest[];
}

/**
 * Turns the TCP segments of a capture into HTTP request/response pairs for a
 * server listening on `serverPort`. It reads HTTP/1.x in the clear, which is
 * what a reverse proxy sends to its backends; anything else is ignored.
 */
export class HttpAssembler {
  private readonly connections = new Map<string, Connection>();

  constructor(
    private readonly serverPort: number,
    private readonly onExchange: (exchange: Exchange) => void
  ) {}

  push(segment: Segment): void {
    const toServer = segment.dstPort === this.serverPort;
    if (!toServer && segment.srcPort !== this.serverPort) return;
    const client = toServer
      ? `${segment.srcIp}:${segment.srcPort}`
      : `${segment.dstIp}:${segment.dstPort}`;
    let connection = this.connections.get(client);
    if (!connection) {
      connection = { client, requests: new Direction(), responses: new Direction(), waiting: [] };
      this.connections.set(client, connection);
    }

    if (toServer) {
      connection.requests.add(segment);
      for (const request of connection.requests.take(
        REQUEST_LINE,
        (start, headers, body, time): HttpRequest => ({
          time,
          method: start[1],
          target: start[2],
          headers,
          body: describeBody(body, headers)
        }),
        () => true
      )) {
        connection.waiting.push(request);
      }
    } else {
      connection.responses.add(segment);
      for (const response of connection.responses.take(
        STATUS_LINE,
        (start, headers, body, time): HttpResponse => ({
          time,
          status: Number(start[1]),
          reason: start[2] ?? '',
          headers,
          body: describeBody(body, headers)
        }),
        (start) => {
          const status = Number(start[1]);
          // No body after informational, 204 and 304 answers, or after an answer to HEAD.
          if (connection.waiting[0]?.method === 'HEAD') return false;
          return !(status < 200 || status === 204 || status === 304);
        }
      )) {
        // 100 Continue and friends are not the answer.
        if (response.status < 200) continue;
        const request = connection.waiting.shift();
        if (!request) continue;
        this.onExchange({
          client,
          request,
          response,
          durationMs: Math.max(0, response.time - request.time)
        });
      }
    }
    if (connection.requests.dead || connection.responses.dead) this.connections.delete(client);
  }

  /** The capture is over: requests still waiting for an answer are reported without one. */
  end(): void {
    for (const connection of this.connections.values()) {
      for (const request of connection.waiting) {
        this.onExchange({ client: connection.client, request, response: null, durationMs: null });
      }
    }
    this.connections.clear();
  }
}
