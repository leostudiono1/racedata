import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { archiveMeetingResponse, archiveRaceResponse, raceDirectory } from '../src/archive/archive.js'
import { rebuildYearIndex } from '../src/archive/index.js'
import { reparseYear } from '../src/archive/reparse.js'
import { repairRaceManifestIds } from '../src/archive/repair.js'
import { sha256, writeJsonAtomic } from '../src/archive/store.js'
import { stableId } from '../src/jra/parse.js'
import { verifyArchive } from '../src/archive/verify.js'
import type { FetchResponse, JraAction } from '../src/types.js'

const CNAME = 'pw01sde1007202602090720260822/08'

function response(html: string, action: JraAction, fetchedAt: string): FetchResponse {
  const bytes = new TextEncoder().encode(html)
  return {
    action,
    finalUrl: action.url,
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    charset: 'utf-8',
    bytes,
    html,
    fetchedAt,
  }
}

describe('archive integration', () => {
  let root: string
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'jra-archive-')) })
  afterEach(async () => { await rm(root, { recursive: true, force: true }) })

  it('archives entry/result/odds, skips identical bytes, indexes and reparses offline', async () => {
    const entry = await readFile('tests/fixtures/entry.html', 'utf8')
    const result = await readFile('tests/fixtures/result.html', 'utf8')
    const odds = await readFile('tests/fixtures/odds.html', 'utf8')
    const entryAction = { url: 'https://www.jra.go.jp/JRADB/accessD.html', cname: CNAME }
    const resultAction = { url: 'https://www.jra.go.jp/JRADB/accessS.html', cname: `${CNAME}-result` }
    expect((await archiveRaceResponse(response(entry, entryAction, '2026-08-21T01:00:00.000Z'), 'entry', root)).changed).toBe(true)
    expect((await archiveRaceResponse(response(entry, entryAction, '2026-08-21T02:00:00.000Z'), 'entry', root)).changed).toBe(false)
    await archiveRaceResponse(response(result, resultAction, '2026-08-22T08:00:00.000Z'), 'result', root)
    await archiveRaceResponse(response(odds, { url: 'https://www.jra.go.jp/JRADB/accessO.html', cname: `${CNAME}-odds` }, '2026-08-22T08:01:00.000Z'), 'odds-win-place', root)
    await archiveMeetingResponse(
      response(entry, { url: 'https://www.jra.go.jp/JRADB/accessD.html', cname: 'pw01drl10072026020920260822/08' }, '2026-08-21T03:00:00.000Z'),
      'meeting-notice',
      '2026-08-22',
      root,
    )
    const previousYearEntry = entry.replaceAll('2026年8月22日', '2025年8月22日')
    await archiveRaceResponse(
      response(previousYearEntry, { url: entryAction.url, cname: 'previous-year-race' }, '2025-08-21T01:00:00.000Z'),
      'entry',
      root,
    )
    const index = await rebuildYearIndex(2026, root)
    expect(index.races).toHaveLength(1)
    expect(index.races[0]?.pageTypes).toEqual(['entry', 'odds-win-place', 'result'])
    const racePath = join(root, index.races[0]?.path ?? '')
    const record = JSON.parse(await readFile(racePath, 'utf8')) as { odds: unknown[]; pages: Array<{ rawPath: string; contentHash: string }> }
    expect(record.odds).toHaveLength(3)
    const manifest = JSON.parse(await readFile(join(racePath, '..', 'manifest.json'), 'utf8')) as { raceId: string }
    expect(manifest.raceId).toBe(stableId(CNAME))
    const rawPath = join(root, record.pages[0]?.rawPath ?? '')
    const compressedBeforeReparse = await readFile(rawPath)
    const recordBeforeReparse = await readFile(racePath, 'utf8')
    const raw = gunzipSync(compressedBeforeReparse)
    expect(sha256(raw)).toBe(record.pages[0]?.contentHash)
    const verification = await verifyArchive(root, 2026)
    expect(verification.meetings).toBe(1)
    expect(verification.errors).toEqual([])
    expect((await reparseYear(2026, root)).errors).toEqual([])
    expect(await readFile(rawPath)).toEqual(compressedBeforeReparse)
    expect(await readFile(racePath, 'utf8')).toBe(recordBeforeReparse)
    expect((await verifyArchive(root, 2026)).errors).toEqual([])
  })

  it('repairs a stale manifest race id without changing the race record', async () => {
    const entry = await readFile('tests/fixtures/entry.html', 'utf8')
    const archived = await archiveRaceResponse(
      response(entry, { url: 'https://www.jra.go.jp/JRADB/accessD.html', cname: CNAME }, '2026-08-21T01:00:00.000Z'),
      'entry',
      root,
    )
    if (!archived.record) throw new Error('Expected archived race record')
    const directory = raceDirectory(root, {
      id: archived.record.id,
      date: archived.record.date,
      venue: archived.record.venue,
      meetingNumber: archived.record.meetingNumber,
      meetingDay: archived.record.meetingDay,
      number: archived.record.number,
    })
    const manifestPath = join(directory, 'manifest.json')
    await rebuildYearIndex(2026, root)
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { raceId: string; pages: unknown[] }
    await writeJsonAtomic(manifestPath, { ...manifest, raceId: 'stale-race-id' })
    expect((await verifyArchive(root, 2026)).errors).toHaveLength(1)
    expect(await repairRaceManifestIds(root, 2026)).toMatchObject({ scanned: 1, repaired: 1, errors: [] })
    expect((await verifyArchive(root, 2026)).errors).toEqual([])
  })

  it('keeps raw bytes and an error manifest when race identity cannot be parsed', async () => {
    const html = '<html><main><h1>layout changed</h1><p>unknown</p></main></html>'
    const url = 'https://www.jra.go.jp/JRADB/accessS.html'
    const archived = await archiveRaceResponse(response(html, { url }, '2026-08-22T08:00:00.000Z'), 'result', root)
    expect(archived.error).toContain('Unable to locate race archive path')
    const failureDir = join(root, 'failures', '2026-08-22', stableId(`${url}|`))
    expect(gunzipSync(await readFile(join(failureDir, 'raw.html.gz'))).toString()).toBe(html)
    expect(JSON.parse(await readFile(join(failureDir, 'manifest.json'), 'utf8')).error).toContain('Unable to locate race archive path')
  })

  it('records schema validation failures in the page manifest', async () => {
    const entry = (await readFile('tests/fixtures/entry.html', 'utf8')).replace('牡4', '牡0')
    const archived = await archiveRaceResponse(
      response(entry, { url: 'https://www.jra.go.jp/JRADB/accessD.html', cname: CNAME }, '2026-08-21T01:00:00.000Z'),
      'entry',
      root,
    )
    expect(archived.error).toContain('Too small')
    const directory = raceDirectory(root, {
      id: archived.record?.id ?? '',
      date: '2026-08-22',
      venue: '新潟',
      meetingNumber: 2,
      meetingDay: 9,
      number: 7,
    })
    const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')) as {
      pages: Array<{ parseStatus: string; error: string | null }>
    }
    expect(manifest.pages[0]).toMatchObject({ parseStatus: 'failed' })
    expect(manifest.pages[0]?.error).toContain('Too small')
  })
})
