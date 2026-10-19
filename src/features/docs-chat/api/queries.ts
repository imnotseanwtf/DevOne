import { queryOptions } from '@tanstack/react-query';
import { getChatModels } from './service';

export const chatModelQueryOptions = queryOptions({
  queryKey: ['docs-chat', 'models'],
  queryFn: ({ signal }) => getChatModels(signal),
  staleTime: 60_000,
  retry: false
});
