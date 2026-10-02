import { Icons } from '@/components/icons';
import PageContainer from '@/components/layout/page-container';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty';
import { DEVONE_SECTIONS, getDevOneSection } from '@/config/devone-sections';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

interface SectionPageProps {
  params: Promise<{ section: string }>;
}

export function generateStaticParams() {
  return DEVONE_SECTIONS.map(({ slug }) => ({ section: slug }));
}

export async function generateMetadata({ params }: SectionPageProps): Promise<Metadata> {
  const { section: slug } = await params;
  const section = getDevOneSection(slug);

  return section ? { title: section.title, description: section.description } : {};
}

export default async function SectionPage({ params }: SectionPageProps) {
  const { section: slug } = await params;
  const section = getDevOneSection(slug);

  if (!section) notFound();

  const Icon = Icons[section.icon];

  return (
    <PageContainer pageTitle={section.title} pageDescription={section.description}>
      <Empty className='bg-card min-h-96 border'>
        <EmptyHeader>
          <EmptyMedia variant='icon'>
            <Icon aria-hidden='true' />
          </EmptyMedia>
          <EmptyTitle>This Area Is Ready to Build</EmptyTitle>
          <EmptyDescription>
            This foundation includes the workspace shell. A future slice will add this area’s data
            and actions with its secure backend flow.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </PageContainer>
  );
}
