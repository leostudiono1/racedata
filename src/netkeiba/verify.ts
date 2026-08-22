import { readFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { exists, readJson, sha256 } from '../archive/store.js'
import {
  netkeibaEntityManifestSchema,
  netkeibaHorseIndexSchema,
  netkeibaHorseRecordSchema,
  netkeibaRaceIndexSchema,
  netkeibaRaceRecordSchema,
} from './schema.js'
import { filesNamed } from './index.js'
import { netkeibaHorseShard } from './shard.js'
import type { NetkeibaEntityManifest, NetkeibaHorseRecord, NetkeibaRaceRecord } from './types.js'

export async function verifyNetkeibaArchive(root: string, selectedYear?: number) {
  const errors: string[] = []
  const raceRoot = selectedYear
    ? join(root, 'netkeiba', 'races', String(selectedYear))
    : join(root, 'netkeiba', 'races')
  const raceFiles = await filesNamed(raceRoot, 'race.json')
  const horseFiles = await filesNamed(join(root, 'netkeiba', 'horses'), 'horse.json')
  const manifests = new Set<string>()
  const raceIds = new Set<string>()
  const horseIds = new Set<string>()
  let pages = 0

  async function verifyEntity(file: string, entityType: 'race' | 'horse') {
    try {
      const record = entityType === 'race'
        ? netkeibaRaceRecordSchema.parse(await readJson<NetkeibaRaceRecord>(file))
        : netkeibaHorseRecordSchema.parse(await readJson<NetkeibaHorseRecord>(file))
      const manifestPath = join(file, '..', 'manifest.json')
      const manifest = netkeibaEntityManifestSchema.parse(await readJson<NetkeibaEntityManifest>(manifestPath))
      manifests.add(manifestPath)
      if (manifest.entityType !== entityType || manifest.entityId !== record.id) {
        errors.push(`Entity manifest mismatch: ${manifestPath}`)
      }
      if (entityType === 'race') {
        if (raceIds.has(record.id)) errors.push(`Duplicate netkeiba race id: ${record.id}`)
        raceIds.add(record.id)
      } else {
        if (horseIds.has(record.id)) errors.push(`Duplicate netkeiba horse id: ${record.id}`)
        horseIds.add(record.id)
      }
      if (JSON.stringify(manifest.pages) !== JSON.stringify(record.pages)) {
        errors.push(`Record pages differ from manifest: ${file}`)
      }
      for (const page of manifest.pages) {
        pages += 1
        if (page.parseStatus === 'failed') errors.push(`Unresolved parse failure: ${manifestPath} (${page.pageType}: ${page.error ?? 'unknown'})`)
        const rawPath = join(root, page.rawPath)
        try {
          const bytes = gunzipSync(await readFile(rawPath))
          if (sha256(bytes) !== page.contentHash) errors.push(`Raw hash mismatch: ${rawPath}`)
        } catch (error) {
          errors.push(`${rawPath}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    } catch (error) {
      errors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  for (const file of raceFiles) await verifyEntity(file, 'race')
  for (const file of horseFiles) await verifyEntity(file, 'horse')

  const manifestRoots = [raceRoot, join(root, 'netkeiba', 'horses')]
  for (const base of manifestRoots) {
    for (const file of await filesNamed(base, 'manifest.json')) {
      if (!manifests.has(file)) errors.push(`Manifest has no schema-valid record: ${file}`)
    }
  }
  if (raceFiles.length) {
    const years = [...new Set(raceFiles.map((file) => Number(file.match(/[\\/]races[\\/](\d{4})[\\/]/)?.[1])).filter(Number.isFinite))]
    for (const year of years) {
      const indexPath = join(root, 'netkeiba', 'index', 'races', `${year}.json`)
      if (!await exists(indexPath)) errors.push(`Missing netkeiba race index for ${year}`)
      else {
        try {
          const index = netkeibaRaceIndexSchema.parse(await readJson(indexPath))
          for (const race of index.races) {
            if (!raceIds.has(race.id)) errors.push(`Indexed netkeiba race has no record: ${race.id}`)
          }
          for (const raceId of raceIds) {
            if (raceId.startsWith(String(year)) && !index.races.some((race) => race.id === raceId)) errors.push(`Netkeiba race missing from index: ${raceId}`)
          }
        } catch (error) {
          errors.push(`${indexPath}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
  }
  if (horseFiles.length) {
    const horseIndexPath = join(root, 'netkeiba', 'index', 'horses.json')
    if (!await exists(horseIndexPath)) errors.push('Missing netkeiba horse index')
    else {
      try {
        const index = netkeibaHorseIndexSchema.parse(await readJson(horseIndexPath))
        const indexed = new Set(index.horses.map((horse) => horse.id))
        for (const id of horseIds) if (!indexed.has(id)) errors.push(`Netkeiba horse missing from index: ${id}`)
        for (const id of indexed) if (!horseIds.has(id)) errors.push(`Indexed netkeiba horse has no record: ${id}`)
      } catch (error) {
        errors.push(`${horseIndexPath}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
  return { races: raceFiles.length, horses: horseFiles.length, pages, errors }
}

export async function verifyNetkeibaHorseShard(root: string, shard: number, shardCount: number) {
  if (!Number.isInteger(shard) || shard < 0 || shard >= shardCount) {
    throw new Error(`Invalid netkeiba shard: ${shard}/${shardCount}`)
  }
  const errors: string[] = []
  const allFiles = await filesNamed(join(root, 'netkeiba', 'horses'), 'horse.json')
  const horseFiles = allFiles.filter((file) => netkeibaHorseShard(basename(dirname(file)), shardCount) === shard)
  const horseIds = new Set<string>()
  let pages = 0

  for (const file of horseFiles) {
    try {
      const record = netkeibaHorseRecordSchema.parse(await readJson<NetkeibaHorseRecord>(file))
      if (horseIds.has(record.id)) errors.push(`Duplicate netkeiba horse id: ${record.id}`)
      horseIds.add(record.id)
      if (netkeibaHorseShard(record.id, shardCount) !== shard) errors.push(`Horse is in wrong verification shard: ${record.id}`)
      const manifestPath = join(file, '..', 'manifest.json')
      const manifest = netkeibaEntityManifestSchema.parse(await readJson<NetkeibaEntityManifest>(manifestPath))
      if (manifest.entityType !== 'horse' || manifest.entityId !== record.id) {
        errors.push(`Entity manifest mismatch: ${manifestPath}`)
      }
      if (JSON.stringify(manifest.pages) !== JSON.stringify(record.pages)) {
        errors.push(`Record pages differ from manifest: ${file}`)
      }
      for (const page of manifest.pages) {
        pages += 1
        if (page.parseStatus === 'failed') errors.push(`Unresolved parse failure: ${manifestPath} (${page.pageType}: ${page.error ?? 'unknown'})`)
        const rawPath = join(root, page.rawPath)
        try {
          const bytes = gunzipSync(await readFile(rawPath))
          if (sha256(bytes) !== page.contentHash) errors.push(`Raw hash mismatch: ${rawPath}`)
        } catch (error) {
          errors.push(`${rawPath}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    } catch (error) {
      errors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (horseFiles.length) {
    const horseIndexPath = join(root, 'netkeiba', 'index', 'horses.json')
    if (!await exists(horseIndexPath)) errors.push('Missing netkeiba horse index')
    else {
      try {
        const index = netkeibaHorseIndexSchema.parse(await readJson(horseIndexPath))
        const indexed = new Set(index.horses.map((horse) => horse.id))
        for (const id of horseIds) if (!indexed.has(id)) errors.push(`Netkeiba horse missing from index: ${id}`)
      } catch (error) {
        errors.push(`${horseIndexPath}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
  return { horses: horseFiles.length, pages, errors }
}
