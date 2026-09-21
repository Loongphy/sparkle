import axios from 'axios'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import path from 'path'
import { getAppConfig, getControledMihomoConfig } from '../config'
import { etldOf, isIpAddress } from '../../shared/domain'
import { dataDir } from './dirs'

const HIT_TTL = 90 * 24 * 3600 * 1000
const MISS_TTL = 7 * 24 * 3600 * 1000
const MAX_ENTRIES = 5000
const MAX_BYTES = 128 * 1024
const MAX_HTML_BYTES = 2 * 1024 * 1024
const FETCH_TIMEOUT = 5000
const HTML_TIMEOUT = 8000
const DOMAIN_RE = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/

const LINK_RE = /<link\b[^>]*>/gi
const REL_ICON_RE = /rel\s*=\s*["'][^"']*icon/i
const MEDIA_DARK_RE = /media\s*=\s*["'][^"']*prefers-color-scheme\s*:\s*dark[^"']*["']/i
const HREF_RE = /href\s*=\s*["']([^"']+)["']/i
const TYPE_SVG_RE = /type\s*=\s*["']image\/svg\+xml["']/i
const EXT_RE = /\.(svg|png|ico|jpe?g|webp|gif)(\?|#|$)/i
const MEDIA_ATTR_RE = /media\s*=\s*["']([^"']+)["']/i
const SIZES_ATTR_RE = /sizes\s*=\s*["']([^"']+)["']/i
const MEDIA_LIGHT_RE = /prefers-color-scheme\s*:\s*light/i
const DARK_DERIVE_TRIES = 5
const HOMEPAGE_ICON_TRIES = 3

interface IconIndexEntry {
  file?: string
  mime?: string
  darkFile?: string
  darkMime?: string
  miss?: boolean
  darkMiss?: boolean
  darkAt?: number
  at: number
}

let indexLoaded = false
let index: Record<string, IconIndexEntry> = {}
let saveTimer: NodeJS.Timeout | null = null
const inflight = new Map<string, Promise<void>>()

function iconDir(): string {
  const dir = path.join(dataDir(), 'favicons')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

function ensureIndex(): void {
  if (indexLoaded) return
  indexLoaded = true
  try {
    index = JSON.parse(readFileSync(path.join(iconDir(), 'index.json'), 'utf-8'))
  } catch {
    index = {}
  }
}

function scheduleSave(): void {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    try {
      writeFileSync(path.join(iconDir(), 'index.json'), JSON.stringify(index))
    } catch {
      // ignore
    }
  }, 1000)
}

function evictIfNeeded(): void {
  const keys = Object.keys(index)
  if (keys.length <= MAX_ENTRIES) return
  const sorted = keys.sort((a, b) => index[a].at - index[b].at)
  const dir = iconDir()
  for (const k of sorted.slice(0, keys.length - MAX_ENTRIES)) {
    for (const f of [index[k].file, index[k].darkFile]) {
      if (f) {
        try {
          unlinkSync(path.join(dir, f))
        } catch {
          // ignore
        }
      }
    }
    delete index[k]
  }
}

function sniffMime(head: string, buf: Buffer): string {
  if (head.startsWith('<svg')) return 'image/svg+xml'
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png'
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg'
  if (buf[0] === 0x47 && buf[1] === 0x49) return 'image/gif'
  if (buf[0] === 0x52 && buf[1] === 0x49) return 'image/webp'
  return 'image/x-icon'
}

async function proxyConf(): Promise<{ host: string; port: number } | undefined> {
  const { 'mixed-port': port = 7890 } = await getControledMihomoConfig()
  return port != 0 ? { host: '127.0.0.1', port } : undefined
}

async function fetchIcon(url: string): Promise<{ buf: Buffer; mime: string } | undefined> {
  const res = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: FETCH_TIMEOUT,
    maxContentLength: MAX_BYTES,
    maxBodyLength: MAX_BYTES,
    validateStatus: (s) => s === 200,
    proxy: await proxyConf()
  })
  const mime = String(res.headers['content-type'] || '')
    .split(';')[0]
    .trim()
    .toLowerCase()
  const buf = Buffer.from(res.data)
  if (!buf.length || buf.length > MAX_BYTES || mime.includes('text/html')) return undefined
  const head = buf.slice(0, 256).toString('utf-8').trimStart().toLowerCase()
  if (head.startsWith('<!doctype') || head.startsWith('<html')) return undefined
  const finalMime = mime.startsWith('image/') ? mime : sniffMime(head, buf)
  return { buf, mime: finalMime }
}

async function fetchByHref(
  host: string,
  href?: string
): Promise<{ buf: Buffer; mime: string } | undefined> {
  if (!href) return undefined
  if (href.startsWith('data:')) {
    const m = /^data:(image\/[^;,]+)?(;base64)?,([\s\S]*)$/s.exec(href)
    if (!m) return undefined
    const buf = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]))
    if (buf.length && buf.length <= MAX_BYTES) {
      return { buf, mime: m[1] || 'image/x-icon' }
    }
    return undefined
  }
  const url = new URL(href, `https://${host}/`).toString()
  if (!url.startsWith('http')) return undefined
  return await fetchIcon(url)
}

async function fetchHomepage(host: string): Promise<string> {
  const res = await axios.get(`https://${host}/`, {
    responseType: 'text',
    timeout: HTML_TIMEOUT,
    maxContentLength: MAX_HTML_BYTES,
    maxBodyLength: MAX_HTML_BYTES,
    validateStatus: (s) => s >= 200 && s < 400,
    headers: {
      Accept: 'text/html,application/xhtml+xml,*/*;q=0.1',
      'Sec-CH-Prefers-Color-Scheme': 'dark'
    },
    proxy: await proxyConf()
  })
  // 重定向到其他 eTLD（如登录墙）时，HTML 里的图标属于落地域名而非本域名
  const finalUrl = res.request?.res?.responseUrl
  if (finalUrl) {
    try {
      const finalHost = new URL(finalUrl).hostname.toLowerCase()
      if (etldOf(finalHost) !== host) return ''
    } catch {
      return ''
    }
  }
  return typeof res.data === 'string' ? res.data : ''
}

async function fetchHomepageIcon(
  host: string,
  html: string
): Promise<{ buf: Buffer; mime: string } | undefined> {
  const tags = (html.match(LINK_RE) ?? []).filter((t) => REL_ICON_RE.test(t))
  const cands: { href: string; score: number }[] = []
  for (const tag of tags) {
    const href = HREF_RE.exec(tag)?.[1]
    if (!href) continue
    const media = MEDIA_ATTR_RE.exec(tag)?.[1]
    if (media && MEDIA_DARK_RE.test(tag) && !MEDIA_LIGHT_RE.test(media)) continue
    const sizes = SIZES_ATTR_RE.exec(tag)?.[1] ?? ''
    const sz = /(\d+)x(\d+)/.exec(sizes)
    let score = sz ? Math.min(parseInt(sz[1], 10), 256) : 16
    if (/rel\s*=\s*["']icon["']/i.test(tag)) score += 1000
    else if (/shortcut/i.test(tag)) score += 400
    else if (/apple-touch-icon/i.test(tag)) score += 300
    else if (/mask-icon|fluid-icon/i.test(tag)) score -= 500
    cands.push({ href, score })
  }
  cands.sort((a, b) => b.score - a.score)
  for (const c of cands.slice(0, HOMEPAGE_ICON_TRIES)) {
    const icon = await fetchByHref(host, c.href).catch(() => undefined)
    if (icon) return icon
  }
  return undefined
}

async function fetchDarkIcon(
  host: string,
  html: string
): Promise<{ buf: Buffer; mime: string } | undefined> {
  const tags = (html.match(LINK_RE) ?? []).filter((t) => REL_ICON_RE.test(t))

  // 1) explicit dark variant declared via media="(prefers-color-scheme: dark)"
  for (const tag of tags) {
    if (!MEDIA_DARK_RE.test(tag)) continue
    const icon = await fetchByHref(host, HREF_RE.exec(tag)?.[1]).catch(() => undefined)
    if (icon) return icon
  }

  // 2) derive from primary icons: adaptive SVG or "<name>-dark.<ext>" convention
  let tried = 0
  for (const tag of tags) {
    if (MEDIA_DARK_RE.test(tag) || tried >= DARK_DERIVE_TRIES) continue
    const href = HREF_RE.exec(tag)?.[1]
    if (!href || href.startsWith('data:')) continue
    tried++
    let url: string
    try {
      url = new URL(href, `https://${host}/`).toString()
    } catch {
      continue
    }
    if (!url.startsWith('http')) continue
    // adaptive svg: self-switches via embedded prefers-color-scheme css
    if (TYPE_SVG_RE.test(tag) || EXT_RE.exec(url)?.[1].toLowerCase() === 'svg') {
      const icon = await fetchIcon(url).catch(() => undefined)
      if (icon && /prefers-color-scheme/i.test(icon.buf.toString('utf-8'))) return icon
    }
    // naming convention: favicon.svg -> favicon-dark.svg
    const darkUrl = url.replace(EXT_RE, (_m, ext, tail) => `-dark.${ext}${tail}`)
    if (darkUrl !== url) {
      const icon = await fetchIcon(darkUrl).catch(() => undefined)
      if (icon) return icon
    }
  }
  return undefined
}

function fileReady(file?: string): boolean {
  return !!file && existsSync(path.join(iconDir(), file))
}

function pickIcon(entry: IconIndexEntry | undefined, preferDark: boolean): string {
  if (!entry) return ''
  const candidates = preferDark
    ? [
        [entry.darkFile, entry.darkMime],
        [entry.file, entry.mime]
      ]
    : [
        [entry.file, entry.mime],
        [entry.darkFile, entry.darkMime]
      ]
  for (const [file, mime] of candidates) {
    if (!file || !mime || !fileReady(file)) continue
    return `data:${mime};base64,${readFileSync(path.join(iconDir(), file)).toString('base64')}`
  }
  return ''
}

async function resolveIcon(host: string, preferDark: boolean): Promise<void> {
  const { faviconServiceFallback = true } = await getAppConfig()
  const entry = (index[host] ??= { at: Date.now() })
  entry.at = Date.now()

  let homepage: string | undefined
  const getHomepage = async (): Promise<string> => {
    homepage ??= await fetchHomepage(host).catch(() => '')
    return homepage
  }

  if (!fileReady(entry.file)) {
    let icon = await fetchIcon(`https://${host}/favicon.ico`).catch(() => undefined)
    if (!icon) {
      const html = await getHomepage()
      if (html) icon = await fetchHomepageIcon(host, html).catch(() => undefined)
    }
    if (!icon && faviconServiceFallback) {
      icon = await fetchIcon(
        `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`
      ).catch(() => undefined)
    }
    if (icon) {
      const file = createHash('sha1').update(host).digest('hex')
      writeFileSync(path.join(iconDir(), file), icon.buf)
      entry.file = file
      entry.mime = icon.mime
      entry.miss = false
    } else {
      entry.miss = true
    }
  }

  const darkFresh = !!entry.darkMiss && Date.now() - (entry.darkAt ?? entry.at) < MISS_TTL
  if (preferDark && !fileReady(entry.darkFile) && !darkFresh) {
    entry.darkAt = Date.now()
    try {
      const html = await getHomepage()
      const dark = html ? await fetchDarkIcon(host, html) : undefined
      if (dark) {
        const file = createHash('sha1').update(`${host}:dark`).digest('hex')
        writeFileSync(path.join(iconDir(), file), dark.buf)
        entry.darkFile = file
        entry.darkMime = dark.mime
        entry.darkMiss = false
      } else {
        entry.darkMiss = true
      }
    } catch {
      entry.darkMiss = true
    }
  }

  evictIfNeeded()
  scheduleSave()
}

export async function getDomainIcon(domain: string, preferDark = false): Promise<string> {
  ensureIndex()
  const host = etldOf(domain.toLowerCase().trim())
  if (isIpAddress(host) || !DOMAIN_RE.test(host)) return ''

  const entry = index[host]
  const pureMiss = !!entry && !!entry.miss && !entry.file && !entry.darkFile
  const fresh = !!entry && Date.now() - entry.at < (pureMiss ? MISS_TTL : HIT_TTL)
  const needDefault = !fileReady(entry?.file) && !(fresh && entry?.miss)
  const darkFresh = !!entry?.darkMiss && Date.now() - (entry?.darkAt ?? entry.at) < MISS_TTL
  const needDark = preferDark && !fileReady(entry?.darkFile) && !darkFresh

  if (!needDefault && !needDark) return pickIcon(entry, preferDark)

  const key = `${host}:${preferDark ? 1 : 0}`
  let task = inflight.get(key)
  if (!task) {
    task = resolveIcon(host, preferDark).finally(() => inflight.delete(key))
    inflight.set(key, task)
  }
  await task
  return pickIcon(index[host], preferDark)
}
