import { join } from 'node:path'
import { raceRecordFiles } from '../archive/index.js'
import { DEFAULT_DATA_ROOT, readJson } from '../archive/store.js'
import { raceRecordSchema } from '../schema.js'
import type { RaceRecord } from '../types.js'
import { archiveNetkeibaHorse, archiveNetkeibaRace, netkeibaHorseDirectory, netkeibaRaceDirectory } from './archive.js'
import { fetchNetkeibaPage, NetkeibaAccessRestrictionError } from './http.js'
import { rebuildNetkeibaIndexes } from './index.js'
import { netkeibaRaceIdFor } from './parse.js'
import type {
  NetkeibaEntityManifest,
  NetkeibaFetchResponse,
  NetkeibaPageType,
  NetkeibaRaceRecord,
  NetkeibaReport,
} from './types.js'

export type NetkeibaFetcher = (url: string) => Promise<NetkeibaFetchResponse>

interface HorseTask {
  horseId: string
  pageType: Exclude<NetkeibaPageType, 'race-result'>
  url: string
  refreshDays: number | null
}

function tokyoDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}

function daysAgo(now: Date, days: number) {
  const value = new Date(now)
  value.setUTCDate(value.getUTCDate() - days)
  return value.toISOString().slice(0, 10)
}

function hasFreshPage(manifest: NetkeibaEntityManifest | null, pageType: NetkeibaPageType, now: Date, refreshDays: number | null) {
  const page = manifest?.pages.find((candidate) => candidate.pageType === pageType && candidate.parseStatus === 'parsed')
  if (!page) return false
  if (refreshDays === null) return true
  return page.fetchedAt >= new Date(now.getTime() - refreshDays * 86_400_000).toISOString()
}

async function loadJraRaces(root: string, now: Date, year?: number) {
  const files = await raceRecordFiles(root, year)
  const cutoff = year ? `${year}-01-01` : daysAgo(now, 35)
  const today = tokyoDate(now)
  const records: RaceRecord[] = []
  for (const file of files) {
    const record = raceRecordSchema.parse(await readJson<RaceRecord>(file))
    if (record.date >= cutoff && record.date <= today && record.result?.final && netkeibaRaceIdFor(record)) records.push(record)
  }
  return records.sort((left, right) => right.date.localeCompare(left.date) || right.number - left.number)
}

function horseTasks(horseIds: string[]): HorseTask[] {
  const groups: Array<{ pageType: HorseTask['pageType']; path: string; refreshDays: number | null }> = [
    { pageType: 'horse-profile', path: 'horse', refreshDays: 180 },
    { pageType: 'horse-pedigree', path: 'horse/ped', refreshDays: null },
    { pageType: 'horse-career', path: 'horse/result', refreshDays: 30 },
  ]
  return groups.flatMap((group) => horseIds.map((horseId) => ({
    horseId,
    pageType: group.pageType,
    url: `https://db.netkeiba.com/${group.path}/${horseId}/`,
    refreshDays: group.refreshDays,
  })))
}

function emptyReport(): NetkeibaReport {
  return { fetched: 0, changed: 0, unchanged: 0, skipped: 0, errors: [] }
}

function recordOutcome(report: NetkeibaReport, result: { changed: boolean; error: string | null }) {
  if (result.changed) report.changed += 1
  else report.unchanged += 1
  if (result.error) report.errors.push(result.error)
}

export async function updateNetkeibaArchive(options: {
  root?: string
  year?: number
  maxPages?: number
  fetcher?: NetkeibaFetcher
  now?: Date
} = {}) {
  const root = options.root ?? DEFAULT_DATA_ROOT
  const maxPages = options.maxPages ?? Number(process.env.NETKEIBA_MAX_PAGES ?? 80)
  if (!Number.isInteger(maxPages) || maxPages < 1) throw new Error(`Invalid netkeiba page budget: ${maxPages}`)
  const fetcher = options.fetcher ?? fetchNetkeibaPage
  const now = options.now ?? new Date()
  const report = emptyReport()
  const jraRaces = await loadJraRaces(root, now, options.year)
  const racesByNetkeibaId = new Map(jraRaces.map((record) => [netkeibaRaceIdFor(record) as string, record]))
  let restricted = false

  for (const [raceId, jra] of racesByNetkeibaId) {
    if (report.fetched >= maxPages) break
    const directory = netkeibaRaceDirectory(root, raceId)
    const manifest = await readJson<NetkeibaEntityManifest>(join(directory, 'manifest.json'))
    const isRecent = jra.date >= daysAgo(now, 2)
    if (hasFreshPage(manifest, 'race-result', now, isRecent ? 2 : null)) {
      report.skipped += 1
      continue
    }
    try {
      report.fetched += 1
      const response = await fetcher(`https://db.netkeiba.com/race/${raceId}/`)
      recordOutcome(report, await archiveNetkeibaRace(response, jra, root))
    } catch (error) {
      report.errors.push(error instanceof Error ? error.message : String(error))
      if (error instanceof NetkeibaAccessRestrictionError) {
        restricted = true
        break
      }
    }
  }

  if (!restricted && report.fetched < maxPages) {
    const horseIds: string[] = []
    const seen = new Set<string>()
    for (const raceId of racesByNetkeibaId.keys()) {
      const race = await readJson<NetkeibaRaceRecord>(join(netkeibaRaceDirectory(root, raceId), 'race.json'))
      for (const runner of race?.runners ?? []) {
        if (runner.horse.id && !seen.has(runner.horse.id)) {
          seen.add(runner.horse.id)
          horseIds.push(runner.horse.id)
        }
      }
    }
    for (const task of horseTasks(horseIds)) {
      if (report.fetched >= maxPages) break
      const directory = netkeibaHorseDirectory(root, task.horseId)
      const manifest = await readJson<NetkeibaEntityManifest>(join(directory, 'manifest.json'))
      if (hasFreshPage(manifest, task.pageType, now, task.refreshDays)) {
        report.skipped += 1
        continue
      }
      try {
        report.fetched += 1
        const response = await fetcher(task.url)
        recordOutcome(report, await archiveNetkeibaHorse(response, task.horseId, task.pageType, root))
      } catch (error) {
        report.errors.push(error instanceof Error ? error.message : String(error))
        if (error instanceof NetkeibaAccessRestrictionError) break
      }
    }
  }

  try {
    await rebuildNetkeibaIndexes(root)
  } catch (error) {
    report.errors.push(error instanceof Error ? error.message : String(error))
  }
  return report
}
