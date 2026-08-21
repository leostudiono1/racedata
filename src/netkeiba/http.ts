import type { NetkeibaCharset, NetkeibaFetchResponse } from './types.js'

const DEFAULT_DELAY_MS = Number(process.env.NETKEIBA_REQUEST_DELAY_MS ?? 3_500)
const DEFAULT_RETRIES = Number(process.env.NETKEIBA_REQUEST_RETRIES ?? 2)
const USER_AGENT = process.env.NETKEIBA_USER_AGENT
  ?? 'racedata-archive/0.1 (personal non-commercial research; https://github.com/leostudiono1/racedata)'

let nextRequestAt = 0

function assertAllowedUrl(value: string) {
  const url = new URL(value)
  const allowedPath = /^\/(?:race\/\d{12}\/|horse\/(?:ped\/|result\/)?\d+\/?)$/
  if (url.protocol !== 'https:' || url.hostname !== 'db.netkeiba.com' || !allowedPath.test(url.pathname)) {
    throw new Error(`Refusing non-allowlisted netkeiba URL: ${value}`)
  }
}

async function waitForTurn() {
  const wait = Math.max(0, nextRequestAt - Date.now())
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
  nextRequestAt = Date.now() + DEFAULT_DELAY_MS
}

export function detectNetkeibaCharset(bytes: Uint8Array, contentType: string | null): NetkeibaCharset {
  const prefix = new TextDecoder('latin1').decode(bytes.slice(0, 4_096))
  const declared = `${contentType ?? ''} ${prefix}`
  if (/euc[-_]?jp/i.test(declared)) return 'euc-jp'
  if (/shift[_-]?jis|windows-31j|x-sjis/i.test(declared)) return 'shift_jis'
  return 'utf-8'
}

export function decodeNetkeibaBytes(bytes: Uint8Array, contentType: string | null) {
  const charset = detectNetkeibaCharset(bytes, contentType)
  return { charset, html: new TextDecoder(charset).decode(bytes) }
}

function headersToRecord(headers: Headers) {
  return Object.fromEntries([...headers.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0))
}

function isAccessRestriction(status: number, html: string) {
  return status === 403 || status === 429
    || /アクセス(?:が集中|制限)|Access Denied|Too Many Requests|Forbidden/i.test(html.slice(0, 20_000))
}

export class NetkeibaAccessRestrictionError extends Error {}
class NetkeibaHttpResponseError extends Error {}

export async function fetchNetkeibaPage(url: string): Promise<NetkeibaFetchResponse> {
  assertAllowedUrl(url)
  let lastError: unknown
  for (let attempt = 0; attempt < DEFAULT_RETRIES; attempt += 1) {
    try {
      await waitForTurn()
      const response = await fetch(url, {
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'ja,en;q=0.5',
          'User-Agent': USER_AGENT,
        },
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      })
      const bytes = new Uint8Array(await response.arrayBuffer())
      const decoded = decodeNetkeibaBytes(bytes, response.headers.get('content-type'))
      if (isAccessRestriction(response.status, decoded.html)) {
        throw new NetkeibaAccessRestrictionError(`netkeiba access restriction detected (HTTP ${response.status}); collection stopped`)
      }
      if (!response.ok) {
        const message = `netkeiba responded with HTTP ${response.status} for ${url}`
        if (response.status >= 400 && response.status < 500) throw new NetkeibaHttpResponseError(message)
        throw new Error(message)
      }
      return {
        url,
        finalUrl: response.url,
        status: response.status,
        headers: headersToRecord(response.headers),
        ...decoded,
        bytes,
        fetchedAt: new Date().toISOString(),
      }
    } catch (error) {
      if (error instanceof NetkeibaAccessRestrictionError || error instanceof NetkeibaHttpResponseError) throw error
      lastError = error
      if (attempt + 1 < DEFAULT_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, 2_000 * (2 ** attempt)))
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Unable to fetch ${url}`)
}

export function resetNetkeibaThrottleForTests() {
  nextRequestAt = 0
}
