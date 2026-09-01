import { readFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { raceRecordFiles } from '../archive/index.js'
import { readJson } from '../archive/store.js'
import { raceRecordSchema } from '../schema.js'
import type { RaceRecord } from '../types.js'
import { archiveNetkeibaHorse, archiveNetkeibaRace } from './archive.js'
import { rebuildNetkeibaHorseIndex, rebuildNetkeibaIndexes, filesNamed } from './index.js'
import { netkeibaEntityManifestSchema } from './schema.js'
import { netkeibaHorseShard } from './shard.js'
import type { NetkeibaEntityManifest, NetkeibaFetchResponse } from './types.js'

async function responseFromRaw(root: string, page: NetkeibaEntityManifest['pages'][number]) {
  const bytes = new Uint8Array(gunzipSync(await readFile(join(root, page.rawPath))))
  return {
    url: page.sourceUrl,
    finalUrl: page.sourceUrl,
    status: page.httpStatus,
    headers: page.headers,
    charset: page.charset,
    bytes,
    html: new TextDecoder(page.charset).decode(bytes),
    fetchedAt: page.fetchedAt,
  } satisfies NetkeibaFetchResponse
}

export async function reparseNetkeibaArchive(root: string, selectedYear?: number) {
  const errors: string[] = []
  let parsed = 0
  const jraById = new Map<string, RaceRecord>()
  for (const file of await raceRecordFiles(root, selectedYear)) {
    const record = raceRecordSchema.parse(await readJson<RaceRecord>(file))
    jraById.set(record.id, record)
  }
  const raceRoot = selectedYear
    ? join(root, 'netkeiba', 'races', String(selectedYear))
    : join(root, 'netkeiba', 'races')
  for (const file of await filesNamed(raceRoot, 'manifest.json')) {
    try {
      const manifest = netkeibaEntityManifestSchema.parse(await readJson<NetkeibaEntityManifest>(file))
      const record = await readJson<{ jraRaceId: string }>(join(file, '..', 'race.json'))
      const jra = record ? jraById.get(record.jraRaceId) : null
      if (!jra) throw new Error(`JRA source record not found for netkeiba race ${manifest.entityId}`)
      const page = manifest.pages.find((candidate) => candidate.pageType === 'race-result')
      if (!page) throw new Error('Missing race-result page')
      const result = await archiveNetkeibaRace(await responseFromRaw(root, page), jra, root, true, false)
      if (result.error) errors.push(`${file}: ${result.error}`)
      else parsed += 1
    } catch (error) {
      errors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  for (const file of await filesNamed(join(root, 'netkeiba', 'horses'), 'manifest.json')) {
    try {
      const manifest = netkeibaEntityManifestSchema.parse(await readJson<NetkeibaEntityManifest>(file))
      for (const page of manifest.pages) {
        if (page.pageType === 'race-result') continue
        const result = await archiveNetkeibaHorse(await responseFromRaw(root, page), manifest.entityId, page.pageType, root, true, false)
        if (result.error) errors.push(`${file}: ${page.pageType}: ${result.error}`)
        else parsed += 1
      }
    } catch (error) {
      errors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  try {
    await rebuildNetkeibaIndexes(root)
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error))
  }
  return { parsed, errors }
}

export async function reparseNetkeibaHorseShard(options: {
  root: string
  shard: number
  shardCount: number
  failedOnly?: boolean
}) {
  if (!Number.isInteger(options.shardCount) || options.shardCount < 1
    || !Number.isInteger(options.shard) || options.shard < 0 || options.shard >= options.shardCount) {
    throw new Error(`Invalid netkeiba shard: ${options.shard}/${options.shardCount}`)
  }
  const errors: string[] = []
  let parsed = 0
  const failedOnly = options.failedOnly ?? true
  const files = await filesNamed(join(options.root, 'netkeiba', 'horses'), 'manifest.json')
  for (const file of files) {
    const horseId = basename(dirname(file))
    if (netkeibaHorseShard(horseId, options.shardCount) !== options.shard) continue
    let manifest: NetkeibaEntityManifest
    try {
      manifest = netkeibaEntityManifestSchema.parse(await readJson<NetkeibaEntityManifest>(file))
    } catch (error) {
      errors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    for (const page of manifest.pages) {
      if (page.pageType === 'race-result' || (failedOnly && page.parseStatus !== 'failed')) continue
      try {
        const result = await archiveNetkeibaHorse(
          await responseFromRaw(options.root, page),
          manifest.entityId,
          page.pageType,
          options.root,
          true,
          false,
        )
        if (result.error) errors.push(`${file}: ${page.pageType}: ${result.error}`)
        else parsed += 1
      } catch (error) {
        errors.push(`${file}: ${page.pageType}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
  try {
    await rebuildNetkeibaHorseIndex(options.root)
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error))
  }
  return { parsed, errors }
}
