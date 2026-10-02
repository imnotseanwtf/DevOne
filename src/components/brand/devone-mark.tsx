import { useId, type SVGProps } from 'react';

/**
 * The DevOne mascot, Prompt: a little robot whose screen reads `> 1_`, a shell
 * prompt with the 1 of DevOne typed in and the cursor waiting after it. Drawn
 * on a 24px grid in currentColor, with the face cut out, so it takes the
 * colour and size of wherever it sits, like any icon.
 */
const HEAD =
  'M6 7.7H11.3V5.027A1.5 1.5 0 1 1 12.7 5.027V7.7H18A3 3 0 0 1 21 10.7V12.6H22A.8 .8 0 0 1 22.8 13.4V16A.8 .8 0 0 1 22 16.8H21V18.7A3 3 0 0 1 18 21.7H6A3 3 0 0 1 3 18.7V16.8H2A.8 .8 0 0 1 1.2 16V13.4A.8 .8 0 0 1 2 12.6H3V10.7A3 3 0 0 1 6 7.7Z';
const PROMPT =
  'M7.198 12.762L8.998 14.262A0.7 0.7 0 0 1 8.998 15.338L7.198 16.838A0.7 0.7 0 0 1 6.302 15.762L7.457 14.8L6.302 13.838A0.7 0.7 0 0 1 7.198 12.762Z';
const ONE =
  'M11.983 13.304L13.283 12.504A0.7 0.7 0 0 1 14.35 13.1L14.35 16.3A0.7 0.7 0 0 1 12.95 16.3L12.95 14.353L12.717 14.496A0.7 0.7 0 0 1 11.983 13.304Z';
const CURSOR = 'M15.85 15.6h1.2a0.7 0.7 0 0 1 0 1.4h-1.2a0.7 0.7 0 0 1 0 -1.4Z';

export const DEVONE_MARK_PATH = HEAD + PROMPT + ONE + CURSOR;

type DevOneMarkProps = SVGProps<SVGSVGElement> & {
  size?: number | string;
  stroke?: number | string;
  title?: string;
  /** Blinks the `_` cursor, as if Prompt is waiting for you to type. */
  blink?: boolean;
};

export function DevOneMark({ size, stroke: _stroke, title, blink, ...props }: DevOneMarkProps) {
  const maskId = useId();
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      viewBox='0 0 24 24'
      width={size ?? 24}
      height={size ?? 24}
      fill='currentColor'
      role={title ? 'img' : undefined}
      {...props}
    >
      {title && <title>{title}</title>}
      {blink ? (
        <>
          {/* The cursor is cut out by a mask so it can fade in and out. */}
          <mask id={maskId}>
            <rect width='24' height='24' fill='#fff' />
            <path d={CURSOR} fill='#000' className='devone-cursor-blink' />
          </mask>
          <path fillRule='evenodd' d={HEAD + PROMPT + ONE} mask={`url(#${maskId})`} />
        </>
      ) : (
        <path fillRule='evenodd' d={DEVONE_MARK_PATH} />
      )}
    </svg>
  );
}
