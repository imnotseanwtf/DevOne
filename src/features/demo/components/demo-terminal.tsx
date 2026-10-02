'use client';

import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DEMO_SERVERS, FakeShell, type DemoServer } from '@/features/demo/fake-shell';
import { useXterm } from '@/features/devops/components/use-xterm';
import { useT } from '@/i18n/client';
import { cn } from '@/lib/utils';
import { useEffect, useRef, useState } from 'react';

/**
 * The terminal page in the public demo: sample servers that open a simulated
 * shell. Everything runs in the browser; nothing connects anywhere.
 */
export function DemoTerminalWorkspace({ fontSize }: { fontSize?: number }) {
  const t = useT();
  const [active, setActive] = useState<DemoServer | null>(null);
  // A new key each connect, so reconnecting starts a fresh shell.
  const [connection, setConnection] = useState(0);

  const open = (server: DemoServer) => {
    setActive(server);
    setConnection((value) => value + 1);
  };

  return (
    <div className='grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]'>
      <Card className='h-fit'>
        <CardHeader>
          <CardTitle className='text-base'>{t('devops.terminal.savedServers')}</CardTitle>
        </CardHeader>
        <CardContent className='space-y-2'>
          <p className='text-muted-foreground text-sm'>{t('demo.terminal.hint')}</p>
          <ul className='space-y-1'>
            {DEMO_SERVERS.map((server) => (
              <li key={server.id}>
                <Button
                  variant='ghost'
                  className={cn(
                    'h-auto w-full justify-start px-2 py-1.5 text-left',
                    active?.id === server.id && 'bg-accent'
                  )}
                  onClick={() => open(server)}
                >
                  <Icons.server className='text-muted-foreground' />
                  <span className='min-w-0'>
                    <span className='block truncate text-sm font-medium'>{server.name}</span>
                    <span className='text-muted-foreground block truncate text-xs'>
                      {server.user}@{server.host}
                    </span>
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <div className='min-w-0 space-y-2'>
        {active ? (
          <>
            <div className='text-muted-foreground flex flex-wrap items-center gap-2 text-xs'>
              <Icons.lock className='size-3.5' />
              <span className='text-foreground font-medium'>
                {active.user}@{active.host}
              </span>
              <span className='truncate font-mono'>{active.fingerprint}</span>
              <Badge variant='secondary'>{t('demo.terminal.simulated')}</Badge>
              <Button
                variant='ghost'
                size='sm'
                className='ml-auto h-7'
                onClick={() => setActive(null)}
              >
                {t('demo.terminal.disconnect')}
              </Button>
            </div>
            <DemoTerminal key={`${active.id}-${connection}`} server={active} fontSize={fontSize} />
          </>
        ) : (
          <div className='text-muted-foreground flex h-[65vh] min-h-80 flex-col items-center justify-center gap-2 rounded-md border border-dashed text-sm'>
            <Icons.terminal className='size-6' />
            {t('demo.terminal.pick')}
          </div>
        )}
      </div>
    </div>
  );
}

function DemoTerminal({ server, fontSize }: { server: DemoServer; fontSize?: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminal = useXterm(containerRef, { fontSize });

  useEffect(() => {
    if (!terminal) return;
    const shell = new FakeShell(server);
    terminal.write(shell.start());
    terminal.focus();
    const input = terminal.onData((data) => {
      terminal.write(shell.input(data));
      if (shell.exited) {
        terminal.write('\r\n\x1b[2m[Connection closed]\x1b[0m\r\n\x1b[?25l');
        terminal.options.disableStdin = true;
      }
    });
    return () => input.dispose();
  }, [terminal, server]);

  return (
    <div className='h-[65vh] min-h-80 overflow-hidden rounded-md bg-[#0a0a0a] p-2'>
      <div ref={containerRef} className='size-full' />
    </div>
  );
}
