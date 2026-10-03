/**
 * The desktop app installers on DevOne's latest GitHub Release, for the landing
 * page's download links. Built by .github/workflows/desktop.yml.
 */

export const RELEASES_URL = 'https://github.com/imnotseanwtf/devone/releases';
const LATEST_RELEASE_API = 'https://api.github.com/repos/imnotseanwtf/devone/releases/latest';

export const DESKTOP_PLATFORMS = ['mac', 'windows', 'debian', 'redhat'] as const;
export type DesktopPlatform = (typeof DESKTOP_PLATFORMS)[number];

const EXTENSIONS: Record<DesktopPlatform, string> = {
  mac: '.dmg',
  windows: '.exe',
  debian: '.deb',
  redhat: '.rpm'
};

export interface DesktopRelease {
  /** e.g. "1.1.0", or null when the release couldn't be read. */
  version: string | null;
  downloads: Record<DesktopPlatform, string>;
}

interface GitHubRelease {
  tag_name?: string;
  assets?: { name: string; browser_download_url: string }[];
}

/** Picks each platform's installer from a release; anything missing links to the release page. */
export function desktopDownloads(release: GitHubRelease | null): DesktopRelease {
  const fallback = `${RELEASES_URL}/latest`;
  const assets = release?.assets ?? [];
  const downloads = Object.fromEntries(
    DESKTOP_PLATFORMS.map((platform) => [
      platform,
      assets.find((asset) => asset.name.endsWith(EXTENSIONS[platform]))?.browser_download_url ??
        fallback
    ])
  ) as Record<DesktopPlatform, string>;
  return { version: release?.tag_name?.replace(/^v/, '') ?? null, downloads };
}

/** Reads the latest release, cached for an hour; never throws, so the page always renders. */
export async function getDesktopRelease(): Promise<DesktopRelease> {
  try {
    const response = await fetch(LATEST_RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json' },
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(3000)
    });
    if (!response.ok) return desktopDownloads(null);
    return desktopDownloads((await response.json()) as GitHubRelease);
  } catch {
    return desktopDownloads(null);
  }
}
