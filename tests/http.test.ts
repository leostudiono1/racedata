import { deterministicGzip, sha256 } from '../src/archive/store.js'
import { decodeBytes, detectCharset } from '../src/jra/http.js'
import {
  fetchNetkeibaPage,
  NetkeibaAccessRestrictionError,
  NetkeibaPageUnavailableError,
  resetNetkeibaThrottleForTests,
} from '../src/netkeiba/http.js'

describe('HTTP bytes and reproducible storage', () => {
  it('detects declared Shift_JIS and preserves deterministic gzip output', () => {
    const bytes = new TextEncoder().encode('<meta charset="Shift_JIS"><p>ascii</p>')
    expect(detectCharset(bytes, 'text/html')).toBe('shift_jis')
    expect(decodeBytes(bytes, 'text/html').html).toContain('ascii')
    expect(deterministicGzip(bytes)).toEqual(deterministicGzip(bytes))
    expect(deterministicGzip(bytes)[9]).toBe(255)
    expect(sha256(bytes)).toMatch(/^[a-f0-9]{64}$/)
  })

  it('uses UTF-8 by default', () => {
    const bytes = new TextEncoder().encode('<p>中央競馬</p>')
    expect(decodeBytes(bytes, 'text/html; charset=utf-8')).toEqual({ charset: 'utf-8', html: '<p>中央競馬</p>' })
  })
})

describe('netkeiba HTTP diagnostics', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    resetNetkeibaThrottleForTests()
  })

  it('reports the exact URL and body signal for an HTTP 200 restriction page', async () => {
    const url = 'https://db.netkeiba.com/horse/2022101625/'
    const html = '<html><head><title>Access Denied</title></head><body>アクセス制限</body></html>'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(html, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })))

    const error: unknown = await fetchNetkeibaPage(url).catch((reason: unknown) => reason)
    if (!(error instanceof NetkeibaAccessRestrictionError)) throw error
    expect(error.diagnostic).toMatchObject({
      reason: 'title-access-denied',
      status: 200,
      requestUrl: url,
      finalUrl: url,
      matchedSignal: 'Access Denied',
      pageTitle: 'Access Denied',
      byteLength: new TextEncoder().encode(html).byteLength,
    })
    expect(error.diagnostic.bodySha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it('does not mistake Forbidden in a horse name for an access restriction', async () => {
    const url = 'https://db.netkeiba.com/horse/2022101625/'
    const html = '<html><head><title>フォビドゥンラヴ (Forbidden Love) | 競走馬データ - netkeiba</title></head><body><h1>Forbidden Love</h1></body></html>'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(html, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })))

    const response = await fetchNetkeibaPage(url)
    expect(response.status).toBe(200)
    expect(response.html).toContain('Forbidden Love')
  })

  it('recognizes an exact English restriction title', async () => {
    const url = 'https://db.netkeiba.com/horse/2022101625/'
    const html = '<html><head><title>Forbidden</title></head><body>nginx</body></html>'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(html, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })))

    const error: unknown = await fetchNetkeibaPage(url).catch((reason: unknown) => reason)
    if (!(error instanceof NetkeibaAccessRestrictionError)) throw error
    expect(error.diagnostic).toMatchObject({
      reason: 'title-forbidden',
      matchedSignal: 'Forbidden',
      pageTitle: 'Forbidden',
    })
  })

  it('classifies a missing page without treating it as a global restriction', async () => {
    const url = 'https://db.netkeiba.com/horse/2022101625/'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not found', { status: 404 })))

    const error: unknown = await fetchNetkeibaPage(url).catch((reason: unknown) => reason)
    if (!(error instanceof NetkeibaPageUnavailableError)) throw error
    expect(error).not.toBeInstanceOf(NetkeibaAccessRestrictionError)
    expect(error.diagnostic).toMatchObject({ reason: 'http-404', status: 404, requestUrl: url })
  })
})
