import { join } from 'node:path'
import { parseDocument } from '../jra/document.js'
import type { RaceRecord } from '../types.js'
import {
  deterministicGzip,
  exists,
  readJson,
  repositoryPath,
  sha256,
  writeFileAtomic,
  writeJsonAtomic,
} from '../archive/store.js'
import { netkeibaEntityManifestSchema, netkeibaHorseRecordSchema, netkeibaRaceRecordSchema } from './schema.js'
import { emptyHorseRecord, parseHorseCareer, parseHorsePedigree, parseHorseProfile, parseNetkeibaRace } from './parse.js'
import type {
  NetkeibaEntityManifest,
  NetkeibaFetchResponse,
  NetkeibaHorseProfile,
  NetkeibaHorseRecord,
  NetkeibaPedigreeNode,
  NetkeibaPageManifest,
  NetkeibaPageType,
  NetkeibaRaceRecord,
} from './types.js'

function profileWithPedigree(
  profile: NetkeibaHorseProfile | null,
  pedigree: NetkeibaPedigreeNode[],
) {
  if (!profile) return null
  const directParents = pedigree.filter((node) => node.generation === 0)
  const sire = directParents[0]
  const dam = directParents[1]
  const damsire = dam
    ? pedigree.find((node) => node.generation === 1 && node.row >= dam.row && node.row < dam.row + dam.rowSpan)
    : null
  return {
    ...profile,
    sire: sire ? { id: sire.id, name: sire.name } : profile.sire,
    dam: dam ? { id: dam.id, name: dam.name } : profile.dam,
    damsire: damsire ? { id: damsire.id, name: damsire.name } : profile.damsire,
  }
}

export interface NetkeibaArchiveResult<T> {
  changed: boolean
  record: T | null
  error: string | null
}

export function netkeibaRaceDirectory(root: string, raceId: string) {
  return join(root, 'netkeiba', 'races', raceId.slice(0, 4), raceId)
}

export function netkeibaHorseDirectory(root: string, horseId: string) {
  return join(root, 'netkeiba', 'horses', horseId.slice(0, 4), horseId)
}

function pageManifest(
  response: NetkeibaFetchResponse,
  pageType: NetkeibaPageType,
  root: string,
  rawPath: string,
  error: string | null,
): NetkeibaPageManifest {
  const headers = Object.fromEntries(Object.entries(response.headers)
    .filter(([name]) => !/^set-cookie2?$/i.test(name)))
  return {
    pageType,
    sourceUrl: response.finalUrl || response.url,
    httpStatus: response.status,
    headers,
    charset: response.charset,
    fetchedAt: response.fetchedAt,
    contentHash: sha256(response.bytes),
    byteLength: response.bytes.byteLength,
    rawPath: repositoryPath(root, rawPath),
    parseStatus: error ? 'failed' : 'parsed',
    error,
  }
}

function mergePages(pages: NetkeibaPageManifest[], next: NetkeibaPageManifest) {
  return [...pages.filter((page) => page.pageType !== next.pageType), next]
    .sort((left, right) => left.pageType < right.pageType ? -1 : left.pageType > right.pageType ? 1 : 0)
}

function initialManifest(entityType: 'race' | 'horse', entityId: string): NetkeibaEntityManifest {
  return { schemaVersion: 1, entityType, entityId, pages: [] }
}

async function existingPageIsCurrent(
  response: NetkeibaFetchResponse,
  pageType: NetkeibaPageType,
  rawPath: string,
  manifest: NetkeibaEntityManifest,
) {
  const previous = manifest.pages.find((page) => page.pageType === pageType)
  return previous?.contentHash === sha256(response.bytes) && previous.parseStatus === 'parsed' && await exists(rawPath)
}

export async function archiveNetkeibaRace(
  response: NetkeibaFetchResponse,
  jra: RaceRecord,
  root: string,
  force = false,
  writeRaw = true,
): Promise<NetkeibaArchiveResult<NetkeibaRaceRecord>> {
  const raceId = response.url.match(/\/race\/(\d{12})/)?.[1]
  if (!raceId) throw new Error(`Invalid netkeiba race URL: ${response.url}`)
  const directory = netkeibaRaceDirectory(root, raceId)
  const rawPath = join(directory, 'raw', 'race-result.html.gz')
  const recordPath = join(directory, 'race.json')
  const manifestPath = join(directory, 'manifest.json')
  const existingRecord = await readJson<NetkeibaRaceRecord>(recordPath)
  const existingManifest = await readJson<NetkeibaEntityManifest>(manifestPath) ?? initialManifest('race', raceId)
  if (!force && await existingPageIsCurrent(response, 'race-result', rawPath, existingManifest)) {
    return { changed: false, record: existingRecord, error: null }
  }
  if (writeRaw) await writeFileAtomic(rawPath, deterministicGzip(response.bytes))
  let parsed: NetkeibaRaceRecord | null = null
  let error: string | null = null
  try {
    parsed = parseNetkeibaRace(response.html, response.finalUrl || response.url, jra, response.fetchedAt)
  } catch (reason) {
    error = reason instanceof Error ? reason.message : String(reason)
  }
  const page = pageManifest(response, 'race-result', root, rawPath, error)
  const manifest = netkeibaEntityManifestSchema.parse({
    ...existingManifest,
    pages: mergePages(existingManifest.pages, page),
  })
  await writeJsonAtomic(manifestPath, manifest)
  if (parsed) {
    const record = netkeibaRaceRecordSchema.parse({ ...parsed, pages: manifest.pages })
    await writeJsonAtomic(recordPath, record)
    return { changed: true, record, error: null }
  }
  if (existingRecord) {
    const record = netkeibaRaceRecordSchema.parse({ ...existingRecord, pages: manifest.pages })
    await writeJsonAtomic(recordPath, record)
    return { changed: true, record, error }
  }
  return { changed: true, record: null, error }
}

export async function archiveNetkeibaHorse(
  response: NetkeibaFetchResponse,
  horseId: string,
  pageType: Exclude<NetkeibaPageType, 'race-result'>,
  root: string,
  force = false,
  writeRaw = true,
): Promise<NetkeibaArchiveResult<NetkeibaHorseRecord>> {
  const directory = netkeibaHorseDirectory(root, horseId)
  const rawPath = join(directory, 'raw', `${pageType}.html.gz`)
  const recordPath = join(directory, 'horse.json')
  const manifestPath = join(directory, 'manifest.json')
  const existingRecord = await readJson<NetkeibaHorseRecord>(recordPath)
  const existingManifest = await readJson<NetkeibaEntityManifest>(manifestPath) ?? initialManifest('horse', horseId)
  if (!force && await existingPageIsCurrent(response, pageType, rawPath, existingManifest)) {
    return { changed: false, record: existingRecord, error: null }
  }
  if (writeRaw) await writeFileAtomic(rawPath, deterministicGzip(response.bytes))
  let record = existingRecord ?? emptyHorseRecord(horseId, `https://db.netkeiba.com/horse/${horseId}/`, response.fetchedAt)
  let error: string | null = null
  try {
    if (pageType === 'horse-profile') {
      record = { ...record, profile: profileWithPedigree(parseHorseProfile(response.html), record.pedigree) }
    } else if (pageType === 'horse-pedigree') {
      const pedigree = parseHorsePedigree(response.html)
      record = { ...record, pedigree, profile: profileWithPedigree(record.profile, pedigree) }
    } else record = { ...record, career: parseHorseCareer(response.html) }
    record = {
      ...record,
      pageDocuments: {
        ...record.pageDocuments,
        [pageType]: parseDocument(response.html, response.finalUrl || response.url),
      },
      updatedAt: response.fetchedAt,
    }
  } catch (reason) {
    error = reason instanceof Error ? reason.message : String(reason)
  }
  const page = pageManifest(response, pageType, root, rawPath, error)
  const manifest = netkeibaEntityManifestSchema.parse({
    ...existingManifest,
    pages: mergePages(existingManifest.pages, page),
  })
  await writeJsonAtomic(manifestPath, manifest)
  const validated = netkeibaHorseRecordSchema.parse({ ...record, pages: manifest.pages })
  await writeJsonAtomic(recordPath, validated)
  return { changed: true, record: validated, error }
}
