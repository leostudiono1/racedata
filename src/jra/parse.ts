import { createHash } from 'node:crypto'
import * as cheerio from 'cheerio'
import { classifyOddsPage } from './discovery.js'
import { compact, parseDocument } from './document.js'
import type {
  BetType,
  OddsQuote,
  Payout,
  RaceCondition,
  RaceRecord,
  RaceResult,
  RunnerRecord,
  WinningHorse,
} from '../types.js'

export function stableId(source: string, length = 20) {
  return createHash('sha256').update(source).digest('hex').slice(0, length)
}

function nullableText(value: string | undefined | null) {
  const text = compact(value ?? '')
  return text || null
}

function numberFrom(value: string | undefined | null) {
  const match = value?.replace(/,/g, '').match(/[+−-]?\d+(?:\.\d+)?/)
  if (!match) return null
  const parsed = Number(match[0].replace('−', '-'))
  return Number.isFinite(parsed) ? parsed : null
}

function integerFrom(value: string | undefined | null) {
  const parsed = numberFrom(value)
  return parsed === null ? null : Math.trunc(parsed)
}

function yenFrom(value: string | undefined | null, unit = 1) {
  const parsed = numberFrom(value)
  return parsed === null ? null : Math.round(parsed * unit)
}

function timeSeconds(value: string | undefined | null) {
  const text = compact(value ?? '')
  const minute = text.match(/^(\d+):(\d{2}(?:\.\d)?)$/)
  if (minute) return Number(minute[1]) * 60 + Number(minute[2])
  const seconds = text.match(/^\d{1,2}\.\d$/)
  return seconds ? Number(seconds[0]) : null
}

function idFromAnchor(value: string | undefined, fallback: string) {
  if (!value) return stableId(fallback)
  const cname = value.match(/[?&]CNAME=([^&'"\s)]+)/i)?.[1]
    ?? value.match(/pw01[a-z]+[^'"\s)]+/i)?.[0]
  return stableId(cname ? decodeURIComponent(cname) : value)
}

function headerIndex(headers: string[], pattern: RegExp) {
  return headers.findIndex((header) => pattern.test(header))
}

function cellAt(cells: string[], index: number) {
  return index >= 0 ? cells[index] : undefined
}

function parseSexAge(text: string) {
  const match = text.match(/(牡|牝|せん)\s*(\d{1,2})/)
  return { sex: match?.[1] ?? null, age: match?.[2] ? Number(match[2]) : null }
}

function parseRunnerTable($: cheerio.CheerioAPI, isResult: boolean): RunnerRecord[] {
  const table = $('table').filter((_, element) => {
    const root = $(element)
    return /馬名/.test(compact(root.text())) && root.find('a[href*="accessU"], a[onclick*="pw01dud"], a[href*="pw01dud"]').length > 0
  }).first()
  if (!table.length) return []
  const headers = table.find('thead th').toArray().map((cell) => compact($(cell).text()))
  const indexes = {
    finish: headerIndex(headers, /着順/), frame: headerIndex(headers, /枠/), number: headerIndex(headers, /馬番/),
    name: headerIndex(headers, /馬名/), sexAge: headerIndex(headers, /性齢/), assigned: headerIndex(headers, /負担|斤量/),
    jockey: headerIndex(headers, /騎手/), time: headerIndex(headers, /^タイム|走破/), margin: headerIndex(headers, /着差/),
    corner: headerIndex(headers, /コーナー|通過/), final3f: headerIndex(headers, /上り/), body: headerIndex(headers, /馬体重/),
    trainer: headerIndex(headers, /調教師/), odds: headerIndex(headers, /単勝.*オッズ|オッズ/), popularity: headerIndex(headers, /人気/),
  }
  const rows: RunnerRecord[] = []
  table.find('tbody tr, tr').each((rowIndex, row) => {
    if ($(row).parents('thead').length) return
    const cells = $(row).find('th, td').toArray().map((cell) => compact($(cell).text()))
    const horseAnchor = $(row).find('a[href*="accessU"], a[onclick*="pw01dud"], a[href*="pw01dud"]').first()
    const name = compact(horseAnchor.text()) || compact(cellAt(cells, indexes.name) ?? '')
    if (!name || /馬名|取消馬/.test(name) || cells.length < 2) return
    const rowText = compact($(row).text())
    const sexAgeText = cellAt(cells, indexes.sexAge) ?? rowText
    const { sex, age } = parseSexAge(sexAgeText)
    const bodyText = cellAt(cells, indexes.body) ?? rowText
    const bodyMatch = bodyText.match(/(\d{3})\s*(?:kg)?\s*\(\s*([+−-]?\d+|前計不|計不|初出走)\s*\)/i)
    const jockeyAnchor = $(row).find('a[href*="accessK"], a[onclick*="pw01k"], [class*="jockey"] a').first()
    const trainerAnchor = $(row).find('a[href*="accessC"], a[onclick*="pw01c"], [class*="trainer"] a').first()
    const finishDisplay = nullableText(cellAt(cells, indexes.finish) ?? (isResult ? cells[0] : null))
    const finish = finishDisplay?.match(/^\d+$/) ? Number(finishDisplay) : null
    const equipment: string[] = []
    $(row).find('img[alt], [title]').each((_, marker) => {
      const label = nullableText($(marker).attr('alt') ?? $(marker).attr('title'))
      if (label && !/^枠\d/.test(label)) equipment.push(label)
    })
    const numericCells = cells.filter((cell) => /^\d+$/.test(cell))
    const number = integerFrom(
      $(row).find('[class*="horse_num"], [class*="umaban"], .num').first().text()
      || cellAt(cells, indexes.number)
      || numericCells[isResult ? 2 : 1]
      || numericCells[0],
    )
    const frame = integerFrom(
      $(row).find('[class*="waku"] img').first().attr('alt')
      || $(row).find('[class*="waku"]').first().text()
      || cellAt(cells, indexes.frame)
      || numericCells[isResult ? 1 : 0],
    )
    const assignedText = cellAt(cells, indexes.assigned) ?? sexAgeText
    const timeDisplay = nullableText(cellAt(cells, indexes.time))
    const corner = nullableText(cellAt(cells, indexes.corner))
    rows.push({
      horseId: idFromAnchor(horseAnchor.attr('href') ?? horseAnchor.attr('onclick'), `${name}-${rowIndex}`),
      number, frame, name, sex, age,
      assignedWeightKg: numberFrom(assignedText.match(/\d{2}(?:\.\d)?/)?.[0]),
      jockeyId: jockeyAnchor.length ? idFromAnchor(jockeyAnchor.attr('href') ?? jockeyAnchor.attr('onclick'), compact(jockeyAnchor.text())) : null,
      jockeyName: nullableText(jockeyAnchor.text() || cellAt(cells, indexes.jockey)),
      trainerId: trainerAnchor.length ? idFromAnchor(trainerAnchor.attr('href') ?? trainerAnchor.attr('onclick'), compact(trainerAnchor.text())) : null,
      trainerName: nullableText(trainerAnchor.text() || cellAt(cells, indexes.trainer)),
      ownerName: nullableText($(row).find('[class*="owner"]').first().text()),
      breederName: nullableText($(row).find('[class*="breeder"]').first().text()),
      bodyWeightKg: integerFrom(bodyMatch?.[1]),
      bodyWeightChangeKg: bodyMatch?.[2] && !/計不|初出走/.test(bodyMatch[2]) ? integerFrom(bodyMatch[2]) : null,
      equipment: [...new Set(equipment)],
      scratched: /取消|除外|中止/.test(`${finishDisplay ?? ''} ${rowText}`),
      finish,
      finishDisplay,
      timeDisplay,
      timeSeconds: timeSeconds(timeDisplay),
      margin: nullableText(cellAt(cells, indexes.margin)),
      cornerPositions: corner ? corner.split(/\s+/).filter(Boolean) : [],
      finalThreeFurlongsSeconds: numberFrom(cellAt(cells, indexes.final3f)),
      winOdds: numberFrom(cellAt(cells, indexes.odds)),
      popularity: integerFrom(cellAt(cells, indexes.popularity)),
      rawCells: cells,
    })
  })
  return [...new Map(rows.map((runner) => [runner.horseId, runner])).values()]
}

function parseCondition(text: string): RaceCondition {
  const course = text.match(/(?:コース[：:]?\s*)?([1-4],?\d{3})\s*メートル[（(]([^）)]+)[）)]/)
  const detail = course?.[2] ?? ''
  const surface = /障害/.test(text) ? 'jump' : /芝/.test(detail) ? 'turf' : /ダート/.test(detail) ? 'dirt' : 'unknown'
  return {
    surface,
    distanceMeters: integerFrom(course?.[1]),
    direction: nullableText(detail.match(/右|左|直線/)?.[0]),
    courseVariant: nullableText(detail),
    classLabel: nullableText(text.match(/(?:新馬|未勝利|オープン|[1-3]勝クラス|GⅠ|GⅡ|GⅢ|J・GⅠ|J・GⅡ|J・GⅢ)/)?.[0]),
    ageRestriction: nullableText(text.match(/(?:\d歳以上|\d歳)/)?.[0]),
    sexRestriction: nullableText(text.match(/(?:牝|牡・牝|せん馬を除く)/)?.[0]),
    weightRule: nullableText(text.match(/(?:定量|別定|ハンデ|馬齢)/)?.[0]),
  }
}

function selectRaceName($: cheerio.CheerioAPI, classLabel: string | null) {
  const ignored = /出馬表|レース結果|払戻金|オッズ|勝馬の紹介|タイム|コーナー通過|過去の成績/
  const names = $('.race_name, .race_name h2, #main h2, #contentsBody h2, main h2, h2').toArray()
    .map((element) => compact($(element).text()))
  return names.find((name) => name && !ignored.test(name) && name !== classLabel && name.length < 100)
    ?? classLabel
    ?? '名称未取得'
}

function inferBetType(value: string): BetType {
  const pageType = classifyOddsPage(value)
  if (pageType === 'odds-win-place') return /複勝/.test(value) && !/単勝/.test(value) ? 'place' : 'win'
  return pageTypeMap[pageType as keyof typeof pageTypeMap] ?? 'unknown'
}

const pageTypeMap = {
  'odds-win-place': 'win', 'odds-frame': 'frame', 'odds-quinella': 'quinella', 'odds-wide': 'wide',
  'odds-exacta': 'exacta', 'odds-trio': 'trio', 'odds-trifecta': 'trifecta', 'odds-unknown': 'unknown',
} as const

function parsePayouts($: cheerio.CheerioAPI): Payout[] {
  const payouts: Payout[] = []
  $('.refund_area dl, [class*="refund"] dl').each((_, definition) => {
    const root = $(definition)
    const label = compact(root.find('dt').first().text())
    const betType = inferBetType(label)
    root.find('.line').each((__, line) => {
      const row = $(line)
      const combination = compact(row.find('.num').first().text())
      const amountText = compact(row.find('.yen').first().text())
      const popularityText = compact(row.find('.pop').first().text())
      if (!combination || !amountText) return
      payouts.push({
        betType,
        combination: [...combination.matchAll(/\d+/g)].map((match) => match[0]).join('-'),
        amountYen: yenFrom(amountText),
        popularity: integerFrom(popularityText),
        specialPayout: /特払/.test(amountText),
        rawCells: [label, combination, amountText, popularityText].filter(Boolean),
      })
    })
  })
  $('table').each((_, table) => {
    const root = $(table)
    const context = compact(`${root.prevAll('h2, h3, h4').first().text()} ${root.text()}`)
    if (!/払戻|円/.test(context) || !/単勝|複勝|枠連|馬連|ワイド|馬単|3連/.test(context)) return
    let currentType: BetType = 'unknown'
    root.find('tr').each((__, row) => {
      const cells = $(row).find('th, td').toArray().map((cell) => compact($(cell).text())).filter(Boolean)
      if (!cells.length) return
      const typeCell = cells.find((cell) => /^(単勝|複勝|枠連|馬連|ワイド|馬単|3連複|3連単)$/.test(cell))
      if (typeCell) currentType = inferBetType(typeCell)
      const amountIndex = cells.findIndex((cell) => /[\d,]+円|特払/.test(cell))
      if (amountIndex < 0) return
      const combination = cells.slice(typeCell ? cells.indexOf(typeCell) + 1 : 0, amountIndex).find((cell) => /\d/.test(cell)) ?? ''
      payouts.push({
        betType: currentType,
        combination,
        amountYen: yenFrom(cells[amountIndex]),
        popularity: integerFrom(cells.find((cell) => /番人気/.test(cell))),
        specialPayout: cells.some((cell) => /特払/.test(cell)),
        rawCells: cells,
      })
    })
  })

  const heading = $('h2, h3, h4').filter((_, element) => /^払戻金$/.test(compact($(element).text()))).first()
  if (heading.length) {
    const sectionRoot = heading.closest('.refund_area, [class*="refund"]')
    const sectionText = compact(sectionRoot.length ? sectionRoot.text() : heading.parent().nextAll().text())
    const labels = '単勝|複勝|枠連|ワイド|馬連|馬単|3連複|3連単'
    const segmentPattern = new RegExp(`(${labels})\\s*([\\s\\S]*?)(?=${labels}|勝馬の紹介|$)`, 'g')
    for (const segment of sectionText.matchAll(segmentPattern)) {
      const label = segment[1] ?? ''
      const body = segment[2] ?? ''
      const betType = inferBetType(label)
      const itemPattern = /((?:\d+\s*[-－]?\s*){1,3})([\d,]+円|特払(?:い)?(?:\s*[\d,]+円)?)\s*(?:(\d+)番人気)?/g
      for (const item of body.matchAll(itemPattern)) {
        const combination = [...(item[1]?.matchAll(/\d+/g) ?? [])].map((match) => match[0]).join('-')
        const amountText = item[2] ?? ''
        if (!combination || !amountText) continue
        payouts.push({
          betType,
          combination,
          amountYen: yenFrom(amountText),
          popularity: integerFrom(item[3]),
          specialPayout: /特払/.test(amountText),
          rawCells: [label, combination, amountText, item[3] ? `${item[3]}番人気` : ''].filter(Boolean),
        })
      }
    }
  }
  return [...new Map(payouts.map((payout) => [
    `${payout.betType}|${payout.combination}|${payout.amountYen ?? ''}`,
    payout,
  ])).values()]
}

function parseResultDetails($: cheerio.CheerioAPI, text: string, isResult: boolean): RaceResult | null {
  if (!isResult) return null
  const lapText = text.match(/ハロンタイム\s*([\d.\s-]+)/)?.[1] ?? ''
  const lapTimesSeconds = [...lapText.matchAll(/\d{1,2}\.\d/g)].map((match) => Number(match[0]))
  const finalSections = [...text.matchAll(/([34]F)\s*([\d.]+)/g)].map((match) => ({ label: match[1] ?? '', seconds: Number(match[2]) }))
  const cornerPassages: Array<{ corner: string; order: string }> = []
  $('table tr').each((_, row) => {
    const cells = $(row).find('th, td').toArray().map((cell) => compact($(cell).text()))
    if (cells[0] && /コーナー/.test(cells[0]) && cells[1]) cornerPassages.push({ corner: cells[0], order: cells.slice(1).join(' ') })
  })
  if (!cornerPassages.length) {
    for (const match of text.matchAll(/([1-4]コーナー)\s*([^\n]+?)(?=[1-4]コーナー|払戻|$)/g)) {
      if (match[1] && match[2]) cornerPassages.push({ corner: match[1], order: compact(match[2]) })
    }
  }
  return { final: true, lapTimesSeconds, finalSections, cornerPassages }
}

function parseIncidents($: cheerio.CheerioAPI) {
  const incidents: string[] = []
  $('h2, h3, h4').filter((_, heading) => /競走中の出来事|制裁|その他/.test(compact($(heading).text()))).each((_, heading) => {
    const text = compact($(heading).nextUntil('h2, h3, h4').text())
    if (text) incidents.push(text)
  })
  return [...new Set(incidents)]
}

function parseWinningHorse($: cheerio.CheerioAPI): WinningHorse | null {
  const heading = $('h2, h3, h4').filter((_, element) => /勝馬の紹介/.test(compact($(element).text()))).first()
  if (!heading.length) return null
  const section = heading.nextUntil('h2, h3').addBack()
  const text = compact(section.text())
  const identity = text.match(/勝馬の紹介\s*([^\s]+)\s*(\d{4})年(\d{1,2})月(\d{1,2})日生\s*(牡|牝|せん)?(\d{1,2})?/)
  const anchor = section.find('a[href*="accessU"], a[onclick*="pw01dud"]').first()
  const name = compact(anchor.text()) || identity?.[1] || compact(heading.next().text()).split(' ')[0] || ''
  if (!name) return null
  return {
    horseId: anchor.length ? idFromAnchor(anchor.attr('href') ?? anchor.attr('onclick'), name) : null,
    name,
    birthDate: identity ? `${identity[2]}-${String(identity[3]).padStart(2, '0')}-${String(identity[4]).padStart(2, '0')}` : null,
    sex: identity?.[5] ?? null,
    age: identity?.[6] ? Number(identity[6]) : null,
    sire: nullableText(text.match(/父[：:]\s*([^\s]+)/)?.[1]),
    dam: nullableText(text.match(/母[：:]\s*([^\s]+)/)?.[1]),
    owner: nullableText(text.match(/馬主[：:]\s*(.+?)(?=生産|$)/)?.[1]),
    breeder: nullableText(text.match(/生産(?:者|牧場)[：:]\s*(.+)$/)?.[1]),
  }
}

export function parseRacePage(html: string, sourceUrl: string, cname: string, fetchedAt: string): RaceRecord {
  const $ = cheerio.load(html)
  const root = $('#main, #contentsBody, main, body').first()
  const text = compact(root.text())
  const dateMatch = text.match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/)
  const date = dateMatch ? `${dateMatch[1]}-${String(dateMatch[2]).padStart(2, '0')}-${String(dateMatch[3]).padStart(2, '0')}` : ''
  const meeting = text.match(/(\d+)回\s*([^\s\d]{2,7})\s*(\d+)日/)
  const venue = meeting?.[2] ?? ''
  const raceNumber = integerFrom(text.match(/(?:^|\s)(\d{1,2})\s*レース/)?.[1])
    ?? integerFrom(text.match(/(\d{1,2})R(?:\s|$)/i)?.[1])
  const time = text.match(/発走時刻[：:]?\s*(\d{1,2})時(\d{2})分/)
  const condition = parseCondition(text)
  if (!date || !venue || !raceNumber || !condition.distanceMeters) {
    throw new Error(`Incomplete JRA race metadata at ${sourceUrl}`)
  }
  const isResult = /レース結果|着順/.test(compact($('title, h1').text()))
  const weather = nullableText(text.match(/天候\s*([^\s]{1,5})/)?.[1])
  const track = nullableText(text.match(/(?:芝|ダート|障害)\s*(良|稍重|重|不良)/)?.[0])
  const prizeText = text.match(/本賞金[（(]万円[）)]\s*(.+?)(?=レース映像|着順|枠|馬番|$)/)?.[1] ?? ''
  const prizes = [...prizeText.matchAll(/(\d+)着\s*([\d,.]+)/g)].map((match) => ({
    place: Number(match[1]), label: `${match[1]}着`, amountYen: yenFrom(match[2], 10_000),
  }))
  return {
    schemaVersion: 1,
    id: stableId(cname || sourceUrl),
    cname: cname || sourceUrl,
    sourceUrl,
    date,
    venue,
    meetingNumber: integerFrom(meeting?.[1]),
    meetingDay: integerFrom(meeting?.[3]),
    number: raceNumber,
    startTime: time ? `${time[1]?.padStart(2, '0')}:${time[2]}` : null,
    name: selectRaceName($, condition.classLabel),
    weather,
    trackCondition: track,
    condition,
    prizes,
    runners: parseRunnerTable($, isResult),
    odds: [],
    result: parseResultDetails($, text, isResult),
    payouts: parsePayouts($),
    incidents: parseIncidents($),
    winningHorse: parseWinningHorse($),
    document: parseDocument(html, sourceUrl),
    pageDocuments: {},
    pages: [],
    updatedAt: fetchedAt,
  }
}

export function parseOddsPage(html: string, fetchedAt: string): OddsQuote[] {
  const $ = cheerio.load(html)
  const quotes: OddsQuote[] = []
  $('table').each((_, table) => {
    const root = $(table)
    const heading = compact(root.prevAll('h1, h2, h3, h4').first().text())
    const headers = root.find('thead th').toArray().map((cell) => compact($(cell).text()))
    const context = `${heading} ${headers.join(' ')} ${compact(root.find('caption').text())}`
    let betType = inferBetType(context)
    root.find('tbody tr, tr').each((__, row) => {
      if ($(row).parents('thead').length) return
      const cells = $(row).find('th, td').toArray().map((cell) => compact($(cell).text())).filter(Boolean)
      if (cells.length < 2 || cells.every((cell) => !/\d/.test(cell))) return
      const rowLabel = cells.find((cell) => /^(単勝|複勝|枠連|馬連|ワイド|馬単|3連複|3連単)$/.test(cell))
      if (rowLabel) betType = inferBetType(rowLabel)
      const oddsCell = [...cells].reverse().find((cell) => /^\d+(?:\.\d+)?(?:\s*[-～]\s*\d+(?:\.\d+)?)?$/.test(cell.replace(/倍/g, '')))
      if (!oddsCell) return
      const values = [...oddsCell.matchAll(/\d+(?:\.\d+)?/g)].map((match) => Number(match[0]))
      const combination = cells.find((cell) => /\d/.test(cell) && cell !== oddsCell && !/番人気/.test(cell)) ?? ''
      quotes.push({
        betType,
        combination: compact(combination),
        minOdds: values[0] ?? null,
        maxOdds: values[1] ?? values[0] ?? null,
        popularity: integerFrom(cells.find((cell) => /番人気/.test(cell))),
        final: true,
        rawCells: cells,
        fetchedAt,
      })
    })
  })
  return quotes
}

export function mergeRaceRecord(current: RaceRecord | null, incoming: RaceRecord) {
  if (!current) return incoming
  const runners = new Map(current.runners.map((runner) => [runner.horseId, runner]))
  for (const runner of incoming.runners) {
    const old = runners.get(runner.horseId)
    runners.set(runner.horseId, old ? mergeRunner(old, runner) : runner)
  }
  return {
    ...current,
    ...incoming,
    prizes: incoming.prizes.length ? incoming.prizes : current.prizes,
    runners: [...runners.values()].sort((a, b) => (a.number ?? 99) - (b.number ?? 99)),
    odds: incoming.odds.length ? incoming.odds : current.odds,
    result: incoming.result ?? current.result,
    payouts: incoming.payouts.length ? incoming.payouts : current.payouts,
    incidents: [...new Set([...current.incidents, ...incoming.incidents])],
    winningHorse: incoming.winningHorse ?? current.winningHorse,
    pageDocuments: { ...current.pageDocuments, ...incoming.pageDocuments },
    pages: current.pages,
    updatedAt: incoming.updatedAt,
  } satisfies RaceRecord
}

function mergeRunner(old: RunnerRecord, next: RunnerRecord): RunnerRecord {
  const merged = { ...old }
  for (const [key, value] of Object.entries(next) as Array<[keyof RunnerRecord, RunnerRecord[keyof RunnerRecord]]>) {
    if (value !== null && value !== '' && (!Array.isArray(value) || value.length > 0)) (merged as any)[key] = value
  }
  return merged
}
