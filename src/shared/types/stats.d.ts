type TrafficStatsRange = 'run' | 'day' | 'week' | 'month' | 'all'
type TrafficStatsDomainMode = 'host' | 'etld'
type TrafficStatsSortBy = 'total' | 'down' | 'up' | 'conns' | 'last'

interface TrafficRouteStat {
  rule: string
  node: string
  direct: boolean
  down: number
  up: number
  conns: number
}

interface TrafficStatChild {
  name: string
  down: number
  up: number
  conns: number
  last: number
  routes?: TrafficRouteStat[]
}

interface TrafficDomainStat {
  name: string
  down: number
  up: number
  conns: number
  last: number
  isIp: boolean
  routes?: TrafficRouteStat[]
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
  routes?: TrafficRouteStat[]
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
