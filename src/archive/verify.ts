import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { meetingRecordSchema, raceManifestSchema, raceRecordSchema, yearIndexSchema } from '../schema.js'
import type { MeetingRecord, PageManifest, RaceManifest, RaceRecord, YearIndex } from '../types.js'
import { raceRecordFiles } from './index.js'
import { DEFAULT_DATA_ROOT, exists, readJson, sha256 } from './store.js'

async function yearsUnder(root: string) {
  try {
    return (await readdir(join(root, 'archive'), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && /^\d{4}$/.test(entry.name))
      .map((entry) => Number(entry.name))
      .sort()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

async function filesNamed(directory: string, fileName: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  return (await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return filesNamed(path, fileName)
    return entry.isFile() && entry.name === fileName ? [path] : []
  }))).flat()
}

async function verifyPage(root: string, page: PageManifest, errors: string[]) {
  const rawPath = join(root, page.rawPath)
  try {
    const bytes = gunzipSync(await readFile(rawPath))
    if (sha256(bytes) !== page.contentHash) errors.push(`Raw hash mismatch: ${rawPath}`)
  } catch (error) {
    errors.push(`${rawPath}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function verifyArchive(root = DEFAULT_DATA_ROOT, selectedYear?: number) {
  const errors: string[] = []
  const ids = new Map<string, string>()
  const verifiedManifests = new Set<string>()
  const years = selectedYear ? [selectedYear] : await yearsUnder(root)
  let races = 0
  let pages = 0
  for (const year of years) {
    const files = await raceRecordFiles(root, year)
    const indexed = new Set<string>()
    const indexPath = join(root, 'index', `${year}.json`)
    if (!await exists(indexPath)) errors.push(`Missing year index: ${indexPath}`)
    else {
      try {
        const index = yearIndexSchema.parse(await readJson<YearIndex>(indexPath))
        for (const race of index.races) indexed.add(race.id)
      } catch (error) {
        errors.push(`${indexPath}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    for (const file of files) {
      try {
        const record = raceRecordSchema.parse(await readJson<RaceRecord>(file))
        races += 1
        const duplicate = ids.get(record.id)
        if (duplicate && duplicate !== file) errors.push(`Duplicate race id ${record.id}: ${duplicate}, ${file}`)
        ids.set(record.id, file)
        if (!indexed.has(record.id)) errors.push(`Race ${record.id} is missing from ${year} index`)
        const manifestPath = join(file, '..', 'manifest.json')
        const manifest = raceManifestSchema.parse(await readJson<RaceManifest>(manifestPath))
        verifiedManifests.add(manifestPath)
        if (manifest.raceId !== record.id) errors.push(`Manifest race id mismatch: ${manifestPath}`)
        for (const page of manifest.pages) {
          pages += 1
          if (page.parseStatus === 'failed') errors.push(`Unresolved parse failure: ${manifestPath} (${page.pageType}: ${page.error ?? 'unknown'})`)
          await verifyPage(root, page, errors)
        }
      } catch (error) {
        errors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
  const allManifests = await filesNamed(join(root, 'archive'), 'manifest.json')
  for (const file of allManifests.filter((candidate) => candidate.includes(`${join('races', '')}`) && !verifiedManifests.has(candidate))) {
    try {
      const manifest = raceManifestSchema.parse(await readJson<RaceManifest>(file))
      errors.push(`Race manifest has no schema-valid race.json: ${file}`)
      for (const page of manifest.pages) {
        pages += 1
        await verifyPage(root, page, errors)
      }
    } catch (error) {
      errors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const meetingFiles = await filesNamed(join(root, 'archive'), 'meeting.json')
  for (const file of meetingFiles) {
    try {
      const meeting = meetingRecordSchema.parse(await readJson<MeetingRecord>(file))
      for (const page of meeting.pages) {
        pages += 1
        await verifyPage(root, page, errors)
      }
    } catch (error) {
      errors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const failureFiles = await filesNamed(join(root, 'failures'), 'manifest.json')
  for (const file of failureFiles) {
    try {
      const failure = await readJson<{ rawPath: string; contentHash: string }>(file)
      if (!failure?.rawPath || !failure.contentHash) throw new Error('Invalid failure manifest')
      const rawPath = join(root, failure.rawPath)
      const bytes = gunzipSync(await readFile(rawPath))
      pages += 1
      if (sha256(bytes) !== failure.contentHash) errors.push(`Raw hash mismatch: ${rawPath}`)
    } catch (error) {
      errors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return { years, races, pages, meetings: meetingFiles.length, failures: failureFiles.length, errors }
}
