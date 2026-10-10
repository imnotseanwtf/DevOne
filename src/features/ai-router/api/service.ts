'use server';

import { requireUser } from '@/lib/auth/session';
import { DEMO_DISABLED_MESSAGE, isDemoMode } from '@/lib/demo';
import {
  listConnections,
  listProviders,
  getRouterSettings,
  listCombos,
  listApiKeys,
  loadRouterState
} from '../service';
import { routerEndpoint } from '../endpoint';
import { listModelIds } from '@/lib/ai-router/routing';
import type { AiGatewayAdminData, AiGatewayEndpointData } from './types';

export async function getGatewayAdmin(): Promise<AiGatewayAdminData> {
  const user = await requireUser();
  if (isDemoMode()) throw new Error(DEMO_DISABLED_MESSAGE);
  const [providers, connections, settings, combos] = await Promise.all([
    listProviders(user.id),
    listConnections(user.id),
    getRouterSettings(user.id),
    listCombos(user.id)
  ]);
  return { providers, connections, settings, combos };
}

export async function getGatewayEndpoint(): Promise<AiGatewayEndpointData> {
  const user = await requireUser();
  if (isDemoMode()) throw new Error(DEMO_DISABLED_MESSAGE);
  const [keys, state, endpoint] = await Promise.all([
    listApiKeys(user.id),
    loadRouterState(),
    routerEndpoint()
  ]);
  return { keys, endpoint, models: listModelIds(state.providers, state.combos) };
}
