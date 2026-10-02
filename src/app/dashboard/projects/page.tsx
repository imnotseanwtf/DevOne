import { redirect } from 'next/navigation';

/** Legacy route: project management lives at `/projects` now. */
export default function OldProjectsPage() {
  redirect('/projects');
}
