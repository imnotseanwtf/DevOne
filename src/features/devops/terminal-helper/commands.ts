export interface HelperCommand {
  /** Typed into the terminal as written; <angle brackets> mark what to fill in. */
  command: string;
  description: string;
  /** Extra words the search matches on. */
  tags?: string;
  /** Changes or deletes things that can't be undone. */
  risky?: boolean;
}

export interface HelperGroup {
  id: string;
  title: string;
  commands: HelperCommand[];
}

/** A hand-picked cheat sheet in the spirit of tldr pages: the commands people reach for on a server. */
export const HELPER_GROUPS: HelperGroup[] = [
  {
    id: 'docker',
    title: 'Docker',
    commands: [
      { command: 'docker ps', description: 'Running containers', tags: 'list containers' },
      { command: 'docker ps -a', description: 'All containers, including stopped' },
      {
        command: 'docker logs -f --tail 100 <container>',
        description: 'Follow a container’s logs'
      },
      {
        command: 'docker exec -it <container> sh',
        description: 'Open a shell in a container',
        tags: 'bash enter'
      },
      { command: 'docker stats --no-stream', description: 'CPU and memory use right now' },
      { command: 'docker restart <container>', description: 'Restart a container' },
      { command: 'docker images', description: 'Downloaded images' },
      { command: 'docker compose up -d', description: 'Start the stack in the background' },
      {
        command: 'docker compose logs -f <service>',
        description: 'Follow a compose service’s logs'
      },
      {
        command: 'docker compose pull && docker compose up -d',
        description: 'Update to the latest images'
      },
      { command: 'docker system df', description: 'Disk used by Docker', tags: 'space size' },
      {
        command: 'docker system prune',
        description: 'Remove stopped containers, unused networks and dangling images',
        tags: 'clean space',
        risky: true
      }
    ]
  },
  {
    id: 'system',
    title: 'System',
    commands: [
      { command: 'df -h', description: 'Disk space per filesystem', tags: 'storage full' },
      {
        command: 'du -sh * | sort -h',
        description: 'Size of everything here, smallest first',
        tags: 'big folders space'
      },
      { command: 'free -h', description: 'Memory and swap', tags: 'ram' },
      { command: 'top', description: 'Live processes (q to quit)', tags: 'cpu htop' },
      { command: 'ps aux | grep <name>', description: 'Find a process by name' },
      { command: 'uptime', description: 'How long it has been up, and the load' },
      { command: 'uname -a', description: 'Kernel and OS details' },
      { command: 'cat /etc/os-release', description: 'Which distribution this is' },
      { command: 'kill <pid>', description: 'Ask a process to stop', risky: true }
    ]
  },
  {
    id: 'services',
    title: 'Services & logs',
    commands: [
      { command: 'systemctl status <service>', description: 'Is a service running?' },
      {
        command: 'sudo systemctl restart <service>',
        description: 'Restart a service',
        risky: true
      },
      { command: 'systemctl list-units --failed', description: 'Services that failed' },
      {
        command: 'journalctl -u <service> -f',
        description: 'Follow a service’s logs',
        tags: 'tail'
      },
      {
        command: 'journalctl -u <service> --since "1 hour ago"',
        description: 'A service’s recent logs'
      },
      { command: 'journalctl -p err -b', description: 'Errors since the last boot' }
    ]
  },
  {
    id: 'files',
    title: 'Files',
    commands: [
      { command: 'ls -lah', description: 'List files with sizes and hidden files' },
      { command: 'tail -f <file>', description: 'Watch a file grow', tags: 'log follow' },
      { command: 'less +F <file>', description: 'Follow a file, Ctrl+C to scroll back' },
      {
        command: 'grep -rn "<text>" .',
        description: 'Search for text in every file here',
        tags: 'find'
      },
      { command: 'find . -name "<pattern>"', description: 'Find files by name' },
      { command: 'find . -size +100M', description: 'Files over 100 MB', tags: 'big large' },
      { command: 'tar -czf <name>.tar.gz <folder>', description: 'Compress a folder' },
      { command: 'tar -xzf <name>.tar.gz', description: 'Unpack a .tar.gz' },
      { command: 'chmod +x <file>', description: 'Make a file executable' },
      {
        command: 'rm -rf <folder>',
        description: 'Delete a folder and everything in it',
        risky: true
      }
    ]
  },
  {
    id: 'network',
    title: 'Network',
    commands: [
      {
        command: 'ss -tulpn',
        description: 'What is listening on which port',
        tags: 'ports netstat'
      },
      { command: 'curl -I <url>', description: 'Just the response headers' },
      { command: 'curl -s <url> | head', description: 'Fetch a page quietly' },
      { command: 'ping -c 4 <host>', description: 'Is a host reachable?' },
      { command: 'dig +short <domain>', description: 'Where a domain points', tags: 'dns' },
      { command: 'ip a', description: 'Network interfaces and addresses', tags: 'ifconfig' },
      { command: 'curl -s ifconfig.me', description: 'This server’s public IP' }
    ]
  },
  {
    id: 'git',
    title: 'Git',
    commands: [
      { command: 'git status -sb', description: 'Short status with branch' },
      { command: 'git log --oneline -10', description: 'Last ten commits' },
      { command: 'git pull --ff-only', description: 'Update without making a merge commit' },
      { command: 'git diff', description: 'Unstaged changes' },
      { command: 'git stash', description: 'Set changes aside' },
      {
        command: 'git checkout -- <file>',
        description: 'Throw away changes to a file',
        risky: true
      }
    ]
  }
];

/** Matches every word of the query against the command, its description and its tags. */
export function searchCommands(query: string): HelperGroup[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return HELPER_GROUPS;
  return HELPER_GROUPS.map((group) => ({
    ...group,
    commands: group.commands.filter((entry) => {
      const haystack =
        `${entry.command} ${entry.description} ${entry.tags ?? ''} ${group.title}`.toLowerCase();
      return words.every((word) => haystack.includes(word));
    })
  })).filter((group) => group.commands.length > 0);
}
