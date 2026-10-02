import DashboardShell from '@/components/layout/dashboard-shell';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Projects',
  description: 'DevOne project workspace',
  robots: {
    index: false,
    follow: false
  }
};

export default async function ProjectsLayout({ children }: { children: React.ReactNode }) {
  return <DashboardShell>{children}</DashboardShell>;
}
