/**
 * A pretend Linux shell for the public demo's terminal. It runs entirely in the
 * browser and never connects anywhere: it echoes keystrokes, keeps a little
 * history and answers the commands people usually try on a server.
 */

export interface DemoServer {
  id: string;
  name: string;
  host: string;
  user: string;
  hostname: string;
  role: 'web' | 'db' | 'ci';
  fingerprint: string;
}

export const DEMO_SERVERS: DemoServer[] = [
  {
    id: 'prod-web-1',
    name: 'Production web',
    host: '10.0.1.12',
    user: 'deploy',
    hostname: 'prod-web-1',
    role: 'web',
    fingerprint: 'SHA256:x9Fq7rTzKpW2mL8vB3nD5cH1sJ6aE4gY0uQ2kLw'
  },
  {
    id: 'staging-web',
    name: 'Staging web',
    host: '10.0.2.20',
    user: 'deploy',
    hostname: 'staging-web',
    role: 'web',
    fingerprint: 'SHA256:Pm3vT8qLr2Xc9WnZ4bK7yF1hD6sA5gE0uJ3oRt'
  },
  {
    id: 'db-1',
    name: 'Database server',
    host: '10.0.3.5',
    user: 'postgres',
    hostname: 'db-1',
    role: 'db',
    fingerprint: 'SHA256:Lq8nR2vT5mX1cZ9wB4kY7hF3dS6aG0eJ2uPo1N'
  }
];

const GREEN = '\x1b[1;32m';
const BLUE = '\x1b[1;34m';
const DIM = '\x1b[2m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

const NETWORK_OFF = `${YELLOW}Network access is turned off in the DevOne demo.${RESET}`;

const DIRECTORIES: Record<string, string[]> = {
  '~': ['app/', 'backups/', 'logs/', 'README.md', '.env'],
  '~/app': [
    'compose.yaml',
    'Dockerfile',
    'package.json',
    'prisma/',
    'public/',
    'src/',
    'README.md'
  ],
  '~/logs': ['access.log', 'error.log', 'deploy.log'],
  '~/backups': ['devone-2026-09-30.sql.gz', 'devone-2026-10-01.sql.gz']
};

const FILES: Record<string, string> = {
  'README.md':
    '# Acme web app\n\nDeployed with Docker Compose. Run `docker compose ps` to see the services,\n`docker compose logs -f web` to follow the logs.',
  '.env': `${RED}cat: .env: Permission denied${RESET} ${DIM}(nice try)${RESET}`,
  'compose.yaml':
    'services:\n  web:\n    image: ghcr.io/acme/web-app:1.8.2\n    ports: ["3000:3000"]\n  worker:\n    image: ghcr.io/acme/web-app:1.8.2\n    command: ["node", "worker.js"]\n  redis:\n    image: redis:8-alpine',
  'package.json':
    '{\n  "name": "acme-web-app",\n  "version": "1.8.2",\n  "scripts": { "build": "next build", "start": "next start" }\n}'
};

function line(text = ''): string {
  return `${text.replace(/\n/g, '\r\n')}\r\n`;
}

/** Output for one command line, given the server and current directory. */
export function runCommand(
  server: DemoServer,
  cwd: string,
  input: string,
  history: string[]
): { output: string; cwd: string; exit?: boolean; clear?: boolean } {
  const trimmed = input.trim();
  if (!trimmed) return { output: '', cwd };
  const [command, ...args] = trimmed.split(/\s+/);
  const rest = args.join(' ');

  switch (command) {
    case 'help':
      return {
        cwd,
        output: line(
          [
            `${DIM}This is a simulated server. Try:${RESET}`,
            '  ls, cd, pwd, cat README.md       files',
            '  uptime, df -h, free -h, top       system',
            '  docker ps, docker compose ps      containers',
            '  docker logs web                   app logs',
            '  systemctl status nginx            services',
            '  git log --oneline, git status     the deployed code',
            '  history, clear, exit'
          ].join('\n')
        )
      };
    case 'whoami':
      return { cwd, output: line(server.user) };
    case 'hostname':
      return { cwd, output: line(server.hostname) };
    case 'pwd':
      return { cwd, output: line(cwd.replace('~', `/home/${server.user}`)) };
    case 'uname':
      return {
        cwd,
        output: line(
          `Linux ${server.hostname} 6.8.0-45-generic #45-Ubuntu SMP x86_64 x86_64 x86_64 GNU/Linux`
        )
      };
    case 'date':
      return { cwd, output: line(new Date().toUTCString()) };
    case 'uptime':
      return {
        cwd,
        output: line(' 09:41:07 up 23 days,  4:12,  1 user,  load average: 0.21, 0.34, 0.29')
      };
    case 'ls': {
      const entries = DIRECTORIES[cwd] ?? [];
      const visible = args.some((arg) => arg.startsWith('-') && arg.includes('a'))
        ? ['./', '../', ...entries]
        : entries.filter((entry) => !entry.startsWith('.'));
      return {
        cwd,
        output: line(
          visible
            .map((entry) => (entry.endsWith('/') ? `${BLUE}${entry.slice(0, -1)}${RESET}` : entry))
            .join('  ')
        )
      };
    }
    case 'cd': {
      if (!rest || rest === '~') return { cwd: '~', output: '' };
      if (rest === '..') return { cwd: '~', output: '' };
      const target = rest.replace(/\/$/, '').replace(/^~\//, '');
      const next = `~/${target}`;
      if (DIRECTORIES[next]) return { cwd: next, output: '' };
      return { cwd, output: line(`bash: cd: ${rest}: No such file or directory`) };
    }
    case 'cat': {
      if (!rest) return { cwd, output: '' };
      const name = rest.split('/').pop() ?? rest;
      const text = FILES[name];
      return {
        cwd,
        output: line(text ?? `cat: ${rest}: No such file or directory`)
      };
    }
    case 'df':
      return {
        cwd,
        output: line(
          [
            'Filesystem      Size  Used Avail Use% Mounted on',
            '/dev/sda1        80G   31G   46G  41% /',
            'tmpfs           2.0G     0  2.0G   0% /dev/shm',
            '/dev/sdb1       200G   88G  103G  47% /var/lib/docker'
          ].join('\n')
        )
      };
    case 'free':
      return {
        cwd,
        output: line(
          [
            '               total        used        free      shared  buff/cache   available',
            'Mem:           7.8Gi       3.1Gi       1.2Gi       112Mi       3.5Gi       4.3Gi',
            'Swap:          2.0Gi          0B       2.0Gi'
          ].join('\n')
        )
      };
    case 'top':
    case 'htop':
      return {
        cwd,
        output: line(
          [
            `top - 09:41:07 up 23 days,  1 user,  load average: 0.21, 0.34, 0.29`,
            'Tasks: 142 total,   1 running, 141 sleeping',
            '%Cpu(s):  6.1 us,  1.2 sy,  0.0 ni, 92.4 id',
            '',
            '    PID USER      %CPU  %MEM COMMAND',
            server.role === 'db'
              ? '   1203 postgres   4.2   18.6 postgres'
              : '   2211 node       5.8   12.4 node server.js',
            '   1874 root       0.9    1.1 dockerd',
            '    911 root       0.3    0.4 nginx',
            `${DIM}(snapshot: the demo doesn't refresh)${RESET}`
          ].join('\n')
        )
      };
    case 'docker':
      return { cwd, output: line(docker(server, args)) };
    case 'systemctl':
      return {
        cwd,
        output: line(
          [
            `${GREEN}●${RESET} ${args[1] ?? 'nginx'}.service - ${args[1] ?? 'nginx'}`,
            `     Loaded: loaded (/lib/systemd/system/${args[1] ?? 'nginx'}.service; enabled)`,
            `     Active: ${GREEN}active (running)${RESET} since Mon 2026-09-08 05:29:11 UTC; 3 weeks 2 days ago`,
            '   Main PID: 911',
            '      Tasks: 3 (limit: 9373)',
            '     Memory: 14.2M'
          ].join('\n')
        )
      };
    case 'git':
      if (args[0] === 'log')
        return {
          cwd,
          output: line(
            [
              `${YELLOW}a1c9e2f${RESET} Pin host keys on first connect`,
              `${YELLOW}7be0d41${RESET} Stream job logs into the terminal`,
              `${YELLOW}3f8a6c0${RESET} Encrypt saved credentials`,
              `${YELLOW}e52b9d7${RESET} Add the SSH host allowlist`,
              `${YELLOW}9d01b3a${RESET} Release 1.8.2`
            ].join('\n')
          )
        };
      if (args[0] === 'status')
        return {
          cwd,
          output: line(
            "On branch main\nYour branch is up to date with 'origin/main'.\n\nnothing to commit, working tree clean"
          )
        };
      return { cwd, output: line(`git: '${args[0] ?? ''}' isn't available in the demo`) };
    case 'tail':
      return {
        cwd,
        output: line(
          [
            '203.0.113.7 - - [02/Oct/2026:09:40:58 +0000] "GET / HTTP/2.0" 200 5124',
            '203.0.113.7 - - [02/Oct/2026:09:40:59 +0000] "GET /projects HTTP/2.0" 200 18233',
            '198.51.100.4 - - [02/Oct/2026:09:41:02 +0000] "POST /api/orders HTTP/2.0" 201 412',
            '198.51.100.4 - - [02/Oct/2026:09:41:05 +0000] "GET /api/orders?limit=20 HTTP/2.0" 200 2981'
          ].join('\n')
        )
      };
    case 'echo':
      return { cwd, output: line(rest.replace(/^["']|["']$/g, '')) };
    case 'history':
      return {
        cwd,
        output: line(
          history.map((entry, index) => `  ${String(index + 1).padStart(3)}  ${entry}`).join('\n')
        )
      };
    case 'clear':
      return { cwd, output: '', clear: true };
    case 'exit':
    case 'logout':
      return { cwd, output: line('logout'), exit: true };
    case 'sudo':
      return {
        cwd,
        output: line(`${server.user} is not in the sudoers file. This incident will be reported.`)
      };
    case 'rm':
      return {
        cwd,
        output: line(`${YELLOW}Nothing here is real, but let's not.${RESET}`)
      };
    case 'ping':
    case 'curl':
    case 'wget':
    case 'ssh':
    case 'scp':
    case 'apt':
    case 'apt-get':
    case 'nc':
      return { cwd, output: line(NETWORK_OFF) };
    default:
      return { cwd, output: line(`bash: ${command}: command not found`) };
  }
}

function docker(server: DemoServer, args: string[]): string {
  const sub = args[0] === 'compose' ? `compose ${args[1] ?? ''}` : (args[0] ?? '');
  if (sub === 'ps' || sub === 'compose ps') {
    if (server.role === 'db') {
      return [
        'NAME        IMAGE               STATUS                 PORTS',
        'postgres    postgres:17-alpine  Up 23 days (healthy)   5432/tcp',
        'pgbouncer   bitnami/pgbouncer   Up 23 days             6432/tcp'
      ].join('\n');
    }
    return [
      'NAME     IMAGE                          STATUS                 PORTS',
      'web      ghcr.io/acme/web-app:1.8.2     Up 3 days (healthy)    0.0.0.0:3000->3000/tcp',
      'worker   ghcr.io/acme/web-app:1.8.2     Up 3 days              ',
      'redis    redis:8-alpine                 Up 23 days (healthy)   6379/tcp'
    ].join('\n');
  }
  if (args[0] === 'logs' || sub === 'compose logs') {
    return [
      `${DIM}web  |${RESET} ▲ Next.js 16 ready on http://0.0.0.0:3000`,
      `${DIM}web  |${RESET} GET /projects 200 in 41ms`,
      `${DIM}web  |${RESET} POST /api/orders 201 in 88ms`,
      `${DIM}web  |${RESET} GET /api/orders?limit=20 200 in 23ms`,
      `${DIM}web  |${RESET} ${GREEN}✓${RESET} job orders.sync finished in 1.2s`
    ].join('\n');
  }
  if (args[0] === 'images') {
    return [
      'REPOSITORY             TAG      SIZE',
      'ghcr.io/acme/web-app   1.8.2    412MB',
      'redis                  8-alpine 41MB'
    ].join('\n');
  }
  return `docker: '${args.join(' ')}' isn't available in the demo. Try docker ps or docker logs web.`;
}

/** The coloured prompt, e.g. deploy@prod-web-1:~$ */
export function prompt(server: DemoServer, cwd: string): string {
  return `${GREEN}${server.user}@${server.hostname}${RESET}:${BLUE}${cwd}${RESET}$ `;
}

/** What the terminal shows on connecting: the pinned key check, then the login banner. */
export function welcome(server: DemoServer): string {
  return [
    `${DIM}Connecting to ${server.user}@${server.host}:22 …${RESET}`,
    `${DIM}Host key ${server.fingerprint.slice(0, 22)}… matches the pinned key ${GREEN}✓${RESET}`,
    '',
    'Welcome to Ubuntu 24.04.1 LTS (GNU/Linux 6.8.0-45-generic x86_64)',
    '',
    `  System load:  0.21               Processes:        142`,
    `  Usage of /:   41.2% of 79.3GB    Users logged in:  1`,
    `  Memory usage: 39%                IPv4 address:     ${server.host}`,
    '',
    `${YELLOW}This is a simulated server in the DevOne demo. Type ${RESET}help${YELLOW} to see what you can try.${RESET}`,
    ''
  ]
    .join('\r\n')
    .concat('\r\n');
}

/**
 * Line editing for the pretend shell: feed it what the terminal sends, write
 * back what it returns.
 */
export class FakeShell {
  private buffer = '';
  private cwd = '~';
  private readonly history: string[] = [];
  private historyIndex = 0;
  exited = false;

  constructor(private readonly server: DemoServer) {}

  start(): string {
    return welcome(this.server) + prompt(this.server, this.cwd);
  }

  /** Returns the text to write to the terminal for `data` typed by the person. */
  input(data: string): string {
    if (this.exited) return '';
    let out = '';
    let index = 0;
    while (index < data.length) {
      const char = data[index];
      // Arrow keys: up/down walk the history; others are ignored.
      if (char === '\x1b') {
        const sequence = data.slice(index, index + 3);
        if (sequence === '\x1b[A' || sequence === '\x1b[B')
          out += this.walkHistory(sequence === '\x1b[A' ? -1 : 1);
        index += 3;
        continue;
      }
      if (char === '\r' || char === '\n') {
        out += this.submit();
        if (this.exited) return out;
      } else if (char === '\x7f' || char === '\b') {
        if (this.buffer) {
          this.buffer = this.buffer.slice(0, -1);
          out += '\b \b';
        }
      } else if (char === '\x03') {
        this.buffer = '';
        out += `^C\r\n${prompt(this.server, this.cwd)}`;
      } else if (char === '\x0c') {
        out += `\x1b[2J\x1b[H${prompt(this.server, this.cwd)}${this.buffer}`;
      } else if (char >= ' ') {
        this.buffer += char;
        out += char;
      }
      index += 1;
    }
    return out;
  }

  private walkHistory(step: number): string {
    if (this.history.length === 0) return '';
    this.historyIndex = Math.min(this.history.length, Math.max(0, this.historyIndex + step));
    const next = this.history[this.historyIndex] ?? '';
    const erase = '\b \b'.repeat(this.buffer.length);
    this.buffer = next;
    return erase + next;
  }

  private submit(): string {
    const command = this.buffer;
    this.buffer = '';
    if (command.trim()) this.history.push(command.trim());
    this.historyIndex = this.history.length;
    const result = runCommand(this.server, this.cwd, command, this.history);
    this.cwd = result.cwd;
    if (result.exit) {
      this.exited = true;
      return `\r\n${result.output}`;
    }
    if (result.clear) return `\x1b[2J\x1b[H${prompt(this.server, this.cwd)}`;
    return `\r\n${result.output}${prompt(this.server, this.cwd)}`;
  }
}
