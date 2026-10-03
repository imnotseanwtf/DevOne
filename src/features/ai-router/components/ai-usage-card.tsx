import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import type { AiUsageOverview } from '@/features/ai-router/service';
import { getLocale, getT } from '@/i18n/server';

export async function AiUsageCard({ usage }: { usage: AiUsageOverview }) {
  const t = await getT();
  const locale = await getLocale();
  const number = new Intl.NumberFormat(locale);
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('aiRouter.usage.title')}</CardTitle>
        <CardDescription>{t('aiRouter.usage.description')}</CardDescription>
      </CardHeader>
      <CardContent className='space-y-6'>
        {usage.recent.length === 0 ? (
          <p className='text-muted-foreground text-sm'>{t('aiRouter.usage.empty')}</p>
        ) : (
          <>
            {usage.byProvider.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('aiRouter.usage.provider')}</TableHead>
                    <TableHead className='text-right'>{t('aiRouter.usage.requests')}</TableHead>
                    <TableHead className='text-right'>{t('aiRouter.usage.failures')}</TableHead>
                    <TableHead className='text-right'>{t('aiRouter.usage.tokens')}</TableHead>
                    <TableHead className='text-right'>{t('aiRouter.usage.latency')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {usage.byProvider.map((row) => (
                    <TableRow key={row.providerName ?? ''}>
                      <TableCell>{row.providerName ?? t('aiRouter.usage.noProvider')}</TableCell>
                      <TableCell className='text-right'>{number.format(row.requests)}</TableCell>
                      <TableCell className='text-right'>{number.format(row.failures)}</TableCell>
                      <TableCell className='text-right'>
                        {number.format(row.promptTokens)} / {number.format(row.completionTokens)}
                      </TableCell>
                      <TableCell className='text-right'>
                        {(row.averageLatencyMs / 1000).toFixed(1)} s
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('aiRouter.usage.when')}</TableHead>
                  <TableHead>{t('aiRouter.usage.who')}</TableHead>
                  <TableHead>{t('aiRouter.usage.model')}</TableHead>
                  <TableHead>{t('aiRouter.usage.provider')}</TableHead>
                  <TableHead className='text-right'>{t('aiRouter.usage.tries')}</TableHead>
                  <TableHead>{t('aiRouter.usage.status')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {usage.recent.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className='whitespace-nowrap'>
                      {dateFormat.format(row.createdAt)}
                    </TableCell>
                    <TableCell>{row.user ? `@${row.user.username}` : '—'}</TableCell>
                    <TableCell>
                      <code className='text-xs'>{row.requestedModel}</code>
                      {row.model && row.model !== row.requestedModel && (
                        <span className='text-muted-foreground text-xs'> → {row.model}</span>
                      )}
                    </TableCell>
                    <TableCell>{row.providerName ?? t('aiRouter.usage.noProvider')}</TableCell>
                    <TableCell className='text-right'>{row.attempts}</TableCell>
                    <TableCell>
                      <Badge
                        variant={row.status < 400 ? 'secondary' : 'destructive'}
                        title={row.error ?? undefined}
                      >
                        {row.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </CardContent>
    </Card>
  );
}
