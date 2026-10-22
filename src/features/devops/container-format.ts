/**
 * An image name that fits a table cell. Containers made from an image that was
 * since replaced show a bare digest ("sha256:6f30057d…"), and Coolify-style names
 * carry a 40-character commit hash as the tag: both are cut to a readable length.
 */
export function shortImage(image: string): string {
  if (image.startsWith('sha256:')) return `${image.slice(0, 19)}…`;
  const at = image.lastIndexOf(':');
  const tag = at >= 0 ? image.slice(at + 1) : '';
  return /^[a-f0-9]{20,}$/.test(tag) ? `${image.slice(0, at)}:${tag.slice(0, 12)}…` : image;
}

export interface PortMapping {
  /** What is shown: "8000:8080", "8080" or "443:443/udp". */
  label: string;
  /** Reachable from outside the machine, not just exposed inside Docker. */
  published: boolean;
}

/**
 * `docker ps` prints each published port once per address family
 * ("0.0.0.0:8000->8080/tcp, [::]:8000->8080/tcp"); this folds those into one
 * entry and keeps "exposed only" ports (8080/tcp) apart from published ones.
 */
export function compactPorts(ports: string): PortMapping[] {
  const seen = new Map<string, PortMapping>();
  for (const raw of ports.split(',')) {
    const entry = raw.trim();
    if (!entry) continue;
    const published = /^(?:\[[^\]]*\]|[\d.]+|[\w:]*):(\d+(?:-\d+)?)->(\d+(?:-\d+)?)\/(\w+)$/.exec(
      entry
    );
    const mapping: PortMapping = published
      ? {
          label: `${published[1]}:${published[2]}${published[3] === 'tcp' ? '' : `/${published[3]}`}`,
          published: true
        }
      : { label: entry.replace(/\/tcp$/, ''), published: false };
    if (!seen.has(mapping.label)) seen.set(mapping.label, mapping);
  }
  return [...seen.values()];
}
