import {
  type ContainerInfo,
  dockerFailure,
  LIST_CONTAINERS_COMMAND,
  listLocalContainers,
  parseContainers
} from '@/lib/docker/containers';
import { execOnClient } from '@/lib/ssh/connection';
import type { SshSession } from '@/lib/ssh/session-store';

/**
 * The containers on the machine a terminal is open on, asked over that
 * terminal's own connection: it works for a server that was never saved, and
 * needs no extra login. The session was authorised when it was opened.
 */
export async function listSessionContainers(session: SshSession): Promise<ContainerInfo[]> {
  if (session.shell.local) return listLocalContainers();
  const result = await execOnClient(
    session.shell.client,
    `${LIST_CONTAINERS_COMMAND} 2>&1`,
    10_000
  );
  if (result.code !== 0) throw dockerFailure(result.stdout + result.stderr, result.code);
  return parseContainers(result.stdout);
}
