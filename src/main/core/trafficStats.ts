import { existsSync, readFileSync } from 'fs'
import { rename, writeFile } from 'fs/promises'
import path from 'path'
import { connDomainKey, etldOf, IP_GROUP_NAME, isIpAddress, UNKNOWN_DOMAIN } from '../../shared/domain'
import { trafficStatsPath } from '../utils/dirs'

interface StatBucket {
  down: number
  up: number
  conns: number
  last: number
}

interface AppBucket extends StatBucket {
  name: string
  path: string
  domains: Record<string, { down: number; up: number }>
}

interface DayStats {
  domains: Record<string, StatBucket>
  apps: Record<string, AppBucket>
}

interface TrafficStatsFile {
  version: number
  days: Record<string, DayStats>
}

const RETAIN_DAYS = 92
const MAX_APP_DOMAINS = 200
const OTHER_APP_DOMAIN = '(其他)'
const SAVE_INTERVAL = 15000
const MAX_CHILDREN = 20

let loaded = false
let stats: TrafficStatsFile = { version: 1, days: {} }
let session: DayStats = emptyDay()
const connTrack = new Map<string, { up: number; down: number }>()
let dirty = false
let saveTimer: NodeJS.Timeout | null = null
let updatedAt = 0

function emptyDay(): DayStats {
  return { domains: {}, apps: {} }
}

function dayKeyOf(t: number): string {
  const d = new Date(t)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}



function appKeyOf(md: ControllerConnectionDetail['metadata']): {
  key: string
  name: string
  path: string
} {
  if (md.type === 'Inner') {
    return { key: 'mihomo', name: 'mihomo（内核内部）', path: 'mihomo' }
  }
  const procPath = md.processPath || ''
  const procName = md.process || (procPath ? path.basename(procPath) : '')
  if (!procPath && !procName) {
    return { key: '(unknown)', name: '未知应用', path: '' }
  }
  return { key: procPath || procName, name: procName || path.basename(procPath), path: procPath }
}

function addToDay(
  day: DayStats,
  dKey: string,
  appInfo: { key: string; name: string; path: string },
  dUp: number,
  dDown: number,
  now: number,
  isNew: boolean
): void {
  const dom = (day.domains[dKey] ??= { down: 0, up: 0, conns: 0, last: 0 })
  dom.down += dDown
  dom.up += dUp
  dom.last = now
  if (isNew) dom.conns += 1

  const app = (day.apps[appInfo.key] ??= {
    down: 0,
    up: 0,
    conns: 0,
    last: 0,
    name: appInfo.name,
    path: appInfo.path,
    domains: {}
  })
  app.down += dDown
  app.up += dUp
  app.last = now
  app.name = appInfo.name
  app.path = appInfo.path
  if (isNew) app.conns += 1

  const dmap = app.domains
  let slot = dmap[dKey]
  if (!slot) {
    const capped = Object.keys(dmap).length >= MAX_APP_DOMAINS
    slot = dmap[capped ? OTHER_APP_DOMAIN : dKey] ??= { down: 0, up: 0 }
  }
  slot.down += dDown
  slot.up += dUp
}

function ensureLoaded(): void {
  if (loaded) return
  loaded = true
  try {
    if (existsSync(trafficStatsPath())) {
      const raw = JSON.parse(readFileSync(trafficStatsPath(), 'utf-8')) as TrafficStatsFile
      if (raw && typeof raw === 'object' && raw.days && typeof raw.days === 'object') {
        stats = raw
      }
    }
  } catch {
    // ignore corrupted file and start fresh
  }
}

function scheduleSave(): void {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    void flushTrafficStats()
  }, SAVE_INTERVAL)
}

function pruneDays(): void {
  const cutoff = dayKeyOf(Date.now() - RETAIN_DAYS * 86400000)
  for (const key of Object.keys(stats.days)) {
    if (key < cutoff) delete stats.days[key]
  }
}

export async function flushTrafficStats(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (!dirty || !loaded) return
  dirty = false
  try {
    pruneDays()
    const file = trafficStatsPath()
    const tmp = `${file}.tmp`
    await writeFile(tmp, JSON.stringify(stats))
    await rename(tmp, file)
  } catch {
    dirty = true
  }
}

export function ingestConnectionsSnapshot(info: ControllerConnections): void {
  ensureLoaded()
  const conns = info.connections ?? []
  const now = Date.now()
  const day = (stats.days[dayKeyOf(now)] ??= emptyDay())
  const seen = new Set<string>()

  for (const conn of conns) {
    seen.add(conn.id)
    const md = conn.metadata
    const dom = connDomainKey(md)
    const appInfo = appKeyOf(md)
    const prev = connTrack.get(conn.id)
    let dUp: number
    let dDown: number
    let isNew = false
    if (!prev || conn.upload < prev.up || conn.download < prev.down) {
      connTrack.set(conn.id, { up: conn.upload, down: conn.download })
      dUp = conn.upload
      dDown = conn.download
      isNew = true
    } else {
      dUp = conn.upload - prev.up
      dDown = conn.download - prev.down
      prev.up = conn.upload
      prev.down = conn.download
    }
    if (!isNew && dUp === 0 && dDown === 0) continue
    addToDay(day, dom.key, appInfo, dUp, dDown, now, isNew)
    addToDay(session, dom.key, appInfo, dUp, dDown, now, isNew)
    dirty = true
    updatedAt = now
  }

  for (const id of connTrack.keys()) {
    if (!seen.has(id)) connTrack.delete(id)
  }
  if (dirty) scheduleSave()
}

function collectDays(range: TrafficStatsRange): DayStats[] {
  if (range === 'run') return [session]
  if (range === 'all') return Object.values(stats.days)
  const count = range === 'week' ? 7 : range === 'month' ? 30 : 1
  const days: DayStats[] = []
  for (let i = 0; i < count; i++) {
    const d = stats.days[dayKeyOf(Date.now() - i * 86400000)]
    if (d) days.push(d)
  }
  return days
}

function mergeDays(days: DayStats[]): { domains: Record<string, StatBucket>; apps: Record<string, AppBucket> } {
  const domains: Record<string, StatBucket> = {}
  const apps: Record<string, AppBucket> = {}
  for (const day of days) {
    for (const [key, s] of Object.entries(day.domains)) {
      const d = (domains[key] ??= { down: 0, up: 0, conns: 0, last: 0 })
      d.down += s.down
      d.up += s.up
      d.conns += s.conns
      d.last = Math.max(d.last, s.last)
    }
    for (const [key, s] of Object.entries(day.apps)) {
      const a = (apps[key] ??= {
        down: 0,
        up: 0,
        conns: 0,
        last: 0,
        name: s.name,
        path: s.path,
        domains: {}
      })
      a.down += s.down
      a.up += s.up
      a.conns += s.conns
      a.last = Math.max(a.last, s.last)
      if (s.last >= a.last) {
        a.name = s.name
        a.path = s.path
      }
      for (const [dn, ds] of Object.entries(s.domains)) {
        const slot = (a.domains[dn] ??= { down: 0, up: 0 })
        slot.down += ds.down
        slot.up += ds.up
      }
    }
  }
  return { domains, apps }
}

function toChildren(map: Record<string, StatBucket | { down: number; up: number }>): TrafficStatChild[] {
  return Object.entries(map)
    .map(([name, s]) => ({
      name,
      down: s.down,
      up: s.up,
      conns: 'conns' in s ? s.conns : 0,
      last: 'last' in s ? s.last : 0
    }))
    .sort((a, b) => b.down + b.up - (a.down + a.up))
    .slice(0, MAX_CHILDREN)
}

export async function getTrafficStats(
  range: TrafficStatsRange = 'week',
  domainMode: TrafficStatsDomainMode = 'etld'
): Promise<TrafficStatsResult> {
  ensureLoaded()
  const merged = mergeDays(collectDays(range))

  let domains: TrafficDomainStat[]
  if (domainMode === 'etld') {
    const groups = new Map<string, { isIp: boolean; children: Record<string, StatBucket> }>()
    for (const [host, s] of Object.entries(merged.domains)) {
      const ip = isIpAddress(host) || host === UNKNOWN_DOMAIN
      const gk = ip ? IP_GROUP_NAME : etldOf(host)
      const g = groups.get(gk) ?? { isIp: ip, children: {} }
      g.children[host] = s
      groups.set(gk, g)
    }
    domains = [...groups.entries()].map(([name, g]) => {
      const children = Object.values(g.children)
      const agg = children.reduce(
        (acc, c) => ({
          down: acc.down + c.down,
          up: acc.up + c.up,
          conns: acc.conns + c.conns,
          last: Math.max(acc.last, c.last)
        }),
        { down: 0, up: 0, conns: 0, last: 0 }
      )
      return {
        name,
        isIp: g.isIp,
        ...agg,
        children: toChildren(g.children)
      }
    })
  } else {
    domains = Object.entries(merged.domains).map(([name, s]) => ({
      name,
      isIp: isIpAddress(name) || name === UNKNOWN_DOMAIN,
      ...s
    }))
  }
  domains.sort((a, b) => b.down + b.up - (a.down + a.up))

  const apps: TrafficAppStat[] = Object.entries(merged.apps)
    .map(([key, a]) => ({
      key,
      name: a.name,
      path: a.path,
      down: a.down,
      up: a.up,
      conns: a.conns,
      last: a.last,
      domains: toChildren(a.domains)
    }))
    .sort((a, b) => b.down + b.up - (a.down + a.up))

  return {
    updatedAt,
    totalDown: domains.reduce((s, d) => s + d.down, 0),
    totalUp: domains.reduce((s, d) => s + d.up, 0),
    totalConns: domains.reduce((s, d) => s + d.conns, 0),
    domains,
    apps
  }
}

export async function getTrafficStatsSummary(
  range: TrafficStatsRange = 'run'
): Promise<TrafficStatsSummary> {
  ensureLoaded()
  const merged = mergeDays(collectDays(range))
  let down = 0
  let up = 0
  let conns = 0
  for (const s of Object.values(merged.domains)) {
    down += s.down
    up += s.up
    conns += s.conns
  }
  return { down, up, conns }
}

export async function resetTrafficStats(): Promise<void> {
  ensureLoaded()
  stats = { version: 1, days: {} }
  session = emptyDay()
  dirty = true
  await flushTrafficStats()
}
