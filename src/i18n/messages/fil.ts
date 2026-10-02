import type { en } from '@/i18n/messages/en';
import type { MessageShape } from '@/i18n/translate';

/** Filipino. Technical terms people use as-is at work (pipeline, branch, token) stay in English. */
export const fil: MessageShape<typeof en> = {
  common: {
    save: 'I-save',
    saved: 'Na-save',
    saving: 'Sine-save…',
    cancel: 'Kanselahin',
    remove: 'Alisin',
    delete: 'Burahin',
    rename: 'Palitan ang pangalan',
    close: 'Isara',
    add: 'Idagdag',
    open: 'Buksan',
    refresh: 'I-refresh',
    loading: 'Naglo-load…',
    never: 'Hindi pa',
    you: 'Ikaw',
    owner: 'May-ari',
    member: 'Miyembro',
    admin: 'Administrator',
    yes: 'Oo',
    no: 'Hindi',
    none: 'Wala',
    somethingWrong: 'May nagkaproblema. Subukan ulit.',
    ownersOnly: 'Ang mga may-ari lang ng proyekto ang puwedeng magbago nito.'
  },
  nav: {
    dashboard: 'Dashboard',
    issues: 'Board',
    resources: 'Mga Resource',
    database: 'Database',
    api: 'API',
    git: 'Git',
    docs: 'Mga Dokumento',
    drawings: 'Mga Drawing',
    devops: 'DevOps',
    settings: 'Mga Setting',
    projects: 'Mga Proyekto',
    account: 'Aking account',
    admin: 'Admin',
    terminal: 'Terminal',
    erd: 'ERD',
    overview: 'Pangkalahatang-tanaw'
  },
  userMenu: {
    signedInAs: 'Naka-sign in bilang @{username}',
    account: 'Aking account',
    admin: 'Admin',
    signOut: 'Mag-sign out'
  },
  devops: {
    title: 'DevOps',
    description: 'Subaybayan ang mga deployment, serbisyo, log, at kalagayan ng mga environment.',
    tabs: { pipelines: 'Mga Pipeline', terminal: 'Terminal' },
    databases: 'Mga Database',
    noDatabases: 'Walang nakakonektang database.',
    readOnly: 'Pagbasa lang',
    writesAllowed: 'Puwedeng magsulat',
    scanned: 'Na-scan {date}',
    neverScanned: 'Hindi pa na-scan',
    linkRepository: 'Mag-link ng repository para makita rito ang mga pipeline nito.',
    pullRequests: 'Mga pull request',
    mergeRequests: 'Mga merge request',
    recentRuns: 'Mga huling run',
    noOpen: 'Walang bukas na {kind}.',
    noRuns: 'Walang nahanap na pipeline run.',
    noMrPipelines: 'Wala pang pipeline na tumakbo para rito.',
    loadingPipelines: 'Nilo-load ang mga pipeline…',
    loadingJobs: 'Nilo-load ang mga job…',
    noJobs: 'Walang job.',
    showPipelines: 'Ipakita ang mga pipeline',
    hidePipelines: 'Itago ang mga pipeline',
    showJobs: 'Ipakita ang mga job',
    hideJobs: 'Itago ang mga job',
    logs: 'Mga log',
    production: 'production',
    hiddenBranches: 'Mga nakatagong branch: {count} ang hindi ipinapakita.',
    log: {
      stage: 'Stage: {stage}',
      truncated: 'Ipinapakita ang huling 1 MB ng log.',
      refreshing: 'Nagre-refresh bawat ilang segundo habang tumatakbo ang job.',
      loading: 'Nilo-load ang log…',
      publishedLater: 'Lalabas ang log kapag natapos ang job.',
      noLog: 'Walang log ang job na ito.',
      noOutput: 'Wala pang output.'
    },
    terminal: {
      savedServers: 'Mga naka-save na server',
      savedHint:
        'Lagyan ng tsek ang “I-save ang mga credential na ito” para isang click na lang sa susunod.',
      newConnection: 'Bagong koneksyon',
      connectTitle: 'Kumonekta sa server',
      remove: 'Alisin ang {name}',
      removeTitle: 'Alisin ang {name}?',
      removeDescription:
        'Mabubura ang mga naka-save na credential. Mananatiling konektado ang mga bukas na terminal.',
      openTerminals: 'Mga bukas na terminal',
      closeTab: 'Isara ang {name}',
      hostKey: 'Host key',
      disabled: 'Naka-off ang terminal para sa proyektong ito.',
      ownersOnly: 'Ang mga may-ari lang ng proyekto ang puwedeng gumamit ng terminal dito.',
      allowedHosts: 'Ang mga host lang na ito ang pinapayagan: {hosts}',
      changeInSettings: 'Baguhin ito sa mga setting ng proyekto',
      form: {
        host: 'Host',
        hostPlaceholder: '203.0.113.10 o server.example.com',
        port: 'Port',
        username: 'Username',
        signInWith: 'Mag-sign in gamit ang',
        password: 'Password',
        privateKey: 'Private key',
        passphrase: 'Passphrase',
        passphraseHint: 'Kung may passphrase lang ang key.',
        save: 'I-save ang mga credential na ito',
        saveHint:
          'Naka-encrypt at ikaw lang ang makakakita. Sa susunod, isang click na lang para kumonekta.',
        name: 'Pangalan',
        nameHint: 'Kung walang ilalagay: user@host.',
        connect: 'Kumonekta'
      }
    }
  },
  projectSettings: {
    title: 'Mga Setting',
    description: 'I-configure ang proyektong ito: detalye, miyembro, repository at DevOps.',
    tabs: {
      general: 'Pangkalahatan',
      members: 'Mga Miyembro',
      repositories: 'Mga Repository',
      devops: 'DevOps',
      activity: 'Aktibidad'
    },
    general: {
      title: 'Detalye ng proyekto',
      name: 'Pangalan',
      description: 'Paglalarawan',
      prefix: 'Prefix ng task key',
      prefixHint:
        'Ganito ang itsura ng mga task key: {example}. Kapag binago, magbabago ang lahat ng key.',
      nameTooShort: 'Gumamit ng hindi bababa sa 2 character',
      prefixInvalid: 'Gumamit ng 2–10 letra o numero, nagsisimula sa letra',
      prefixTaken: 'May ibang proyektong gumagamit na ng prefix na ito',
      dangerTitle: 'Burahin ang proyektong ito',
      dangerDescription:
        'Mabubura ang board, mga dokumento, drawing, koneksyon sa database at mga setting. Hindi gagalawin ang mga naka-link na repository.',
      deleteButton: 'Burahin ang proyekto',
      deleteConfirmTitle: 'Burahin ang {name}?',
      deleteConfirmHint: 'I-type ang pangalan ng proyekto para kumpirmahin.',
      deleted: 'Nabura ang proyekto'
    },
    members: {
      title: 'Mga Miyembro',
      count: '{count} miyembro',
      addTitle: 'Magdagdag ng miyembro',
      addHint: 'Kailangang naka-sign in na sila sa DevOne kahit isang beses.',
      username: 'Username',
      role: 'Tungkulin',
      joined: 'Sumali {date}',
      removeTitle: 'Alisin si @{username}?',
      removeDescription: 'Mawawalan agad sila ng access sa proyektong ito.',
      leave: 'Umalis sa proyekto',
      leaveTitle: 'Umalis sa proyektong ito?',
      leaveDescription: 'Mawawalan ka ng access hanggang idagdag ka ulit ng may-ari.',
      added: 'Naidagdag si @{username}'
    },
    repositories: {
      title: 'Mga naka-link na repository',
      none: 'Wala pang naka-link na repository.',
      linkMore: 'Mag-link ng repository sa Git page',
      defaultBranch: 'Default na branch: {branch}',
      productionBranch: 'Production branch',
      productionHint: 'Mamarkahan ng “production” sa DevOps ang mga pipeline sa branch na ito.',
      notSet: 'Hindi naka-set',
      unlink: 'I-unlink',
      unlinkTitle: 'I-unlink ang {name}?',
      unlinkDescription:
        'Mananatili ang repository sa {provider}; aalis lang ito sa proyektong ito.'
    },
    devops: {
      terminalTitle: 'SSH terminal',
      access: 'Sino ang puwedeng gumamit ng terminal',
      accessMembers: 'Lahat ng miyembro',
      accessOwners: 'Mga may-ari lang',
      accessDisabled: 'Naka-off',
      allowedHosts: 'Mga pinapayagang host',
      allowedHostsHint:
        'Isang pattern bawat linya, hal. *.internal o 10.0.*. Iwanang blangko para payagan ang kahit anong host.',
      pipelinesTitle: 'Mga Pipeline',
      hiddenBranches: 'Mga nakatagong branch',
      hiddenBranchesHint:
        'Isang pattern bawat linya, hal. dependabot/*. Itatago sa listahan ng mga pipeline.',
      saved: 'Na-save ang mga setting ng DevOps'
    },
    activity: {
      title: 'Aktibidad',
      description: 'Mga pagbabago sa proyektong ito at mga koneksyon sa terminal, pinakabago muna.',
      empty: 'Wala pang nangyayari.'
    }
  },
  account: {
    title: 'Aking account',
    description:
      'Ang iyong profile, mga nakakonektang account, naka-save na server, session at kagustuhan.',
    tabs: {
      profile: 'Profile',
      connections: 'Mga nakakonektang account',
      ssh: 'Mga naka-save na server',
      sessions: 'Mga session',
      preferences: 'Mga kagustuhan'
    },
    profile: {
      signedInWith: 'Naka-sign in gamit ang {provider}',
      role: 'Tungkulin',
      memberSince: 'Miyembro mula',
      lastSignIn: 'Huling pag-sign in',
      projects: 'Mga proyekto',
      fromProvider:
        'Galing sa {provider} ang iyong pangalan at larawan, at naa-update tuwing nagsa-sign in ka.'
    },
    connections: {
      description:
        'Mga GitHub at GitLab account na ginagamit ng DevOne para basahin ang mga repository, branch at pipeline.',
      signInAccount: 'Account sa pag-sign in',
      oauth: 'Naka-sign in gamit ang OAuth',
      token: 'Personal access token',
      expires: 'Kusang nire-renew',
      repositories: '{count} naka-link na repository',
      replaceToken: 'Palitan ang token',
      replaceTitle: 'Palitan ang token para sa {host}',
      replaceHint: 'Dapat sa parehong account ang bagong token.',
      add: 'Magkonekta ng ibang account',
      addTitle: 'Magkonekta ng GitHub o GitLab account',
      provider: 'Provider',
      gitlabUrl: 'GitLab URL',
      accessToken: 'Access token',
      tokenHint: 'GitHub: mga scope na repo at read:org. GitLab: mga scope na api at read_user.',
      connected: 'Nakakonekta si @{username}',
      replaced: 'Napalitan ang token',
      removeTitle: 'Alisin ang koneksyong ito?',
      removeDescription:
        'Maa-unlink sa lahat ng proyekto ang {count} naka-link na repository nito. Puwede mo itong ikonekta ulit mamaya.',
      cannotRemove: 'Ito ang account na ginagamit mo sa pag-sign in'
    },
    ssh: {
      description: 'Mga server na na-save mo sa DevOps terminal, sa lahat ng proyekto.',
      empty: 'Wala kang naka-save na server. Mag-save kapag kumokonekta mula sa DevOps → Terminal.',
      project: 'Proyekto',
      server: 'Server',
      auth: 'Pag-sign in',
      lastConnected: 'Huling kumonekta',
      hostKey: 'Host key',
      notPinned: 'Ipi-pin sa susunod na koneksyon',
      resetKey: 'I-reset ang host key',
      resetKeyTitle: 'I-reset ang host key ng {name}?',
      resetKeyDescription:
        'Gawin lang ito kung alam mong na-rebuild ang server. Pagkakatiwalaan ng susunod na koneksyon ang kahit anong key na ipakita ng server.',
      renamed: 'Napalitan ang pangalan',
      keyReset: 'Na-reset ang host key'
    },
    sessions: {
      description: 'Kung saan ka naka-sign in. Mag-sign out sa mga hindi mo na ginagamit.',
      thisDevice: 'Device na ito',
      signedIn: 'Nag-sign in {date}',
      expires: 'Mag-e-expire {date}',
      unknownAddress: 'Hindi naitala ang address',
      signOut: 'Mag-sign out',
      signOutOthers: 'Mag-sign out sa lahat ng iba pa',
      signedOutOthers: 'Na-sign out ang {count} ibang session'
    },
    preferences: {
      language: 'Wika',
      languageHint: 'Ginagamit sa mga menu at page sa buong DevOne.',
      theme: 'Tema',
      themeHint: 'Light o dark mode, at ang kulay ng tema. Naka-save sa browser na ito.',
      terminalFontSize: 'Laki ng font sa terminal',
      startPage: 'Panimulang page',
      startPageHint: 'Kung saan bubukas ang DevOne pagka-sign in mo.',
      startProjects: 'Mga Proyekto',
      startDashboard: 'Dashboard',
      saved: 'Na-save ang mga kagustuhan'
    }
  },
  admin: {
    title: 'Admin',
    description: 'Mga tao, patakaran sa pag-sign in at audit log ng DevOne na ito.',
    tabs: { users: 'Mga user', policy: 'Patakaran sa pag-sign in', audit: 'Audit log' },
    users: {
      count: '{count} tao',
      user: 'User',
      provider: 'Provider',
      role: 'Tungkulin',
      projects: 'Mga proyekto',
      lastSignIn: 'Huling pag-sign in',
      status: 'Katayuan',
      active: 'Aktibo',
      disabled: 'Naka-disable',
      disable: 'I-disable',
      enable: 'I-enable',
      disableTitle: 'I-disable si @{username}?',
      disableDescription:
        'Masa-sign out sila kahit saan at hindi makakapag-sign in hanggang i-enable ulit. Mananatili ang kanilang trabaho.',
      roleAdmin: 'Administrator',
      roleMember: 'Miyembro'
    },
    policy: {
      description:
        'Itinatakda gamit ang mga environment variable sa server (tingnan ang docs/deployment.md). I-restart ang DevOne pagkatapos baguhin.',
      providers: 'Mga provider sa pag-sign in',
      registration: 'Puwedeng mag-register ang mga bagong tao',
      bootstrap: 'Magiging administrator ang unang mag-sign in',
      githubOrgs: 'Mga pinapayagang GitHub organization',
      gitlabGroups: 'Mga pinapayagang GitLab group',
      trustProxy: 'Pagkatiwalaan ang X-Forwarded-For',
      anyone: 'Kahit sinong may account'
    },
    audit: {
      description: 'Lahat ng naitala sa DevOne, pinakabago muna (huling 200).',
      when: 'Kailan',
      who: 'Sino',
      what: 'Ano',
      project: 'Proyekto',
      empty: 'Wala pang naitala.'
    }
  },
  audit: {
    project_update: 'binago ang detalye ng proyekto',
    project_delete: 'binura ang proyekto',
    project_devops_update: 'binago ang mga setting ng DevOps',
    project_member_add: 'nagdagdag ng miyembro',
    project_member_role: 'binago ang tungkulin ng miyembro',
    project_member_remove: 'nag-alis ng miyembro',
    project_member_leave: 'umalis sa proyekto',
    project_repository_unlink: 'nag-unlink ng repository',
    project_repository_production: 'nag-set ng production branch',
    terminal_connect: 'nagbukas ng terminal',
    terminal_host_save: 'nag-save ng server',
    terminal_host_delete: 'nag-alis ng naka-save na server',
    terminal_host_reset_key: 'nag-reset ng host key ng server',
    account_connection_add: 'nagkonekta ng account',
    account_connection_token: 'pinalitan ang token ng account',
    account_connection_remove: 'nag-alis ng nakakonektang account',
    account_session_revoke: 'nag-sign out ng session',
    account_session_revoke_others: 'nag-sign out sa ibang session',
    admin_user_role: 'binago ang tungkulin ng user',
    admin_user_disable: 'nag-disable ng user',
    admin_user_enable: 'nag-enable ng user'
  },
  landing: {
    nav: {
      features: 'Mga feature',
      security: 'Seguridad',
      selfHost: 'Self-host',
      signIn: 'Mag-sign in'
    },
    hero: {
      eyebrow: 'Self-hosted na workspace para sa developer',
      title: 'Lahat ng tool.',
      titleAccent: 'Iisang lugar.',
      body: 'Pinagsasama ng DevOne ang board, Git, database, API client, docs, drawings, pipeline at server mo sa iisang project, kaya isang click lang ang kailangan mong konteksto.',
      primary: 'Magsimula',
      secondary: 'I-self-host'
    },
    demo: { label: 'Demo ng DevOne', play: 'I-play ang demo', pause: 'I-pause ang demo' },
    features: {
      eyebrow: 'Ang workspace',
      title: 'Lahat ng kailangan ng project, nasa project.',
      body: 'Tama na ang paglipat-lipat sa walong tab. Alam ng bawat tool kung anong project ang bukas mo.',
      board: {
        title: 'Board',
        body: 'Board, list at calendar view na may status, priority at due date.'
      },
      git: {
        title: 'Git',
        body: 'Mga branch, commit at pagbabago mula sa GitHub at GitLab, katabi ng trabaho.'
      },
      database: {
        title: 'Database',
        body: 'Tingnan ang mga table, key at index, at mag-run ng query sa mga database ng project.'
      },
      api: {
        title: 'API client',
        body: 'Magpadala ng request, mag-ipon ng collection at ulitin ang history nang hindi umaalis sa project.'
      },
      docs: {
        title: 'Docs',
        body: 'Isulat ang dokumentasyon katabi mismo ng trabahong inilalarawan nito.'
      },
      drawings: {
        title: 'Drawings',
        body: 'Mag-sketch ng architecture at daloy sa canvas na mabubuksan ng buong team.'
      },
      devops: {
        title: 'Pipelines',
        body: 'Sundan ang CI/CD ng bawat merge request at basahin ang job log sa terminal view.'
      },
      terminal: {
        title: 'SSH terminal',
        body: 'Kumonekta sa mga server mo mula sa browser, may naka-save na credentials kung gusto mo.'
      }
    },
    security: {
      eyebrow: 'Seguridad',
      title: 'Nasa server mo ang code mo.',
      body: 'Tumatakbo ang DevOne sa infrastructure na hawak mo. Naka-encrypt ang mga secret at may bakas ang bawat sensitibong aksyon.',
      encrypted: {
        title: 'Naka-encrypt na credentials',
        body: 'Ine-encrypt ang mga provider token at naka-save na SSH secret bago itago.'
      },
      sessions: {
        title: 'HttpOnly na session',
        body: 'Nasa database ang mga browser session at hindi ginagamit ang provider token mo.'
      },
      hostKeys: {
        title: 'Naka-pin na host key',
        body: 'Tinatandaan ng terminal ang key ng bawat server at tinatanggihan kapag nagbago ito.'
      },
      audit: {
        title: 'Audit log',
        body: 'Naitatala ang pagbabago sa settings, sa mga miyembro at ang access sa terminal.'
      }
    },
    selfHost: {
      eyebrow: 'Self-host',
      title: 'Tatlong command lang.',
      body: 'May kasamang Docker Compose, PostgreSQL at Redis ang DevOne. Magdala ng server at hawakan ang sarili mong data.',
      step1: 'Kopyahin ang halimbawang environment',
      step2: 'Gumawa ng encryption key',
      step3: 'Patakbuhin ang stack',
      ready: 'Tumatakbo na ang DevOne sa port 3000'
    },
    cta: {
      title: 'Iuwi ang buong project.',
      body: 'Mag-sign in gamit ang GitHub o GitLab at buksan ang una mong project.',
      button: 'Magsimula'
    },
    footer: { tagline: 'Lahat ng tool. Iisang lugar.' }
  }
};
