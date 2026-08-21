import { deterministicGzip, sha256 } from '../src/archive/store.js'
import { decodeBytes, detectCharset } from '../src/jra/http.js'

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
