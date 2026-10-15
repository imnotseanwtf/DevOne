'use client';

import { useLayoutEffect, useRef } from 'react';

const DURATION_MS = 200;

/**
 * A list whose items glide to their new place when the order changes (FLIP:
 * measure, let the DOM update, then animate each item from where it was).
 * Items opt in with `data-flip-id`; `signature` changes whenever the order
 * should be re-measured, e.g. the ids joined together. Positions are measured
 * against the list itself, so scrolling the page or the board between two
 * renders can't throw the animation off.
 */
export function FlipList({
  signature,
  children,
  ...props
}: React.ComponentProps<'ul'> & { signature: string }) {
  const list = useRef<HTMLUListElement>(null);
  const previous = useRef(new Map<string, { x: number; y: number }>());

  useLayoutEffect(() => {
    const element = list.current;
    if (!element) return;
    const origin = element.getBoundingClientRect();
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const next = new Map<string, { x: number; y: number }>();

    for (const item of element.querySelectorAll<HTMLElement>(':scope > [data-flip-id]')) {
      const id = item.dataset.flipId as string;
      const box = item.getBoundingClientRect();
      const at = { x: box.left - origin.left, y: box.top - origin.top };
      next.set(id, at);
      const before = previous.current.get(id);
      if (!before || reduceMotion) continue;
      const dx = before.x - at.x;
      const dy = before.y - at.y;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      item.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
        { duration: DURATION_MS, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }
      );
    }
    previous.current = next;
  }, [signature]);

  return (
    <ul ref={list} {...props}>
      {children}
    </ul>
  );
}
