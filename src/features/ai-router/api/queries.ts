import { queryOptions } from '@tanstack/react-query';
import { getGatewayAdmin, getGatewayEndpoint } from './service';
import { completeOAuthConnection } from './oauth/service';

export const aiGatewayKeys = {
  all: ['ai-gateway'] as const,
  admin: (userId: string) => ['ai-gateway', 'admin', userId] as const,
  endpoint: (userId: string) => ['ai-gateway', 'endpoint', userId] as const
};

export function gatewayAdminQueryOptions(userId: string) {
  return queryOptions({
    queryKey: aiGatewayKeys.admin(userId),
    queryFn: getGatewayAdmin
  });
}

export function gatewayEndpointQueryOptions(userId: string) {
  return queryOptions({
    queryKey: aiGatewayKeys.endpoint(userId),
    queryFn: getGatewayEndpoint
  });
}

export function oauthConnectionPollOptions(state: string, intervalMs = 5000) {
  return queryOptions({
    queryKey: ['ai-oauth', state],
    queryFn: async () => {
      const result = await completeOAuthConnection({ state });
      if (!result.ok) throw new Error(result.error);
      return result;
    },
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchInterval: (query) =>
      query.state.error || query.state.data?.connected ? false : Math.max(5000, intervalMs)
  });
}
