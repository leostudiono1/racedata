import { createHash } from 'node:crypto'
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

export interface NetkeibaResponseDiagnostic {
  reason: string
  status: number
  requestUrl: string
  finalUrl: string
  matchedSignal: string | null
  pageTitle: string | null
  bodySha256: string
  byteLength: number
}

export interface NetkeibaRequestDiagnostic {
  reason: 'timeout' | 'network-or-redirect' | 'request-failure'
  requestUrl: string
  attempts: number
  errorName: string
  errorMessage: string
  causeCode: string | null
}

const ACCESS_RESTRICTION_PATTERNS: Array<{ reason: string; pattern: RegExp }> = [
  { reason: 'body-access-concentrated', pattern: /アクセス(?:が)?集中/i },
  { reason: 'body-access-restricted', pattern: /アクセス(?:を)?制限/i },
  { reason: 'body-access-unavailable', pattern: /アクセスできません/i },
  { reason: 'body-access-denied', pattern: /Access Denied/i },
  { reason: 'body-too-many-requests', pattern: /Too Many Requests/i },
  { reason: 'body-forbidden', pattern: /Forbidden/i },
]

function cleanText(value: string) {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

function pageTitle(html: string) {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  if (!match?.[1]) return null
  return cleanText(match[1]).slice(0, 200) || null
}

function restrictionSignal(status: number, html: string) {
  if (status === 403) return { reason: 'http-403', matchedSignal: 'HTTP 403' }
  if (status === 429) return { reason: 'http-429', matchedSignal: 'HTTP 429' }
  const prefix = html.slice(0, 20_000)
  for (const candidate of ACCESS_RESTRICTION_PATTERNS) {
    const match = candidate.pattern.exec(prefix)
    if (match?.[0]) return { reason: candidate.reason, matchedSignal: cleanText(match[0]).slice(0, 200) }
  }
  return null
}

function unavailableSignal(status: number, title: string | null) {
  if (status === 404) return { reason: 'http-404', matchedSignal: 'HTTP 404' }
  if (status === 410) return { reason: 'http-410', matchedSignal: 'HTTP 410' }
  const match = title && /(?:ページが見つかりません|お探しのページは見つかりません|404\s*Not Found)/i.exec(title)
  return match?.[0] ? { reason: 'body-page-not-found', matchedSignal: match[0] } : null
}

function responseDiagnostic(
  signal: { reason: string; matchedSignal: string | null },
  response: Response,
  requestUrl: string,
  bytes: Uint8Array,
  html: string,
): NetkeibaResponseDiagnostic {
  return {
    ...signal,
    status: response.status,
    requestUrl,
    finalUrl: response.url || requestUrl,
    pageTitle: pageTitle(html),
    bodySha256: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.byteLength,
  }
}

function diagnosticMessage(label: string, diagnostic: NetkeibaResponseDiagnostic) {
  return `${label} ${JSON.stringify(diagnostic)}`
}

export class NetkeibaAccessRestrictionError extends Error {
  constructor(readonly diagnostic: NetkeibaResponseDiagnostic) {
    super(`${diagnosticMessage('netkeiba access restriction', diagnostic)}; collection stopped`)
    this.name = 'NetkeibaAccessRestrictionError'
  }
}

export class NetkeibaPageUnavailableError extends Error {
  constructor(readonly diagnostic: NetkeibaResponseDiagnostic) {
    super(diagnosticMessage('netkeiba page unavailable', diagnostic))
    this.name = 'NetkeibaPageUnavailableError'
  }
}

export class NetkeibaHttpResponseError extends Error {
  constructor(readonly diagnostic: NetkeibaResponseDiagnostic, readonly retryable: boolean) {
    super(diagnosticMessage('netkeiba HTTP response error', diagnostic))
    this.name = 'NetkeibaHttpResponseError'
  }
}

export class NetkeibaRequestError extends Error {
  constructor(readonly diagnostic: NetkeibaRequestDiagnostic) {
    super(`netkeiba request error ${JSON.stringify(diagnostic)}`)
    this.name = 'NetkeibaRequestError'
  }
}

function requestDiagnostic(error: unknown, requestUrl: string, attempts: number): NetkeibaRequestDiagnostic {
  const candidate = error instanceof Error ? error : new Error(String(error))
  const causeCode = (candidate as Error & { cause?: { code?: unknown } }).cause?.code
  return {
    reason: candidate.name === 'TimeoutError' || candidate.name === 'AbortError'
      ? 'timeout'
      : candidate instanceof TypeError
        ? 'network-or-redirect'
        : 'request-failure',
    requestUrl,
    attempts,
    errorName: candidate.name,
    errorMessage: candidate.message,
    causeCode: typeof causeCode === 'string' ? causeCode : null,
  }
}

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
      const unavailable = unavailableSignal(response.status, pageTitle(decoded.html))
      if (unavailable) {
        throw new NetkeibaPageUnavailableError(responseDiagnostic(unavailable, response, url, bytes, decoded.html))
      }
      const restriction = restrictionSignal(response.status, decoded.html)
      if (restriction) {
        throw new NetkeibaAccessRestrictionError(responseDiagnostic(restriction, response, url, bytes, decoded.html))
      }
      if (!response.ok) {
        const signal = {
          reason: response.status >= 500 ? 'http-server-error' : 'http-client-error',
          matchedSignal: `HTTP ${response.status}`,
        }
        throw new NetkeibaHttpResponseError(
          responseDiagnostic(signal, response, url, bytes, decoded.html),
          response.status >= 500,
        )
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
      if (error instanceof NetkeibaAccessRestrictionError || error instanceof NetkeibaPageUnavailableError) throw error
      if (error instanceof NetkeibaHttpResponseError && !error.retryable) throw error
      lastError = error
      if (attempt + 1 < DEFAULT_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, 2_000 * (2 ** attempt)))
      }
    }
  }
  if (lastError instanceof NetkeibaHttpResponseError) throw lastError
  throw new NetkeibaRequestError(requestDiagnostic(lastError, url, DEFAULT_RETRIES))
}

export function resetNetkeibaThrottleForTests() {
  nextRequestAt = 0
}
