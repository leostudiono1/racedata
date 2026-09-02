import { readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import {
  netkeibaHorseIndexSchema,
  netkeibaHorseRecordSchema,
  netkeibaRaceIndexSchema,
  netkeibaRaceRecordSchema,
} from './schema.js'
import type { NetkeibaHorseRecord, NetkeibaRaceRecord } from './types.js'
import { NETKEIBA_HORSE_PAGE_TYPES } from './types.js'
import { readJson, writeJsonAtomic } from '../archive/store.js'

export async function filesNamed(directory: string, fileName: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  return (await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? filesNamed(path, fileName) : entry.isFile() && entry.name === fileName ? [path] : []
  }))).flat()
}

export async function indexedNetkeibaHorseIds(root: string) {
  let files: string[]
  try {
    files = (await readdir(join(root, 'netkeiba', 'index', 'races')))
      .filter((file) => /^\d{4}\.json$/.test(file))
      .sort()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const ids = new Set<string>()
  for (const file of files) {
    const index = netkeibaRaceIndexSchema.parse(await readJson(join(root, 'netkeiba', 'index', 'races', file)))
    for (const race of index.races) for (const id of race.horseIds) ids.add(id)
  }
  return [...ids].sort()
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0
}

function stableGeneratedAt(previous: { generatedAt: string; [key: string]: unknown } | null, content: unknown) {
  if (!previous) return new Date().toISOString()
  const previousContent = JSON.stringify(previous, (key, value) => key === 'generatedAt' ? undefined : value)
  return previousContent === JSON.stringify(content) ? previous.generatedAt : new Date().toISOString()
}

export async function rebuildNetkeibaRaceIndexes(root: string) {
  const raceFiles = await filesNamed(join(root, 'netkeiba', 'races'), 'race.json')
  const byYear = new Map<number, Array<{
    id: string; jraRaceId: string; date: string; venue: string; number: number; name: string; path: string; horseIds: string[]
  }>>()
  for (const file of raceFiles) {
    const record = netkeibaRaceRecordSchema.parse(await readJson<NetkeibaRaceRecord>(file))
    const year = Number(record.date.slice(0, 4))
    const entries = byYear.get(year) ?? []
    entries.push({
      id: record.id,
      jraRaceId: record.jraRaceId,
      date: record.date,
      venue: record.venue,
      number: record.number,
      name: record.name,
      path: relative(root, file).split(sep).join('/'),
      horseIds: record.runners.map((runner) => runner.horse.id).filter((id): id is string => Boolean(id)),
    })
    byYear.set(year, entries)
  }
  for (const [year, races] of byYear) {
    races.sort((left, right) => compareText(left.date, right.date) || compareText(left.id, right.id))
    const path = join(root, 'netkeiba', 'index', 'races', `${year}.json`)
    const content = { schemaVersion: 1 as const, year, races }
    const previous = await readJson<typeof content & { generatedAt: string }>(path)
    await writeJsonAtomic(path, netkeibaRaceIndexSchema.parse({
      ...content,
      generatedAt: stableGeneratedAt(previous, content),
    }))
  }

  return { races: raceFiles.length, years: [...byYear.keys()].sort() }
}

export async function rebuildNetkeibaHorseIndex(root: string) {
  const horseFiles = await filesNamed(join(root, 'netkeiba', 'horses'), 'horse.json')
  const horses: Array<{ id: string; name: string | null; path: string; pageTypes: string[]; complete: boolean }> = []
  for (const file of horseFiles) {
    const record = netkeibaHorseRecordSchema.parse(await readJson<NetkeibaHorseRecord>(file))
    const pageTypes = record.pages.filter((page) => page.parseStatus === 'parsed').map((page) => page.pageType).sort()
    horses.push({
      id: record.id,
      name: record.profile?.name ?? null,
      path: relative(root, file).split(sep).join('/'),
      pageTypes,
      complete: NETKEIBA_HORSE_PAGE_TYPES.every((pageType) => pageTypes.includes(pageType)),
    })
  }
  horses.sort((left, right) => compareText(left.id, right.id))
  const horseIndexPath = join(root, 'netkeiba', 'index', 'horses.json')
  const horseContent = { schemaVersion: 1 as const, horses }
  const previousHorses = await readJson<typeof horseContent & { generatedAt: string }>(horseIndexPath)
  await writeJsonAtomic(horseIndexPath, netkeibaHorseIndexSchema.parse({
    ...horseContent,
    generatedAt: stableGeneratedAt(previousHorses, horseContent),
  }))
  return { horses: horseFiles.length }
}

export async function rebuildNetkeibaIndexes(root: string) {
  const races = await rebuildNetkeibaRaceIndexes(root)
  const horses = await rebuildNetkeibaHorseIndex(root)
  return { ...races, ...horses }
}
