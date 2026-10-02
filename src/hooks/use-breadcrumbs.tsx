'use client';

import { useT } from '@/i18n/client';
import { usePathname } from 'next/navigation';
import { useMemo } from 'react';

export function useBreadcrumbs(projects: { id: string; name: string }[]) {
  const pathname = usePathname();
  const t = useT();

  const breadcrumbs = useMemo(() => {
    if (pathname === '/dashboard' || pathname === '/dashboard/overview') {
      return [{ title: t('nav.dashboard'), link: pathname }];
    }

    // If no exact match, fall back to generating breadcrumbs from the path
    const segments = pathname.split('/').filter(Boolean);
    return segments.map((segment, index) => {
      const path = `/${segments.slice(0, index + 1).join('/')}`;
      const project =
        segments[0] === 'projects' && index === 1
          ? projects.find((entry) => entry.id === segment)
          : undefined;
      const title =
        project?.name ??
        t.maybe(`nav.${segment}`) ??
        segment.charAt(0).toUpperCase() + segment.slice(1);
      return {
        title,
        link: path
      };
    });
  }, [pathname, projects, t]);

  return breadcrumbs;
}
