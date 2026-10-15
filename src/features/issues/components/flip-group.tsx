'use client';

import { useLayoutEffect, useRef } from 'react';

const DURATION_MS = 220;

/**
 * Everything inside glides to its new place when the layout changes, including
 * a card that moves to another column (FLIP: remember where each item was, let
 * the DOM update, then animate it from there). Items opt in with
 * `data-flip-id`; `signature` changes whenever the order should be re-measured.
 *
 * Positions are measured against the group, plus the scroll of any
 * `data-flip-scroll` element they sit in. So the page scrolling, or the board
 * being scrolled sideways while a card is dragged to a far column, between two
 * renders can't throw the animation off.
 */
export function FlipGroup({
  signature,
  children,
  ...props
}: React.ComponentProps<'div'> & { signature: string }) {
  const group = useRef<HTMLDivElement>(null);
  const previous = useRef(new Map<string, { x: number; y: number }>());

  useLayoutEffect(() => {
    const element = group.current;
    if (!element) return;
    const origin = element.getBoundingClientRect();
    // Hidden (another view is showing): measuring would record zeros.
    if (origin.width === 0 && origin.height === 0) {
      previous.current = new Map();
      return;
    }
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const next = new Map<string, { x: number; y: number }>();

    for (const item of element.querySelectorAll<HTMLElement>('[data-flip-id]')) {
      const id = item.dataset.flipId as string;
      const box = item.getBoundingClientRect();
      const scroller = item.closest<HTMLElement>('[data-flip-scroll]');
      const at = {
        x: box.left - origin.left + (scroller?.scrollLeft ?? 0),
        y: box.top - origin.top + (scroller?.scrollTop ?? 0)
      };
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
    <div ref={group} {...props}>
      {children}
    </div>
  );
}
