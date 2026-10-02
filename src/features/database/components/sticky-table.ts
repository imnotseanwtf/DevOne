/**
 * Class for the box a shadcn `<Table>` scrolls in. The primitive wraps the
 * table in its own `overflow-x-auto` div, which puts the horizontal scrollbar
 * below the last row and breaks `sticky` headers; letting that inner div
 * overflow hands both axes to this box, so the header stays pinned and the
 * horizontal scrollbar sits at the bottom of the visible area.
 */
export const STICKY_TABLE_SCROLLER =
  'overflow-auto [&>[data-slot=table-container]]:overflow-visible';
