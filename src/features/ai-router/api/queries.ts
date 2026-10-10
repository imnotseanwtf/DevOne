import { queryOptions } from '@tanstack/react-query';
import { getGatewayAdmin } from './service';

export const aiGatewayKeys = {
  all: ['ai-gateway'] as const,
  admin: (userId: string) => ['ai-gateway', 'admin', userId] as const
};

export function gatewayAdminQueryOptions(userId: string) {
  return queryOptions({
    queryKey: aiGatewayKeys.admin(userId),
    queryFn: getGatewayAdmin
  });
}
