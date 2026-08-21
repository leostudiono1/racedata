import { readFile } from 'node:fs/promises'
import { parseDocument } from '../src/jra/document.js'
import { parseOddsPage, parseRacePage } from '../src/jra/parse.js'
import { raceRecordSchema } from '../src/schema.js'

const SOURCE = 'https://www.jra.go.jp/JRADB/accessS.html'
const CNAME = 'pw01sde1007202602090720260822/08'
const FETCHED_AT = '2026-08-22T08:00:00.000Z'

describe('JRA page parser', () => {
  it('parses a complete entry card and retains unknown content blocks', async () => {
    const html = await readFile('tests/fixtures/entry.html', 'utf8')
    const race = parseRacePage(html, SOURCE, CNAME, FETCHED_AT)
    expect(raceRecordSchema.parse(race)).toEqual(race)
    expect(race).toMatchObject({ date: '2026-08-22', venue: '新潟', number: 7, startTime: '15:25', name: 'サンプル特別' })
    expect(race.condition).toMatchObject({ surface: 'turf', distanceMeters: 1600, direction: '左', classLabel: '3勝クラス' })
    expect(race.prizes[0]).toEqual({ place: 1, label: '1着', amountYen: 18_400_000 })
    expect(race.runners[0]).toMatchObject({ number: 1, frame: 1, bodyWeightKg: 502, bodyWeightChangeKg: 4, jockeyName: '騎手一' })
    expect(JSON.stringify(race.document.blocks)).toContain('parser が知らない重要な説明')
  })

  it('parses result, dead heat, cancellation, timing, payouts and incidents', async () => {
    const html = await readFile('tests/fixtures/result.html', 'utf8')
    const race = parseRacePage(html, SOURCE, CNAME, FETCHED_AT)
    expect(race.name).toBe('サンプル特別')
    expect(race.runners.map((runner) => runner.finish)).toEqual([1, 1, null])
    expect(race.runners[2]?.scratched).toBe(true)
    expect(race.runners[0]).toMatchObject({ timeSeconds: 92.4, finalThreeFurlongsSeconds: 33.4, popularity: 2 })
    expect(race.result?.lapTimesSeconds).toHaveLength(8)
    expect(race.result?.cornerPassages).toEqual([{ corner: '3コーナー', order: '2,1-3' }, { corner: '4コーナー', order: '2,1-3' }])
    expect(race.payouts).toEqual(expect.arrayContaining([expect.objectContaining({ betType: 'win', amountYen: 320 })]))
    expect(race.incidents[0]).toContain('競走除外')
    expect(race.winningHorse).toMatchObject({ name: 'サンプルスター', birthDate: '2022-03-04', sire: 'サンプルサイアー' })
  })

  it('normalizes unpublished zero popularity to null', async () => {
    const fixture = await readFile('tests/fixtures/result.html', 'utf8')
    const html = fixture.replace('<td>3.2</td><td>2</td></tr>', '<td>3.2</td><td>0</td></tr>')
    const race = parseRacePage(html, SOURCE, CNAME, FETCHED_AT)
    expect(race.runners[0]?.popularity).toBeNull()
    expect(raceRecordSchema.parse(race)).toEqual(race)

    const oddsFixture = await readFile('tests/fixtures/odds.html', 'utf8')
    const odds = parseOddsPage(oddsFixture.replace('2番人気', '0番人気'), FETCHED_AT)
    expect(odds[0]?.popularity).toBeNull()
  })

  it('parses final odds ranges and generic document tables', async () => {
    const html = await readFile('tests/fixtures/odds.html', 'utf8')
    const quotes = parseOddsPage(html, FETCHED_AT)
    expect(quotes).toEqual(expect.arrayContaining([
      expect.objectContaining({ betType: 'win', combination: '1', minOdds: 3.2, final: true }),
      expect.objectContaining({ betType: 'place', minOdds: 1.2, maxOdds: 1.5 }),
    ]))
    expect(parseDocument(html, SOURCE).blocks.some((block) => block.type === 'table')).toBe(true)
  })

  it('recognizes obstacle races and special payouts', async () => {
    const jump = '<html lang="ja"><head><title>レース結果</title></head><body><main><h1>レース結果 2026年4月14日（土曜）3回中山7日 11レース</h1><p>2026年4月14日 3回中山7日 発走時刻：15時40分</p><h2>障害テスト</h2><p>障害4歳以上 オープン 別定 コース：4,250メートル（芝 外）</p><table><thead><tr><th>着順</th><th>枠</th><th>馬番</th><th>馬名</th></tr></thead><tbody><tr><td>1</td><td>1</td><td>1</td><td><a href="/JRADB/accessU.html?CNAME=horse">ジャンプワン</a></td></tr></tbody></table><h2>払戻金</h2><table><tr><th>3連単</th><td>1-2-3</td><td>特払 700円</td></tr></table></main></body></html>'
    const race = parseRacePage(jump, SOURCE, 'jump-race', FETCHED_AT)
    expect(race.condition).toMatchObject({ surface: 'jump', distanceMeters: 4250 })
    expect(race.payouts[0]).toMatchObject({ betType: 'trifecta', amountYen: 700, specialPayout: true })
  })
})
