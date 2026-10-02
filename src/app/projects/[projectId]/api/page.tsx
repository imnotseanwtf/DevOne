import PageContainer from '@/components/layout/page-container';
import { ApiClient } from '@/features/platform/components/api-client';
import { listCollections, listEnvironments, listHistory } from '@/features/platform/service';
import { listProjectsForUser } from '@/features/projects/service';
import {
  parseStoredAuth,
  type ApiBodyType,
  type ApiMethod,
  type ApiRequestDraft
} from '@/lib/api-client/types';
import { requireUser } from '@/lib/auth/session';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

export const metadata: Metadata = { title: 'API' };

interface ApiPageProps {
  params: Promise<{ projectId: string }>;
}

interface StoredRequest {
  method: string;
  url: string;
  headersJson: unknown;
  body: string | null;
  bodyType: string;
  authJson: unknown;
  pathParamsJson: unknown;
}

/** Keeps only the string entries of a stored JSON object. */
function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  );
}

/** Turns a stored row into an editor draft, tolerating older rows' loose JSON. */
function toDraft(row: StoredRequest): ApiRequestDraft {
  const headers = stringRecord(row.headersJson);

  return {
    method: row.method as ApiMethod,
    url: row.url,
    headers,
    body: row.body ?? '',
    bodyType: row.bodyType as ApiBodyType,
    auth: parseStoredAuth(row.authJson),
    pathParams: stringRecord(row.pathParamsJson)
  };
}

export default async function ApiPage({ params }: ApiPageProps) {
  const user = await requireUser();
  const { projectId } = await params;

  const projects = await listProjectsForUser(user.id);
  const activeProject = projects.find((entry) => entry.id === projectId);
  if (!activeProject) notFound();

  const [environments, collections, history] = await Promise.all([
    listEnvironments(user.id, activeProject.id),
    listCollections(user.id, activeProject.id),
    listHistory(user.id, activeProject.id)
  ]);

  return (
    <PageContainer
      pageTitle='API'
      pageDescription='Organize, save and test requests against your endpoints, or any other API.'
    >
      <ApiClient
        projectId={activeProject.id}
        environments={environments}
        collections={collections.map((collection) => ({
          id: collection.id,
          name: collection.name,
          requests: collection.requests.map((request) => ({
            id: request.id,
            collectionId: collection.id,
            folder: request.folder,
            name: request.name,
            draft: toDraft(request)
          }))
        }))}
        history={history.map((entry) => ({
          id: entry.id,
          status: entry.status,
          durationMs: entry.durationMs,
          createdAt: entry.createdAt.toISOString(),
          draft: toDraft(entry)
        }))}
      />
    </PageContainer>
  );
}
