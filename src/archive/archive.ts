import * as cheerio from 'cheerio'
import { join } from 'node:path'
import { classifyOddsPage } from '../jra/discovery.js'
import { compact, parseDocument } from '../jra/document.js'
import { mergeRaceRecord, parseOddsPage, parseRacePage, stableId } from '../jra/parse.js'
import { meetingRecordSchema, raceManifestSchema, raceRecordSchema } from '../schema.js'
import type {
  FetchResponse,
  MeetingRecord,
  PageManifest,
  PageType,
  RaceManifest,
  RaceRecord,
} from '../types.js'
import {
  archiveDatePath,
  DEFAULT_DATA_ROOT,
  deterministicGzip,
  exists,
  readJson,
  repositoryPath,
  sha256,
  writeFileAtomic,
  writeJsonAtomic,
} from './store.js'

interface LooseRaceIdentity {
  id: string
  date: string
  venue: string
  meetingNumber: number | null
  meetingDay: number | null
  number: number
}

export interface ArchiveResult {
  changed: boolean
  year: number | null
  record: RaceRecord | null
  error: string | null
}

function nullableInteger(value: string | undefined) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function looseRaceIdentity(html: string, cname: string, sourceUrl: string): LooseRaceIdentity {
  const $ = cheerio.load(html)
  const text = compact($('#main, #contentsBody, main, body').first().text())
  const dateMatch = text.match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/)
  const date = dateMatch
    ? `${dateMatch[1]}-${String(dateMatch[2]).padStart(2, '0')}-${String(dateMatch[3]).padStart(2, '0')}`
    : ''
  const meeting = text.match(/(\d+)回\s*([^\s\d]{2,7})\s*(\d+)日/)
  const number = nullableInteger(text.match(/(?:^|\s)(\d{1,2})\s*レース/)?.[1]
    ?? text.match(/(\d{1,2})R(?:\s|$)/i)?.[1])
  if (!date || !meeting?.[2] || !number) throw new Error(`Unable to locate race archive path for ${sourceUrl}`)
  return {
    id: stableId(cname || sourceUrl),
    date,
    venue: meeting[2],
    meetingNumber: nullableInteger(meeting[1]),
    meetingDay: nullableInteger(meeting[3]),
    number,
  }
}

export function meetingIdFor(identity: LooseRaceIdentity) {
  return `m-${stableId(`${identity.date}|${identity.venue}|${identity.meetingNumber ?? ''}|${identity.meetingDay ?? ''}`, 12)}`
}

export function raceDirectory(root: string, identity: LooseRaceIdentity) {
  return join(archiveDatePath(root, identity.date), meetingIdFor(identity), 'races', String(identity.number).padStart(2, '0'))
}

function rawFileName(pageType: PageType) {
  return `${pageType}.html.gz`
}

function makePageManifest(response: FetchResponse, pageType: PageType, root: string, rawPath: string, error: string | null): PageManifest {
  return {
    pageType,
    sourceUrl: response.finalUrl || response.action.url,
    cname: response.action.cname ?? null,
    method: response.action.cname ? 'POST' : 'GET',
    httpStatus: response.status,
    headers: response.headers,
    charset: response.charset,
    fetchedAt: response.fetchedAt,
    contentHash: sha256(response.bytes),
    byteLength: response.bytes.byteLength,
    rawPath: repositoryPath(root, rawPath),
    parseStatus: error ? 'failed' : 'parsed',
    error,
  }
}

function mergePages(pages: PageManifest[], page: PageManifest) {
  const filtered = pages.filter((candidate) => candidate.pageType !== page.pageType)
  return [...filtered, page].sort((a, b) => a.pageType.localeCompare(b.pageType))
}

function pageTextForClassification(response: FetchResponse) {
  const $ = cheerio.load(response.html)
  return compact(`${response.action.label ?? ''} ${$('title, h1, h2').slice(0, 5).text()}`)
}

export async function archiveRaceResponse(
  response: FetchResponse,
  requestedType: PageType,
  root = DEFAULT_DATA_ROOT,
  force = false,
): Promise<ArchiveResult> {
  let identity: LooseRaceIdentity
  try {
    identity = looseRaceIdentity(response.html, response.action.cname ?? '', response.finalUrl || response.action.url)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const failureDir = join(root, 'failures', response.fetchedAt.slice(0, 10), stableId(`${response.action.url}|${response.action.cname ?? ''}`))
    const rawPath = join(failureDir, 'raw.html.gz')
    await writeFileAtomic(rawPath, deterministicGzip(response.bytes))
    await writeJsonAtomic(join(failureDir, 'manifest.json'), {
      schemaVersion: 1,
      action: response.action,
      fetchedAt: response.fetchedAt,
      contentHash: sha256(response.bytes),
      rawPath: repositoryPath(root, rawPath),
      error: message,
    })
    return { changed: true, year: null, record: null, error: message }
  }

  const pageType = requestedType === 'odds-unknown'
    ? classifyOddsPage(pageTextForClassification(response))
    : requestedType
  const directory = raceDirectory(root, identity)
  const recordPath = join(directory, 'race.json')
  const manifestPath = join(directory, 'manifest.json')
  const rawPath = join(directory, 'raw', rawFileName(pageType))
  const existingRecord = await readJson<RaceRecord>(recordPath)
  const existingManifest = await readJson<RaceManifest>(manifestPath) ?? { schemaVersion: 1 as const, raceId: identity.id, pages: [] }
  const contentHash = sha256(response.bytes)
  const oldPage = existingManifest.pages.find((page) => page.pageType === pageType)
  if (!force && oldPage?.contentHash === contentHash && oldPage.parseStatus === 'parsed' && await exists(rawPath)) {
    return { changed: false, year: Number(identity.date.slice(0, 4)), record: existingRecord, error: null }
  }

  await writeFileAtomic(rawPath, deterministicGzip(response.bytes))
  let nextRecord = existingRecord
  let parseError: string | null = null
  try {
    if (pageType.startsWith('odds-')) {
      if (!existingRecord) throw new Error(`Odds page arrived before entry/result metadata for race ${identity.id}`)
      const quotes = parseOddsPage(response.html, response.fetchedAt)
      const quoteTypes = new Set(quotes.map((quote) => quote.betType))
      nextRecord = {
        ...existingRecord,
        odds: [...existingRecord.odds.filter((quote) => !quoteTypes.has(quote.betType)), ...quotes],
        pageDocuments: {
          ...existingRecord.pageDocuments,
          [pageType]: parseDocument(response.html, response.finalUrl || response.action.url),
        },
        updatedAt: response.fetchedAt,
      }
    } else if (pageType === 'entry' || pageType === 'result') {
      const parsed = parseRacePage(
        response.html,
        response.finalUrl || response.action.url,
        response.action.cname ?? response.finalUrl ?? response.action.url,
        response.fetchedAt,
      )
      parsed.pageDocuments[pageType] = parsed.document
      nextRecord = mergeRaceRecord(existingRecord, parsed)
    } else {
      throw new Error(`Page type ${pageType} is not a race page`)
    }
  } catch (error) {
    parseError = error instanceof Error ? error.message : String(error)
  }

  const page = makePageManifest(response, pageType, root, rawPath, parseError)
  const manifest = raceManifestSchema.parse({
    schemaVersion: 1,
    raceId: identity.id,
    pages: mergePages(existingManifest.pages, page),
  })
  await writeJsonAtomic(manifestPath, manifest)
  if (nextRecord) {
    nextRecord.pages = manifest.pages
    nextRecord.updatedAt = response.fetchedAt
    await writeJsonAtomic(recordPath, raceRecordSchema.parse(nextRecord))
  }
  return {
    changed: true,
    year: Number(identity.date.slice(0, 4)),
    record: nextRecord,
    error: parseError,
  }
}

export async function archiveMeetingResponse(
  response: FetchResponse,
  pageType: 'special-entry' | 'meeting-notice' | 'track-info',
  date: string,
  root = DEFAULT_DATA_ROOT,
) {
  const document = parseDocument(response.html, response.finalUrl || response.action.url)
  const $ = cheerio.load(response.html)
  const text = compact($('#main, #contentsBody, main, body').first().text())
  const meeting = text.match(/(\d+)回\s*([^\s\d]{2,7})\s*(\d+)日/)
  const venue = meeting?.[2] ?? 'all'
  const id = meeting
    ? meetingIdFor({
        id: stableId(response.action.cname ?? response.action.url),
        date,
        venue,
        meetingNumber: nullableInteger(meeting[1]),
        meetingDay: nullableInteger(meeting[3]),
        number: 1,
      })
    : `context-${stableId(`${response.action.url}|${response.action.cname ?? ''}`, 12)}`
  const directory = join(archiveDatePath(root, date), id)
  const rawPath = join(directory, 'raw', rawFileName(pageType))
  const recordPath = join(directory, 'meeting.json')
  const existing = await readJson<MeetingRecord>(recordPath)
  const hash = sha256(response.bytes)
  const oldPage = existing?.pages.find((page) => page.pageType === pageType)
  if (oldPage?.contentHash === hash && await exists(rawPath)) return false
  await writeFileAtomic(rawPath, deterministicGzip(response.bytes))
  const page = makePageManifest(response, pageType, root, rawPath, null)
  const record: MeetingRecord = meetingRecordSchema.parse({
    schemaVersion: 1,
    id,
    date,
    venue,
    title: document.title || response.action.label || pageType,
    document,
    pages: mergePages(existing?.pages ?? [], page),
    updatedAt: response.fetchedAt,
  })
  await writeJsonAtomic(recordPath, record)
  return true
}
