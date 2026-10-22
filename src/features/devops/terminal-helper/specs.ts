/**
 * A small declarative spec per command, in the spirit of withfig/autocomplete:
 * what a command's subcommands and options are called, and what they do.
 */
export interface CommandSpec {
  description?: string;
  subcommands?: Record<string, CommandSpec>;
  /** Flag name -> what it does. */
  options?: Record<string, string>;
}

const containerLogs: CommandSpec = {
  description: 'Show a container’s logs',
  options: {
    '-f': 'Follow the output',
    '--follow': 'Follow the output',
    '--tail': 'Number of lines from the end',
    '--since': 'Only logs since a time or duration',
    '-t': 'Show timestamps',
    '--timestamps': 'Show timestamps'
  }
};

const compose: CommandSpec = {
  description: 'Run multi-container apps',
  subcommands: {
    up: {
      description: 'Create and start services',
      options: { '-d': 'In the background', '--build': 'Build images first' }
    },
    down: { description: 'Stop and remove services', options: { '-v': 'Also remove volumes' } },
    logs: containerLogs,
    ps: { description: 'List services', options: { '-a': 'Include stopped' } },
    pull: { description: 'Pull service images' },
    restart: { description: 'Restart services' },
    build: { description: 'Build service images' },
    exec: { description: 'Run a command in a service' },
    stop: { description: 'Stop services' },
    start: { description: 'Start services' }
  }
};

export const SPECS: Record<string, CommandSpec> = {
  docker: {
    description: 'Manage containers',
    options: { '--help': 'Show help', '-v': 'Show the version' },
    subcommands: {
      ps: {
        description: 'List containers',
        options: {
          '-a': 'Include stopped containers',
          '-q': 'Only IDs',
          '--filter': 'Filter the output',
          '--format': 'Format with a Go template',
          '--no-trunc': 'Don’t shorten IDs'
        }
      },
      logs: containerLogs,
      exec: {
        description: 'Run a command in a container',
        options: {
          '-it': 'Interactive, with a terminal',
          '-i': 'Keep input open',
          '-t': 'Allocate a terminal',
          '-u': 'User to run as',
          '-w': 'Working directory',
          '-e': 'Set an environment variable'
        }
      },
      run: {
        description: 'Create and start a container',
        options: {
          '-d': 'In the background',
          '--rm': 'Remove when it exits',
          '-p': 'Publish a port',
          '-v': 'Mount a volume',
          '-e': 'Set an environment variable',
          '--name': 'Name the container',
          '--network': 'Connect to a network',
          '-it': 'Interactive, with a terminal'
        }
      },
      start: { description: 'Start stopped containers' },
      stop: { description: 'Stop running containers' },
      restart: { description: 'Restart containers' },
      rm: {
        description: 'Remove containers',
        options: { '-f': 'Force, even if running', '-v': 'Also remove volumes' }
      },
      images: { description: 'List images', options: { '-a': 'Include intermediate images' } },
      pull: { description: 'Download an image' },
      push: { description: 'Upload an image' },
      build: {
        description: 'Build an image',
        options: { '-t': 'Name and tag', '--no-cache': 'Don’t use the cache' }
      },
      inspect: { description: 'Show low-level details' },
      stats: {
        description: 'Live resource use',
        options: { '--no-stream': 'Print once and exit' }
      },
      top: { description: 'Show a container’s processes' },
      cp: { description: 'Copy files to or from a container' },
      network: {
        description: 'Manage networks',
        subcommands: { ls: {}, inspect: {}, create: {}, rm: {} }
      },
      volume: {
        description: 'Manage volumes',
        subcommands: { ls: {}, inspect: {}, create: {}, rm: {}, prune: {} }
      },
      system: {
        description: 'Manage Docker',
        subcommands: {
          df: { description: 'Disk used by Docker' },
          prune: {
            description: 'Remove unused data',
            options: { '-a': 'All unused images', '-f': 'No confirmation' }
          }
        }
      },
      compose
    }
  },
  git: {
    description: 'Version control',
    subcommands: {
      status: {
        description: 'Show changes',
        options: { '-s': 'Short format', '-sb': 'Short, with branch' }
      },
      add: { description: 'Stage changes', options: { '-A': 'Everything', '-p': 'Pick hunks' } },
      commit: {
        description: 'Record changes',
        options: {
          '-m': 'Message',
          '-a': 'Include tracked changes',
          '--amend': 'Redo the last commit'
        }
      },
      push: {
        description: 'Upload commits',
        options: { '-u': 'Set upstream', '--force-with-lease': 'Safer force push' }
      },
      pull: {
        description: 'Fetch and merge',
        options: { '--ff-only': 'Never make a merge commit', '--rebase': 'Rebase instead of merge' }
      },
      fetch: { description: 'Download without merging' },
      checkout: {
        description: 'Switch branches or restore files',
        options: { '-b': 'Create a branch' }
      },
      switch: { description: 'Switch branches', options: { '-c': 'Create a branch' } },
      branch: {
        description: 'List or manage branches',
        options: { '-a': 'All branches', '-d': 'Delete a branch' }
      },
      log: {
        description: 'Show history',
        options: {
          '--oneline': 'One line per commit',
          '-p': 'Show changes',
          '-n': 'Limit the count'
        }
      },
      diff: { description: 'Show changes', options: { '--staged': 'Staged changes' } },
      stash: { description: 'Set changes aside', subcommands: { pop: {}, list: {}, drop: {} } },
      merge: { description: 'Join branches' },
      rebase: { description: 'Replay commits on another base' },
      reset: {
        description: 'Move HEAD',
        options: { '--hard': 'Discard changes too', '--soft': 'Keep changes staged' }
      },
      clone: { description: 'Copy a repository' },
      remote: { description: 'Manage remotes', options: { '-v': 'Show URLs' } }
    }
  },
  systemctl: {
    description: 'Control services',
    options: {
      '--failed': 'Only failed units',
      '--user': 'The user’s services',
      '--no-pager': 'Don’t page the output'
    },
    subcommands: {
      status: { description: 'Show a service’s state' },
      start: { description: 'Start a service' },
      stop: { description: 'Stop a service' },
      restart: { description: 'Restart a service' },
      reload: { description: 'Reload its configuration' },
      enable: { description: 'Start at boot', options: { '--now': 'Also start it now' } },
      disable: { description: 'Don’t start at boot', options: { '--now': 'Also stop it now' } },
      'is-active': { description: 'Is it running?' },
      'list-units': { description: 'List units', options: { '--failed': 'Only failed units' } },
      'daemon-reload': { description: 'Reload unit files' }
    }
  },
  journalctl: {
    description: 'Read system logs',
    options: {
      '-u': 'Only this unit',
      '-f': 'Follow new entries',
      '-n': 'Number of lines',
      '--since': 'Since a time, e.g. "1 hour ago"',
      '--until': 'Until a time',
      '-p': 'Priority, e.g. err',
      '-b': 'Since the last boot',
      '--no-pager': 'Don’t page the output'
    }
  },
  ls: {
    description: 'List files',
    options: {
      '-l': 'Long format',
      '-a': 'Include hidden',
      '-h': 'Human-readable sizes',
      '-la': 'Long, with hidden',
      '-lah': 'Long, hidden, readable',
      '-t': 'Newest first',
      '-S': 'Largest first'
    }
  },
  tail: {
    description: 'Show the end of a file',
    options: {
      '-f': 'Follow as it grows',
      '-n': 'Number of lines',
      '-F': 'Follow, even if recreated'
    }
  },
  grep: {
    description: 'Search text',
    options: {
      '-r': 'Recursive',
      '-n': 'Line numbers',
      '-i': 'Ignore case',
      '-v': 'Invert the match',
      '-l': 'Only file names',
      '-E': 'Extended regex',
      '-A': 'Lines after',
      '-B': 'Lines before'
    }
  },
  curl: {
    description: 'Transfer a URL',
    options: {
      '-I': 'Headers only',
      '-s': 'Silent',
      '-L': 'Follow redirects',
      '-o': 'Write to a file',
      '-X': 'Request method',
      '-H': 'Add a header',
      '-d': 'Send data',
      '-k': 'Skip certificate checks'
    }
  },
  apt: {
    description: 'Manage packages',
    subcommands: {
      update: {},
      upgrade: {},
      install: {},
      remove: {},
      search: {},
      autoremove: {},
      list: {}
    }
  },
  npm: {
    description: 'Node packages',
    subcommands: {
      install: {},
      run: {},
      start: {},
      test: {},
      build: {},
      ci: {},
      update: {},
      ls: {}
    }
  },
  tar: {
    description: 'Archive files',
    options: {
      '-czf': 'Create a .tar.gz',
      '-xzf': 'Extract a .tar.gz',
      '-tf': 'List contents',
      '-C': 'Change directory first'
    }
  },
  chmod: {
    description: 'Change permissions',
    options: { '-R': 'Recursive', '+x': 'Make executable' }
  }
};
