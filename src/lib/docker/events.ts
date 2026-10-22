/** One thing that happened to a container, from `docker events`. */
export interface DockerEvent {
  /** Milliseconds since the epoch. */
  time: number;
  /** start, stop, die, kill, restart, oom, exec_start, health_status, … */
  action: string;
  /** What follows the action: the command for exec_*, "healthy" for health_status. */
  detail: string;
  /** Exit code, signal, new name and the like. */
  attributes: Record<string, string>;
}

interface EventJson {
  Action?: string;
  status?: string;
  time?: number;
  timeNano?: number;
  Actor?: { Attributes?: Record<string, string> };
}

/** `docker events --format '{{json .}}'` prints one JSON object per line. */
export function parseDockerEvent(line: string): DockerEvent | null {
  const start = line.indexOf('{');
  if (start < 0) return null;
  let row: EventJson;
  try {
    row = JSON.parse(line.slice(start)) as EventJson;
  } catch {
    return null;
  }
  const full = row.Action ?? row.status;
  if (!full) return null;
  // "exec_start: sh -c ls" and "health_status: healthy" carry their detail after a colon.
  const colon = full.indexOf(': ');
  const time = row.timeNano ? Math.floor(row.timeNano / 1e6) : (row.time ?? 0) * 1000;
  const attributes = { ...row.Actor?.Attributes };
  // The image and name repeat on every event; what is left is what is specific to this one.
  delete attributes.image;
  delete attributes.name;
  return {
    time,
    action: colon < 0 ? full : full.slice(0, colon),
    detail: colon < 0 ? '' : full.slice(colon + 2),
    attributes
  };
}
