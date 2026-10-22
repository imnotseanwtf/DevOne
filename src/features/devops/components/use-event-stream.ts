'use client';

import { useCallback, useEffect, useState } from 'react';

export type StreamStatus = 'connecting' | 'live' | 'ended';

/**
 * Items from a Server-Sent Events URL, newest first. Rows arrive oldest first
 * (history, then live) and are batched to one render per frame, so a burst of
 * history doesn't cost a render per row. A null `url` keeps the stream closed.
 * `meta` events carry side information the page shows next to the list.
 */
export function useEventStream<T, M = unknown>(url: string | null, max: number) {
  const [items, setItems] = useState<T[]>([]);
  const [status, setStatus] = useState<StreamStatus>('connecting');
  const [reason, setReason] = useState<string | null>(null);
  const [meta, setMeta] = useState<M | null>(null);

  useEffect(() => {
    if (!url) return;
    setItems([]);
    setReason(null);
    setMeta(null);
    setStatus('connecting');

    const stream = new EventSource(url);
    let batch: T[] = [];
    let frame = 0;
    const flush = () => {
      frame = 0;
      const rows = batch.toReversed();
      batch = [];
      setItems((current) => [...rows, ...current].slice(0, max));
    };

    stream.addEventListener('open', () => setStatus('live'));
    stream.addEventListener('message', (event: MessageEvent<string>) => {
      batch.push(JSON.parse(event.data) as T);
      if (!frame) frame = requestAnimationFrame(flush);
    });
    stream.addEventListener('meta', (event) => {
      setMeta(JSON.parse((event as MessageEvent<string>).data) as M);
    });
    const end = (message: string | null) => {
      stream.close();
      setStatus('ended');
      setReason(message);
    };
    stream.addEventListener('end', (event) => {
      end((JSON.parse((event as MessageEvent<string>).data) as { reason: string }).reason);
    });
    // A reconnect would replay the history and duplicate rows, so a dropped link ends the stream.
    stream.addEventListener('error', () => end('Disconnected'));

    return () => {
      if (frame) cancelAnimationFrame(frame);
      stream.close();
    };
  }, [url, max]);

  const clear = useCallback(() => setItems([]), []);
  return { items, status, reason, meta, clear };
}
