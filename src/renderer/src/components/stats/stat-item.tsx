import { Card, Chip } from '@heroui/react'
import { calcTraffic } from '@renderer/utils/calc'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'
import dayjs from 'dayjs'
import React, { memo } from 'react'
import { MdOutlinePublic } from 'react-icons/md'

dayjs.extend(relativeTime)
dayjs.locale('zh-cn')

interface StatRowProps {
  rank: number
  name: string
  sub?: React.ReactNode
  down: number
  up: number
  conns?: number
  last?: number
  isIp?: boolean
  iconUrl?: string
  letter?: string
  share: number
  barScale: number
  expanded?: boolean
  expandable?: boolean
  children?: React.ReactNode
  onToggle?: () => void
}

const StatItemComponent: React.FC<StatRowProps> = ({
  rank,
  name,
  sub,
  down,
  up,
  iconUrl,
  letter,
  share,
  barScale,
  expanded,
  expandable,
  children,
  onToggle
}) => {
  const total = down + up
  const downPct = total > 0 ? (down / total) * 100 : 0

  return (
    <div className="px-2 pb-2">
      <Card as="div" className="w-full">
        <div
          className={`flex items-center gap-3 px-3 py-2.5 ${expandable ? 'cursor-pointer select-none' : ''}`}
          role={expandable ? 'button' : undefined}
          tabIndex={expandable ? 0 : undefined}
          onClick={expandable ? onToggle : undefined}
          onKeyDown={
            expandable
              ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onToggle?.()
                  }
                }
              : undefined
          }
        >
          <div
            className={`w-6 text-center text-[13px] font-bold tabular-nums ${
              rank === 1
                ? 'text-yellow-500'
                : rank === 2
                  ? 'text-gray-300'
                  : rank === 3
                    ? 'text-amber-700'
                    : 'text-foreground-500'
            }`}
          >
            {rank}
          </div>
          {iconUrl ? (
            <img src={iconUrl} className="w-9 h-9 rounded-lg object-contain flex-none" />
          ) : (
            <div className="w-9 h-9 rounded-lg flex-none bg-content2 flex items-center justify-center text-foreground-500 text-sm font-bold">
              {letter ? letter[0]?.toUpperCase() : <MdOutlinePublic className="text-lg" />}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="truncate text-[13px] font-medium">{name}</div>
            {sub && <div className="truncate text-xs text-foreground-500">{sub}</div>}
          </div>
          <div className="w-44 hidden md:flex items-center gap-2 flex-none">
            <div className="flex-1 h-2 rounded-full bg-content2 overflow-hidden">
              <div className="flex h-full" style={{ width: `${barScale}%` }}>
                <div className="bg-primary h-full" style={{ width: `${downPct}%` }} />
                <div className="bg-success h-full" style={{ width: `${100 - downPct}%` }} />
              </div>
            </div>
            <span className="text-xs text-foreground-500 w-11 text-right tabular-nums">
              {share.toFixed(1)}%
            </span>
          </div>
          <div className="w-40 text-right flex-none tabular-nums flex items-center justify-end gap-2">
            <div className="text-[13px] font-bold">{calcTraffic(total)}</div>
            <div className="w-20">
              <div className="text-xs text-success whitespace-nowrap flex justify-between gap-1">
                <span>↑</span>
                <span>{calcTraffic(up)}</span>
              </div>
              <div className="text-xs text-primary whitespace-nowrap flex justify-between gap-1">
                <span>↓</span>
                <span>{calcTraffic(down)}</span>
              </div>
            </div>
          </div>
        </div>
        {expanded && children}
      </Card>
    </div>
  )
}

export const StatChildRow: React.FC<{
  name: string
  sub?: React.ReactNode
  down: number
  up: number
  live?: ControllerConnectionDetail[]
  routes?: TrafficRouteStat[]
  onOpen?: () => void
}> = ({ name, sub, down, up, live, routes, onOpen }) => {
  const total = down + up
  const liveConns = live ?? []
  const liveDownSpeed = liveConns.reduce((s, c) => s + (c.downloadSpeed ?? 0), 0)
  const liveUpSpeed = liveConns.reduce((s, c) => s + (c.uploadSpeed ?? 0), 0)
  const liveNodes = [...new Set(liveConns.map((c) => c.chains[0]).filter(Boolean))]
  const liveRules = [
    ...new Set(
      liveConns
        .map((c) => (c.rule ? `${c.rule}${c.rulePayload ? ` (${c.rulePayload})` : ''}` : ''))
        .filter(Boolean)
    )
  ]
  const nodes = [
    ...new Set([...liveNodes, ...(routes ?? []).map((r) => r.node).filter(Boolean)])
  ]
  const rules = [
    ...new Set([...liveRules, ...(routes ?? []).map((r) => r.rule).filter(Boolean)])
  ]
  return (
    <div
      className={`flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-content2/60 ${onOpen ? 'cursor-pointer' : ''}`}
      role={onOpen ? 'button' : undefined}
      onClick={onOpen}
    >
      <div className="flex-1 min-w-0">
        <div className="truncate text-[12px] flex items-center gap-1.5">
          <span
            className={`w-1.5 h-1.5 rounded-full flex-none ${liveConns.length ? 'bg-success animate-pulse' : ''}`}
          />
          {name}
        </div>
        {(sub || !!liveConns.length) && (
          <div className="truncate text-[11px] pl-3 flex items-center gap-2">
            {sub && <span className="text-foreground-500">{sub}</span>}
            {!!liveConns.length && (
              <span className="tabular-nums">
                <span className="text-primary">↓{calcTraffic(liveDownSpeed)}/s</span>{' '}
                <span className="text-success">↑{calcTraffic(liveUpSpeed)}/s</span>
              </span>
            )}
          </div>
        )}
      </div>
      <div className="hidden lg:flex flex-1 min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5">
        {!!nodes.length && (
          <div className="flex flex-wrap items-center gap-1">
            {nodes.map((n) => (
              <Chip
                key={n}
                size="sm"
                radius="sm"
                variant="bordered"
                className="max-w-64"
                title={n}
              >
                <span className="truncate text-[10px]">{n}</span>
              </Chip>
            ))}
          </div>
        )}
        {!!rules.length && (
          <div className="flex flex-wrap items-center gap-1">
            {rules.map((r) => (
              <Chip
                key={r}
                size="sm"
                radius="sm"
                variant="flat"
                color="secondary"
                className="max-w-64"
                title={r}
              >
                <span className="truncate text-[10px]">{r}</span>
              </Chip>
            ))}
          </div>
        )}
      </div>
      <div className="w-40 text-right flex-none tabular-nums flex items-center justify-end gap-2">
        <div className="text-[12px] font-medium">{calcTraffic(total)}</div>
        <div className="w-16">
          <div className="text-[10px] text-success whitespace-nowrap flex justify-between gap-1">
            <span>↑</span>
            <span>{calcTraffic(up)}</span>
          </div>
          <div className="text-[10px] text-primary whitespace-nowrap flex justify-between gap-1">
            <span>↓</span>
            <span>{calcTraffic(down)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export function formatLastActive(last?: number): string {
  if (!last) return ''
  return dayjs(last).fromNow()
}

export default memo(StatItemComponent)
