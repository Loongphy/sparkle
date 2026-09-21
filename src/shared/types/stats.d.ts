type TrafficStatsRange = 'run' | 'day' | 'week' | 'month' | 'all'
type TrafficStatsDomainMode = 'host' | 'etld'
type TrafficStatsSortBy = 'total' | 'down' | 'up' | 'conns' | 'last'

interface TrafficStatChild {
  name: string
  down: number
  up: number
  conns: number
  last: number
}

interface TrafficDomainStat {
  name: string
  down: number
  up: number
  conns: number
  last: number
  isIp: boolean
  children?: TrafficStatChild[]
}

interface TrafficAppStat {
  key: string
  name: string
  path: string
  down: number
  up: number
  conns: number
  last: number
  domains: TrafficStatChild[]
}

interface TrafficStatsResult {
  updatedAt: number
  totalDown: number
  totalUp: number
  totalConns: number
  domains: TrafficDomainStat[]
  apps: TrafficAppStat[]
}

interface TrafficStatsSummary {
  down: number
  up: number
  conns: number
}
