import { redirect } from 'next/navigation';

interface RedirectProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Legacy route: forwards `?project=` bookmarks to the project-scoped URL. */
export default async function OldErdPage({ searchParams }: RedirectProps) {
  const params = await searchParams;
  const project = params.project;
  const id = Array.isArray(project) ? project[0] : project;
  redirect(id ? `/projects/${id}/erd` : '/projects');
}
