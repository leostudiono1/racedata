export const PAGE_TYPES = [
  'entry',
  'result',
  'odds-win-place',
  'odds-frame',
  'odds-quinella',
  'odds-wide',
  'odds-exacta',
  'odds-trio',
  'odds-trifecta',
  'odds-unknown',
  'special-entry',
  'meeting-notice',
  'track-info',
] as const

export type PageType = (typeof PAGE_TYPES)[number]
export type Surface = 'turf' | 'dirt' | 'jump' | 'unknown'
export type ParseStatus = 'parsed' | 'failed'
export type BetType = 'win' | 'place' | 'frame' | 'quinella' | 'wide' | 'exacta' | 'trio' | 'trifecta' | 'unknown'

export interface JraAction {
  url: string
  cname?: string
  label?: string
}

export interface FetchResponse {
  action: JraAction
  finalUrl: string
  status: number
  headers: Record<string, string>
  charset: 'shift_jis' | 'utf-8'
  bytes: Uint8Array
  html: string
  fetchedAt: string
}

export interface DocumentLink {
  text: string
  href: string
}

export type DocumentBlock =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string; links: DocumentLink[] }
  | { type: 'list'; items: string[] }
  | { type: 'keyValue'; entries: Array<{ key: string; value: string }> }
  | { type: 'table'; caption: string | null; headers: string[]; rows: string[][] }

export interface ParsedDocument {
  title: string
  language: string | null
  blocks: DocumentBlock[]
}

export interface PageManifest {
  pageType: PageType
  sourceUrl: string
  cname: string | null
  method: 'GET' | 'POST'
  httpStatus: number
  headers: Record<string, string>
  charset: 'shift_jis' | 'utf-8'
  fetchedAt: string
  contentHash: string
  byteLength: number
  rawPath: string
  parseStatus: ParseStatus
  error: string | null
}

export interface RaceManifest {
  schemaVersion: 1
  raceId: string
  pages: PageManifest[]
}

export interface RaceCondition {
  surface: Surface
  distanceMeters: number | null
  direction: string | null
  courseVariant: string | null
  classLabel: string | null
  ageRestriction: string | null
  sexRestriction: string | null
  weightRule: string | null
}

export interface Prize {
  place: number | null
  label: string
  amountYen: number | null
}

export interface RunnerRecord {
  horseId: string
  number: number | null
  frame: number | null
  name: string
  sex: string | null
  age: number | null
  assignedWeightKg: number | null
  jockeyId: string | null
  jockeyName: string | null
  trainerId: string | null
  trainerName: string | null
  ownerName: string | null
  breederName: string | null
  bodyWeightKg: number | null
  bodyWeightChangeKg: number | null
  equipment: string[]
  scratched: boolean
  finish: number | null
  finishDisplay: string | null
  timeDisplay: string | null
  timeSeconds: number | null
  margin: string | null
  cornerPositions: string[]
  finalThreeFurlongsSeconds: number | null
  winOdds: number | null
  popularity: number | null
  rawCells: string[]
}

export interface OddsQuote {
  betType: BetType
  combination: string
  minOdds: number | null
  maxOdds: number | null
  popularity: number | null
  final: boolean
  rawCells: string[]
  fetchedAt: string
}

export interface Payout {
  betType: BetType
  combination: string
  amountYen: number | null
  popularity: number | null
  specialPayout: boolean
  rawCells: string[]
}

export interface RaceResult {
  final: boolean
  lapTimesSeconds: number[]
  finalSections: Array<{ label: string; seconds: number }>
  cornerPassages: Array<{ corner: string; order: string }>
}

export interface WinningHorse {
  horseId: string | null
  name: string
  birthDate: string | null
  sex: string | null
  age: number | null
  sire: string | null
  dam: string | null
  owner: string | null
  breeder: string | null
}

export interface RaceRecord {
  schemaVersion: 1
  id: string
  cname: string
  sourceUrl: string
  date: string
  venue: string
  meetingNumber: number | null
  meetingDay: number | null
  number: number
  startTime: string | null
  name: string
  weather: string | null
  trackCondition: string | null
  condition: RaceCondition
  prizes: Prize[]
  runners: RunnerRecord[]
  odds: OddsQuote[]
  result: RaceResult | null
  payouts: Payout[]
  incidents: string[]
  winningHorse: WinningHorse | null
  document: ParsedDocument
  pageDocuments: Partial<Record<PageType, ParsedDocument>>
  pages: PageManifest[]
  updatedAt: string
}

export interface MeetingRecord {
  schemaVersion: 1
  id: string
  date: string
  venue: string
  title: string
  document: ParsedDocument
  pages: PageManifest[]
  updatedAt: string
}

export interface RaceIndexEntry {
  id: string
  date: string
  venue: string
  meetingId: string
  number: number
  name: string
  path: string
  pageTypes: PageType[]
  complete: boolean
}

export interface YearIndex {
  schemaVersion: 1
  year: number
  generatedAt: string
  races: RaceIndexEntry[]
}

export interface CrawlReport {
  fetched: number
  changed: number
  unchanged: number
  errors: string[]
  years: number[]
}
