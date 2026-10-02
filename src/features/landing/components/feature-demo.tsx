'use client';

import { DevOneMark } from '@/components/brand/devone-mark';
import { Icons } from '@/components/icons';
import { useT } from '@/i18n/client';
import type { TKey } from '@/i18n/messages';
import { cn } from '@/lib/utils';
import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * The landing page's product demo: a little DevOne window that plays through
 * every tool on its own, like a short video. Every scene is driven by one
 * clock (`t`, milliseconds since the scene started), so pausing freezes it
 * and people who prefer reduced motion see each scene's finished state.
 */

type IconName = keyof typeof Icons;

const SCENE_MS = 6500;
const TICK_MS = 80;

const SCENES: { key: string; icon: IconName; label: TKey; path: string }[] = [
  { key: 'board', icon: 'kanban', label: 'landing.features.board.title', path: 'issues' },
  { key: 'git', icon: 'gitBranch', label: 'landing.features.git.title', path: 'git' },
  {
    key: 'database',
    icon: 'database',
    label: 'landing.features.database.title',
    path: 'database'
  },
  { key: 'api', icon: 'braces', label: 'landing.features.api.title', path: 'api' },
  { key: 'docs', icon: 'post', label: 'landing.features.docs.title', path: 'docs' },
  { key: 'drawings', icon: 'drawing', label: 'landing.features.drawings.title', path: 'drawings' },
  { key: 'devops', icon: 'checks', label: 'landing.features.devops.title', path: 'devops' },
  {
    key: 'terminal',
    icon: 'terminal',
    label: 'landing.features.terminal.title',
    path: 'devops/terminal'
  }
];

/** The part of `text` typed by time `t`, starting at `start`, at `cps` characters a second. */
function typed(text: string, t: number, start: number, cps = 32) {
  return text.slice(0, Math.max(0, Math.floor(((t - start) * cps) / 1000)));
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const onChange = () => setReduced(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

export function FeatureDemo() {
  const t = useT();
  const reducedMotion = usePrefersReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const [clock, setClock] = useState({ scene: 0, t: 0 });
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [visible, setVisible] = useState(true);

  // Only play while the demo is on screen and the tab is in front.
  useEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    let inView = true;
    const update = () => setVisible(inView && document.visibilityState === 'visible');
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      update();
    });
    observer.observe(element);
    document.addEventListener('visibilitychange', update);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', update);
    };
  }, []);

  const playing = !reducedMotion && !paused && !hovered && visible;

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setClock((current) =>
        current.t + TICK_MS >= SCENE_MS
          ? { scene: (current.scene + 1) % SCENES.length, t: 0 }
          : { scene: current.scene, t: current.t + TICK_MS }
      );
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [playing]);

  const scene = SCENES[clock.scene];
  // With reduced motion every scene shows its finished state.
  const time = reducedMotion ? SCENE_MS : clock.t;
  const select = (index: number) => setClock({ scene: index, t: 0 });

  return (
    <section
      ref={rootRef}
      aria-label={t('landing.demo.label')}
      className='relative mx-auto mt-16 max-w-5xl sm:mt-20'
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <div
        aria-hidden='true'
        className='absolute -inset-x-10 -top-10 h-40 bg-[radial-gradient(ellipse_at_center,rgb(182_242_58/0.12),transparent_70%)] blur-2xl'
      />
      <div className='relative overflow-hidden rounded-xl border border-white/10 bg-[#0f0f10] text-left shadow-2xl shadow-black/60'>
        {/* Window chrome */}
        <div className='flex items-center gap-3 border-b border-white/[0.06] px-4 py-3'>
          <div aria-hidden='true' className='flex w-12 gap-1.5'>
            <span className='size-2.5 rounded-full bg-white/15' />
            <span className='size-2.5 rounded-full bg-white/15' />
            <span className='size-2.5 rounded-full bg-white/15' />
          </div>
          <div
            aria-hidden='true'
            className='mx-auto flex h-7 w-full max-w-sm min-w-0 items-center justify-center gap-1.5 rounded-md bg-white/[0.04] px-3 font-mono text-[11px] text-zinc-500'
          >
            <Icons.lock className='size-3 shrink-0' />
            <span className='truncate'>devone.local/projects/web/{scene.path}</span>
          </div>
          <div className='flex w-12 justify-end'>
            {!reducedMotion && (
              <button
                type='button'
                onClick={() => setPaused((value) => !value)}
                aria-label={paused ? t('landing.demo.play') : t('landing.demo.pause')}
                className='flex size-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200 focus-visible:ring-2 focus-visible:ring-[#b6f23a] focus-visible:outline-none'
              >
                {paused ? <Icons.run className='size-3.5' /> : <Icons.pause className='size-3.5' />}
              </button>
            )}
          </div>
        </div>

        <div className='flex'>
          {/* Sidebar */}
          <div className='hidden w-14 shrink-0 flex-col items-center gap-1 border-r border-white/[0.06] py-4 sm:flex'>
            <span
              aria-hidden='true'
              className='mb-3 flex size-8 items-center justify-center rounded-lg bg-[#fafafa] text-[#0a0a0a]'
            >
              <DevOneMark blink className='size-5' />
            </span>
            {SCENES.map((item, index) => {
              const Icon = Icons[item.icon];
              const active = index === clock.scene;
              return (
                <button
                  key={item.key}
                  type='button'
                  onClick={() => select(index)}
                  aria-label={t(item.label)}
                  aria-pressed={active}
                  className={cn(
                    'flex size-8 items-center justify-center rounded-md text-zinc-500 transition-colors hover:text-zinc-200 focus-visible:ring-2 focus-visible:ring-[#b6f23a] focus-visible:outline-none',
                    active && 'bg-white/[0.07] text-[#fafafa]'
                  )}
                >
                  <Icon className='size-4' />
                </button>
              );
            })}
          </div>

          {/* Scene */}
          <div aria-hidden='true' className='h-[340px] min-w-0 flex-1 overflow-hidden p-4 sm:p-5'>
            <div
              key={scene.key}
              className='animate-in fade-in slide-in-from-bottom-1 h-full duration-500'
            >
              <Scene name={scene.key} t={time} />
            </div>
          </div>
        </div>
      </div>

      {/* Feature tabs with progress */}
      <div className='mt-4 grid grid-cols-4 gap-2 sm:grid-cols-8'>
        {SCENES.map((item, index) => {
          const Icon = Icons[item.icon];
          const active = index === clock.scene;
          return (
            <button
              key={item.key}
              type='button'
              onClick={() => select(index)}
              aria-pressed={active}
              className={cn(
                'relative flex flex-col items-center gap-1.5 overflow-hidden rounded-lg border px-2 pt-2.5 pb-3 text-[11px] transition-colors focus-visible:ring-2 focus-visible:ring-[#b6f23a] focus-visible:outline-none',
                active
                  ? 'border-white/15 bg-white/[0.05] text-[#fafafa]'
                  : 'border-white/[0.06] text-zinc-500 hover:text-zinc-300'
              )}
            >
              <Icon aria-hidden='true' className={cn('size-4', active && 'text-[#b6f23a]')} />
              <span className='w-full truncate'>{t(item.label)}</span>
              {active && (
                <span
                  aria-hidden='true'
                  className='absolute bottom-0 left-0 h-0.5 bg-[#b6f23a]'
                  style={{ width: `${(time / SCENE_MS) * 100}%` }}
                />
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function Scene({ name, t }: { name: string; t: number }) {
  switch (name) {
    case 'board':
      return <BoardScene t={t} />;
    case 'git':
      return <GitScene t={t} />;
    case 'database':
      return <DatabaseScene t={t} />;
    case 'api':
      return <ApiScene t={t} />;
    case 'docs':
      return <DocsScene t={t} />;
    case 'drawings':
      return <DrawingsScene t={t} />;
    case 'devops':
      return <PipelineScene t={t} />;
    default:
      return <TerminalScene t={t} />;
  }
}

/* ------------------------------------------------------------------------ */
/* Shared bits                                                              */
/* ------------------------------------------------------------------------ */

function SceneHeader({ title, chip, right }: { title: string; chip: string; right?: ReactNode }) {
  return (
    <div className='mb-4 flex items-center justify-between gap-3'>
      <div className='flex min-w-0 items-center gap-2'>
        <span className='truncate text-sm font-medium'>{title}</span>
        <span className='shrink-0 rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-zinc-400'>
          {chip}
        </span>
      </div>
      {right}
    </div>
  );
}

function Appear({
  at,
  t,
  children,
  className
}: {
  at: number;
  t: number;
  children: ReactNode;
  className?: string;
}) {
  if (t < at) return null;
  return (
    <div className={cn('animate-in fade-in slide-in-from-bottom-1 duration-300', className)}>
      {children}
    </div>
  );
}

function Caret() {
  return (
    <span className='ml-px inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse bg-[#b6f23a]' />
  );
}

/* ------------------------------------------------------------------------ */
/* Board: a card is finished and moves to Done.                             */
/* ------------------------------------------------------------------------ */

type Priority = 'urgent' | 'high' | 'medium' | 'low';

const PRIORITY: Record<Priority, { icon: IconName; className: string }> = {
  urgent: { icon: 'priorityUrgent', className: 'text-red-400' },
  high: { icon: 'priorityHigh', className: 'text-orange-400' },
  medium: { icon: 'priorityMedium', className: 'text-yellow-400' },
  low: { icon: 'priorityLow', className: 'text-sky-400' }
};

interface BoardCard {
  id: string;
  title: string;
  priority: Priority;
  label?: string;
}

const MOVING_CARD: BoardCard = {
  id: 'DEV-46',
  title: 'Stream job logs into the terminal',
  priority: 'medium',
  label: 'devops'
};

function BoardScene({ t }: { t: number }) {
  const moved = t >= 2600;
  const columns: {
    name: string;
    icon: IconName;
    color: string;
    hideOnMobile?: boolean;
    cards: BoardCard[];
  }[] = [
    {
      name: 'To do',
      icon: 'statusTodo',
      color: 'text-zinc-400',
      cards: [
        { id: 'DEV-48', title: 'Rate-limit the token sign-in', priority: 'high', label: 'auth' },
        { id: 'DEV-51', title: 'Export drawings as SVG', priority: 'low' }
      ]
    },
    {
      name: 'In progress',
      icon: 'statusProgress',
      color: 'text-amber-400',
      cards: [
        {
          id: 'DEV-44',
          title: 'Pin SSH host keys on first connect',
          priority: 'urgent',
          label: 'ops'
        },
        ...(moved ? [] : [MOVING_CARD])
      ]
    },
    {
      name: 'Done',
      icon: 'statusDoneFilled',
      color: 'text-[#b6f23a]',
      hideOnMobile: true,
      cards: [
        ...(moved ? [MOVING_CARD] : []),
        { id: 'DEV-39', title: 'Calendar view for the board', priority: 'medium', label: 'board' }
      ]
    }
  ];

  return (
    <div>
      <SceneHeader
        title='Web platform'
        chip='Board'
        right={
          <div className='flex items-center -space-x-1.5'>
            {['#b6f23a', '#a1a1aa', '#fafafa'].map((color) => (
              <span
                key={color}
                className='size-5 rounded-full border-2 border-[#0f0f10]'
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        }
      />
      <div className='grid grid-cols-2 gap-3 sm:grid-cols-3'>
        {columns.map((column) => {
          const StatusIcon = Icons[column.icon];
          return (
            <div
              key={column.name}
              className={cn('min-w-0', column.hideOnMobile && 'hidden sm:block')}
            >
              <div className='mb-2.5 flex items-center gap-2 px-1 text-xs'>
                <StatusIcon className={cn('size-3.5', column.color)} />
                <span className='font-medium text-zinc-300'>{column.name}</span>
                <span className='text-zinc-600'>{column.cards.length}</span>
              </div>
              <div className='space-y-2'>
                {column.cards.map((card) => {
                  const priority = PRIORITY[card.priority];
                  const PriorityIcon = Icons[priority.icon];
                  const justMoved = card === MOVING_CARD && moved;
                  return (
                    <div
                      key={card.id}
                      className={cn(
                        'rounded-lg border border-white/[0.06] bg-[#151517] p-3 transition-shadow',
                        justMoved &&
                          'animate-in fade-in slide-in-from-left-6 ring-1 ring-[#b6f23a]/50 duration-500'
                      )}
                    >
                      <div className='flex items-center justify-between font-mono text-[10px] text-zinc-500'>
                        {card.id}
                        <span className='size-4 rounded-full bg-white/10' />
                      </div>
                      <p className='mt-1.5 truncate text-[13px] text-zinc-200'>{card.title}</p>
                      <div className='mt-2.5 flex items-center gap-1.5'>
                        <span className='inline-flex items-center gap-1 rounded border border-white/[0.06] px-1.5 py-0.5 text-[10px] text-zinc-400 capitalize'>
                          <PriorityIcon className={cn('size-3', priority.className)} />
                          {card.priority}
                        </span>
                        {card.label && (
                          <span className='rounded border border-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-zinc-500'>
                            {card.label}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Git: commits land on the branch and the diff fills in.                   */
/* ------------------------------------------------------------------------ */

const COMMITS = [
  { sha: 'a1c9e2f', message: 'Pin host keys on first connect', who: 'you', at: 'now' },
  { sha: '7be0d41', message: 'Stream SSH output over SSE', who: 'mara', at: '2h' },
  { sha: '3f8a6c0', message: 'Encrypt saved credentials', who: 'jo', at: '5h' },
  { sha: 'e52b9d7', message: 'Add SSH host allowlist', who: 'mara', at: '1d' }
];

const DIFF: { kind: ' ' | '+' | '-'; text: string }[] = [
  { kind: ' ', text: 'const fingerprint = hash(key);' },
  { kind: '-', text: 'return true;' },
  { kind: '+', text: 'const pinned = await pins.get(host);' },
  { kind: '+', text: 'if (!pinned) return pins.save(host, fingerprint);' },
  { kind: '+', text: 'return pinned === fingerprint;' }
];

function GitScene({ t }: { t: number }) {
  const shown = COMMITS.length - Math.max(0, 3 - Math.floor(t / 500));
  return (
    <div>
      <SceneHeader
        title='feat/ssh-terminal'
        chip='3 ahead of main'
        right={
          <span className='hidden items-center gap-1.5 rounded-md border border-white/10 px-2 py-1 text-[11px] text-zinc-300 sm:inline-flex'>
            <Icons.gitPullRequest className='size-3.5 text-[#b6f23a]' /> Merge request !42
          </span>
        }
      />
      <div className='grid gap-4 sm:grid-cols-[1fr_1.15fr]'>
        <ol className='relative space-y-1 before:absolute before:top-3 before:bottom-3 before:left-[11px] before:w-px before:bg-white/10'>
          {COMMITS.slice(COMMITS.length - shown).map((commit, index) => (
            <li
              key={commit.sha}
              className={cn(
                'relative flex items-center gap-3 rounded-md px-1 py-1.5',
                index === 0 && 'animate-in fade-in slide-in-from-top-2 duration-300'
              )}
            >
              <span
                className={cn(
                  'z-10 size-[9px] shrink-0 translate-x-[6px] rounded-full border-2 border-[#0f0f10]',
                  index === 0 ? 'bg-[#b6f23a]' : 'bg-zinc-500'
                )}
              />
              <div className='ml-2 min-w-0 flex-1'>
                <p className='truncate text-[13px] text-zinc-200'>{commit.message}</p>
                <p className='font-mono text-[10px] text-zinc-500'>
                  {commit.sha} · {commit.who} · {commit.at}
                </p>
              </div>
            </li>
          ))}
        </ol>
        <div className='hidden overflow-hidden rounded-lg border border-white/[0.06] bg-[#0b0b0c] sm:block'>
          <div className='flex items-center justify-between border-b border-white/[0.06] px-3 py-2 font-mono text-[11px] text-zinc-400'>
            src/lib/ssh/host-keys.ts
            <span>
              <span className='text-[#b6f23a]'>+3</span> <span className='text-red-400'>−1</span>
            </span>
          </div>
          <div className='py-1.5 font-mono text-[11px] leading-6'>
            {DIFF.map((line, index) =>
              t >= 1800 + index * 280 ? (
                <div
                  key={line.text}
                  className={cn(
                    'animate-in fade-in flex gap-3 px-3 duration-300',
                    line.kind === '+' && 'bg-[#b6f23a]/[0.07] text-[#d5f78f]',
                    line.kind === '-' && 'bg-red-500/[0.08] text-red-300',
                    line.kind === ' ' && 'text-zinc-400'
                  )}
                >
                  <span className='w-2 text-zinc-600'>{line.kind}</span>
                  <span className='truncate'>{line.text}</span>
                </div>
              ) : null
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Database: a query is typed, run, and the rows come back.                 */
/* ------------------------------------------------------------------------ */

const QUERY = 'SELECT name, role, last_seen FROM users ORDER BY last_seen DESC LIMIT 4;';
const QUERY_DONE = 300 + (QUERY.length * 1000) / 34;

const ROWS = [
  ['Mara Santos', 'owner', '2 min ago'],
  ['Jo Reyes', 'member', '18 min ago'],
  ['Ali Cruz', 'member', '1 h ago'],
  ['Sam Lee', 'admin', '3 h ago']
];

function DatabaseScene({ t }: { t: number }) {
  const ran = t >= QUERY_DONE + 500;
  return (
    <div className='flex h-full gap-4'>
      <div className='hidden w-36 shrink-0 sm:block'>
        <p className='mb-2 font-mono text-[10px] tracking-wider text-zinc-500 uppercase'>app_db</p>
        {['users', 'projects', 'issues', 'sessions', 'audit_events'].map((table) => (
          <div
            key={table}
            className={cn(
              'flex items-center gap-2 rounded-md px-2 py-1.5 font-mono text-[12px] text-zinc-400',
              table === 'users' && 'bg-white/[0.06] text-zinc-100'
            )}
          >
            <Icons.table className='size-3.5 text-zinc-500' />
            {table}
          </div>
        ))}
      </div>
      <div className='min-w-0 flex-1'>
        <div className='rounded-lg border border-white/[0.06] bg-[#0b0b0c] p-3'>
          <div className='mb-2 flex items-center justify-between'>
            <span className='font-mono text-[10px] text-zinc-500'>query.sql</span>
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
                ran ? 'bg-[#b6f23a] text-[#0a0a0a]' : 'bg-white/[0.06] text-zinc-300'
              )}
            >
              <Icons.run className='size-3' /> Run
            </span>
          </div>
          <p className='min-h-10 font-mono text-[12px] leading-5 break-words text-zinc-200'>
            {typed(QUERY, t, 300, 34)}
            {!ran && <Caret />}
          </p>
        </div>
        <div className='mt-3 overflow-hidden rounded-lg border border-white/[0.06]'>
          <div className='grid grid-cols-3 border-b border-white/[0.06] bg-white/[0.03] px-3 py-2 font-mono text-[10px] text-zinc-500'>
            <span>name</span>
            <span>role</span>
            <span>last_seen</span>
          </div>
          {ROWS.map((row, index) =>
            t >= QUERY_DONE + 800 + index * 180 ? (
              <div
                key={row[0]}
                className='animate-in fade-in slide-in-from-top-1 grid grid-cols-3 border-b border-white/[0.04] px-3 py-2 text-[12px] text-zinc-300 duration-300 last:border-0'
              >
                <span className='truncate'>{row[0]}</span>
                <span className='font-mono text-[11px] text-zinc-400'>{row[1]}</span>
                <span className='truncate text-zinc-500'>{row[2]}</span>
              </div>
            ) : null
          )}
        </div>
        <Appear at={QUERY_DONE + 1600} t={t} className='mt-2 font-mono text-[10px] text-zinc-500'>
          4 rows · 12 ms
        </Appear>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* API client: a request goes out and the response comes back.              */
/* ------------------------------------------------------------------------ */

const API_URL = 'https://api.devone.local/v1/issues';
const RESPONSE = [
  '{',
  '  "id": "DEV-52",',
  '  "title": "Add dark mode to docs",',
  '  "status": "todo",',
  '  "priority": "medium"',
  '}'
];

function ApiScene({ t }: { t: number }) {
  const sentAt = 300 + (API_URL.length * 1000) / 30 + 400;
  const sending = t >= sentAt && t < sentAt + 700;
  const answered = t >= sentAt + 700;
  return (
    <div className='flex h-full gap-4'>
      <div className='hidden w-36 shrink-0 sm:block'>
        <p className='mb-2 font-mono text-[10px] tracking-wider text-zinc-500 uppercase'>
          Issues API
        </p>
        {[
          ['GET', 'List issues'],
          ['POST', 'Create issue'],
          ['PATCH', 'Move issue'],
          ['DEL', 'Delete issue']
        ].map(([method, name]) => (
          <div
            key={name}
            className={cn(
              'flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-zinc-400',
              name === 'Create issue' && 'bg-white/[0.06] text-zinc-100'
            )}
          >
            <span className='w-9 font-mono text-[9px] font-semibold text-[#b6f23a]'>{method}</span>
            {name}
          </div>
        ))}
      </div>
      <div className='min-w-0 flex-1'>
        <div className='flex items-center gap-2'>
          <div className='flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-white/10 bg-[#0b0b0c] px-3 font-mono text-[12px]'>
            <span className='font-semibold text-[#b6f23a]'>POST</span>
            <span className='truncate text-zinc-200'>
              {typed(API_URL, t, 300, 30)}
              {t < sentAt && <Caret />}
            </span>
          </div>
          <span
            className={cn(
              'inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[12px] font-medium transition-all',
              sending ? 'scale-95 bg-[#c8f76a] text-[#0a0a0a]' : 'bg-[#b6f23a] text-[#0a0a0a]'
            )}
          >
            {sending ? (
              <Icons.spinner className='size-3.5 animate-spin' />
            ) : (
              <Icons.send className='size-3.5' />
            )}
            Send
          </span>
        </div>
        <div className='mt-3 grid gap-3 sm:grid-cols-2'>
          <div className='hidden rounded-lg border border-white/[0.06] bg-[#0b0b0c] p-3 font-mono text-[11px] leading-5 text-zinc-400 sm:block'>
            <p className='mb-1 text-[10px] text-zinc-600'>Body</p>
            {'{'}
            <br />
            &nbsp;&nbsp;&quot;title&quot;:{' '}
            <span className='text-[#d5f78f]'>&quot;Add dark mode to docs&quot;</span>
            <br />
            {'}'}
          </div>
          <div className='rounded-lg border border-white/[0.06] bg-[#0b0b0c] p-3 font-mono text-[11px] leading-5'>
            <div className='mb-1 flex items-center justify-between text-[10px]'>
              <span className='text-zinc-600'>Response</span>
              {answered && (
                <span className='animate-in fade-in text-[#b6f23a] duration-300'>
                  201 Created · 84 ms
                </span>
              )}
            </div>
            {answered ? (
              RESPONSE.map((line, index) =>
                t >= sentAt + 700 + index * 120 ? (
                  <div
                    key={line}
                    className='animate-in fade-in whitespace-pre text-zinc-300 duration-200'
                  >
                    {line}
                  </div>
                ) : null
              )
            ) : (
              <p className='text-zinc-600'>
                {sending ? 'Sending…' : 'Send a request to see the response.'}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Docs: a page writes itself.                                              */
/* ------------------------------------------------------------------------ */

const DOC_TITLE = 'Deploying DevOne';
const DOC_BODY =
  'DevOne runs as a single Docker Compose stack. Copy the example environment, generate an encryption key and start it.';

function DocsScene({ t }: { t: number }) {
  const bodyStart = 300 + (DOC_TITLE.length * 1000) / 22 + 200;
  const bodyEnd = bodyStart + (DOC_BODY.length * 1000) / 60;
  return (
    <div className='flex h-full gap-4'>
      <div className='hidden w-36 shrink-0 sm:block'>
        <p className='mb-2 font-mono text-[10px] tracking-wider text-zinc-500 uppercase'>Docs</p>
        {['Getting started', 'Architecture', 'Deploying DevOne', 'Runbooks', 'Changelog'].map(
          (page) => (
            <div
              key={page}
              className={cn(
                'flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-zinc-400',
                page === 'Deploying DevOne' && 'bg-white/[0.06] text-zinc-100'
              )}
            >
              <Icons.post className='size-3.5 text-zinc-500' />
              <span className='truncate'>{page}</span>
            </div>
          )
        )}
      </div>
      <div className='min-w-0 flex-1 px-1 sm:px-4'>
        <h3 className='text-xl font-semibold tracking-tight text-zinc-100'>
          {typed(DOC_TITLE, t, 300, 22)}
          {t < bodyStart && <Caret />}
        </h3>
        <p className='mt-1 text-[11px] text-zinc-500'>Edited by you · just now</p>
        <p className='mt-4 text-[13px] leading-relaxed text-zinc-300'>
          {typed(DOC_BODY, t, bodyStart, 60)}
          {t >= bodyStart && t < bodyEnd && <Caret />}
        </p>
        <Appear at={bodyEnd + 200} t={t}>
          <pre className='mt-4 rounded-lg border border-white/[0.06] bg-[#0b0b0c] p-3 font-mono text-[11px] leading-5 text-zinc-300'>
            <span className='text-[#b6f23a]'>$</span> docker compose up -d
          </pre>
        </Appear>
        <div className='mt-4 space-y-2'>
          {['Set DEVONE_ENCRYPTION_KEY', 'Run the migrations', 'Invite your team'].map(
            (item, index) => {
              const at = bodyEnd + 600 + index * 350;
              if (t < at) return null;
              const done = t >= at + 250;
              return (
                <div
                  key={item}
                  className='animate-in fade-in flex items-center gap-2 text-[12px] text-zinc-300 duration-300'
                >
                  {done ? (
                    <Icons.statusDoneFilled className='size-4 text-[#b6f23a]' />
                  ) : (
                    <Icons.statusTodo className='size-4 text-zinc-500' />
                  )}
                  <span className={cn(done && 'text-zinc-500 line-through')}>{item}</span>
                </div>
              );
            }
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Drawings: an architecture diagram draws itself.                          */
/* ------------------------------------------------------------------------ */

const NODES = [
  { id: 'browser', label: 'Browser', x: 20, y: 110, at: 200 },
  { id: 'app', label: 'DevOne app', x: 220, y: 110, at: 700, accent: true },
  { id: 'postgres', label: 'PostgreSQL', x: 430, y: 40, at: 1200 },
  { id: 'redis', label: 'Redis', x: 430, y: 180, at: 1500 }
];

const EDGES = [
  { from: [140, 132], to: [220, 132], at: 900, label: 'HTTPS' },
  { from: [340, 122], to: [430, 62], at: 1700, label: 'SQL' },
  { from: [340, 142], to: [430, 202], at: 2000, label: 'cache' }
];

function DrawingsScene({ t }: { t: number }) {
  return (
    <div className='flex h-full gap-3'>
      <div className='hidden shrink-0 flex-col gap-1 rounded-lg border border-white/[0.06] bg-[#0b0b0c] p-1 sm:flex'>
        {(['drawing', 'diagram', 'text', 'link'] as IconName[]).map((name, index) => {
          const Icon = Icons[name];
          return (
            <span
              key={name}
              className={cn(
                'flex size-7 items-center justify-center rounded-md text-zinc-500',
                index === 1 && 'bg-white/[0.07] text-zinc-100'
              )}
            >
              <Icon className='size-3.5' />
            </span>
          );
        })}
      </div>
      <div
        className='relative min-w-0 flex-1 overflow-hidden rounded-lg border border-white/[0.06]'
        style={{
          backgroundImage: 'radial-gradient(rgb(255 255 255 / 0.08) 1px, transparent 1px)',
          backgroundSize: '16px 16px'
        }}
      >
        <svg viewBox='0 0 560 260' className='h-full w-full'>
          <defs>
            <marker
              id='demo-arrow'
              viewBox='0 0 10 10'
              refX='9'
              refY='5'
              markerWidth='7'
              markerHeight='7'
              orient='auto-start-reverse'
            >
              <path d='M0 0L10 5L0 10z' fill='#71717a' />
            </marker>
          </defs>
          {EDGES.map((edge) => {
            const length = Math.hypot(edge.to[0] - edge.from[0], edge.to[1] - edge.from[1]);
            const progress = Math.min(1, Math.max(0, (t - edge.at) / 500));
            if (progress === 0) return null;
            return (
              <g key={edge.label}>
                <line
                  x1={edge.from[0]}
                  y1={edge.from[1]}
                  x2={edge.to[0]}
                  y2={edge.to[1]}
                  stroke='#71717a'
                  strokeWidth='1.5'
                  strokeDasharray={length}
                  strokeDashoffset={length * (1 - progress)}
                  markerEnd={progress === 1 ? 'url(#demo-arrow)' : undefined}
                />
                {progress === 1 && (
                  <text
                    x={(edge.from[0] + edge.to[0]) / 2}
                    y={(edge.from[1] + edge.to[1]) / 2 - 8}
                    textAnchor='middle'
                    fill='#a1a1aa'
                    fontSize='11'
                    fontFamily='var(--font-mono), monospace'
                  >
                    {edge.label}
                  </text>
                )}
              </g>
            );
          })}
          {NODES.map((node) =>
            t >= node.at ? (
              <g key={node.id} className='animate-in fade-in zoom-in-95 duration-300'>
                <rect
                  x={node.x}
                  y={node.y}
                  width='120'
                  height='44'
                  rx='10'
                  fill={node.accent ? '#b6f23a' : '#18181b'}
                  stroke={node.accent ? '#b6f23a' : '#3f3f46'}
                />
                <text
                  x={node.x + 60}
                  y={node.y + 27}
                  textAnchor='middle'
                  fill={node.accent ? '#0a0a0a' : '#e4e4e7'}
                  fontSize='13'
                  fontWeight={node.accent ? 600 : 400}
                >
                  {node.label}
                </text>
              </g>
            ) : null
          )}
        </svg>
        {t >= 2700 && (
          <span className='animate-in fade-in absolute right-3 bottom-3 rounded-md bg-white/[0.06] px-2 py-1 font-mono text-[10px] text-zinc-400 duration-300'>
            Saved · 3 people viewing
          </span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Pipelines: a merge request's jobs go green while the log streams.        */
/* ------------------------------------------------------------------------ */

const STAGES = [
  {
    name: 'build',
    jobs: [
      { name: 'install', start: 200, end: 1100 },
      { name: 'compile', start: 1100, end: 2200 }
    ]
  },
  {
    name: 'test',
    jobs: [
      { name: 'unit', start: 2200, end: 3400 },
      { name: 'lint', start: 2200, end: 3000 }
    ]
  },
  { name: 'deploy', jobs: [{ name: 'staging', start: 3400, end: 4600 }] }
];

const LOG = [
  { at: 300, text: '$ bun install --frozen-lockfile' },
  { at: 900, text: '✓ 812 packages installed' },
  { at: 1300, text: '$ bun run build' },
  { at: 2100, text: '✓ Compiled in 41s' },
  { at: 2400, text: '$ bun run test' },
  { at: 3300, text: '✓ 214 passed' },
  { at: 3600, text: '$ deploy --env staging' },
  { at: 4500, text: '✓ Live at staging.devone.local' }
];

function jobState(job: { start: number; end: number }, t: number) {
  if (t >= job.end) return 'passed';
  if (t >= job.start) return 'running';
  return 'pending';
}

function PipelineScene({ t }: { t: number }) {
  const passed = t >= 4600;
  return (
    <div>
      <SceneHeader
        title='!42 Add SSH terminal'
        chip='feat/ssh-terminal → main'
        right={
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium',
              passed ? 'bg-[#b6f23a]/15 text-[#b6f23a]' : 'bg-amber-400/15 text-amber-300'
            )}
          >
            {passed ? (
              <Icons.statusDoneFilled className='size-3.5' />
            ) : (
              <Icons.spinner className='size-3.5 animate-spin' />
            )}
            {passed ? 'Passed' : 'Running'}
          </span>
        }
      />
      <div className='flex items-start gap-2 sm:gap-6'>
        {STAGES.map((stage) => (
          <div key={stage.name} className='min-w-0 flex-1'>
            <p className='mb-2 font-mono text-[10px] tracking-wider text-zinc-500 uppercase'>
              {stage.name}
            </p>
            <div className='space-y-1.5'>
              {stage.jobs.map((job) => {
                const state = jobState(job, t);
                return (
                  <div
                    key={job.name}
                    className={cn(
                      'flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-[12px] transition-colors',
                      state === 'running'
                        ? 'border-amber-400/30 text-zinc-100'
                        : 'border-white/[0.06] text-zinc-400'
                    )}
                  >
                    {state === 'passed' && (
                      <Icons.statusDoneFilled className='size-3.5 shrink-0 text-[#b6f23a]' />
                    )}
                    {state === 'running' && (
                      <Icons.spinner className='size-3.5 shrink-0 animate-spin text-amber-300' />
                    )}
                    {state === 'pending' && (
                      <Icons.statusTodo className='size-3.5 shrink-0 text-zinc-600' />
                    )}
                    <span className='truncate'>{job.name}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className='mt-4 h-[132px] overflow-hidden rounded-lg border border-white/[0.06] bg-[#0b0b0c] px-3 py-2 font-mono text-[11px] leading-5'>
        {LOG.filter((line) => t >= line.at)
          .slice(-6)
          .map((line) => (
            <div
              key={line.text}
              className={cn(
                'animate-in fade-in truncate duration-200',
                line.text.startsWith('✓') ? 'text-[#b6f23a]' : 'text-zinc-300'
              )}
            >
              {line.text}
            </div>
          ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Terminal: an SSH session connects and runs a command.                    */
/* ------------------------------------------------------------------------ */

const SSH_COMMAND = 'ssh deploy@prod-1.devone.local';
const PS_COMMAND = 'docker compose ps';

function TerminalScene({ t }: { t: number }) {
  const sshDone = 300 + (SSH_COMMAND.length * 1000) / 26;
  const psStart = sshDone + 1500;
  const psDone = psStart + (PS_COMMAND.length * 1000) / 22;
  const prompt = (
    <>
      <span className='text-[#b6f23a]'>deploy@prod-1</span>
      <span className='text-zinc-500'>:~$ </span>
    </>
  );
  return (
    <div className='flex h-full flex-col overflow-hidden rounded-lg border border-white/[0.06] bg-[#0b0b0c]'>
      <div className='flex items-center gap-2 border-b border-white/[0.06] px-3 py-2 text-[11px]'>
        <span className='flex items-center gap-1.5 rounded-md bg-white/[0.06] px-2 py-0.5 text-zinc-200'>
          <span
            className={cn(
              'size-1.5 rounded-full',
              t >= sshDone + 900 ? 'bg-[#b6f23a]' : 'bg-zinc-500'
            )}
          />
          prod-1
        </span>
        <span className='text-zinc-600'>staging-db</span>
        <span className='ml-auto font-mono text-[10px] text-zinc-600'>saved credentials</span>
      </div>
      <div className='flex-1 px-3 py-2.5 font-mono text-[12px] leading-6 text-zinc-300'>
        <div>
          <span className='text-zinc-500'>$ </span>
          {typed(SSH_COMMAND, t, 300, 26)}
          {t < sshDone && <Caret />}
        </div>
        {t >= sshDone + 400 && (
          <div className='animate-in fade-in text-zinc-500 duration-200'>
            Host key SHA256:x9Fq…2kLw matches the pinned key{' '}
            <span className='text-[#b6f23a]'>✓</span>
          </div>
        )}
        {t >= sshDone + 900 && (
          <div className='animate-in fade-in duration-200'>Connected to prod-1 (Ubuntu 24.04)</div>
        )}
        {t >= psStart && (
          <div>
            {prompt}
            {typed(PS_COMMAND, t, psStart, 22)}
            {t < psDone && <Caret />}
          </div>
        )}
        {t >= psDone + 300 && (
          <div className='animate-in fade-in text-zinc-400 duration-300'>
            <div className='text-zinc-600'>NAME&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;STATUS</div>
            <div>devone&nbsp;&nbsp;&nbsp;&nbsp;Up 3 days (healthy)</div>
            <div>postgres&nbsp;&nbsp;Up 3 days (healthy)</div>
            <div>redis&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Up 3 days</div>
          </div>
        )}
        {t >= psDone + 700 && (
          <div>
            {prompt}
            <Caret />
          </div>
        )}
      </div>
    </div>
  );
}
