import { Icons } from '@/components/icons';
import PageContainer from '@/components/layout/page-container';
import { Badge } from '@/components/ui/badge';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty';
import {
  getRepositoryBranches,
  getRepositoryCommits,
  getRepositoryPipelines,
  getRepositoryTags,
  listConnectionsForUser,
  listProviderRepositories,
  listProjectRepositories
} from '@/features/git/service';
import { listProjectsForUser } from '@/features/projects/service';
import { DeleteResourceButton } from '@/features/resources/components/delete-resource-button';
import {
  ResourceDialog,
  type ResourceRepositoryOption
} from '@/features/resources/components/resource-dialog';
import { CopyButton } from '@/features/resources/components/copy-button';
import { ResourceAccounts } from '@/features/resources/components/resource-accounts';
import { ResourceVariables } from '@/features/resources/components/resource-variables';
import { ENVIRONMENT_LABELS, RESOURCE_KIND_LABELS } from '@/features/resources/labels';
import { listResources, type ProjectResourceView } from '@/features/resources/service';
import { requireUser } from '@/lib/auth/session';
import type { GitCommit, GitPipeline } from '@/lib/git/provider';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

export const metadata: Metadata = { title: 'Resources' };

const dateFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' });

const GOOD = new Set(['success', 'completed', 'passed']);
const BAD = new Set(['failure', 'failed', 'canceled', 'cancelled', 'timed_out']);

function statusVariant(status: string): 'secondary' | 'destructive' | 'outline' {
  const value = status.toLowerCase();
  if (GOOD.has(value)) return 'secondary';
  if (BAD.has(value)) return 'destructive';
  return 'outline';
}

/** `v*`-style glob to a matcher; `*` is any run of characters, `?` any one. */
function globMatcher(pattern: string | null): (name: string) => boolean {
  if (!pattern) return () => true;
  const source = pattern
    .split('')
    .map((char) =>
      char === '*' ? '.*' : char === '?' ? '.' : char.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    )
    .join('');
  const regex = new RegExp(`^${source}$`, 'i');
  return (name) => regex.test(name);
}

/** Where to view an image: Docker Hub for bare names, else the registry host itself. */
function registryPage(image: string): string {
  const [first, ...rest] = image.split('/');
  const hasHost = rest.length > 0 && (first.includes('.') || first.includes(':'));
  if (hasHost) return `https://${image}`;
  // Official images (a bare name like "nginx") live under /_/ on Docker Hub.
  return rest.length > 0
    ? `https://hub.docker.com/r/${image}`
    : `https://hub.docker.com/_/${image}`;
}

type RepositoryTag = Awaited<ReturnType<typeof getRepositoryTags>>[number];

/**
 * Every repository the person's connected accounts can read that isn't in the
 * project yet, so a resource can point at any of them. Branches load on pick.
 */
async function accountRepositories(
  userId: string,
  inProject: Set<string>
): Promise<ResourceRepositoryOption[]> {
  const connections = await listConnectionsForUser(userId);
  const lists = await Promise.all(
    connections.map(async (connection) =>
      (await listProviderRepositories(userId, connection.id).catch(() => []))
        .filter((repository) => !inProject.has(repository.fullName))
        .map((repository) => ({
          id: `link:${connection.id}:${repository.providerRepositoryId}`,
          fullName: repository.fullName,
          defaultBranch: repository.defaultBranch,
          branches: null,
          link: {
            connectionId: connection.id,
            providerRepositoryId: repository.providerRepositoryId
          }
        }))
    )
  );
  return lists.flat().toSorted((a, b) => a.fullName.localeCompare(b.fullName));
}

/** What is deployed from a resource's branch, read live from the git provider. */
interface Deployment {
  commit: GitCommit | null;
  pipeline: GitPipeline | null;
  error: boolean;
}

interface ResourcesPageProps {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ResourcesPage({ params, searchParams }: ResourcesPageProps) {
  const user = await requireUser();
  const { projectId } = await params;
  // "Only me" lists the person's own personal resources; the default is the shared ones.
  const mine = (await searchParams).view === 'mine';

  const projects = await listProjectsForUser(user.id);
  const activeProject = projects.find((entry) => entry.id === projectId);
  if (!activeProject) notFound();

  const [listed, repositories] = await Promise.all([
    listResources(user.id, activeProject.id),
    listProjectRepositories(user.id, activeProject.id)
  ]);
  const personalCount = listed.filter((resource) => resource.personal).length;
  const resources = listed.filter((resource) => resource.personal === mine);

  // Pipelines are listed per repository, so each repository is asked once.
  const pipelinesByRepository = new Map<string, Promise<GitPipeline[] | null>>();
  const pipelinesFor = (repositoryId: string) => {
    let pipelines = pipelinesByRepository.get(repositoryId);
    if (!pipelines) {
      pipelines = getRepositoryPipelines(user.id, repositoryId).catch(() => null);
      pipelinesByRepository.set(repositoryId, pipelines);
    }
    return pipelines;
  };

  const deployments = new Map(
    await Promise.all(
      resources.map(async (resource): Promise<[string, Deployment | null]> => {
        const branch = resource.branch ?? resource.repository?.defaultBranch;
        if (resource.kind !== 'API' || !resource.repositoryId || !branch) {
          return [resource.id, null];
        }
        const [commits, pipelines] = await Promise.all([
          getRepositoryCommits(user.id, resource.repositoryId, branch).catch(() => null),
          pipelinesFor(resource.repositoryId)
        ]);
        return [
          resource.id,
          {
            commit: commits?.[0] ?? null,
            pipeline: pipelines?.find((run) => run.ref === branch) ?? null,
            error: commits === null
          }
        ];
      })
    )
  );

  // A "GitHub tags" resource shows its repository's latest matching tags.
  const tagsByResource = new Map(
    await Promise.all(
      resources
        .filter((resource) => resource.kind === 'GIT_TAG' && resource.repositoryId)
        .map(async (resource): Promise<[string, RepositoryTag[] | null]> => {
          const tags = await getRepositoryTags(user.id, resource.repositoryId!).catch(() => null);
          const matches = globMatcher(resource.tagPattern);
          return [resource.id, tags?.filter((tag) => matches(tag.name)).slice(0, 5) ?? null];
        })
    )
  );

  const [projectRepositoryOptions, accountRepositoryOptions] = await Promise.all([
    Promise.all(
      repositories.map(
        async ({ id, fullName, defaultBranch }): Promise<ResourceRepositoryOption> => ({
          id,
          fullName,
          defaultBranch,
          branches: await getRepositoryBranches(user.id, id)
            .then((branches) => branches.map((branch) => branch.name))
            .catch(() => null)
        })
      )
    ),
    accountRepositories(user.id, new Set(repositories.map((entry) => entry.fullName)))
  ]);
  const repositoryOptions = [...projectRepositoryOptions, ...accountRepositoryOptions];

  const base = `/projects/${activeProject.id}/resources`;

  return (
    <PageContainer
      pageTitle='Resources'
      pageDescription='Each environment of the app: URLs, builds, keys, accounts and credentials. Databases and the API client use them.'
      pageHeaderAction={
        resources.length > 0 ? (
          <ResourceDialog
            key={mine ? 'mine' : 'project'}
            projectId={activeProject.id}
            repositories={repositoryOptions}
            personal={mine}
          />
        ) : undefined
      }
    >
      <nav aria-label='Resource scope' className='mb-4 flex gap-5 border-b'>
        <Link
          href={base}
          aria-current={mine ? undefined : 'page'}
          className='text-muted-foreground hover:text-foreground aria-[current=page]:border-foreground aria-[current=page]:text-foreground -mb-px border-b-2 border-transparent px-1 pb-2 text-sm font-medium'
        >
          Project
        </Link>
        <Link
          href={`${base}?view=mine`}
          aria-current={mine ? 'page' : undefined}
          className='text-muted-foreground hover:text-foreground aria-[current=page]:border-foreground aria-[current=page]:text-foreground -mb-px inline-flex items-center gap-1.5 border-b-2 border-transparent px-1 pb-2 text-sm font-medium'
        >
          <Icons.lock className='size-3.5' />
          Only me
          {personalCount > 0 && (
            <span className='text-muted-foreground text-xs'>{personalCount}</span>
          )}
        </Link>
      </nav>

      {resources.length === 0 ? (
        <Empty className='bg-card min-h-96 border'>
          <EmptyHeader>
            <EmptyMedia variant='icon'>
              {mine ? <Icons.lock aria-hidden='true' /> : <Icons.server aria-hidden='true' />}
            </EmptyMedia>
            <EmptyTitle>{mine ? 'No notes yet' : 'No resources yet'}</EmptyTitle>
            <EmptyDescription>
              {mine
                ? 'Keep your own tokens, keys, logins and notes here. Nobody else in the project can see them.'
                : `Add each environment of ${activeProject.name}, such as Staging or Production: its URL, build, keys and accounts.`}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <ResourceDialog
              key={mine ? 'mine' : 'project'}
              projectId={activeProject.id}
              repositories={repositoryOptions}
              personal={mine}
              variant='default'
            />
          </EmptyContent>
        </Empty>
      ) : (
        <div className='grid items-start gap-4 xl:grid-cols-2'>
          {resources.map((resource) => (
            <ResourceCard
              key={resource.id}
              projectId={activeProject.id}
              resource={resource}
              repositories={repositoryOptions}
              deployment={deployments.get(resource.id) ?? null}
              tags={tagsByResource.get(resource.id)}
            />
          ))}
        </div>
      )}
    </PageContainer>
  );
}

function ResourceCard({
  projectId,
  resource,
  repositories,
  deployment,
  tags
}: {
  projectId: string;
  resource: ProjectResourceView;
  repositories: ResourceRepositoryOption[];
  deployment: Deployment | null;
  /** GIT_TAG only; null when the provider couldn't be reached. */
  tags?: RepositoryTag[] | null;
}) {
  const branch = resource.branch ?? resource.repository?.defaultBranch ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex flex-wrap items-center gap-2'>
          {resource.name}
          {resource.kind !== 'NOTE' && (
            <>
              <Badge variant={resource.environment === 'PRODUCTION' ? 'destructive' : 'outline'}>
                {ENVIRONMENT_LABELS[resource.environment]}
              </Badge>
              <Badge variant='secondary'>{RESOURCE_KIND_LABELS[resource.kind].label}</Badge>
            </>
          )}
          {resource.personal && (
            <Badge variant='outline' className='gap-1'>
              <Icons.lock className='size-3' /> Only me
            </Badge>
          )}
        </CardTitle>
        <CardAction className='flex gap-1'>
          <ResourceDialog projectId={projectId} repositories={repositories} resource={resource} />
          <DeleteResourceButton resourceId={resource.id} resourceName={resource.name} />
        </CardAction>
      </CardHeader>
      <CardContent className='space-y-4 text-sm'>
        {(resource.kind === 'API' || resource.kind === 'APP') &&
          (resource.url ? (
            <a
              href={resource.url}
              target='_blank'
              rel='noreferrer noopener'
              className='text-primary inline-flex max-w-full items-center gap-1.5 font-medium break-all hover:underline'
            >
              {resource.url}
              <Icons.externalLink className='size-3.5 shrink-0' />
            </a>
          ) : (
            <p className='text-muted-foreground'>No URL yet.</p>
          ))}

        {resource.kind === 'API' && (
          <dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5'>
            <Detail label='Hosted on' value={resource.hostedOn} />
            <Detail label='Built by' value={resource.builtBy} />
            <dt className='text-muted-foreground'>Deploys from</dt>
            <dd className='min-w-0 break-words'>
              {resource.repository ? (
                <span className='inline-flex flex-wrap items-center gap-1.5'>
                  <Link
                    href={`/projects/${projectId}/git?repo=${resource.repository.id}`}
                    className='hover:underline'
                  >
                    {resource.repository.fullName}
                  </Link>
                  {branch && (
                    <code className='bg-muted inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs'>
                      <Icons.gitBranch className='size-3' />
                      {branch}
                    </code>
                  )}
                </span>
              ) : resource.branch ? (
                <code className='text-xs'>{resource.branch}</code>
              ) : (
                <span className='text-muted-foreground'>—</span>
              )}
            </dd>
            {deployment && <DeploymentDetails deployment={deployment} />}
          </dl>
        )}

        {resource.kind === 'GIT_TAG' && (
          <GitTags projectId={projectId} resource={resource} tags={tags} />
        )}

        {resource.kind === 'DOCKER_IMAGE' && resource.image && (
          <DockerImage image={resource.image} tag={resource.imageTag} />
        )}

        {resource.kind === 'NOTE' ? (
          <>
            <ResourceVariables
              resourceId={resource.id}
              resourceName={resource.name}
              variables={resource.variables}
              mode='fields'
            />
            <ResourceAccounts resourceId={resource.id} accounts={resource.accounts} />
          </>
        ) : (
          <>
            <ResourceAccounts resourceId={resource.id} accounts={resource.accounts} />
            <ResourceVariables
              resourceId={resource.id}
              resourceName={resource.name}
              variables={resource.variables}
            />
          </>
        )}

        {resource.headers.length > 0 && (
          <div className='space-y-2'>
            <h4 className='text-muted-foreground text-xs font-medium tracking-wide uppercase'>
              API headers
            </h4>
            <p className='flex flex-wrap gap-1.5'>
              {resource.headers.map((header) => (
                <code key={header.id} className='bg-muted rounded px-1.5 py-0.5 text-xs'>
                  {header.name}
                </code>
              ))}
            </p>
            <p className='text-muted-foreground text-xs'>
              Sent with every request in the{' '}
              <Link href={`/projects/${projectId}/api`} className='underline'>
                API
              </Link>{' '}
              client while this environment is selected.
            </p>
          </div>
        )}

        {(resource.kind === 'API' || resource.kind === 'APP') && (
          <div className='space-y-2'>
            <h4 className='text-muted-foreground text-xs font-medium tracking-wide uppercase'>
              Databases
            </h4>
            {resource.databases.length === 0 ? (
              <p className='text-muted-foreground text-xs'>
                None yet. Pick this resource when adding or editing a connection in{' '}
                <Link href={`/projects/${projectId}/database`} className='underline'>
                  Database
                </Link>
                .
              </p>
            ) : (
              <ul className='flex flex-wrap gap-2'>
                {resource.databases.map((database) => (
                  <li key={database.id}>
                    <Link
                      href={`/projects/${projectId}/database?connection=${database.id}`}
                      className='bg-muted hover:bg-muted/70 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs'
                    >
                      <Icons.database className='size-3.5' />
                      {database.name}
                      {database.databaseName && (
                        <span className='text-muted-foreground'>· {database.databaseName}</span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {resource.notes && (
          <p className='text-muted-foreground border-t pt-3 whitespace-pre-wrap'>
            {resource.notes}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function GitTags({
  projectId,
  resource,
  tags
}: {
  projectId: string;
  resource: ProjectResourceView;
  tags: RepositoryTag[] | null | undefined;
}) {
  if (!resource.repository) {
    return <p className='text-muted-foreground'>Pick a repository to list its tags.</p>;
  }

  return (
    <div className='space-y-2'>
      <p className='flex flex-wrap items-center gap-1.5'>
        <Link
          href={`/projects/${projectId}/git?repo=${resource.repository.id}`}
          className='font-medium hover:underline'
        >
          {resource.repository.fullName}
        </Link>
        {resource.tagPattern && (
          <code className='bg-muted rounded px-1.5 py-0.5 text-xs'>{resource.tagPattern}</code>
        )}
      </p>
      {tags === null || tags === undefined ? (
        <p className='text-muted-foreground text-xs'>Could not read the tags.</p>
      ) : tags.length === 0 ? (
        <p className='text-muted-foreground text-xs'>No matching tags yet.</p>
      ) : (
        <ul className='divide-border divide-y rounded-md border'>
          {tags.map((tag, index) => (
            <li key={tag.name} className='flex items-center gap-2 px-3 py-1.5'>
              <Icons.gitCommit className='text-muted-foreground size-3.5 shrink-0' />
              <a
                href={tag.webUrl}
                target='_blank'
                rel='noreferrer noopener'
                className='font-medium hover:underline'
              >
                {tag.name}
              </a>
              {index === 0 && <Badge variant='secondary'>Latest</Badge>}
              <code className='text-muted-foreground ml-auto text-xs'>{tag.sha.slice(0, 7)}</code>
              {tag.committedAt && (
                <span className='text-muted-foreground text-xs'>
                  {dateFormat.format(tag.committedAt)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DockerImage({ image, tag }: { image: string; tag: string | null }) {
  const reference = `${image}:${tag || 'latest'}`;
  const pull = `docker pull ${reference}`;

  return (
    <div className='space-y-2'>
      <a
        href={registryPage(image)}
        target='_blank'
        rel='noreferrer noopener'
        className='text-primary inline-flex max-w-full items-center gap-1.5 font-medium break-all hover:underline'
      >
        {reference}
        <Icons.externalLink className='size-3.5 shrink-0' />
      </a>
      <div className='bg-muted flex items-center gap-2 rounded-md py-1 pr-1 pl-3'>
        <code className='min-w-0 flex-1 truncate text-xs'>{pull}</code>
        <CopyButton text={pull} label='the pull command' />
      </div>
    </div>
  );
}

function DeploymentDetails({ deployment }: { deployment: Deployment }) {
  if (deployment.error) {
    return (
      <>
        <dt className='text-muted-foreground'>Latest commit</dt>
        <dd className='text-muted-foreground'>Could not read the branch</dd>
      </>
    );
  }

  return (
    <>
      <dt className='text-muted-foreground'>Latest commit</dt>
      <dd className='min-w-0'>
        {deployment.commit ? (
          <span className='flex min-w-0 items-center gap-2'>
            <code className='text-xs'>{deployment.commit.sha.slice(0, 7)}</code>
            <span className='truncate'>{deployment.commit.message.split('\n')[0]}</span>
          </span>
        ) : (
          <span className='text-muted-foreground'>—</span>
        )}
      </dd>
      <dt className='text-muted-foreground'>Pipeline</dt>
      <dd className='min-w-0'>
        {deployment.pipeline ? (
          <a
            href={deployment.pipeline.webUrl}
            target='_blank'
            rel='noreferrer noopener'
            className='inline-flex items-center gap-2 hover:underline'
          >
            <Badge variant={statusVariant(deployment.pipeline.status)}>
              {deployment.pipeline.status}
            </Badge>
            <span className='text-muted-foreground text-xs'>
              {dateFormat.format(deployment.pipeline.createdAt)}
            </span>
          </a>
        ) : (
          <span className='text-muted-foreground'>No runs on this branch</span>
        )}
      </dd>
    </>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <>
      <dt className='text-muted-foreground'>{label}</dt>
      <dd className='min-w-0 break-words'>
        {value || <span className='text-muted-foreground'>—</span>}
      </dd>
    </>
  );
}
