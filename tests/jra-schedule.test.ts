import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { archiveRaceResponse } from '../src/archive/archive.js'
import { raceRecordsForDate } from '../src/archive/index.js'
import { updateArchive } from '../src/jra/crawler.js'
import { parseRacePage } from '../src/jra/parse.js'
import { raceSchedule, shouldUpdateRace, tokyoDate } from '../src/jra/schedule.js'
import type { FetchResponse, JraAction, PageManifest, PageType, RaceRecord } from '../src/types.js'

const DATE = '2026-08-22'
const ENTRY = 'pw01dde1007202602090720260822/08'
const RESULT = 'pw01sde1007202602090720260822/09'
const entryAction = { url: 'https://www.jra.go.jp/JRADB/accessD.html', cname: ENTRY }
const resultAction = { url: 'https://www.jra.go.jp/JRADB/accessS.html', cname: RESULT }
const at = (time: string) => new Date(`${DATE}T${time}:00+09:00`)

function response(html: string, action: JraAction): FetchResponse {
  return {
    action, html, bytes: new TextEncoder().encode(html), finalUrl: action.url,
    fetchedAt: at('15:00').toISOString(), status: 200, charset: 'utf-8', headers: {},
  }
}
function link(action: JraAction) {
  return `<a onclick="doAction('${action.url}', '${action.cname}')">race</a>`
}

describe('race-time selection', () => {
  let record: RaceRecord
  beforeEach(async () => {
    record = parseRacePage(await readFile('tests/fixtures/entry.html', 'utf8'), entryAction.url, ENTRY, at('09:00').toISOString())
  })

  it('uses Tokyo calendar dates and includes the 30-minute pre-race boundary', () => {
    expect(tokyoDate(new Date('2026-08-21T23:59:00Z'))).toBe(DATE)
    const schedule = raceSchedule([record])
    expect(shouldUpdateRace(entryAction, 'entry', schedule, at('14:54'))).toBe(false)
    expect(shouldUpdateRace(entryAction, 'entry', schedule, at('14:55'))).toBe(true)
    expect(shouldUpdateRace(entryAction, 'entry', schedule, at('15:24'))).toBe(true)
    expect(shouldUpdateRace(resultAction, 'result', schedule, at('15:24'))).toBe(false)
    expect(shouldUpdateRace(resultAction, 'result', schedule, at('15:25'))).toBe(true)
  })

  it('includes missing/unknown times and delayed races, but excludes other dates', () => {
    expect(shouldUpdateRace(entryAction, 'entry', new Map(), at('09:07'))).toBe(true)
    record.startTime = null
    expect(shouldUpdateRace(entryAction, 'entry', raceSchedule([record]), at('09:07'))).toBe(true)
    record.startTime = '15:25'
    expect(shouldUpdateRace(entryAction, 'entry', raceSchedule([record]), at('17:07'))).toBe(true)
    const tomorrow = { ...entryAction, cname: ENTRY.replace('20260822', '20260823') }
    expect(shouldUpdateRace(tomorrow, 'entry', new Map(), at('09:07'))).toBe(false)
    const yesterday = { ...resultAction, cname: RESULT.replace('20260822', '20260821') }
    expect(shouldUpdateRace(yesterday, 'result', new Map(), at('09:07'))).toBe(false)
  })

  it('keeps missing final odds eligible beyond the time window and stops complete old races', () => {
    const types: PageType[] = ['result', 'odds-win-place', 'odds-frame', 'odds-quinella', 'odds-wide', 'odds-exacta', 'odds-trio', 'odds-trifecta']
    record.result = { final: true, lapTimesSeconds: [], finalSections: [], cornerPassages: [] }
    record.pages = types.map((pageType): PageManifest => ({
      pageType, sourceUrl: resultAction.url, cname: RESULT, method: 'POST',
      httpStatus: 200, headers: {}, charset: 'utf-8', fetchedAt: at('16:00').toISOString(),
      contentHash: '0'.repeat(64), byteLength: 1, rawPath: 'unused', parseStatus: 'parsed', error: null,
    }))
    expect(shouldUpdateRace(entryAction, 'entry', raceSchedule([record]), at('16:00'))).toBe(false)
    expect(shouldUpdateRace(resultAction, 'result', raceSchedule([record]), at('16:35'))).toBe(true)
    expect(shouldUpdateRace(resultAction, 'result', raceSchedule([record]), at('16:36'))).toBe(false)
    record.pages.pop()
    expect(shouldUpdateRace(resultAction, 'result', raceSchedule([record]), at('18:52'))).toBe(true)
    record.startTime = '18:30'
    expect(shouldUpdateRace(resultAction, 'result', raceSchedule([record]), at('18:52'))).toBe(true)
  })
})

describe('intraday crawler', () => {
  let root: string
  let entry: string
  let result: string
  let odds: string
  const oddsAction = { url: 'https://www.jra.go.jp/JRADB/accessO.html', cname: 'pw151ou1007202602090720260822/0A' }
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'jra-schedule-'))
    entry = await readFile('tests/fixtures/entry.html', 'utf8')
    result = await readFile('tests/fixtures/result.html', 'utf8')
    odds = await readFile('tests/fixtures/odds.html', 'utf8')
    await archiveRaceResponse(response(entry, entryAction), 'entry', root)
  })
  afterEach(async () => { await rm(root, { recursive: true, force: true }) })

  function mockSite() {
    const entryMenu = { url: entryAction.url, cname: 'pw01dli00/01' }
    const resultMenu = { url: resultAction.url, cname: 'pw01sli00/01' }
    const pages = new Map([
      ['', `${link(entryMenu)}${link(resultMenu)}`],
      [entryMenu.cname, link(entryAction)],
      [resultMenu.cname, link(resultAction)],
      [ENTRY, entry], [RESULT, `${result}${link(oddsAction)}`], [oddsAction.cname, odds],
    ])
    return vi.fn(async (action: JraAction) => {
      const html = pages.get(action.cname ?? '')
      if (html === undefined) throw new Error(`Unexpected request: ${action.cname}`)
      return response(html, action)
    })
  }

  it('selects pre-race entries, then archives results and final odds after the start', async () => {
    const fetcher = mockSite()
    const early = await updateArchive({ root, fetcher, now: at('14:22'), scope: 'intraday' })
    expect(early).toMatchObject({ changed: 0, errors: [] })
    expect(fetcher.mock.calls.map(([action]) => action.cname)).not.toContain(ENTRY)
    fetcher.mockClear()
    const before = await updateArchive({ root, fetcher, now: at('15:07'), scope: 'intraday' })
    expect(before.errors).toEqual([])
    expect(fetcher.mock.calls.map(([action]) => action.cname)).toContain(ENTRY)
    expect(fetcher.mock.calls.map(([action]) => action.cname)).not.toContain(RESULT)
    fetcher.mockClear()
    const after = await updateArchive({ root, fetcher, now: at('15:37'), scope: 'intraday' })
    expect(after.errors).toEqual([])
    expect(fetcher.mock.calls.map(([action]) => action.cname)).toContain(oddsAction.cname)
    const [record] = await raceRecordsForDate(DATE, root)
    expect(record?.pages.map((page) => page.pageType)).toEqual(['entry', 'odds-win-place', 'result'])
    expect(record?.result?.final).toBe(true)
  })

  it('discovers today when prefetch is absent and does not fetch races on a non-racing Monday', async () => {
    const fetcher = mockSite()
    const report = await updateArchive({ root: join(root, 'empty'), fetcher, now: at('09:07'), scope: 'intraday' })
    expect(report.errors).toEqual([])
    expect(fetcher.mock.calls.map(([action]) => action.cname)).toContain(ENTRY)
    fetcher.mockClear()
    const monday = await updateArchive({ root, fetcher, now: new Date('2026-08-24T09:07:00+09:00'), scope: 'intraday' })
    expect(monday).toMatchObject({ changed: 0, errors: [] })
    expect(fetcher.mock.calls.map(([action]) => action.cname)).not.toContain(ENTRY)
    expect(fetcher.mock.calls.map(([action]) => action.cname)).not.toContain(RESULT)
  })

  it('keeps full updates as the default for the daily sweep and manual recovery', async () => {
    const fetcher = mockSite()
    const report = await updateArchive({ root, fetcher, now: at('09:07') })
    expect(report.errors).toEqual([])
    expect(fetcher.mock.calls.map(([action]) => action.cname)).toContain(ENTRY)
    expect(fetcher.mock.calls.map(([action]) => action.cname)).toContain(RESULT)
  })
})
