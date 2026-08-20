import type { FetchResponse, JraAction } from '../types.js'

const DEFAULT_DELAY_MS = Number(process.env.JRA_REQUEST_DELAY_MS ?? 1_200)
const DEFAULT_RETRIES = Number(process.env.JRA_REQUEST_RETRIES ?? 3)
const USER_AGENT = process.env.JRA_USER_AGENT
  ?? 'jra-race-archive/0.1 (personal non-commercial research; contact via repository)'

let nextRequestAt = 0

async function waitForTurn() {
  const wait = Math.max(0, nextRequestAt - Date.now())
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
  nextRequestAt = Date.now() + DEFAULT_DELAY_MS
}

export function detectCharset(bytes: Uint8Array, contentType: string | null): 'shift_jis' | 'utf-8' {
  const prefix = new TextDecoder('latin1').decode(bytes.slice(0, 4_096))
  const declared = `${contentType ?? ''} ${prefix}`
  return /shift[_-]?jis|windows-31j|x-sjis/i.test(declared) ? 'shift_jis' : 'utf-8'
}

export function decodeBytes(bytes: Uint8Array, contentType: string | null) {
  const charset = detectCharset(bytes, contentType)
  return { charset, html: new TextDecoder(charset).decode(bytes) }
}

function headersToRecord(headers: Headers) {
  return Object.fromEntries([...headers.entries()].sort(([a], [b]) => a.localeCompare(b)))
}

export async function fetchPage(action: JraAction): Promise<FetchResponse> {
  let lastError: unknown
  for (let attempt = 0; attempt < DEFAULT_RETRIES; attempt += 1) {
    try {
      await waitForTurn()
      const body = action.cname ? new URLSearchParams({ cname: action.cname }) : undefined
      const request: RequestInit = {
        method: body ? 'POST' : 'GET',
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'User-Agent': USER_AGENT,
          ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(30_000),
      }
      if (body) request.body = body
      const response = await fetch(action.url, request)
      if (!response.ok) throw new Error(`JRA responded with HTTP ${response.status} for ${action.url}`)
      const bytes = new Uint8Array(await response.arrayBuffer())
      const decoded = decodeBytes(bytes, response.headers.get('content-type'))
      return {
        action,
        finalUrl: response.url,
        status: response.status,
        headers: headersToRecord(response.headers),
        ...decoded,
        bytes,
        fetchedAt: new Date().toISOString(),
      }
    } catch (error) {
      lastError = error
      if (attempt + 1 < DEFAULT_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, 1_000 * (2 ** attempt)))
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Unable to fetch ${action.url}`)
}

export function resetThrottleForTests() {
  nextRequestAt = 0
}
