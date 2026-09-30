// Dev-only mock for `pnpm dev:renderer` (electron-vite --rendererOnly).
// Installs a fake window.electron/window.api so the app shell renders in a
// plain browser. Stats data grows on every poll to simulate live traffic.
/* eslint-disable @typescript-eslint/no-explicit-any */

const MB = 1024 * 1024
let tick = 0

const appConfig: Record<string, any> = {
  statsRange: 'run',
  statsDomainMode: 'etld',
  statsSortBy: 'total',
  statsSortDir: 'desc',
  connectionInterval: 500,
  displayIcon: true,
  displayAppName: true,
  statsCardStatus: 'col-span-2',
  connectionCardStatus: 'col-span-2'
}

function grow(base: number, step: number): number {
  return Math.round(base * MB + step * MB * tick + Math.random() * step * MB)
}

function child(name: string, down: number, up: number, conns: number): TrafficStatChild {
  return { name, down, up, conns, last: Date.now() }
}

function buildStats(): TrafficStatsResult {
  tick++
  const domains: TrafficDomainStat[] = [
    {
      name: 'github.com',
      down: grow(180, 2.2),
      up: grow(4.5, 0.05),
      conns: 34,
      last: Date.now(),
      isIp: false,
      children: [
        child('api.github.com', grow(60, 0.8), grow(3, 0.04), 20),
        child('raw.githubusercontent.com', grow(45, 0.5), grow(0.8, 0.01), 9),
        child('objects.githubusercontent.com', grow(75, 0.9), grow(0.7, 0.01), 5)
      ]
    },
    {
      name: 'googlevideo.com',
      down: grow(320, 4.5),
      up: grow(1.2, 0.01),
      conns: 12,
      last: Date.now(),
      isIp: false,
      children: [
        child('rr3---sn-i3belney.googlevideo.com', grow(200, 3), grow(0.8, 0.01), 7),
        child('rr1---sn-i3b7kns6.googlevideo.com', grow(120, 1.5), grow(0.4, 0.01), 5)
      ]
    },
    {
      name: 'bilivideo.com',
      down: grow(96, 1.1),
      up: grow(0.6, 0.01),
      conns: 8,
      last: Date.now(),
      isIp: false,
      children: [child('upos-sz-mirrorcos.bilivideo.com', grow(96, 1.1), grow(0.6, 0.01), 8)]
    },
    {
      name: 'openai.com',
      down: grow(22, 0.15),
      up: grow(8, 0.09),
      conns: 15,
      last: Date.now(),
      isIp: false,
      children: [
        child('api.openai.com', grow(18, 0.12), grow(7.5, 0.09), 12),
        child('auth.openai.com', grow(4, 0.03), grow(0.5, 0.01), 3)
      ]
    },
    {
      name: 'cloudflare-dns.com',
      down: grow(0.4, 0.004),
      up: grow(0.2, 0.002),
      conns: 40,
      last: Date.now(),
      isIp: false,
      children: []
    },
    {
      name: 'IP 直连',
      down: grow(15, 0.3),
      up: grow(2, 0.04),
      conns: 6,
      last: Date.now(),
      isIp: true,
      children: [
        child('203.0.113.8', grow(9, 0.2), grow(1.2, 0.03), 4),
        child('198.51.100.4', grow(6, 0.1), grow(0.8, 0.01), 2)
      ]
    },
    {
      name: '(未知)',
      down: grow(0.9, 0.01),
      up: grow(0.05, 0.001),
      conns: 3,
      last: Date.now() - 3600_000,
      isIp: false,
      children: []
    }
  ]

  const apps: TrafficAppStat[] = [
    {
      key: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      name: 'chrome.exe',
      path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      down: grow(420, 5),
      up: grow(9, 0.08),
      conns: 52,
      last: Date.now(),
      domains: [
        child('googlevideo.com', grow(320, 4.5), grow(1.2, 0.01), 12),
        child('bilivideo.com', grow(96, 1.1), grow(0.6, 0.01), 8),
        child('cloudflare-dns.com', grow(0.4, 0.004), grow(0.2, 0.002), 40)
      ]
    },
    {
      key: 'C:\\Users\\Loong\\AppData\\Local\\Programs\\Git\\git.exe',
      name: 'git.exe',
      path: 'C:\\Users\\Loong\\AppData\\Local\\Programs\\Git\\git.exe',
      down: grow(150, 1.8),
      up: grow(3.5, 0.04),
      conns: 22,
      last: Date.now(),
      domains: [
        child('github.com', grow(140, 1.7), grow(3.2, 0.04), 20),
        child('openai.com', grow(10, 0.1), grow(0.3, 0.005), 2)
      ]
    },
    {
      key: '(unknown)',
      name: '未知应用',
      path: '',
      down: grow(15, 0.3),
      up: grow(2, 0.04),
      conns: 6,
      last: Date.now(),
      domains: [child('IP 直连', grow(15, 0.3), grow(2, 0.04), 6)]
    },
    {
      key: 'mihomo',
      name: 'mihomo（内核内部）',
      path: 'mihomo',
      down: grow(0.9, 0.01),
      up: grow(0.05, 0.001),
      conns: 3,
      last: Date.now() - 3600_000,
      domains: []
    }
  ]

  return {
    updatedAt: Date.now(),
    totalDown: domains.reduce((s, d) => s + d.down, 0),
    totalUp: domains.reduce((s, d) => s + d.up, 0),
    totalConns: domains.reduce((s, d) => s + d.conns, 0),
    domains,
    apps
  }
}

const handlers: Record<string, (...args: any[]) => any> = {
  getVersion: () => '1.26.8-preview',
  getAppConfig: () => appConfig,
  patchAppConfig: (patch: Record<string, any>) => {
    Object.assign(appConfig, patch)
    return appConfig
  },
  getControledMihomoConfig: () => ({
    'find-process-mode': 'always',
    'mixed-port': 7890,
    mode: 'rule'
  }),
  getProfileConfig: () => ({ items: [] }),
  getOverrideConfig: () => ({ items: [] }),
  mihomoGroups: () => [],
  mihomoRules: () => ({ rules: [] }),
  mihomoVersion: () => ({ version: 'v1.19.31-preview', meta: true }),
  getTrafficStats: () => buildStats(),
  getTrafficStatsSummary: (range?: TrafficStatsRange) => {
    const s = buildStats()
    void range
    return { down: s.totalDown, up: s.totalUp, conns: s.totalConns }
  },
  getDomainIcon: () => '',
  getIconDataURL: () => '',
  getAppName: () => '',
  getImageDataURL: () => '',
  getUserAgent: () => 'sparkle-preview',
  showFloatingWindow: () => undefined,
  quitApp: () => undefined,
  relaunchApp: () => undefined,
  checkUpdate: () => undefined,
  restartCore: () => undefined,
  startMonitor: () => undefined,
  getRuntimeConfig: () => ({}),
  getGistUrl: () => '',
  getAutoRunState: () => false,
  getSystemServiceState: () => 'not-installed',
  getConnections: () => ({ downloadTotal: 0, uploadTotal: 0, connections: [] }),
  mihomoConnections: () => ({ downloadTotal: 0, uploadTotal: 0, connections: [] }),
  getProcessMemoryInfo: () => ({}),
  createHeapSnapshot: () => '',
  getFilePath: () => [],
  resolveThemes: () => [],
  fetchThemes: () => [],
  calcTraffic: () => '0',
  notify: () => undefined,
  alert: () => undefined
}

function installMock(): void {
  const listeners = new Map<string, Set<(...args: any[]) => void>>()
  const on = (channel: string, cb: (...args: any[]) => void): unknown => {
    const set = listeners.get(channel) ?? new Set()
    set.add(cb)
    listeners.set(channel, set)
    return () => set.delete(cb)
  }
  const removeAllListeners = (channel?: string): void => {
    if (channel) listeners.delete(channel)
    else listeners.clear()
  }
  const ipcRenderer = {
    invoke: (channel: string, ...args: any[]): Promise<any> =>
      Promise.resolve(handlers[channel] ? handlers[channel](...args) : undefined),
    send: () => undefined,
    sendSync: () => undefined,
    postMessage: () => undefined,
    sendTo: () => undefined,
    sendToHost: () => undefined,
    on,
    once: on,
    addListener: on,
    off: (channel: string, cb: (...args: any[]) => void) => {
      listeners.get(channel)?.delete(cb)
    },
    removeListener: (channel: string, cb: (...args: any[]) => void) => {
      listeners.get(channel)?.delete(cb)
    },
    removeAllListeners,
    listeners: (channel: string) => Array.from(listeners.get(channel) ?? []),
    listenerCount: (channel: string) => listeners.get(channel)?.size ?? 0,
    emit: () => undefined,
    setMaxListeners: () => undefined,
    getMaxListeners: () => 10,
    prependListener: on,
    prependOnceListener: on,
    eventNames: () => Array.from(listeners.keys()),
    rawListeners: (channel: string) => Array.from(listeners.get(channel) ?? [])
  }

  const w = window as any
  if (!w.electron) {
    w.electron = {
      ipcRenderer,
      process: {
        platform: 'win32',
        versions: { electron: 'preview', chrome: 'preview', node: 'preview' },
        env: {}
      }
    }
  }
  if (!w.api) {
    w.api = { platform: 'win32', webUtils: {} }
  }

  const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  const GIT = 'C:\\Users\\Loong\\AppData\\Local\\Programs\\Git\\git.exe'
  const liveConns = [
    {
      id: 'mock-live-1',
      metadata: {
        network: 'tcp',
        type: 'tcp',
        sourceIP: '127.0.0.1',
        destinationIP: '140.82.112.5',
        destinationPort: '443',
        host: 'api.github.com',
        process: 'git.exe',
        processPath: GIT,
        sniffHost: ''
      },
      chains: ['🇺🇸 美国 01', 'GitHub 分组'],
      rule: 'DomainSuffix',
      rulePayload: 'github.com',
      upload: 1.2 * MB,
      download: 24 * MB,
      upStep: 0.015 * MB,
      downStep: 0.5 * MB
    },
    {
      id: 'mock-live-2',
      metadata: {
        network: 'tcp',
        type: 'tcp',
        sourceIP: '127.0.0.1',
        destinationIP: '103.44.56.28',
        destinationPort: '443',
        host: 'rr3---sn-i3belney.googlevideo.com',
        process: 'chrome.exe',
        processPath: CHROME,
        sniffHost: ''
      },
      chains: ['🇯🇵 日本 02', 'YouTube 分组'],
      rule: 'GEOSITE',
      rulePayload: 'google',
      upload: 0.4 * MB,
      download: 96 * MB,
      upStep: 0.005 * MB,
      downStep: 2.2 * MB
    },
    {
      id: 'mock-live-3',
      metadata: {
        network: 'tcp',
        type: 'tcp',
        sourceIP: '127.0.0.1',
        destinationIP: '183.131.51.24',
        destinationPort: '443',
        host: 'upos-sz-mirrorcos.bilivideo.com',
        process: 'chrome.exe',
        processPath: CHROME,
        sniffHost: ''
      },
      chains: ['DIRECT'],
      rule: 'DomainSuffix',
      rulePayload: 'bilivideo.com',
      upload: 0.2 * MB,
      download: 41 * MB,
      upStep: 0.003 * MB,
      downStep: 1.1 * MB
    },
    {
      id: 'mock-live-4',
      metadata: {
        network: 'tcp',
        type: 'tcp',
        sourceIP: '127.0.0.1',
        destinationIP: '203.0.113.8',
        destinationPort: '8443',
        host: '',
        process: '',
        processPath: '',
        sniffHost: ''
      },
      chains: ['DIRECT'],
      rule: 'Match',
      rulePayload: '',
      upload: 0.9 * MB,
      download: 6 * MB,
      upStep: 0.02 * MB,
      downStep: 0.3 * MB
    }
  ]

  setInterval(() => {
    const cbs = listeners.get('mihomoConnections')
    if (!cbs?.size) return
    const connections = liveConns.map(({ upStep, downStep, ...conn }, i) => {
      conn.upload += Math.round(upStep * (0.4 + Math.random()))
      conn.download += Math.round(downStep * (0.4 + Math.random()))
      return {
        ...conn,
        start: new Date(Date.now() - (i + 1) * 90000).toISOString(),
        isActive: true
      }
    })
    const info = {
      downloadTotal: connections.reduce((s, c) => s + c.download, 0),
      uploadTotal: connections.reduce((s, c) => s + c.upload, 0),
      connections,
      memory: 0
    }
    cbs.forEach((cb) => cb(null, info))
  }, 500)
}

if (!window.electron) {
  installMock()
}

export {}
