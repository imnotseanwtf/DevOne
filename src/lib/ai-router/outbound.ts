import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';
import { isIP } from 'node:net';
import { createGunzip, createInflate, createBrotliDecompress } from 'node:zlib';
import { resolveGatewayUrl } from './security';

/** Resolve and validate once, then pin those addresses in the socket's lookup callback. */
export async function safeGatewayFetch(
  input: string | URL | Request,
  init: RequestInit = {},
  resolve?: (hostname: string) => Promise<string[]>
): Promise<Response> {
  const signal = init.signal ?? (input instanceof Request ? input.signal : undefined);
  signal?.throwIfAborted();
  const validated = await resolveGatewayUrl(
    input instanceof Request ? input.url : String(input),
    undefined,
    resolve
  );
  signal?.throwIfAborted();
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  const body = init.body ?? (input instanceof Request ? await input.arrayBuffer() : undefined);
  const payload = body instanceof URLSearchParams ? body.toString() : body;
  if (
    payload !== undefined &&
    payload !== null &&
    typeof payload !== 'string' &&
    !(payload instanceof ArrayBuffer) &&
    !ArrayBuffer.isView(payload)
  ) {
    throw new Error('Unsupported outbound request body');
  }
  return new Promise<Response>((resolveResponse, reject) => {
    const send = validated.url.protocol === 'https:' ? httpsRequest : httpRequest;
    const request = send(
      validated.url,
      {
        method: init.method ?? (input instanceof Request ? input.method : 'GET'),
        headers: Object.fromEntries(headers.entries()),
        signal: signal ?? undefined,
        // HTTPS keeps the original host/SNI and certificate verification, while DNS cannot rebind.
        lookup: (_hostname, options, callback) => {
          const addresses = validated.addresses.map((address) => ({
            address,
            family: isIP(address)
          }));
          if (options.all) callback(null, addresses);
          else {
            const entry =
              addresses.find((address) => !options.family || address.family === options.family) ??
              addresses[0];
            callback(null, entry.address, entry.family);
          }
        }
      },
      (response) => {
        const answerHeaders = new Headers();
        for (let index = 0; index < response.rawHeaders.length; index += 2)
          answerHeaders.append(response.rawHeaders[index], response.rawHeaders[index + 1]);
        const status = response.statusCode ?? 502;
        if (status >= 300 && status < 400) {
          response.destroy();
          reject(new Error('Provider redirects are forbidden'));
          return;
        }
        const encoding = answerHeaders.get('content-encoding')?.toLowerCase();
        const decompress =
          encoding === 'gzip'
            ? createGunzip()
            : encoding === 'deflate'
              ? createInflate()
              : encoding === 'br'
                ? createBrotliDecompress()
                : null;
        const source = decompress ? response.pipe(decompress) : response;
        if (decompress) {
          answerHeaders.delete('content-encoding');
          answerHeaders.delete('content-length');
          response.on('error', (error) => decompress.destroy(error));
          decompress.on('close', () => response.destroy());
        }
        const stream =
          status === 204 || status === 205 || status === 304 || init.method === 'HEAD'
            ? null
            : (Readable.toWeb(source) as ReadableStream<Uint8Array>);
        if (!stream) response.resume();
        resolveResponse(new Response(stream, { status, headers: answerHeaders }));
      }
    );
    request.on('error', reject);
    if (payload !== undefined && payload !== null) {
      request.end(
        typeof payload === 'string'
          ? payload
          : payload instanceof ArrayBuffer
            ? Buffer.from(payload)
            : Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength)
      );
    } else request.end();
  });
}
