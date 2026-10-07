export const en = {
  common: {
    save: 'Save',
    saved: 'Saved',
    saving: 'Saving…',
    cancel: 'Cancel',
    remove: 'Remove',
    delete: 'Delete',
    rename: 'Rename',
    close: 'Close',
    add: 'Add',
    open: 'Open',
    refresh: 'Refresh',
    loading: 'Loading…',
    never: 'Never',
    you: 'You',
    owner: 'Owner',
    member: 'Member',
    admin: 'Administrator',
    yes: 'Yes',
    no: 'No',
    none: 'None',
    somethingWrong: 'Something went wrong. Try again.',
    ownersOnly: 'Only project owners can change this.'
  },
  nav: {
    dashboard: 'Dashboard',
    issues: 'Board',
    resources: 'Resources',
    database: 'Database',
    api: 'API',
    git: 'Git',
    docs: 'Docs',
    drawings: 'Drawings',
    devops: 'DevOps',
    settings: 'Settings',
    projects: 'Projects',
    account: 'My account',
    admin: 'Admin',
    terminal: 'Terminal',
    erd: 'ERD',
    overview: 'Overview'
  },
  userMenu: {
    signedInAs: 'Signed in as @{username}',
    account: 'My account',
    admin: 'Admin',
    signOut: 'Sign out'
  },
  devops: {
    title: 'DevOps',
    description: 'Track deployments, services, logs, and environment health.',
    tabs: { pipelines: 'Pipelines', terminal: 'Terminal' },
    databases: 'Databases',
    noDatabases: 'No databases connected.',
    readOnly: 'Read-only',
    writesAllowed: 'Writes allowed',
    scanned: 'Scanned {date}',
    neverScanned: 'Never scanned',
    linkRepository: 'Link a repository to see its pipelines here.',
    pullRequests: 'Pull requests',
    mergeRequests: 'Merge requests',
    recentRuns: 'Recent runs',
    noOpen: 'No open {kind}.',
    noRuns: 'No pipeline runs found.',
    noMrPipelines: 'No pipelines have run for this yet.',
    loadingPipelines: 'Loading pipelines…',
    loadingJobs: 'Loading jobs…',
    noJobs: 'No jobs.',
    showPipelines: 'Show pipelines',
    hidePipelines: 'Hide pipelines',
    showJobs: 'Show jobs',
    hideJobs: 'Hide jobs',
    logs: 'Logs',
    production: 'production',
    hiddenBranches: 'Hidden branches: {count} not shown.',
    log: {
      stage: 'Stage: {stage}',
      truncated: 'Showing the last 1 MB of the log.',
      refreshing: 'Refreshing every few seconds while the job runs.',
      loading: 'Loading the log…',
      publishedLater: 'The log is published when the job finishes.',
      noLog: 'This job has no log.',
      noOutput: 'No output yet.'
    },
    terminal: {
      savedServers: 'Saved servers',
      savedHint: 'Tick “Save these credentials” when connecting to connect in one click next time.',
      newConnection: 'New connection',
      connectTitle: 'Connect to a server',
      remove: 'Remove {name}',
      removeTitle: 'Remove {name}?',
      removeDescription: 'The saved credentials are deleted. Open terminals stay connected.',
      openTerminals: 'Open terminals',
      closeTab: 'Close {name}',
      hostKey: 'Host key',
      disabled: 'The terminal is turned off for this project.',
      ownersOnly: 'Only project owners can use the terminal in this project.',
      allowedHosts: 'Only these hosts are allowed: {hosts}',
      changeInSettings: 'Change this in project settings',
      form: {
        host: 'Host',
        hostPlaceholder: '203.0.113.10 or server.example.com',
        port: 'Port',
        username: 'Username',
        signInWith: 'Sign in with',
        password: 'Password',
        privateKey: 'Private key',
        passphrase: 'Passphrase',
        passphraseHint: 'Only if the key is protected by one.',
        save: 'Save these credentials',
        saveHint: 'Stored encrypted and visible only to you. Next time it connects in one click.',
        name: 'Name',
        nameHint: 'Defaults to user@host.',
        connect: 'Connect'
      }
    }
  },
  projectSettings: {
    title: 'Settings',
    description: 'Configure this project: details, members, repositories and DevOps.',
    tabs: {
      general: 'General',
      members: 'Members',
      repositories: 'Repositories',
      devops: 'DevOps',
      activity: 'Activity'
    },
    general: {
      title: 'Project details',
      name: 'Name',
      description: 'Description',
      prefix: 'Task key prefix',
      prefixHint: 'Task keys look like {example}. Changing it renames every key.',
      nameTooShort: 'Use at least 2 characters',
      prefixInvalid: 'Use 2–10 letters or digits, starting with a letter',
      prefixTaken: 'Another project already uses this prefix',
      dangerTitle: 'Delete this project',
      dangerDescription:
        'Deletes the board, docs, drawings, database connections and settings. Linked repositories are not touched.',
      deleteButton: 'Delete project',
      deleteConfirmTitle: 'Delete {name}?',
      deleteConfirmHint: 'Type the project name to confirm.',
      deleted: 'Project deleted'
    },
    members: {
      title: 'Members',
      count: '{count} members',
      addTitle: 'Add a member',
      addHint: 'They need to have signed in to DevOne once.',
      username: 'Username',
      role: 'Role',
      joined: 'Joined {date}',
      removeTitle: 'Remove @{username}?',
      removeDescription: 'They lose access to this project straight away.',
      leave: 'Leave project',
      leaveTitle: 'Leave this project?',
      leaveDescription: 'You lose access until an owner adds you again.',
      added: '@{username} added'
    },
    repositories: {
      title: 'Linked repositories',
      none: 'No repositories are linked yet.',
      linkMore: 'Link repositories from the Git page',
      defaultBranch: 'Default branch: {branch}',
      productionBranch: 'Production branch',
      productionHint: 'Pipelines on this branch are marked “production” in DevOps.',
      notSet: 'Not set',
      unlink: 'Unlink',
      unlinkTitle: 'Unlink {name}?',
      unlinkDescription: 'The repository stays on {provider}; it just leaves this project.'
    },
    devops: {
      terminalTitle: 'SSH terminal',
      access: 'Who can use the terminal',
      accessMembers: 'All members',
      accessOwners: 'Owners only',
      accessDisabled: 'Turned off',
      allowedHosts: 'Allowed hosts',
      allowedHostsHint:
        'One pattern per line, e.g. *.internal or 10.0.*. Leave empty to allow any host.',
      pipelinesTitle: 'Pipelines',
      hiddenBranches: 'Hidden branches',
      hiddenBranchesHint:
        'One pattern per line, e.g. dependabot/*. Hidden from the pipeline lists.',
      saved: 'DevOps settings saved'
    },
    activity: {
      title: 'Activity',
      description: 'Changes to this project and terminal connections, newest first.',
      empty: 'Nothing has happened yet.'
    }
  },
  account: {
    title: 'My account',
    description: 'Your profile, connected accounts, saved servers, sessions and preferences.',
    tabs: {
      profile: 'Profile',
      connections: 'Connected accounts',
      ssh: 'Saved servers',
      sessions: 'Sessions',
      ai: 'AI keys',
      preferences: 'Preferences'
    },
    profile: {
      signedInWith: 'Signed in with {provider}',
      role: 'Role',
      memberSince: 'Member since',
      lastSignIn: 'Last sign-in',
      projects: 'Projects',
      fromProvider: 'Your name and picture come from {provider} and update when you sign in.'
    },
    connections: {
      description:
        'GitHub and GitLab accounts DevOne reads repositories, branches and pipelines with.',
      signInAccount: 'Sign-in account',
      oauth: 'Signed in with OAuth',
      token: 'Personal access token',
      expires: 'Renews automatically',
      repositories: '{count} linked repositories',
      replaceToken: 'Replace token',
      replaceTitle: 'Replace the token for {host}',
      replaceHint: 'The new token must belong to the same account.',
      add: 'Connect another account',
      addTitle: 'Connect a GitHub or GitLab account',
      provider: 'Provider',
      gitlabUrl: 'GitLab URL',
      accessToken: 'Access token',
      tokenHint: 'GitHub: repo and read:org scopes. GitLab: api and read_user scopes.',
      connected: 'Connected @{username}',
      replaced: 'Token replaced',
      removeTitle: 'Remove this connection?',
      removeDescription:
        'Its {count} linked repositories are unlinked from every project. You can connect it again later.',
      cannotRemove: 'You sign in with this account'
    },
    ssh: {
      description: 'Servers you saved in the DevOps terminal, across all projects.',
      empty: 'You have no saved servers. Save one when connecting from DevOps → Terminal.',
      project: 'Project',
      server: 'Server',
      auth: 'Sign-in',
      lastConnected: 'Last connected',
      hostKey: 'Host key',
      notPinned: 'Pinned on next connection',
      resetKey: 'Reset host key',
      resetKeyTitle: 'Reset the host key of {name}?',
      resetKeyDescription:
        'Do this only if you know the server was rebuilt. The next connection trusts whatever key the server presents.',
      renamed: 'Renamed',
      keyReset: 'Host key reset'
    },
    sessions: {
      description: 'Where you are signed in. Sign out anywhere you no longer use.',
      thisDevice: 'This device',
      signedIn: 'Signed in {date}',
      expires: 'Expires {date}',
      unknownAddress: 'Address not recorded',
      signOut: 'Sign out',
      signOutOthers: 'Sign out everywhere else',
      signedOutOthers: 'Signed out of {count} other sessions'
    },
    preferences: {
      language: 'Language',
      languageHint: 'Used for menus and pages across DevOne.',
      theme: 'Theme',
      themeHint: 'Light or dark mode, and the colour theme. Saved in this browser.',
      terminalFontSize: 'Terminal font size',
      startPage: 'Start page',
      startPageHint: 'Where DevOne opens after you sign in.',
      startProjects: 'Projects',
      startDashboard: 'Dashboard',
      saved: 'Preferences saved'
    }
  },
  admin: {
    title: 'Admin',
    description: 'People, sign-in rules and the audit log for this DevOne installation.',
    tabs: { users: 'Users', ai: 'AI router', policy: 'Sign-in policy', audit: 'Audit log' },
    users: {
      count: '{count} people',
      user: 'User',
      provider: 'Provider',
      role: 'Role',
      projects: 'Projects',
      lastSignIn: 'Last sign-in',
      status: 'Status',
      active: 'Active',
      disabled: 'Disabled',
      disable: 'Disable',
      enable: 'Enable',
      disableTitle: 'Disable @{username}?',
      disableDescription:
        'They are signed out everywhere and cannot sign in until enabled again. Their work stays.',
      roleAdmin: 'Administrator',
      roleMember: 'Member'
    },
    policy: {
      description:
        'Set with environment variables on the server (see docs/deployment.md). Restart DevOne after changing them.',
      providers: 'Sign-in providers',
      registration: 'New people can register',
      bootstrap: 'First sign-in becomes administrator',
      githubOrgs: 'Allowed GitHub organizations',
      gitlabGroups: 'Allowed GitLab groups',
      trustProxy: 'Trust X-Forwarded-For',
      anyone: 'Anyone with an account'
    },
    audit: {
      description: 'Everything recorded across DevOne, newest first (last 200).',
      when: 'When',
      who: 'Who',
      what: 'What',
      project: 'Project',
      empty: 'Nothing recorded yet.'
    }
  },
  audit: {
    project_update: 'updated the project details',
    project_delete: 'deleted the project',
    project_devops_update: 'changed the DevOps settings',
    project_member_add: 'added a member',
    project_member_role: 'changed a member’s role',
    project_member_remove: 'removed a member',
    project_member_leave: 'left the project',
    project_repository_unlink: 'unlinked a repository',
    project_repository_production: 'set the production branch',
    terminal_connect: 'opened a terminal',
    terminal_host_save: 'saved a server',
    terminal_host_delete: 'removed a saved server',
    terminal_host_reset_key: 'reset a server’s host key',
    account_connection_add: 'connected an account',
    account_connection_token: 'replaced an account token',
    account_connection_remove: 'removed a connected account',
    account_session_revoke: 'signed out a session',
    account_session_revoke_others: 'signed out other sessions',
    admin_user_role: 'changed a user’s role',
    admin_user_disable: 'disabled a user',
    admin_user_enable: 'enabled a user',
    admin_ai_provider_add: 'added an AI provider',
    admin_ai_provider_update: 'changed an AI provider',
    admin_ai_provider_delete: 'removed an AI provider',
    admin_ai_combo_add: 'added an AI combo',
    admin_ai_combo_update: 'changed an AI combo',
    admin_ai_combo_delete: 'removed an AI combo',
    account_ai_key_create: 'created an AI key',
    account_ai_key_delete: 'deleted an AI key'
  },
  aiRouter: {
    intro:
      'One OpenAI-compatible endpoint for every model set up here. A request goes to the first provider that answers; one that is rate-limited, out of quota or down hands over to the next.',
    endpoint: 'Endpoint',
    providers: {
      title: 'Providers',
      description:
        'OpenAI-compatible APIs the router can use. Keys are encrypted and never shown again.',
      empty: 'No providers yet. Add one to start routing requests.',
      add: 'Add provider',
      addTitle: 'Add a provider',
      editTitle: 'Edit {name}',
      preset: 'Start from',
      name: 'Name',
      nameHint: 'Clients can ask for "{name}/model" to use only this provider.',
      baseUrl: 'Base URL',
      apiKey: 'API key',
      apiKeyKeep: 'Leave empty to keep the saved key.',
      clearKey: 'Remove the saved key',
      models: 'Models',
      modelsHint: 'One per line, as the provider names them. The first is used for "auto".',
      fetchModels: 'Fetch models',
      fetched: '{count} models found',
      priority: 'Priority',
      priorityHint: 'When several providers serve a model, lower numbers are tried first.',
      enabled: 'Enabled',
      off: 'Off',
      noKey: 'No API key',
      modelCount: '{count} models',
      resting: 'Resting until {time}',
      lastError: 'Last error',
      tryNow: 'Try again now',
      removeTitle: 'Remove {name}?',
      removeDescription: 'It is also taken out of every combo that uses it.',
      saved: 'Provider saved',
      removed: 'Provider removed'
    },
    combos: {
      title: 'Combos',
      description:
        'A model name that stands for a list of models, tried in order until one answers. Put free models first and paid ones last to spend as little as possible.',
      empty: 'No combos yet.',
      add: 'Add combo',
      addTitle: 'Add a combo',
      editTitle: 'Edit {name}',
      name: 'Name',
      nameHint: 'What clients ask for as the model, e.g. "free-stack".',
      steps: 'Models, in the order they are tried',
      addStep: 'Add a model',
      provider: 'Provider',
      model: 'Model',
      moveUp: 'Move up',
      moveDown: 'Move down',
      removeStep: 'Remove this model',
      noProviders: 'Add a provider first.',
      removeTitle: 'Remove the combo {name}?',
      removeDescription: 'Clients asking for it get an error until it is added again.',
      saved: 'Combo saved',
      removed: 'Combo removed'
    },
    settings: {
      title: 'Settings',
      description: 'How the router treats requests from tools such as Claude Code.',
      defaultModel: 'Default model',
      defaultModelHint:
        'Used when nothing serves the model a tool asks for, for example Claude Code asking for "claude-sonnet-…". Enter a combo name, "auto" or a model.',
      compress: 'Shrink tool output before sending',
      maxChars: 'Longest tool output (characters)',
      compressHint:
        'Command logs, listings and diffs are cleaned up, and anything longer keeps its beginning and end. Send "x-devone-token-saver: off" to skip it for one request.',
      save: 'Save settings',
      saved: 'Settings saved'
    },
    usage: {
      title: 'Usage',
      description: 'Requests in the last 24 hours, and the latest 50.',
      empty: 'No requests yet.',
      provider: 'Provider',
      requests: 'Requests',
      failures: 'Failed',
      tokens: 'Tokens in / out',
      latency: 'Average time',
      when: 'When',
      who: 'Who',
      model: 'Model',
      tries: 'Tries',
      status: 'Status',
      noProvider: 'None answered'
    },
    keys: {
      description:
        'Personal keys for using the AI router from OpenCode, Cursor, scripts and other tools. DevOne itself needs no key.',
      empty: 'You have no AI keys.',
      create: 'Create key',
      createTitle: 'Create an AI key',
      name: 'Name',
      namePlaceholder: 'e.g. Laptop OpenCode',
      created: 'Copy your key now. It is not shown again.',
      copy: 'Copy',
      copied: 'Copied',
      done: 'Done',
      lastUsed: 'Last used',
      createdOn: 'Created {date}',
      deleteTitle: 'Delete the key {name}?',
      deleteDescription: 'Tools using it stop working.',
      deleted: 'Key deleted',
      setup: 'Set up a tool',
      setupHint:
        'Any tool that takes an OpenAI-compatible base URL works. Ask for "auto" or a combo as the model to get automatic fallback.',
      models: 'Models you can ask for',
      noModels: 'An administrator has not set up any AI providers yet.',
      disabledInDemo: 'The AI router is turned off in the public demo.'
    }
  },
  demo: {
    account: {
      badge: 'Demo account',
      note: 'A temporary account for the DevOne demo. It and everything in it are deleted after 24 hours.'
    },
    terminal: {
      hint: 'Sample servers for the demo. They open a simulated terminal: nothing connects anywhere.',
      simulated: 'Simulated',
      disconnect: 'Disconnect',
      pick: 'Pick a server to open a terminal.'
    },
    banner:
      'You’re exploring the DevOne demo. Your sample project is deleted in {hours} h, and anything that connects to other machines is turned off.',
    selfHost: 'Self-host DevOne',
    title: 'Try DevOne',
    body: 'Get your own sample project to explore for 24 hours. No sign-up, nothing to install.',
    start: 'Start the demo',
    note: 'This is a public demo, so signing in with GitHub or GitLab is turned off.',
    home: 'Back to the home page',
    homePage: 'Home page'
  },
  landing: {
    nav: {
      features: 'Features',
      security: 'Security',
      download: 'Download',
      selfHost: 'Self-host',
      signIn: 'Sign in',
      github: 'DevOne on GitHub'
    },
    hero: {
      eyebrow: 'Self-hosted developer workspace',
      title: 'Every tool.',
      titleAccent: 'One place.',
      body: 'DevOne puts your board, Git, databases, API client, docs, drawings, pipelines and servers inside one project, so the context you need is always a click away.',
      primary: 'Get started',
      openWorkspace: 'Open your workspace',
      tryDemo: 'Try the demo',
      secondary: 'Self-host it'
    },
    demo: { label: 'DevOne product demo', play: 'Play demo', pause: 'Pause demo' },
    features: {
      eyebrow: 'The workspace',
      title: 'Everything a project needs, in the project.',
      body: 'Stop juggling eight tabs. Every tool knows which project you are in.',
      board: {
        title: 'Board',
        body: 'Board, list and calendar views with statuses, priorities and due dates.'
      },
      git: {
        title: 'Git',
        body: 'Branches, commits and changes from GitHub and GitLab, side by side with the work.'
      },
      database: {
        title: 'Database',
        body: 'Browse tables, keys and indexes, and run queries against project databases.'
      },
      api: {
        title: 'API client',
        body: 'Send requests, keep collections and replay history without leaving the project.'
      },
      docs: {
        title: 'Docs',
        body: 'Write project documentation right next to the work it describes.'
      },
      drawings: {
        title: 'Drawings',
        body: 'Sketch architecture and flows on a canvas the whole team can open.'
      },
      devops: {
        title: 'Pipelines',
        body: 'Follow CI/CD for every merge request and read job logs in a terminal view.'
      },
      terminal: {
        title: 'SSH terminal',
        body: 'Connect to your servers from the browser, with saved credentials if you want them.'
      }
    },
    security: {
      eyebrow: 'Security',
      title: 'Your code stays on your servers.',
      body: 'DevOne runs on infrastructure you control. Secrets are encrypted at rest and every sensitive action leaves a trail.',
      encrypted: {
        title: 'Encrypted credentials',
        body: 'Provider tokens and saved SSH secrets are encrypted before they are stored.'
      },
      sessions: {
        title: 'HttpOnly sessions',
        body: 'Browser sessions are database-backed and never reuse your provider token.'
      },
      hostKeys: {
        title: 'Pinned host keys',
        body: 'The terminal remembers each server’s key and refuses one that changes.'
      },
      audit: {
        title: 'Audit log',
        body: 'Settings changes, member changes and terminal access are recorded.'
      }
    },
    download: {
      eyebrow: 'Desktop app',
      title: 'Or run it on your own computer.',
      body: 'The desktop app runs DevOne with its own built-in database. No server, no setup: install it and sign in.',
      version: 'Latest release',
      allReleases: 'All releases',
      mac: 'macOS',
      macDetail: 'Apple silicon (.dmg)',
      windows: 'Windows',
      windowsDetail: '64-bit installer (.exe)',
      debian: 'Debian / Ubuntu',
      debianDetail: '64-bit package (.deb)',
      redhat: 'Fedora / RHEL',
      redhatDetail: '64-bit package (.rpm)'
    },
    selfHost: {
      eyebrow: 'Self-host',
      title: 'Up in four steps.',
      body: 'DevOne ships with Docker Compose, PostgreSQL and Redis. Bring a server with Docker and keep your data.',
      step1: 'Get the code',
      step2: 'Copy the example environment',
      step3: 'Set a database password and encryption key',
      step4: 'Start the stack',
      ready: 'DevOne is running on http://localhost:3000',
      note: 'The first person to sign in becomes the administrator. Afterwards, set DEVONE_ALLOW_BOOTSTRAP=false in .env and run docker compose up -d again.',
      guide: 'Full self-hosting guide'
    },
    cta: {
      title: 'Bring the whole project home.',
      body: 'Sign in with GitHub or GitLab and open your first project.',
      button: 'Get started'
    },
    footer: { tagline: 'Every tool. One place.', github: 'Star on GitHub' }
  }
};
