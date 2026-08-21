import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeJsonAtomic } from '../src/archive/store.js'
import { updateNetkeibaArchive } from '../src/netkeiba/crawler.js'
import { decodeNetkeibaBytes, detectNetkeibaCharset } from '../src/netkeiba/http.js'
import { netkeibaRaceIdFor, parseHorseCareer, parseHorsePedigree, parseHorseProfile, parseNetkeibaRace } from '../src/netkeiba/parse.js'
import { reparseNetkeibaArchive } from '../src/netkeiba/reparse.js'
import type { NetkeibaFetchResponse } from '../src/netkeiba/types.js'
import { verifyNetkeibaArchive } from '../src/netkeiba/verify.js'
import type { RaceRecord } from '../src/types.js'

const jraRace: RaceRecord = {
  schemaVersion: 1,
  id: 'jra-test-race',
  cname: 'pw01sde0104202603020720260822/AA',
  sourceUrl: 'https://www.jra.go.jp/JRADB/accessS.html',
  date: '2026-08-22',
  venue: '新潟',
  meetingNumber: 3,
  meetingDay: 2,
  number: 7,
  startTime: '13:30',
  name: '検索ウィンドウ',
  weather: '晴',
  trackCondition: '芝 良',
  condition: { surface: 'turf', distanceMeters: 1600, direction: '左', courseVariant: null, classLabel: null, ageRestriction: null, sexRestriction: null, weightRule: null },
  prizes: [],
  runners: [],
  odds: [],
  result: { final: true, lapTimesSeconds: [], finalSections: [], cornerPassages: [] },
  payouts: [],
  incidents: [],
  winningHorse: null,
  document: { title: 'JRA', language: 'ja', blocks: [] },
  pageDocuments: {},
  pages: [],
  updatedAt: '2026-08-22T08:00:00.000Z',
}

async function fixture(name: string) {
  return readFile(`tests/fixtures/${name}`, 'utf8')
}

function response(url: string, html: string): NetkeibaFetchResponse {
  const bytes = new TextEncoder().encode(html)
  return {
    url,
    finalUrl: url,
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    charset: 'utf-8',
    bytes,
    html,
    fetchedAt: '2026-08-22T10:00:00.000Z',
  }
}

describe('netkeiba parsing', () => {
  it('builds a netkeiba race id from JRA identity and parses public race results', async () => {
    expect(netkeibaRaceIdFor(jraRace)).toBe('202604030207')
    const parsed = parseNetkeibaRace(
      await fixture('netkeiba-race.html'),
      'https://db.netkeiba.com/race/202604030207/',
      jraRace,
      '2026-08-22T10:00:00.000Z',
    )
    expect(parsed.runners).toHaveLength(2)
    expect(parsed.name).toBe('テスト特別')
    expect(parsed.runners[0]).toMatchObject({
      horse: { id: '2022100001', name: 'テストホース' },
      finish: 1,
      timeSeconds: 93.4,
      bodyWeightKg: 480,
      bodyWeightChangeKg: 2,
    })
  })

  it('parses profile, pedigree coordinates and cross-jurisdiction career rows', async () => {
    const profile = parseHorseProfile(await fixture('netkeiba-profile.html'))
    expect(profile).toMatchObject({ name: 'テストホース', birthDate: '2022-03-14', sex: '牡', coatColor: '鹿毛', birthplace: '安平町' })
    expect(profile.trainer).toEqual({ id: '01001', name: '調教師一' })
    const pedigree = parseHorsePedigree(await fixture('netkeiba-pedigree.html'))
    expect(pedigree).toHaveLength(6)
    expect(pedigree[0]).toMatchObject({ id: '2010100001', generation: 0, row: 0, rowSpan: 2 })
    const career = parseHorseCareer(await fixture('netkeiba-career.html'))
    expect(career[0]).toMatchObject({ raceId: '202604030207', surface: '芝', distanceMeters: 1600, prizeYen: 10_000_000 })
  })

  it('recognizes supported response encodings', () => {
    const bytes = new TextEncoder().encode('<meta charset="EUC-JP"><p>test</p>')
    expect(detectNetkeibaCharset(bytes, 'text/html')).toBe('euc-jp')
    expect(decodeNetkeibaBytes(new TextEncoder().encode('<p>ok</p>'), 'text/html; charset=utf-8').html).toContain('ok')
  })
})

describe('netkeiba archive integration', () => {
  let root: string
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'netkeiba-archive-'))
    await writeJsonAtomic(join(root, 'archive', '2026', '08', '22', 'meeting', 'races', '07', 'race.json'), jraRace)
  })
  afterEach(async () => { await rm(root, { recursive: true, force: true }) })

  it('collects within a page budget, indexes, verifies, skips fresh pages and reparses raw only', async () => {
    const pages = {
      race: await fixture('netkeiba-race.html'),
      profile: await fixture('netkeiba-profile.html'),
      pedigree: await fixture('netkeiba-pedigree.html'),
      career: await fixture('netkeiba-career.html'),
    }
    const fetcher = async (url: string) => response(url, url.includes('/race/') ? pages.race : url.includes('/ped/') ? pages.pedigree : url.includes('/result/') ? pages.career : pages.profile)
    const first = await updateNetkeibaArchive({ root, fetcher, maxPages: 7, now: new Date('2026-08-22T12:00:00.000Z') })
    expect(first.fetched).toBe(7)
    expect(first.errors).toEqual([])
    expect((await verifyNetkeibaArchive(root, 2026)).errors).toEqual([])
    const second = await updateNetkeibaArchive({ root, fetcher, maxPages: 7, now: new Date('2026-08-22T12:00:00.000Z') })
    expect(second.fetched).toBe(0)
    expect(second.skipped).toBeGreaterThan(0)
    expect((await reparseNetkeibaArchive(root, 2026)).errors).toEqual([])
    expect((await verifyNetkeibaArchive(root, 2026)).errors).toEqual([])
  })
})
