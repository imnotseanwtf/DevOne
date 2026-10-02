import type { DatabaseEnvironmentName } from '@/lib/database/types';

/** Shared by the server page and the client dialog, so it can't live in either. */
export const ENVIRONMENT_LABELS: Record<DatabaseEnvironmentName, string> = {
  LOCAL: 'Local',
  DEVELOPMENT: 'Development',
  STAGING: 'Staging',
  PRODUCTION: 'Production'
};

/** Mirrors the Prisma `ResourceKind` enum; `check-core` keeps them in step. */
export const RESOURCE_KINDS = ['API', 'APP', 'GIT_TAG', 'DOCKER_IMAGE', 'NOTE'] as const;

/** The kinds a shared (project) resource can be; personal ones are always notes. */
export const PROJECT_RESOURCE_KINDS = ['API', 'APP', 'GIT_TAG', 'DOCKER_IMAGE'] as const;
export type ResourceKindName = (typeof RESOURCE_KINDS)[number];

export const RESOURCE_KIND_LABELS: Record<ResourceKindName, { label: string; hint: string }> = {
  API: {
    label: 'API endpoint',
    hint: 'A running API: URL, host, build and branch. It shows up in the API page.'
  },
  APP: { label: 'App (URL only)', hint: 'A deployed app, recorded as just its link.' },
  GIT_TAG: {
    label: 'GitHub tags',
    hint: 'Release tags of a repository; the card lists the latest ones.'
  },
  DOCKER_IMAGE: {
    label: 'Docker image',
    hint: 'A container image and the tag this environment runs.'
  },
  NOTE: {
    label: 'Note',
    hint: 'Your own private notes: any fields and accounts, like tokens and logins.'
  }
};
