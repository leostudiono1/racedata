import { z } from 'zod'
import { PAGE_TYPES } from './types.js'

const nullableString = z.string().nullable()
const nullableNumber = z.number().nullable()
const documentLinkSchema = z.object({ text: z.string(), href: z.string() })
const documentBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('heading'), level: z.number().int().min(1).max(6), text: z.string() }),
  z.object({ type: z.literal('paragraph'), text: z.string(), links: z.array(documentLinkSchema) }),
  z.object({ type: z.literal('list'), items: z.array(z.string()) }),
  z.object({ type: z.literal('keyValue'), entries: z.array(z.object({ key: z.string(), value: z.string() })) }),
  z.object({ type: z.literal('table'), caption: nullableString, headers: z.array(z.string()), rows: z.array(z.array(z.string())) }),
])

export const parsedDocumentSchema = z.object({
  title: z.string(),
  language: nullableString,
  blocks: z.array(documentBlockSchema),
})

export const pageManifestSchema = z.object({
  pageType: z.enum(PAGE_TYPES),
  sourceUrl: z.string().url(),
  cname: nullableString,
  method: z.enum(['GET', 'POST']),
  httpStatus: z.number().int().min(100).max(599),
  headers: z.record(z.string(), z.string()),
  charset: z.enum(['shift_jis', 'utf-8']),
  fetchedAt: z.string().datetime(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  byteLength: z.number().int().nonnegative(),
  rawPath: z.string().min(1),
  parseStatus: z.enum(['parsed', 'failed']),
  error: nullableString,
})

export const raceManifestSchema = z.object({
  schemaVersion: z.literal(1),
  raceId: z.string().min(1),
  pages: z.array(pageManifestSchema),
})

const runnerSchema = z.object({
  horseId: z.string().min(1),
  number: z.number().int().positive().nullable(),
  frame: z.number().int().positive().nullable(),
  name: z.string().min(1),
  sex: nullableString,
  age: z.number().int().positive().nullable(),
  assignedWeightKg: nullableNumber,
  jockeyId: nullableString,
  jockeyName: nullableString,
  trainerId: nullableString,
  trainerName: nullableString,
  ownerName: nullableString,
  breederName: nullableString,
  bodyWeightKg: z.number().int().positive().nullable(),
  bodyWeightChangeKg: z.number().int().nullable(),
  equipment: z.array(z.string()),
  scratched: z.boolean(),
  finish: z.number().int().positive().nullable(),
  finishDisplay: nullableString,
  timeDisplay: nullableString,
  timeSeconds: nullableNumber,
  margin: nullableString,
  cornerPositions: z.array(z.string()),
  finalThreeFurlongsSeconds: nullableNumber,
  winOdds: nullableNumber,
  popularity: z.number().int().positive().nullable(),
  rawCells: z.array(z.string()),
})

const oddsSchema = z.object({
  betType: z.enum(['win', 'place', 'frame', 'quinella', 'wide', 'exacta', 'trio', 'trifecta', 'unknown']),
  combination: z.string(),
  minOdds: nullableNumber,
  maxOdds: nullableNumber,
  popularity: z.number().int().positive().nullable(),
  final: z.boolean(),
  rawCells: z.array(z.string()),
  fetchedAt: z.string().datetime(),
})

const payoutSchema = z.object({
  betType: z.enum(['win', 'place', 'frame', 'quinella', 'wide', 'exacta', 'trio', 'trifecta', 'unknown']),
  combination: z.string(),
  amountYen: z.number().int().nonnegative().nullable(),
  popularity: z.number().int().positive().nullable(),
  specialPayout: z.boolean(),
  rawCells: z.array(z.string()),
})

export const raceRecordSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  cname: z.string().min(1),
  sourceUrl: z.string().url(),
  date: z.iso.date(),
  venue: z.string().min(1),
  meetingNumber: z.number().int().positive().nullable(),
  meetingDay: z.number().int().positive().nullable(),
  number: z.number().int().positive(),
  startTime: nullableString,
  name: z.string().min(1),
  weather: nullableString,
  trackCondition: nullableString,
  condition: z.object({
    surface: z.enum(['turf', 'dirt', 'jump', 'unknown']),
    distanceMeters: z.number().int().positive().nullable(),
    direction: nullableString,
    courseVariant: nullableString,
    classLabel: nullableString,
    ageRestriction: nullableString,
    sexRestriction: nullableString,
    weightRule: nullableString,
  }),
  prizes: z.array(z.object({ place: z.number().int().positive().nullable(), label: z.string(), amountYen: z.number().int().nonnegative().nullable() })),
  runners: z.array(runnerSchema),
  odds: z.array(oddsSchema),
  result: z.object({
    final: z.boolean(),
    lapTimesSeconds: z.array(z.number().nonnegative()),
    finalSections: z.array(z.object({ label: z.string(), seconds: z.number().nonnegative() })),
    cornerPassages: z.array(z.object({ corner: z.string(), order: z.string() })),
  }).nullable(),
  payouts: z.array(payoutSchema),
  incidents: z.array(z.string()),
  winningHorse: z.object({
    horseId: nullableString,
    name: z.string().min(1),
    birthDate: nullableString,
    sex: nullableString,
    age: z.number().int().positive().nullable(),
    sire: nullableString,
    dam: nullableString,
    owner: nullableString,
    breeder: nullableString,
  }).nullable(),
  document: parsedDocumentSchema,
  pageDocuments: z.record(z.string(), parsedDocumentSchema),
  pages: z.array(pageManifestSchema),
  updatedAt: z.string().datetime(),
})

export const meetingRecordSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  date: z.iso.date(),
  venue: z.string().min(1),
  title: z.string(),
  document: parsedDocumentSchema,
  pages: z.array(pageManifestSchema),
  updatedAt: z.string().datetime(),
})

export const yearIndexSchema = z.object({
  schemaVersion: z.literal(1),
  year: z.number().int().min(1986),
  generatedAt: z.string().datetime(),
  races: z.array(z.object({
    id: z.string(),
    date: z.iso.date(),
    venue: z.string(),
    meetingId: z.string(),
    number: z.number().int().positive(),
    name: z.string(),
    path: z.string(),
    pageTypes: z.array(z.enum(PAGE_TYPES)),
    complete: z.boolean(),
  })),
})
