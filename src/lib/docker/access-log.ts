/** One request through the reverse proxy, from Traefik's access log. */
export interface ProxyRequest {
  /** Milliseconds since the epoch. */
  time: number;
  method: string;
  /** The URI as requested, query string included. */
  path: string;
  status: number;
  durationMs: number;
  client: string;
  host: string;
  router: string;
  /** The backend that answered: ip:port. */
  backend: string;
}

interface JsonLine {
  ClientHost?: string;
  ClientAddr?: string;
  DownstreamStatus?: number;
  Duration?: number;
  RequestHost?: string;
  RequestMethod?: string;
  RequestPath?: string;
  RouterName?: string;
  ServiceAddr?: string;
  ServiceName?: string;
  StartUTC?: string;
  StartLocal?: string;
  time?: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "22/Oct/2026:03:00:00 +0000", the time in Common Log Format. */
function parseClfTime(text: string): number {
  const match = /^(\d+)\/(\w+)\/(\d+):(\d+):(\d+):(\d+) ([+-])(\d{2})(\d{2})$/.exec(text);
  if (!match) return 0;
  const [, day, month, year, hour, minute, second, sign, offsetHours, offsetMinutes] = match;
  const utc = Date.UTC(+year, MONTHS.indexOf(month), +day, +hour, +minute, +second);
  const offset = (+offsetHours * 60 + +offsetMinutes) * 60_000;
  return sign === '-' ? utc + offset : utc - offset;
}

// <client> - <user> [<time>] "<method> <path> <proto>" <status> <size> "<referer>" "<agent>" <n> "<router>" "<backend url>" <ms>ms
const CLF =
  /^(\S+) \S+ \S+ \[([^\]]+)\] "(\S+) (\S+) [^"]*" (\d{3}) \S+ "[^"]*" "[^"]*" \d+ "([^"]*)" "([^"]*)" (\d+)ms$/;

function hostOf(url: string): string {
  return url.replace(/^\w+:\/\//, '').replace(/\/.*$/, '');
}

/**
 * Reads one line of Traefik's access log, in either format it can write: JSON
 * (`--accesslog.format=json`) or the default Common Log Format. Anything else
 * (Traefik's own messages share the output) is null.
 */
export function parseAccessLogLine(line: string): ProxyRequest | null {
  const text = line.trim();
  if (text.startsWith('{')) {
    let row: JsonLine;
    try {
      row = JSON.parse(text) as JsonLine;
    } catch {
      return null;
    }
    // Traefik's own JSON log lines have a level and a message, not a router.
    if (row.RouterName === undefined && row.DownstreamStatus === undefined) return null;
    const stamp = Date.parse(row.StartUTC ?? row.StartLocal ?? row.time ?? '');
    return {
      time: Number.isNaN(stamp) ? 0 : stamp,
      method: row.RequestMethod ?? '',
      path: row.RequestPath ?? '',
      status: row.DownstreamStatus ?? 0,
      // Nanoseconds in JSON.
      durationMs: Math.round(((row.Duration ?? 0) / 1e6) * 100) / 100,
      client: row.ClientHost ?? row.ClientAddr?.replace(/:\d+$/, '') ?? '',
      host: row.RequestHost ?? '',
      router: row.RouterName ?? '',
      backend: row.ServiceAddr ?? ''
    };
  }

  const match = CLF.exec(text);
  if (!match) return null;
  const [, client, time, method, path, status, router, url, ms] = match;
  return {
    time: parseClfTime(time),
    method,
    path,
    status: Number(status),
    durationMs: Number(ms),
    client,
    host: '',
    router,
    backend: hostOf(url)
  };
}

/** What identifies one container's traffic in the proxy's log. */
export interface TrafficTarget {
  /** Router and service names from the container's Traefik labels, without the "@docker". */
  names: ReadonlySet<string>;
  /** The container's addresses on its networks: the proxy's backend is one of them. */
  ips: ReadonlySet<string>;
}

const ROUTER_LABEL = /^traefik\.(?:http|tcp)\.routers\.([^.]+)\./;
const SERVICE_LABEL = /^traefik\.(?:http|tcp)\.services\.([^.]+)\./;

export function trafficTarget(
  labels: readonly { key: string }[],
  networks: readonly { ip: string }[]
): TrafficTarget {
  const names = new Set<string>();
  for (const { key } of labels) {
    const name = ROUTER_LABEL.exec(key)?.[1] ?? SERVICE_LABEL.exec(key)?.[1];
    if (name) names.add(name);
  }
  return { names, ips: new Set(networks.map((network) => network.ip).filter(Boolean)) };
}

/** True when this request was routed to the container. */
export function isForTarget(request: ProxyRequest, target: TrafficTarget): boolean {
  if (request.backend && target.ips.has(request.backend.replace(/:\d+$/, ''))) return true;
  const router = request.router.replace(/@.*$/, '');
  return router !== '' && target.names.has(router);
}

/** Splits streamed text into lines; a partial line waits for the rest of it. */
export function createLineReader(onLine: (line: string) => void) {
  let pending = '';
  return (chunk: string) => {
    pending += chunk;
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) if (line.trim()) onLine(line);
  };
}
