/** Safe to import from client components: no Node modules here. */
export const LOG_TAIL_LINES = 300;

/** A small container with the usual network tools, used for traffic captures. */
export const CAPTURE_IMAGE = 'nicolaka/netshoot';
export const CAPTURE_SECONDS = [10, 30, 60] as const;
