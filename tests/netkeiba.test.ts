import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deterministicGzip, readJson, writeFileAtomic, writeJsonAtomic } from '../src/archive/store.js'
import { archiveNetkeibaHorse, netkeibaHorseDirectory } from '../src/netkeiba/archive.js'
import { updateNetkeibaArchive, updateNetkeibaHorseShard, updateNetkeibaRaceYear } from '../src/netkeiba/crawler.js'
import { decodeNetkeibaBytes, detectNetkeibaCharset, NetkeibaAccessRestrictionError } from '../src/netkeiba/http.js'
import { netkeibaRaceIdFor, parseHorseCareer, parseHorsePedigree, parseHorseProfile, parseNetkeibaRace } from '../src/netkeiba/parse.js'
import { reparseNetkeibaArchive, reparseNetkeibaHorseShard } from '../src/netkeiba/reparse.js'
import { netkeibaHorseRepairShard, netkeibaHorseShard } from '../src/netkeiba/shard.js'
import type { NetkeibaFetchResponse } from '../src/netkeiba/types.js'
import { verifyNetkeibaArchive, verifyNetkeibaHorseShard } from '../src/netkeiba/verify.js'
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

  it('prefers the horse profile title over an earlier site heading', async () => {
    const html = (await fixture('netkeiba-profile.html'))
      .replace('<body>', '<body><header><h1>netkeiba</h1></header>')
    const expected = parseHorseProfile(await fixture('netkeiba-profile.html')).name
    expect(parseHorseProfile(html).name).toBe(expected)
  })

  it('does not treat an unrelated horse-link table as pedigree data', async () => {
    const html = '<main><div class="horse_title"><h1>Horse</h1></div><table><tr><th>Related</th>'
      + '<td><a href="/horse/1/">One</a><a href="/horse/2/">Two</a><a href="/horse/3/">Three</a></td>'
      + '</tr></table></main>'
    expect(parseHorseProfile(html)).toMatchObject({ name: 'Horse', sire: null, dam: null, damsire: null })
  })

  it('recognizes supported response encodings', () => {
    const bytes = new TextEncoder().encode('<meta charset="EUC-JP"><p>test</p>')
    expect(detectNetkeibaCharset(bytes, 'text/html')).toBe('euc-jp')
    expect(decodeNetkeibaBytes(new TextEncoder().encode('<p>ok</p>'), 'text/html; charset=utf-8').html).toContain('ok')
  })

  it('assigns every horse deterministically to one hash shard', () => {
    const assignments = Array.from({ length: 64 }, (_, shard) => netkeibaHorseShard('2022100001', 64) === shard)
    expect(assignments.filter(Boolean)).toHaveLength(1)
    expect(netkeibaHorseShard('2022100001', 64)).toBe(netkeibaHorseShard('2022100001', 64))
    const repairAssignments = Array.from({ length: 8 }, (_, shard) => netkeibaHorseRepairShard('2022100001', 8) === shard)
    expect(repairAssignments.filter(Boolean)).toHaveLength(1)
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

  it('collects one complete race year before deduplicated horse shards', async () => {
    const pages = {
      race: await fixture('netkeiba-race.html'),
      profile: await fixture('netkeiba-profile.html'),
      pedigree: await fixture('netkeiba-pedigree.html'),
      career: await fixture('netkeiba-career.html'),
    }
    const fetcher = async (url: string) => response(url, url.includes('/race/') ? pages.race : url.includes('/ped/') ? pages.pedigree : url.includes('/result/') ? pages.career : pages.profile)
    const races = await updateNetkeibaRaceYear({ root, year: 2026, fetcher, now: new Date('2026-08-22T12:00:00.000Z') })
    expect(races).toMatchObject({ fetched: 1, changed: 1, timeLimitReached: false, accessRestricted: false, errors: [] })

    const horses = await updateNetkeibaHorseShard({ root, shard: 0, shardCount: 1, fetcher, now: new Date('2026-08-22T12:00:00.000Z') })
    expect(horses).toMatchObject({ fetched: 6, changed: 6, timeLimitReached: false, accessRestricted: false, errors: [] })
    expect((await verifyNetkeibaHorseShard(root, 0, 1)).errors).toEqual([])
    const horse = await readJson<{ profile: { sire: { id: string | null } | null; dam: { id: string | null } | null; damsire: { id: string | null } | null } | null }>(
      join(netkeibaHorseDirectory(root, '2022100001'), 'horse.json'),
    )
    expect(horse?.profile).toMatchObject({
      sire: { id: '2010100001' },
      dam: { id: '2010100002' },
      damsire: { id: '2000100003' },
    })

    const repeated = await updateNetkeibaHorseShard({ root, shard: 0, shardCount: 1, fetcher, now: new Date('2026-08-22T12:00:00.000Z') })
    expect(repeated).toMatchObject({ fetched: 0, skipped: 6, errors: [] })
  })

  it('finishes one horse before starting another and reports coverage gaps', async () => {
    const pages = {
      race: await fixture('netkeiba-race.html'),
      profile: await fixture('netkeiba-profile.html'),
      pedigree: await fixture('netkeiba-pedigree.html'),
      career: await fixture('netkeiba-career.html'),
    }
    const fetcher = async (url: string) => response(
      url,
      url.includes('/race/') ? pages.race
        : url.includes('/ped/') ? pages.pedigree
          : url.includes('/result/') ? pages.career
            : pages.profile,
    )
    const report = await updateNetkeibaArchive({
      root,
      fetcher,
      maxPages: 4,
      now: new Date('2026-08-22T12:00:00.000Z'),
    })
    expect(report).toMatchObject({ fetched: 4, changed: 4, errors: [] })
    const first = await readJson<{ pages: Array<{ pageType: string }> }>(
      join(netkeibaHorseDirectory(root, '2022100001'), 'horse.json'),
    )
    const second = await readJson(join(netkeibaHorseDirectory(root, '2022100002'), 'horse.json'))
    expect(first?.pages.map((page) => page.pageType).sort()).toEqual([
      'horse-career',
      'horse-pedigree',
      'horse-profile',
    ])
    expect(second).toBeNull()

    const coverage = await verifyNetkeibaArchive(root, 2026)
    expect(coverage).toMatchObject({
      referencedHorses: 2,
      completeHorses: 1,
      missingHorseRecords: 1,
      incompleteHorses: 0,
      errors: [],
    })
    const strictCoverage = await verifyNetkeibaArchive(root, 2026, { requireCompleteHorses: true })
    expect(strictCoverage.errors).toEqual([expect.stringContaining('Referenced horses without records: 1')])
  })

  it('marks access restrictions so a later workflow can resume after cooldown', async () => {
    const fetcher = async () => {
      throw new NetkeibaAccessRestrictionError('restricted for test')
    }
    const report = await updateNetkeibaRaceYear({
      root,
      year: 2026,
      fetcher,
      now: new Date('2026-08-22T12:00:00.000Z'),
    })
    expect(report).toMatchObject({ fetched: 1, changed: 0, accessRestricted: true })
    expect(report.errors).toEqual(['restricted for test'])
  })

  it('reparses failed horse raw pages within one hash shard without fetching', async () => {
    const horseId = '2022100001'
    const url = `https://db.netkeiba.com/horse/${horseId}/`
    const failed = await archiveNetkeibaHorse(response(url, '<html><body><h1></h1></body></html>'), horseId, 'horse-profile', root)
    expect(failed.error).toBe('Unable to parse netkeiba horse name')

    const rawPath = join(netkeibaHorseDirectory(root, horseId), 'raw', 'horse-profile.html.gz')
    const bytes = new TextEncoder().encode(await fixture('netkeiba-profile.html'))
    await writeFileAtomic(rawPath, deterministicGzip(bytes))
    const shard = netkeibaHorseShard(horseId, 2)
    const report = await reparseNetkeibaHorseShard({ root, shard, shardCount: 2 })
    expect(report).toEqual({ parsed: 1, errors: [] })
    const record = await readJson<{ profile: { name: string } | null }>(join(netkeibaHorseDirectory(root, horseId), 'horse.json'))
    expect(record?.profile?.name).toBe(parseHorseProfile(await fixture('netkeiba-profile.html')).name)
    expect((await verifyNetkeibaHorseShard(root, shard, 2)).errors).toEqual([])
  })
})
