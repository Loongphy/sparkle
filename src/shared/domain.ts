export const UNKNOWN_DOMAIN = '(未知)'
export const IP_GROUP_NAME = 'IP 直连'

const SECOND_LEVEL_SUFFIXES = new Set([
  'com.cn',
  'net.cn',
  'org.cn',
  'gov.cn',
  'edu.cn',
  'ac.cn',
  'com.hk',
  'com.tw',
  'co.jp',
  'or.jp',
  'ne.jp',
  'co.kr',
  'co.uk',
  'org.uk',
  'ac.uk',
  'com.au',
  'net.au',
  'com.br',
  'com.mx',
  'co.in'
])

export function etldOf(host: string): string {
  const parts = host.split('.')
  if (parts.length <= 2) return host
  const last2 = parts.slice(-2).join('.')
  if (SECOND_LEVEL_SUFFIXES.has(last2) && parts.length >= 3) {
    return parts.slice(-3).join('.')
  }
  return last2
}

export function isIpAddress(s: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(s) || s.includes(':')
}

interface DomainMetadataLike {
  host?: string
  sniffHost?: string
  destinationIP?: string
}

export function connDomainKey(md: DomainMetadataLike): { key: string; isIp: boolean } {
  const host = (md.host || md.sniffHost || '').toLowerCase()
  if (host) return { key: host, isIp: isIpAddress(host) }
  if (md.destinationIP) return { key: md.destinationIP, isIp: true }
  return { key: UNKNOWN_DOMAIN, isIp: false }
}
