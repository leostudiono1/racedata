import { readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { raceRecordSchema, yearIndexSchema } from '../schema.js'
import type { PageType, RaceIndexEntry, RaceRecord, YearIndex } from '../types.js'
import { DEFAULT_DATA_ROOT, readJson, writeJsonAtomic } from './store.js'

async function filesNamed(directory: string, name: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return filesNamed(path, name)
    return entry.isFile() && entry.name === name ? [path] : []
  }))
  return nested.flat()
}

export async function raceRecordFiles(root = DEFAULT_DATA_ROOT, year?: number) {
  return filesNamed(join(root, 'archive', year ? String(year) : ''), 'race.json')
}

export async function rebuildYearIndex(year: number, root = DEFAULT_DATA_ROOT) {
  const files = await raceRecordFiles(root, year)
  const entries: RaceIndexEntry[] = []
  for (const file of files) {
    const record = raceRecordSchema.parse(await readJson<RaceRecord>(file))
    const pageTypes = record.pages.filter((page) => page.parseStatus === 'parsed').map((page) => page.pageType)
    const requiredOdds: PageType[] = ['odds-win-place', 'odds-frame', 'odds-quinella', 'odds-wide', 'odds-exacta', 'odds-trio', 'odds-trifecta']
    const hasEntry = pageTypes.includes('entry')
    const complete = pageTypes.includes('result') && (!hasEntry || requiredOdds.every((page) => pageTypes.includes(page)))
    const normalizedPath = relative(root, file).split(sep).join('/')
    const meetingId = normalizedPath.split('/').at(-4) ?? ''
    entries.push({
      id: record.id,
      date: record.date,
      venue: record.venue,
      meetingId,
      number: record.number,
      name: record.name,
      path: normalizedPath,
      pageTypes: [...new Set(pageTypes)].sort(),
      complete,
    })
  }
  entries.sort((a, b) => a.date.localeCompare(b.date) || a.venue.localeCompare(b.venue) || a.number - b.number)
  const previous = await readJson<YearIndex>(join(root, 'index', `${year}.json`))
  const generatedAt = previous && JSON.stringify(previous.races) === JSON.stringify(entries)
    ? previous.generatedAt
    : new Date().toISOString()
  const index = yearIndexSchema.parse({ schemaVersion: 1, year, generatedAt, races: entries })
  await writeJsonAtomic(join(root, 'index', `${year}.json`), index)
  return index
}
