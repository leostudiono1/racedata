import type { ParsedDocument } from '../types.js'

export const NETKEIBA_PAGE_TYPES = [
  'race-result',
  'horse-profile',
  'horse-pedigree',
  'horse-career',
] as const

export type NetkeibaPageType = (typeof NETKEIBA_PAGE_TYPES)[number]
export type NetkeibaCharset = 'utf-8' | 'shift_jis' | 'euc-jp'

export interface NetkeibaFetchResponse {
  url: string
  finalUrl: string
  status: number
  headers: Record<string, string>
  charset: NetkeibaCharset
  bytes: Uint8Array
  html: string
  fetchedAt: string
}

export interface NetkeibaPageManifest {
  pageType: NetkeibaPageType
  sourceUrl: string
  httpStatus: number
  headers: Record<string, string>
  charset: NetkeibaCharset
  fetchedAt: string
  contentHash: string
  byteLength: number
  rawPath: string
  parseStatus: 'parsed' | 'failed'
  error: string | null
}

export interface NetkeibaEntityManifest {
  schemaVersion: 1
  entityType: 'race' | 'horse'
  entityId: string
  pages: NetkeibaPageManifest[]
}

export interface NetkeibaEntityRef {
  id: string | null
  name: string
}

export interface NetkeibaRaceRunner {
  number: number | null
  frame: number | null
  horse: NetkeibaEntityRef
  jockey: NetkeibaEntityRef | null
  trainer: NetkeibaEntityRef | null
  owner: NetkeibaEntityRef | null
  sex: string | null
  age: number | null
  assignedWeightKg: number | null
  bodyWeightKg: number | null
  bodyWeightChangeKg: number | null
  finish: number | null
  finishDisplay: string | null
  timeDisplay: string | null
  timeSeconds: number | null
  margin: string | null
  passingOrder: string | null
  finalThreeFurlongsSeconds: number | null
  winOdds: number | null
  popularity: number | null
  prizeYen: number | null
  rawCells: string[]
}

export interface NetkeibaRaceRecord {
  schemaVersion: 1
  id: string
  jraRaceId: string
  sourceUrl: string
  date: string
  venue: string
  meetingNumber: number
  meetingDay: number
  number: number
  name: string
  runners: NetkeibaRaceRunner[]
  document: ParsedDocument
  pages: NetkeibaPageManifest[]
  updatedAt: string
}

export interface NetkeibaHorseProfile {
  name: string
  birthDate: string | null
  sex: string | null
  coatColor: string | null
  trainer: NetkeibaEntityRef | null
  owner: NetkeibaEntityRef | null
  breeder: NetkeibaEntityRef | null
  birthplace: string | null
  sire: NetkeibaEntityRef | null
  dam: NetkeibaEntityRef | null
  damsire: NetkeibaEntityRef | null
}

export interface NetkeibaPedigreeNode extends NetkeibaEntityRef {
  generation: number
  row: number
  rowSpan: number
}

export interface NetkeibaCareerEntry {
  date: string | null
  raceId: string | null
  raceName: string
  venue: string | null
  fieldSize: number | null
  frame: number | null
  number: number | null
  odds: number | null
  popularity: number | null
  finish: number | null
  finishDisplay: string | null
  jockey: NetkeibaEntityRef | null
  assignedWeightKg: number | null
  surface: string | null
  distanceMeters: number | null
  trackCondition: string | null
  timeDisplay: string | null
  timeSeconds: number | null
  margin: string | null
  pace: string | null
  passingOrder: string | null
  finalThreeFurlongsSeconds: number | null
  bodyWeightKg: number | null
  bodyWeightChangeKg: number | null
  prizeYen: number | null
  rawCells: string[]
}

export interface NetkeibaHorseRecord {
  schemaVersion: 1
  id: string
  sourceUrl: string
  profile: NetkeibaHorseProfile | null
  pedigree: NetkeibaPedigreeNode[]
  career: NetkeibaCareerEntry[]
  pageDocuments: Partial<Record<NetkeibaPageType, ParsedDocument>>
  pages: NetkeibaPageManifest[]
  updatedAt: string
}

export interface NetkeibaReport {
  fetched: number
  changed: number
  unchanged: number
  skipped: number
  timeLimitReached: boolean
  errors: string[]
}
