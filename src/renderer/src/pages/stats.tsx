import BasePage from '@renderer/components/base/base-page'
import StatItem, { StatChildRow, formatLastActive } from '@renderer/components/stats/stat-item'
import LiveConnsModal from '@renderer/components/stats/live-conns-modal'
import ConnectionDetailModal from '@renderer/components/connections/connection-detail-modal'
import {
  Badge,
  Button,
  Card,
  Chip,
  Divider,
  Input,
  Select,
  SelectItem,
  Tab,
  Tabs
} from '@heroui/react'
import { calcTraffic } from '@renderer/utils/calc'
import { includesIgnoreCase } from '@renderer/utils/includes'
import { STATS_REFRESH_INTERVAL } from '@renderer/utils/stats'
import { connDomainKey, etldOf, IP_GROUP_NAME, UNKNOWN_DOMAIN } from '../../../shared/domain'
import {
  getAppName,
  getDomainIcon,
  getIconDataURL,
  getTrafficStats,
  resetTrafficStats
} from '@renderer/utils/ipc'
import { cropAndPadTransparent } from '@renderer/utils/image'
import { platform } from '@renderer/utils/init'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { useControledMihomoConfig } from '@renderer/hooks/use-controled-mihomo-config'
import { notify } from '@renderer/utils/notification'
import { useTheme } from 'next-themes'
import React, { Key, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Virtuoso } from 'react-virtuoso'
import { CgTrash } from 'react-icons/cg'
import { HiSortAscending, HiSortDescending } from 'react-icons/hi'
import { IoPause, IoPlay } from 'react-icons/io5'
import { MdFileDownload, MdOutlinePublic } from 'react-icons/md'

const Stats: React.FC = () => {
  const { appConfig, patchAppConfig } = useAppConfig()
  const { controledMihomoConfig } = useControledMihomoConfig()
  const {
    statsRange = 'run',
    statsSortBy = 'total',
    statsSortDir = 'desc',
    statsHideDirect = false,
    connectionInterval = 500,
    displayIcon = true,
    displayAppName = true
  } = appConfig || {}
  const statsDomainMode: TrafficStatsDomainMode = 'etld'
  const { 'find-process-mode': findProcessMode = 'always' } = controledMihomoConfig || {}
  const { resolvedTheme } = useTheme()
  const preferDark = resolvedTheme === 'dark'
  const iconKey = useCallback((name: string) => `${name}|${preferDark ? 1 : 0}`, [preferDark])

  const [tab, setTab] = useState<'domain' | 'app'>('domain')
  const [filter, setFilter] = useState('')
  const [paused, setPaused] = useState(false)
  const [data, setData] = useState<TrafficStatsResult>()
  const [liveConns, setLiveConns] = useState<ControllerConnectionDetail[]>([])
  const [liveSel, setLiveSel] = useState<{ host: string; appKey?: string; iconUrl?: string }>()
  const [detailConn, setDetailConn] = useState<ControllerConnectionDetail>()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [resetArmed, setResetArmed] = useState(false)
  const pausedRef = useRef(paused)
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [iconMap, setIconMap] = useState<Record<string, string>>({})
  const [appNameCache, setAppNameCache] = useState<Record<string, string>>({})
  const [domainIconMap, setDomainIconMap] = useState<Record<string, string>>({})
  const iconQueue = useRef(new Set<string>())
  const processingIcons = useRef(new Set<string>())
  const iconTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const appNameQueue = useRef(new Set<string>())
  const processingAppNames = useRef(new Set<string>())
  const appNameTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const domainIconQueue = useRef(new Set<string>())
  const processingDomainIcons = useRef(new Set<string>())
  const requestedDomainIcons = useRef(new Set<string>())
  const domainIconTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  pausedRef.current = paused
  const livePrevRef = useRef(new Map<string, { down: number; up: number }>())

  useEffect(() => {
    const handler = (_e: unknown, info: ControllerConnections): void => {
      if (pausedRef.current) return
      const prev = livePrevRef.current
      const next = new Map<string, { down: number; up: number }>()
      const ratio = 1000 / connectionInterval
      const conns = (info.connections ?? []).map((conn) => {
        const p = prev.get(conn.id)
        next.set(conn.id, { down: conn.download, up: conn.upload })
        const metadata =
          conn.metadata.type === 'Inner'
            ? { ...conn.metadata, process: 'mihomo', processPath: 'mihomo' }
            : conn.metadata
        return {
          ...conn,
          metadata,
          isActive: true,
          downloadSpeed: p ? Math.max(0, Math.round((conn.download - p.down) * ratio)) : 0,
          uploadSpeed: p ? Math.max(0, Math.round((conn.upload - p.up) * ratio)) : 0
        }
      })
      livePrevRef.current = next
      setLiveConns(conns)
    }
    window.electron.ipcRenderer.on('mihomoConnections', handler)
    return (): void => {
      window.electron.ipcRenderer.removeAllListeners('mihomoConnections')
    }
  }, [connectionInterval])

  const liveDomainMap = useMemo(() => {
    const map = new Map<string, ControllerConnectionDetail[]>()
    for (const conn of liveConns) {
      const { key, isIp } = connDomainKey(conn.metadata)
      const ip = isIp || key === UNKNOWN_DOMAIN
      const gk = statsDomainMode === 'etld' ? (ip ? IP_GROUP_NAME : etldOf(key)) : key
      const arr = map.get(gk) ?? []
      arr.push(conn)
      map.set(gk, arr)
    }
    return map
  }, [liveConns, statsDomainMode])

  const liveHostMap = useMemo(() => {
    const map = new Map<string, ControllerConnectionDetail[]>()
    for (const conn of liveConns) {
      const { key } = connDomainKey(conn.metadata)
      const arr = map.get(key) ?? []
      arr.push(conn)
      map.set(key, arr)
    }
    return map
  }, [liveConns])

  const liveAppMap = useMemo(() => {
    const map = new Map<string, ControllerConnectionDetail[]>()
    for (const conn of liveConns) {
      const md = conn.metadata
      const key = md.processPath || md.process || '(unknown)'
      const arr = map.get(key) ?? []
      arr.push(conn)
      map.set(key, arr)
    }
    return map
  }, [liveConns])

  const openLiveConns = useCallback(
    (
      conns: ControllerConnectionDetail[],
      sel: { host: string; appKey?: string; iconUrl?: string }
    ) => {
      if (conns.length === 1) setDetailConn(conns[0])
      else setLiveSel(sel)
    },
    []
  )

  const liveModalConns = useMemo(() => {
    if (!liveSel) return []
    const pool =
      liveSel.appKey !== undefined ? (liveAppMap.get(liveSel.appKey) ?? []) : liveConns
    return pool.filter((c) => connDomainKey(c.metadata).key === liveSel.host)
  }, [liveSel, liveConns, liveAppMap])

  useEffect(() => {
    let mounted = true
    const load = async (): Promise<void> => {
      if (pausedRef.current) return
      try {
        const res = await getTrafficStats(statsRange, statsDomainMode)
        if (mounted) setData(res)
      } catch {
        // ignore
      }
    }
    void load()
    const timer = setInterval(load, STATS_REFRESH_INTERVAL)
    return (): void => {
      mounted = false
      clearInterval(timer)
    }
  }, [statsRange, statsDomainMode])

  const processIconQueue = useCallback(async () => {
    if (processingIcons.current.size >= 5 || iconQueue.current.size === 0) return
    const batch = Array.from(iconQueue.current).slice(0, 5)
    batch.forEach((p) => iconQueue.current.delete(p))
    await Promise.all(
      batch.map(async (p) => {
        if (processingIcons.current.has(p)) return
        processingIcons.current.add(p)
        try {
          const raw = await getIconDataURL(p)
          if (!raw) return
          let url = raw.startsWith('data:') ? raw : `data:image/png;base64,${raw}`
          if (platform !== 'darwin') url = await cropAndPadTransparent(url)
          try {
            localStorage.setItem(p, url)
          } catch {
            // ignore
          }
          setIconMap((prev) => ({ ...prev, [p]: url }))
        } catch {
          // ignore
        } finally {
          processingIcons.current.delete(p)
        }
      })
    )
    if (iconQueue.current.size > 0) {
      iconTimer.current = setTimeout(processIconQueue, 50)
    }
  }, [])

  const processAppNameQueue = useCallback(async () => {
    if (processingAppNames.current.size >= 3 || appNameQueue.current.size === 0) return
    const batch = Array.from(appNameQueue.current).slice(0, 3)
    batch.forEach((p) => appNameQueue.current.delete(p))
    await Promise.all(
      batch.map(async (p) => {
        if (processingAppNames.current.has(p)) return
        processingAppNames.current.add(p)
        try {
          const name = await getAppName(p)
          if (name) setAppNameCache((prev) => ({ ...prev, [p]: name }))
        } catch {
          // ignore
        } finally {
          processingAppNames.current.delete(p)
        }
      })
    )
    if (appNameQueue.current.size > 0) {
      appNameTimer.current = setTimeout(processAppNameQueue, 100)
    }
  }, [])

  const processDomainIconQueue = useCallback(async () => {
    if (processingDomainIcons.current.size >= 4 || domainIconQueue.current.size === 0) return
    const batch = Array.from(domainIconQueue.current).slice(0, 4)
    batch.forEach((d) => domainIconQueue.current.delete(d))
    await Promise.all(
      batch.map(async (d) => {
        if (processingDomainIcons.current.has(d)) return
        processingDomainIcons.current.add(d)
        try {
          const sep = d.lastIndexOf('|')
          const name = d.slice(0, sep)
          const url = await getDomainIcon(name, d.slice(sep + 1) === '1')
          if (url) setDomainIconMap((prev) => ({ ...prev, [d]: url }))
        } catch {
          // ignore
        } finally {
          processingDomainIcons.current.delete(d)
        }
      })
    )
    if (domainIconQueue.current.size > 0) {
      domainIconTimer.current = setTimeout(processDomainIconQueue, 50)
    }
  }, [])

  const requestDomainIcon = useCallback(
    (name: string) => {
      if (!name) return
      const key = iconKey(name)
      if (domainIconMap[key] || requestedDomainIcons.current.has(key)) return
      requestedDomainIcons.current.add(key)
      domainIconQueue.current.add(key)
      if (!domainIconTimer.current) {
        domainIconTimer.current = setTimeout(processDomainIconQueue, 10)
      }
    },
    [domainIconMap, processDomainIconQueue, iconKey]
  )

  const requestAppAssets = useCallback(
    (path: string) => {
      if (!path || path === 'mihomo') return
      if (displayIcon && findProcessMode !== 'off' && !iconMap[path]) {
        const cached = localStorage.getItem(path)
        if (cached) {
          setIconMap((prev) => (prev[path] ? prev : { ...prev, [path]: cached }))
        } else if (!processingIcons.current.has(path)) {
          iconQueue.current.add(path)
          if (!iconTimer.current) iconTimer.current = setTimeout(processIconQueue, 10)
        }
      }
      if (
        displayAppName &&
        !appNameCache[path] &&
        !processingAppNames.current.has(path)
      ) {
        appNameQueue.current.add(path)
        if (!appNameTimer.current) appNameTimer.current = setTimeout(processAppNameQueue, 10)
      }
    },
    [displayIcon, displayAppName, findProcessMode, iconMap, appNameCache, processIconQueue, processAppNameQueue]
  )

  useEffect(() => {
    return (): void => {
      if (iconTimer.current) clearTimeout(iconTimer.current)
      if (appNameTimer.current) clearTimeout(appNameTimer.current)
      if (domainIconTimer.current) clearTimeout(domainIconTimer.current)
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
    }
  }, [])

  const rawRows = useMemo<(TrafficDomainStat | TrafficAppStat)[]>(
    () => (tab === 'domain' ? (data?.domains ?? []) : (data?.apps ?? [])),
    [data, tab]
  )

  const rows = useMemo(() => {
    let list = rawRows
    if (tab === 'domain' && statsHideDirect) {
      list = list.filter((r) => !(r as TrafficDomainStat).isIp)
    }
    if (filter !== '') {
      list = list.filter((r) => {
        const name = 'name' in r ? r.name : ''
        const extra = tab === 'app' ? `${(r as TrafficAppStat).name} ${(r as TrafficAppStat).path}` : ''
        return (
          includesIgnoreCase(name, filter) ||
          includesIgnoreCase(extra, filter) ||
          ('children' in r && r.children?.some((c) => includesIgnoreCase(c.name, filter))) ||
          ('domains' in r && r.domains.some((c) => includesIgnoreCase(c.name, filter)))
        )
      })
    }
    const dir = statsSortDir === 'asc' ? 1 : -1
    const val = (r: TrafficDomainStat | TrafficAppStat): number => {
      switch (statsSortBy) {
        case 'down':
          return r.down
        case 'up':
          return r.up
        case 'conns':
          return r.conns
        case 'last':
          return r.last
        default:
          return r.down + r.up
      }
    }
    return [...list].sort((a, b) => (val(a) - val(b)) * dir)
  }, [rawRows, filter, statsSortBy, statsSortDir, statsHideDirect, tab])

  const maxRowTotal = useMemo(
    () => rows.reduce((m, r) => Math.max(m, r.down + r.up), 0),
    [rows]
  )
  const viewTotal = useMemo(() => rows.reduce((s, r) => s + r.down + r.up, 0), [rows])

  const toggleRow = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const handleReset = useCallback(async () => {
    if (!resetArmed) {
      setResetArmed(true)
      resetTimerRef.current = setTimeout(() => setResetArmed(false), 3000)
      return
    }
    setResetArmed(false)
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
    try {
      await resetTrafficStats()
      setData(undefined)
      setExpanded(new Set())
      notify('统计数据已清空', { variant: 'success' })
    } catch (e) {
      notify(e, { variant: 'danger' })
    }
  }, [resetArmed])

  const handleExport = useCallback(() => {
    const header = 'name,download_bytes,upload_bytes,total_bytes,connections\n'
    const body = rows
      .map((r) => {
        const name = tab === 'app' ? (r as TrafficAppStat).name : r.name
        return `"${name}",${r.down},${r.up},${r.down + r.up},${r.conns}`
      })
      .join('\n')
    const blob = new Blob(['﻿' + header + body], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `traffic-stats-${tab}-${statsRange}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
    notify('已导出 CSV', { variant: 'success' })
  }, [rows, tab, statsRange])

  const renderRow = useCallback(
    (index: number, row: TrafficDomainStat | TrafficAppStat) => {
      const total = row.down + row.up
      const share = viewTotal > 0 ? (total / viewTotal) * 100 : 0
      const barScale = maxRowTotal > 0 ? (total / maxRowTotal) * 100 : 0
      const rowKey = tab === 'app' ? (row as TrafficAppStat).key : row.name

      if (tab === 'app') {
        const app = row as TrafficAppStat
        const iconUrl = iconMap[app.path] || ''
        const displayName = displayAppName ? appNameCache[app.path] || app.name : app.name
        const live = liveAppMap.get(app.key) ?? []
        const liveByHost = new Map<string, ControllerConnectionDetail[]>()
        for (const conn of live) {
          const k = connDomainKey(conn.metadata).key
          const arr = liveByHost.get(k) ?? []
          arr.push(conn)
          liveByHost.set(k, arr)
        }
        const childNames = new Set(app.domains.map((d) => d.name))
        const leftoverByHost = new Map<string, ControllerConnectionDetail[]>()
        for (const conn of live) {
          const k = connDomainKey(conn.metadata).key
          if (childNames.has(k)) continue
          const arr = leftoverByHost.get(k) ?? []
          arr.push(conn)
          leftoverByHost.set(k, arr)
        }
        return (
          <StatItem
            key={rowKey}
            rank={index + 1}
            name={displayName}
            sub={
              <>
                {`${app.domains.length} 个域名 · ${row.conns} 连接`}
                {!live.length && ` · 最后活跃 ${formatLastActive(row.last)}`}
                {!!live.length && (
                  <span className="text-success">{` · ${live.length} 活跃`}</span>
                )}
              </>
            }
            down={row.down}
            up={row.up}
            iconUrl={iconUrl}
            letter={app.name}
            share={share}
            barScale={barScale}
            expanded={expanded.has(rowKey)}
            expandable={app.domains.length > 0 || live.length > 0}
            onToggle={() => toggleRow(rowKey)}
          >
            <div className="border-t border-divider mx-3 mb-2 px-2 pt-1">
              {app.domains.map((d) => {
                const clive = liveByHost.get(d.name) ?? []
                return (
                  <StatChildRow
                    key={d.name}
                    name={d.name}
                    sub={clive.length ? `${clive.length} 活跃` : undefined}
                    down={d.down}
                    up={d.up}
                    live={clive}
                    onOpen={
                      clive.length
                        ? () => openLiveConns(clive, { host: d.name, appKey: app.key, iconUrl })
                        : undefined
                    }
                  />
                )
              })}
              {[...leftoverByHost.entries()].map(([host, conns]) => (
                <StatChildRow
                  key={host}
                  name={host}
                  sub={`${conns.length} 活跃`}
                  down={conns.reduce((s, c) => s + c.download, 0)}
                  up={conns.reduce((s, c) => s + c.upload, 0)}
                  live={conns}
                  onOpen={() => openLiveConns(conns, { host, appKey: app.key, iconUrl })}
                />
              ))}
            </div>
          </StatItem>
        )
      }

      const dom = row as TrafficDomainStat
      const live = liveDomainMap.get(dom.name) ?? []
      const childNames = new Set((dom.children ?? []).map((c) => c.name))
      const leftoverByHost = new Map<string, ControllerConnectionDetail[]>()
      for (const conn of live) {
        const k = connDomainKey(conn.metadata).key
        if (childNames.has(k)) continue
        const arr = leftoverByHost.get(k) ?? []
        arr.push(conn)
        leftoverByHost.set(k, arr)
      }
      const domIconUrl = domainIconMap[iconKey(dom.name)] || ''
      return (
        <StatItem
          key={rowKey}
          rank={index + 1}
          name={dom.name}
          sub={
            <>
              {statsDomainMode === 'etld'
                ? `${dom.children?.length ?? 0} 个主机名 · ${row.conns} 连接`
                : `${row.conns} 连接`}
              {!live.length && ` · 最后活跃 ${formatLastActive(row.last)}`}
              {!!live.length && (
                <span className="text-success">{` · ${live.length} 活跃`}</span>
              )}
            </>
          }
          down={row.down}
          up={row.up}
          isIp={dom.isIp}
          iconUrl={domainIconMap[iconKey(dom.name)] || ''}
          share={share}
          barScale={barScale}
          expanded={expanded.has(rowKey)}
          expandable={
            (statsDomainMode === 'etld' && (dom.children?.length ?? 0) > 0) || live.length > 0
          }
          onToggle={() => toggleRow(rowKey)}
        >
          <div className="border-t border-divider mx-3 mb-2 px-2 pt-1">
            {(dom.children ?? []).map((c) => {
              const clive = liveHostMap.get(c.name) ?? []
              return (
                <StatChildRow
                  key={c.name}
                  name={c.name}
                  sub={`${c.conns} 连接${clive.length ? ` · ${clive.length} 活跃` : ''}`}
                  down={c.down}
                  up={c.up}
                  live={clive}
                  onOpen={
                    clive.length
                      ? () => openLiveConns(clive, { host: c.name, iconUrl: domIconUrl })
                      : undefined
                  }
                />
              )
            })}
            {[...leftoverByHost.entries()].map(([host, conns]) => (
              <StatChildRow
                key={host}
                name={host}
                sub={`${conns.length} 活跃`}
                down={conns.reduce((s, c) => s + c.download, 0)}
                up={conns.reduce((s, c) => s + c.upload, 0)}
                live={conns}
                onOpen={() => openLiveConns(conns, { host, iconUrl: domIconUrl })}
              />
            ))}
          </div>
        </StatItem>
      )
    },
    [
      tab,
      viewTotal,
      maxRowTotal,
      iconMap,
      appNameCache,
      domainIconMap,
      iconKey,
      displayAppName,
      expanded,
      toggleRow,
      statsDomainMode,
      liveAppMap,
      liveDomainMap,
      liveHostMap,
      openLiveConns
    ]
  )

  useEffect(() => {
    if (tab !== 'app' || findProcessMode === 'off') return
    rows.slice(0, 50).forEach((r) => requestAppAssets((r as TrafficAppStat).path))
  }, [rows, tab, findProcessMode, requestAppAssets])

  useEffect(() => {
    if (tab !== 'domain') return
    rows.slice(0, 50).forEach((r) => {
      const d = r as TrafficDomainStat
      if (!d.isIp) requestDomainIcon(d.name)
    })
  }, [rows, tab, requestDomainIcon])

  const domainCount = data?.domains.length ?? 0
  const appCount = data?.apps.length ?? 0

  return (
    <>
      <BasePage
        title="流量统计"
      header={
        <>
          <Select
            size="sm"
            variant="bordered"
            className="w-28 app-nodrag"
            selectedKeys={[statsRange]}
            aria-label="统计范围"
            onSelectionChange={(keys) => {
              const v = (keys as { currentKey?: Key }).currentKey as TrafficStatsRange
              if (v) void patchAppConfig({ statsRange: v })
            }}
          >
            <SelectItem key="run">本次运行</SelectItem>
            <SelectItem key="day">今日</SelectItem>
            <SelectItem key="week">近 7 天</SelectItem>
            <SelectItem key="month">近 30 天</SelectItem>
            <SelectItem key="all">累计</SelectItem>
          </Select>
          <Button
            size="sm"
            isIconOnly
            className="app-nodrag"
            variant="light"
            aria-label={paused ? '继续刷新' : '暂停刷新'}
            onPress={() => setPaused((p) => !p)}
          >
            {paused ? <IoPlay className="text-lg" /> : <IoPause className="text-lg" />}
          </Button>
          <Button
            size="sm"
            isIconOnly
            className="app-nodrag"
            variant="light"
            aria-label="导出 CSV"
            onPress={handleExport}
          >
            <MdFileDownload className="text-lg" />
          </Button>
          <Button
            size="sm"
            className="app-nodrag"
            isIconOnly={!resetArmed}
            variant="light"
            color={resetArmed ? 'danger' : 'default'}
            aria-label="清空统计"
            onPress={handleReset}
          >
            {resetArmed ? '确认清空?' : <CgTrash className="text-lg" />}
          </Button>
        </>
      }
    >
      <div className="sticky top-0 z-40 bg-background/95 backdrop-blur-sm">
        <div className="flex p-2 gap-2 items-center flex-wrap">
          <Tabs
            size="sm"
            color="primary"
            selectedKey={tab}
            variant="underlined"
            className="w-fit h-8"
            onSelectionChange={(k) => {
              setTab(k as 'domain' | 'app')
              setExpanded(new Set())
            }}
          >
            <Tab
              key="domain"
              title={
                <Badge
                  color={tab === 'domain' ? 'primary' : 'default'}
                  size="sm"
                  shape="circle"
                  variant="flat"
                  content={domainCount}
                  showOutline={false}
                >
                  <span className="p-1">按域名</span>
                </Badge>
              }
            />
            <Tab
              key="app"
              title={
                <Badge
                  color={tab === 'app' ? 'primary' : 'default'}
                  size="sm"
                  shape="circle"
                  variant="flat"
                  content={appCount}
                  showOutline={false}
                >
                  <span className="p-1">按应用</span>
                </Badge>
              }
            />
          </Tabs>
          <div className="flex-1" />
          <Input
            size="sm"
            variant="bordered"
            className="w-44"
            value={filter}
            placeholder="筛选过滤"
            isClearable
            onValueChange={setFilter}
          />
          <Button
            size="sm"
            variant={statsHideDirect ? 'bordered' : 'flat'}
            color={statsHideDirect ? 'default' : 'primary'}
            className="app-nodrag"
            aria-label="显示直连流量"
            onPress={() => void patchAppConfig({ statsHideDirect: !statsHideDirect })}
          >
            显示直连
          </Button>
          <Select
            size="sm"
            variant="bordered"
            className="w-32"
            selectedKeys={[statsSortBy]}
            aria-label="排序方式"
            onSelectionChange={(keys) => {
              const v = (keys as { currentKey?: Key }).currentKey as TrafficStatsSortBy
              if (v) void patchAppConfig({ statsSortBy: v })
            }}
          >
            <SelectItem key="total">按总流量</SelectItem>
            <SelectItem key="down">按下载</SelectItem>
            <SelectItem key="up">按上传</SelectItem>
            <SelectItem key="conns">按连接数</SelectItem>
            <SelectItem key="last">按最近活跃</SelectItem>
          </Select>
          <Button
            size="sm"
            isIconOnly
            variant="light"
            aria-label="排序方向"
            onPress={() =>
              void patchAppConfig({ statsSortDir: statsSortDir === 'asc' ? 'desc' : 'asc' })
            }
          >
            {statsSortDir === 'asc' ? (
              <HiSortAscending className="text-lg" />
            ) : (
              <HiSortDescending className="text-lg" />
            )}
          </Button>
        </div>
        <div className="px-3 pb-2 flex items-center gap-2 text-xs text-foreground-500">
          <MdOutlinePublic className="flex-none" />
          <span>
            基于内核连接快照采样（间隔 {connectionInterval}ms），仅统计经过内核的流量；已断开连接末尾的少量流量可能未计入
          </span>
          {tab === 'app' && findProcessMode === 'off' && (
            <Chip size="sm" color="warning" variant="flat">
              进程识别已关闭，无法按应用统计
            </Chip>
          )}
          {paused && (
            <Chip size="sm" color="warning" variant="flat">
              已暂停刷新
            </Chip>
          )}
        </div>
        <Divider />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 px-2 pt-2">
        <Card className="px-3 py-2 gap-1">
          <div className="text-xs text-foreground-500">累计下载</div>
          <div className="text-lg font-bold text-primary tabular-nums">
            ↓ {calcTraffic(data?.totalDown ?? 0)}
          </div>
        </Card>
        <Card className="px-3 py-2 gap-1">
          <div className="text-xs text-foreground-500">累计上传</div>
          <div className="text-lg font-bold text-success tabular-nums">
            ↑ {calcTraffic(data?.totalUp ?? 0)}
          </div>
        </Card>
        <Card className="px-3 py-2 gap-1">
          <div className="text-xs text-foreground-500">统计条目</div>
          <div className="text-lg font-bold tabular-nums">
            {tab === 'domain' ? `${domainCount} 个域名` : `${appCount} 个应用`}
          </div>
        </Card>
        <Card className="px-3 py-2 gap-1">
          <div className="text-xs text-foreground-500">累计连接</div>
          <div className="text-lg font-bold tabular-nums">
            {(data?.totalConns ?? 0).toLocaleString()}
          </div>
        </Card>
      </div>

      <div className="h-[calc(100vh-226px)] mt-2">
        {rows.length === 0 ? (
          <div className="h-full flex items-center justify-center text-foreground-500 text-sm">
            {data ? '没有匹配的统计记录' : '暂无统计数据，等待内核连接产生流量…'}
          </div>
        ) : (
          <Virtuoso data={rows} itemContent={renderRow} />
        )}
      </div>
      </BasePage>
      {liveSel && (
        <LiveConnsModal
          title={liveSel.host}
          conns={liveModalConns}
          hideProcess={liveSel.appKey !== undefined}
          iconUrl={liveSel.iconUrl}
          onClose={() => setLiveSel(undefined)}
        />
      )}
      {detailConn && (
        <ConnectionDetailModal
          connection={detailConn}
          onClose={() => setDetailConn(undefined)}
        />
      )}
    </>
  )
}

export default Stats
