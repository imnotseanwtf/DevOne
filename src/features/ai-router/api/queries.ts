import { queryOptions } from '@tanstack/react-query';
import { getGatewayAdmin, getGatewayEndpoint } from './service';

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
