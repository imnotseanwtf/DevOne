import PageContainer from '@/components/layout/page-container';

/** Shown straight away while another project (or one of its modules) loads. */
export default function ProjectLoading() {
  return <PageContainer isLoading>{null}</PageContainer>;
}
