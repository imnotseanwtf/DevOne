'use server';

import { requireUser } from '@/lib/auth/session';
import { DEMO_DISABLED_MESSAGE, isDemoMode } from '@/lib/demo';
import { listConnections, listProviders, getRouterSettings } from '../service';
import type { AiGatewayAdminData } from './types';

export async function getGatewayAdmin(): Promise<AiGatewayAdminData> {
  const user = await requireUser();
  if (isDemoMode()) throw new Error(DEMO_DISABLED_MESSAGE);
  const [providers, connections, settings] = await Promise.all([
    listProviders(user.id),
    listConnections(user.id),
    getRouterSettings(user.id)
  ]);
  return { providers, connections, settings };
}
