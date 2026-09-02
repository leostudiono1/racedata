import { dirname, join } from 'node:path'
import { raceManifestSchema, raceRecordSchema } from '../schema.js'
import type { RaceManifest, RaceRecord } from '../types.js'
import { raceRecordFiles } from './index.js'
import { DEFAULT_DATA_ROOT, readJson, writeJsonAtomic } from './store.js'

export async function repairRaceManifestIds(root = DEFAULT_DATA_ROOT, year?: number) {
  const errors: string[] = []
  let scanned = 0
  let repaired = 0

  for (const recordPath of await raceRecordFiles(root, year)) {
    scanned += 1
    const manifestPath = join(dirname(recordPath), 'manifest.json')
    try {
      const record = raceRecordSchema.parse(await readJson<RaceRecord>(recordPath))
      const manifest = raceManifestSchema.parse(await readJson<RaceManifest>(manifestPath))
      if (manifest.raceId === record.id) continue
      await writeJsonAtomic(manifestPath, raceManifestSchema.parse({ ...manifest, raceId: record.id }))
      repaired += 1
    } catch (error) {
      errors.push(`${manifestPath}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return { scanned, repaired, errors }
}
