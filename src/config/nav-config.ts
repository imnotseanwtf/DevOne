import { DEVONE_SECTIONS } from '@/config/devone-sections';
import type { NavGroup } from '@/types';
export const navGroups: NavGroup[] = [
  {
    label: 'Workspace',
    items: [
      {
        title: 'Dashboard',
        url: '/dashboard/overview',
        icon: 'dashboard',
        isActive: false,
        shortcut: ['d', 'd'],
        items: []
      },
      // ERD lives as a tab inside Database now, so it has no nav entry of its own.
      ...DEVONE_SECTIONS.filter((section) => !['docs', 'erd'].includes(section.slug)).map(
        (section) => ({
          title: section.title,
          url: `/dashboard/${section.slug}`,
          icon: section.icon,
          isActive: false,
          // Docs and Drawings are tabs of the Board, so Board stays highlighted on them.
          activeFor: section.slug === 'issues' ? ['/dashboard/docs', '/dashboard/drawings'] : [],
          items: []
        })
      )
    ]
  }
];
