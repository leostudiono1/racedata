import * as cheerio from 'cheerio'
import type { AnyNode } from 'domhandler'
import { parseDocument, compact } from '../jra/document.js'
import type { RaceRecord } from '../types.js'
import type {
  NetkeibaCareerEntry,
  NetkeibaEntityRef,
  NetkeibaHorseProfile,
  NetkeibaHorseRecord,
  NetkeibaPedigreeNode,
  NetkeibaRaceRecord,
  NetkeibaRaceRunner,
} from './types.js'

const VENUE_CODES: Record<string, string> = {
  札幌: '01', 函館: '02', 福島: '03', 新潟: '04', 東京: '05', 中山: '06',
  中京: '07', 京都: '08', 阪神: '09', 小倉: '10',
}

function nullableText(value: string | undefined | null) {
  const text = compact(value ?? '')
  return text || null
}

function numberFrom(value: string | undefined | null) {
  const match = value?.replaceAll(',', '').match(/[+−-]?\d+(?:\.\d+)?/)
  if (!match) return null
  const parsed = Number(match[0].replace('−', '-'))
  return Number.isFinite(parsed) ? parsed : null
}

function integerFrom(value: string | undefined | null) {
  const parsed = numberFrom(value)
  return parsed === null ? null : Math.trunc(parsed)
}

function positiveIntegerFrom(value: string | undefined | null) {
  const parsed = integerFrom(value)
  return parsed !== null && parsed > 0 ? parsed : null
}

function yenFrom(value: string | undefined | null, unit = 1) {
  const parsed = numberFrom(value)
  if (parsed === null) return null
  return Math.round(parsed * (/万/.test(value ?? '') ? 10_000 : unit))
}

function timeSeconds(value: string | undefined | null) {
  const text = compact(value ?? '')
  const minute = text.match(/^(\d+):(\d{2}(?:\.\d+)?)$/)
  if (minute) return Number(minute[1]) * 60 + Number(minute[2])
  return /^\d{1,2}\.\d$/.test(text) ? Number(text) : null
}

function dateFrom(value: string | undefined | null) {
  const match = value?.match(/(\d{4})[/.年-](\d{1,2})[/.月-](\d{1,2})/)
  return match ? `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}` : null
}

function idFromHref(value: string | undefined, type: 'horse' | 'jockey' | 'trainer' | 'owner' | 'breeder' | 'race') {
  if (!value) return null
  const patterns = {
    horse: /\/horse\/(\d+)/,
    jockey: /\/jockey\/(?:result\/recent\/)?(\d+)/,
    trainer: /\/trainer\/(?:result\/recent\/)?(\d+)/,
    owner: /\/owner\/(?:result\/recent\/)?([^/?#]+)/,
    breeder: /\/breeder\/(?:result\/recent\/)?([^/?#]+)/,
    race: /\/race\/(\d{12})/,
  }
  return value.match(patterns[type])?.[1] ?? null
}

function entityFromAnchor(
  $: cheerio.CheerioAPI,
  anchor: AnyNode | undefined,
  type: 'horse' | 'jockey' | 'trainer' | 'owner' | 'breeder',
): NetkeibaEntityRef | null {
  if (!anchor) return null
  const node = $(anchor)
  const name = compact(node.text())
  if (!name) return null
  return { id: idFromHref(node.attr('href'), type), name }
}

function headerIndexes(headers: string[]) {
  const find = (pattern: RegExp) => headers.findIndex((header) => pattern.test(header))
  return {
    finish: find(/^着順$/), frame: find(/^枠番?$/), number: find(/^馬番$/), horse: find(/^馬名$/),
    sexAge: find(/性齢/), assigned: find(/斤量/), jockey: find(/騎手/), time: find(/^タイム$/),
    margin: find(/着差/), passing: find(/通過/), final3f: find(/上り/), odds: find(/単勝/),
    popularity: find(/人気/), body: find(/馬体重/), trainer: find(/調教師/), owner: find(/馬主/), prize: find(/賞金/),
  }
}

function at(cells: string[], index: number) {
  return index >= 0 ? cells[index] : undefined
}

function parseBodyWeight(value: string | undefined) {
  const match = value?.match(/(\d{3})\s*\(([+−-]?\d+)\)/)
  return {
    weight: positiveIntegerFrom(match?.[1]),
    change: integerFrom(match?.[2]),
  }
}

export function netkeibaRaceIdFor(record: Pick<RaceRecord, 'date' | 'venue' | 'meetingNumber' | 'meetingDay' | 'number'>) {
  const course = VENUE_CODES[record.venue]
  const year = record.date.slice(0, 4)
  if (!/^\d{4}$/.test(year) || !course || !record.meetingNumber || !record.meetingDay || !record.number) return null
  return `${year}${course}${String(record.meetingNumber).padStart(2, '0')}${String(record.meetingDay).padStart(2, '0')}${String(record.number).padStart(2, '0')}`
}

export function parseNetkeibaRace(html: string, sourceUrl: string, jra: RaceRecord, fetchedAt: string): NetkeibaRaceRecord {
  const $ = cheerio.load(html)
  const id = sourceUrl.match(/\/race\/(\d{12})/)?.[1] ?? netkeibaRaceIdFor(jra)
  if (!id) throw new Error(`Unable to determine netkeiba race id for JRA race ${jra.id}`)
  const table = $('table.race_table_01, table').filter((_, element) => {
    const text = compact($(element).find('tr').first().text())
    return /着順/.test(text) && /馬名/.test(text) && $(element).find('a[href*="/horse/"]').length > 0
  }).first()
  if (!table.length) throw new Error(`Unable to find public race result table at ${sourceUrl}`)
  const headerRow = table.find('tr').first()
  const headers = headerRow.find('th, td').toArray().map((cell) => compact($(cell).text()))
  const indexes = headerIndexes(headers)
  const runners: NetkeibaRaceRunner[] = []
  table.find('tr').slice(1).each((_, row) => {
    const cells = $(row).find('th, td').toArray().map((cell) => compact($(cell).text()))
    const horseAnchor = $(row).find('a[href*="/horse/"]').first().get(0)
    const horse = entityFromAnchor($, horseAnchor, 'horse')
    if (!horse?.id) return
    const jockey = entityFromAnchor($, $(row).find('a[href*="/jockey/"]').first().get(0), 'jockey')
    const trainer = entityFromAnchor($, $(row).find('a[href*="/trainer/"]').first().get(0), 'trainer')
    const owner = entityFromAnchor($, $(row).find('a[href*="/owner/"]').first().get(0), 'owner')
    const sexAge = at(cells, indexes.sexAge)?.match(/([^\d\s]+)\s*(\d+)/)
    const body = parseBodyWeight(at(cells, indexes.body))
    const finishDisplay = nullableText(at(cells, indexes.finish))
    const timeDisplay = nullableText(at(cells, indexes.time))
    runners.push({
      number: positiveIntegerFrom(at(cells, indexes.number)),
      frame: positiveIntegerFrom(at(cells, indexes.frame)),
      horse,
      jockey,
      trainer,
      owner,
      sex: sexAge?.[1] ?? null,
      age: positiveIntegerFrom(sexAge?.[2]),
      assignedWeightKg: numberFrom(at(cells, indexes.assigned)),
      bodyWeightKg: body.weight,
      bodyWeightChangeKg: body.change,
      finish: finishDisplay && /^\d+$/.test(finishDisplay) ? Number(finishDisplay) : null,
      finishDisplay,
      timeDisplay,
      timeSeconds: timeSeconds(timeDisplay),
      margin: nullableText(at(cells, indexes.margin)),
      passingOrder: nullableText(at(cells, indexes.passing)),
      finalThreeFurlongsSeconds: numberFrom(at(cells, indexes.final3f)),
      winOdds: numberFrom(at(cells, indexes.odds)),
      popularity: positiveIntegerFrom(at(cells, indexes.popularity)),
      prizeYen: yenFrom(at(cells, indexes.prize), /万/.test(headers[indexes.prize] ?? '') ? 10_000 : 1),
      rawCells: cells,
    })
  })
  if (!runners.length) throw new Error(`No runners parsed from netkeiba race ${id}`)
  const name = $('.data_intro h1, .RaceName, main h1, #contents h1, h1').toArray()
    .map((element) => compact($(element).text()))
    .find(Boolean) ?? jra.name
  return {
    schemaVersion: 1,
    id,
    jraRaceId: jra.id,
    sourceUrl,
    date: jra.date,
    venue: jra.venue,
    meetingNumber: jra.meetingNumber ?? 0,
    meetingDay: jra.meetingDay ?? 0,
    number: jra.number,
    name,
    runners,
    document: parseDocument(html, sourceUrl),
    pages: [],
    updatedAt: fetchedAt,
  }
}

function labeledValue($: cheerio.CheerioAPI, label: RegExp) {
  let value: string | null = null
  $('table tr, dl').each((_, element) => {
    if (value) return
    const node = $(element)
    const key = compact(node.find('th, dt').first().text())
    if (label.test(key)) value = nullableText(node.find('td, dd').first().text())
  })
  return value
}

function labeledEntity(
  $: cheerio.CheerioAPI,
  label: RegExp,
  type: 'trainer' | 'owner' | 'breeder',
) {
  let entity: NetkeibaEntityRef | null = null
  $('table tr, dl').each((_, element) => {
    if (entity) return
    const node = $(element)
    if (!label.test(compact(node.find('th, dt').first().text()))) return
    entity = entityFromAnchor($, node.find('td a, dd a').first().get(0), type)
      ?? (nullableText(node.find('td, dd').first().text()) ? { id: null, name: compact(node.find('td, dd').first().text()) } : null)
  })
  return entity
}

export function parseHorseProfile(html: string): NetkeibaHorseProfile {
  const $ = cheerio.load(html)
  const name = compact($('.horse_title h1, .HorseTitle h1, h1').first().text()).replace(/\s+/g, ' ')
  if (!name) throw new Error('Unable to parse netkeiba horse name')
  const description = compact($('.horse_title, .HorseTitle, .db_prof_area').first().text())
  const born = labeledValue($, /生年月日/) ?? description
  const details = labeledValue($, /性別|毛色/) ?? description
  let pedigree: NetkeibaPedigreeNode[] = []
  try {
    pedigree = parseHorsePedigree(html)
  } catch {
    // Some profile variants omit the pedigree table; the dedicated pedigree page remains authoritative.
  }
  const directParents = pedigree.filter((node) => node.generation === 0)
  const dam = directParents[1]
  const damsire = dam ? pedigree.find((node) => node.generation === 1 && node.row >= dam.row) : null
  return {
    name,
    birthDate: dateFrom(born),
    sex: details.match(/(牡|牝|セ|せん)/)?.[1] ?? null,
    coatColor: details.match(/(鹿毛|黒鹿毛|青鹿毛|栗毛|栃栗毛|青毛|芦毛|白毛)/)?.[1] ?? null,
    trainer: labeledEntity($, /調教師/, 'trainer'),
    owner: labeledEntity($, /馬主/, 'owner'),
    breeder: labeledEntity($, /生産者/, 'breeder'),
    birthplace: labeledValue($, /産地/),
    sire: directParents[0] ? { id: directParents[0].id, name: directParents[0].name } : null,
    dam: dam ? { id: dam.id, name: dam.name } : null,
    damsire: damsire ? { id: damsire.id, name: damsire.name } : null,
  }
}

export function parseHorsePedigree(html: string): NetkeibaPedigreeNode[] {
  const $ = cheerio.load(html)
  const table = $('table.blood_table, table').filter((_, element) => $(element).find('a[href*="/horse/"]').length >= 3).first()
  if (!table.length) throw new Error('Unable to find netkeiba pedigree table')
  const occupied: number[] = []
  const nodes: NetkeibaPedigreeNode[] = []
  table.find('tr').each((rowIndex, row) => {
    let generation = 0
    $(row).children('th, td').each((_, cell) => {
      while ((occupied[generation] ?? 0) > 0) generation += 1
      const node = $(cell)
      const anchor = node.find('a[href*="/horse/"]').first().get(0)
      const entity = entityFromAnchor($, anchor, 'horse')
      const name = entity?.name ?? compact(node.clone().children().remove().end().text())
      const rowSpan = positiveIntegerFrom(node.attr('rowspan')) ?? 1
      if (name) nodes.push({ id: entity?.id ?? null, name, generation, row: rowIndex, rowSpan })
      occupied[generation] = rowSpan
      generation += 1
    })
    for (let column = 0; column < occupied.length; column += 1) {
      if ((occupied[column] ?? 0) > 0) occupied[column] = (occupied[column] ?? 0) - 1
    }
  })
  if (!nodes.length) throw new Error('No pedigree nodes parsed')
  return nodes
}

export function parseHorseCareer(html: string): NetkeibaCareerEntry[] {
  const $ = cheerio.load(html)
  const table = $('table.db_h_race_results, table').filter((_, element) => {
    const text = compact($(element).find('tr').first().text())
    return /日付/.test(text) && /レース名/.test(text) && /着順/.test(text)
  }).first()
  if (!table.length) throw new Error('Unable to find netkeiba horse career table')
  const headers = table.find('tr').first().find('th, td').toArray().map((cell) => compact($(cell).text()))
  const find = (pattern: RegExp) => headers.findIndex((header) => pattern.test(header))
  const indexes = {
    date: find(/^日付$/), venue: find(/^開催$/), field: find(/頭数/), frame: find(/^枠番?$/), number: find(/^馬番$/),
    odds: find(/オッズ/), popularity: find(/人気/), finish: find(/^着順$/), jockey: find(/騎手/), assigned: find(/斤量/),
    distance: find(/^距離$/), condition: find(/馬場/), time: find(/^タイム$/), margin: find(/着差/), pace: find(/ペース/),
    passing: find(/通過/), final3f: find(/上り/), body: find(/馬体重/), prize: find(/賞金/), race: find(/レース名/),
  }
  const entries: NetkeibaCareerEntry[] = []
  table.find('tr').slice(1).each((_, row) => {
    const cells = $(row).find('th, td').toArray().map((cell) => compact($(cell).text()))
    if (!cells.length) return
    const raceAnchor = $(row).find('a[href*="/race/"]').first()
    const jockeyAnchor = $(row).find('a[href*="/jockey/"]').first().get(0)
    const distance = at(cells, indexes.distance)?.match(/([^\d\s]+)\s*(\d+)/)
    const body = parseBodyWeight(at(cells, indexes.body))
    const finishDisplay = nullableText(at(cells, indexes.finish))
    const timeDisplay = nullableText(at(cells, indexes.time))
    entries.push({
      date: dateFrom(at(cells, indexes.date)),
      raceId: idFromHref(raceAnchor.attr('href'), 'race'),
      raceName: compact(raceAnchor.text()) || compact(at(cells, indexes.race) ?? ''),
      venue: nullableText(at(cells, indexes.venue)),
      fieldSize: positiveIntegerFrom(at(cells, indexes.field)),
      frame: positiveIntegerFrom(at(cells, indexes.frame)),
      number: positiveIntegerFrom(at(cells, indexes.number)),
      odds: numberFrom(at(cells, indexes.odds)),
      popularity: positiveIntegerFrom(at(cells, indexes.popularity)),
      finish: finishDisplay && /^\d+$/.test(finishDisplay) ? Number(finishDisplay) : null,
      finishDisplay,
      jockey: entityFromAnchor($, jockeyAnchor, 'jockey'),
      assignedWeightKg: numberFrom(at(cells, indexes.assigned)),
      surface: distance?.[1] ?? null,
      distanceMeters: positiveIntegerFrom(distance?.[2]),
      trackCondition: nullableText(at(cells, indexes.condition)),
      timeDisplay,
      timeSeconds: timeSeconds(timeDisplay),
      margin: nullableText(at(cells, indexes.margin)),
      pace: nullableText(at(cells, indexes.pace)),
      passingOrder: nullableText(at(cells, indexes.passing)),
      finalThreeFurlongsSeconds: numberFrom(at(cells, indexes.final3f)),
      bodyWeightKg: body.weight,
      bodyWeightChangeKg: body.change,
      prizeYen: yenFrom(at(cells, indexes.prize), /万/.test(headers[indexes.prize] ?? '') ? 10_000 : 1),
      rawCells: cells,
    })
  })
  return entries
}

export function emptyHorseRecord(id: string, sourceUrl: string, fetchedAt: string): NetkeibaHorseRecord {
  return {
    schemaVersion: 1,
    id,
    sourceUrl,
    profile: null,
    pedigree: [],
    career: [],
    pageDocuments: {},
    pages: [],
    updatedAt: fetchedAt,
  }
}
