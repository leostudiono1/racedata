import { join } from 'node:path'
import { raceRecordFiles } from '../archive/index.js'
import { DEFAULT_DATA_ROOT, readJson } from '../archive/store.js'
import { raceRecordSchema } from '../schema.js'
import type { RaceRecord } from '../types.js'
import { archiveNetkeibaHorse, archiveNetkeibaRace, netkeibaHorseDirectory, netkeibaRaceDirectory } from './archive.js'
import { fetchNetkeibaPage, NetkeibaAccessRestrictionError } from './http.js'
import {
  indexedNetkeibaHorseIds,
  rebuildNetkeibaHorseIndex,
  rebuildNetkeibaIndexes,
  rebuildNetkeibaRaceIndexes,
} from './index.js'
import { netkeibaRaceIdFor } from './parse.js'
import { netkeibaHorseRepairShard, netkeibaHorseShard } from './shard.js'
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

function horseTasks(horseIds: string[], refresh = true): HorseTask[] {
  const groups: Array<{ pageType: HorseTask['pageType']; path: string; refreshDays: number | null }> = [
    { pageType: 'horse-profile', path: 'horse', refreshDays: refresh ? 180 : null },
    { pageType: 'horse-pedigree', path: 'horse/ped', refreshDays: null },
    { pageType: 'horse-career', path: 'horse/result', refreshDays: refresh ? 30 : null },
  ]
  return horseIds.flatMap((horseId) => groups.map((group) => ({
    horseId,
    pageType: group.pageType,
    url: `https://db.netkeiba.com/${group.path}/${horseId}/`,
    refreshDays: group.refreshDays,
  })))
}

function emptyReport(): NetkeibaReport {
  return {
    fetched: 0,
    changed: 0,
    unchanged: 0,
    skipped: 0,
    timeLimitReached: false,
    accessRestricted: false,
    errors: [],
  }
}

function recordOutcome(report: NetkeibaReport, result: { changed: boolean; error: string | null }) {
  if (result.changed) report.changed += 1
  else report.unchanged += 1
  if (result.error) report.errors.push(result.error)
}

function deadlineFromMinutes(maxRuntimeMinutes: number) {
  if (!Number.isInteger(maxRuntimeMinutes) || maxRuntimeMinutes < 1) {
    throw new Error(`Invalid netkeiba runtime limit: ${maxRuntimeMinutes}`)
  }
  return Date.now() + maxRuntimeMinutes * 60_000
}

function reachedDeadline(report: NetkeibaReport, deadline: number) {
  if (Date.now() < deadline) return false
  report.timeLimitReached = true
  return true
}

async function collectRacePages(options: {
  root: string
  races: RaceRecord[]
  fetcher: NetkeibaFetcher
  now: Date
  report: NetkeibaReport
  canFetch: () => boolean
  refreshRecent: boolean
}) {
  const racesByNetkeibaId = new Map(options.races.map((record) => [netkeibaRaceIdFor(record) as string, record]))
  let restricted = false
  for (const [raceId, jra] of racesByNetkeibaId) {
    if (!options.canFetch()) break
    const directory = netkeibaRaceDirectory(options.root, raceId)
    const manifest = await readJson<NetkeibaEntityManifest>(join(directory, 'manifest.json'))
    const refreshDays = options.refreshRecent && jra.date >= daysAgo(options.now, 2) ? 2 : null
    if (hasFreshPage(manifest, 'race-result', options.now, refreshDays)) {
      options.report.skipped += 1
      continue
    }
    try {
      options.report.fetched += 1
      const response = await options.fetcher(`https://db.netkeiba.com/race/${raceId}/`)
      recordOutcome(options.report, await archiveNetkeibaRace(response, jra, options.root))
    } catch (error) {
      options.report.errors.push(error instanceof Error ? error.message : String(error))
      if (error instanceof NetkeibaAccessRestrictionError) {
        options.report.accessRestricted = true
        restricted = true
        break
      }
    }
  }
  return { racesByNetkeibaId, restricted }
}

async function collectHorsePages(options: {
  root: string
  horseIds: string[]
  fetcher: NetkeibaFetcher
  now: Date
  report: NetkeibaReport
  canFetch: () => boolean
  refresh: boolean
}) {
  for (const task of horseTasks(options.horseIds, options.refresh)) {
    if (!options.canFetch()) break
    const directory = netkeibaHorseDirectory(options.root, task.horseId)
    const manifest = await readJson<NetkeibaEntityManifest>(join(directory, 'manifest.json'))
    if (hasFreshPage(manifest, task.pageType, options.now, task.refreshDays)) {
      options.report.skipped += 1
      continue
    }
    try {
      options.report.fetched += 1
      const response = await options.fetcher(task.url)
      recordOutcome(options.report, await archiveNetkeibaHorse(response, task.horseId, task.pageType, options.root))
    } catch (error) {
      options.report.errors.push(error instanceof Error ? error.message : String(error))
      if (error instanceof NetkeibaAccessRestrictionError) {
        options.report.accessRestricted = true
        break
      }
    }
  }
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
  const { racesByNetkeibaId, restricted } = await collectRacePages({
    root, races: jraRaces, fetcher, now, report,
    canFetch: () => report.fetched < maxPages,
    refreshRecent: true,
  })

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
    await collectHorsePages({
      root, horseIds, fetcher, now, report,
      canFetch: () => report.fetched < maxPages,
      refresh: true,
    })
  }

  try {
    await rebuildNetkeibaIndexes(root)
  } catch (error) {
    report.errors.push(error instanceof Error ? error.message : String(error))
  }
  return report
}

export async function updateNetkeibaRaceYear(options: {
  year: number
  root?: string
  maxRuntimeMinutes?: number
  fetcher?: NetkeibaFetcher
  now?: Date
}) {
  const root = options.root ?? DEFAULT_DATA_ROOT
  const fetcher = options.fetcher ?? fetchNetkeibaPage
  const now = options.now ?? new Date()
  const deadline = deadlineFromMinutes(options.maxRuntimeMinutes ?? 330)
  const report = emptyReport()
  const races = await loadJraRaces(root, now, options.year)
  await collectRacePages({
    root, races, fetcher, now, report,
    canFetch: () => !reachedDeadline(report, deadline),
    refreshRecent: false,
  })
  try {
    await rebuildNetkeibaRaceIndexes(root)
  } catch (error) {
    report.errors.push(error instanceof Error ? error.message : String(error))
  }
  return report
}

export async function updateNetkeibaHorseShard(options: {
  shard: number
  shardCount: number
  root?: string
  maxRuntimeMinutes?: number
  fetcher?: NetkeibaFetcher
  now?: Date
  repairPartition?: boolean
}) {
  if (!Number.isInteger(options.shard) || options.shard < 0 || options.shard >= options.shardCount) {
    throw new Error(`Invalid netkeiba shard: ${options.shard}/${options.shardCount}`)
  }
  const root = options.root ?? DEFAULT_DATA_ROOT
  const fetcher = options.fetcher ?? fetchNetkeibaPage
  const now = options.now ?? new Date()
  const deadline = deadlineFromMinutes(options.maxRuntimeMinutes ?? 330)
  const report = emptyReport()
  const shardFor = options.repairPartition ? netkeibaHorseRepairShard : netkeibaHorseShard
  const horseIds = (await indexedNetkeibaHorseIds(root))
    .filter((id) => shardFor(id, options.shardCount) === options.shard)
  await collectHorsePages({
    root, horseIds, fetcher, now, report,
    canFetch: () => !reachedDeadline(report, deadline),
    refresh: false,
  })
  try {
    await rebuildNetkeibaHorseIndex(root)
  } catch (error) {
    report.errors.push(error instanceof Error ? error.message : String(error))
  }
  return report
}
