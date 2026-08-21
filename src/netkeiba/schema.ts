import { z } from 'zod'
import { parsedDocumentSchema } from '../schema.js'
import { NETKEIBA_PAGE_TYPES } from './types.js'

const nullableString = z.string().nullable()
const nullableNumber = z.number().nullable()
const entityRefSchema = z.object({ id: nullableString, name: z.string().min(1) })

export const netkeibaPageManifestSchema = z.object({
  pageType: z.enum(NETKEIBA_PAGE_TYPES),
  sourceUrl: z.string().url(),
  httpStatus: z.number().int().min(100).max(599),
  headers: z.record(z.string(), z.string()),
  charset: z.enum(['utf-8', 'shift_jis', 'euc-jp']),
  fetchedAt: z.string().datetime(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  byteLength: z.number().int().nonnegative(),
  rawPath: z.string().min(1),
  parseStatus: z.enum(['parsed', 'failed']),
  error: nullableString,
})

export const netkeibaEntityManifestSchema = z.object({
  schemaVersion: z.literal(1),
  entityType: z.enum(['race', 'horse']),
  entityId: z.string().min(1),
  pages: z.array(netkeibaPageManifestSchema),
})

const raceRunnerSchema = z.object({
  number: z.number().int().positive().nullable(),
  frame: z.number().int().positive().nullable(),
  horse: entityRefSchema,
  jockey: entityRefSchema.nullable(),
  trainer: entityRefSchema.nullable(),
  owner: entityRefSchema.nullable(),
  sex: nullableString,
  age: z.number().int().positive().nullable(),
  assignedWeightKg: nullableNumber,
  bodyWeightKg: z.number().int().positive().nullable(),
  bodyWeightChangeKg: z.number().int().nullable(),
  finish: z.number().int().positive().nullable(),
  finishDisplay: nullableString,
  timeDisplay: nullableString,
  timeSeconds: nullableNumber,
  margin: nullableString,
  passingOrder: nullableString,
  finalThreeFurlongsSeconds: nullableNumber,
  winOdds: nullableNumber,
  popularity: z.number().int().positive().nullable(),
  prizeYen: z.number().int().nonnegative().nullable(),
  rawCells: z.array(z.string()),
})

export const netkeibaRaceRecordSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^\d{12}$/),
  jraRaceId: z.string().min(1),
  sourceUrl: z.string().url(),
  date: z.iso.date(),
  venue: z.string().min(1),
  meetingNumber: z.number().int().positive(),
  meetingDay: z.number().int().positive(),
  number: z.number().int().positive(),
  name: z.string().min(1),
  runners: z.array(raceRunnerSchema),
  document: parsedDocumentSchema,
  pages: z.array(netkeibaPageManifestSchema),
  updatedAt: z.string().datetime(),
})

const profileSchema = z.object({
  name: z.string().min(1),
  birthDate: nullableString,
  sex: nullableString,
  coatColor: nullableString,
  trainer: entityRefSchema.nullable(),
  owner: entityRefSchema.nullable(),
  breeder: entityRefSchema.nullable(),
  birthplace: nullableString,
  sire: entityRefSchema.nullable(),
  dam: entityRefSchema.nullable(),
  damsire: entityRefSchema.nullable(),
})

const careerSchema = z.object({
  date: nullableString,
  raceId: nullableString,
  raceName: z.string(),
  venue: nullableString,
  fieldSize: z.number().int().positive().nullable(),
  frame: z.number().int().positive().nullable(),
  number: z.number().int().positive().nullable(),
  odds: nullableNumber,
  popularity: z.number().int().positive().nullable(),
  finish: z.number().int().positive().nullable(),
  finishDisplay: nullableString,
  jockey: entityRefSchema.nullable(),
  assignedWeightKg: nullableNumber,
  surface: nullableString,
  distanceMeters: z.number().int().positive().nullable(),
  trackCondition: nullableString,
  timeDisplay: nullableString,
  timeSeconds: nullableNumber,
  margin: nullableString,
  pace: nullableString,
  passingOrder: nullableString,
  finalThreeFurlongsSeconds: nullableNumber,
  bodyWeightKg: z.number().int().positive().nullable(),
  bodyWeightChangeKg: z.number().int().nullable(),
  prizeYen: z.number().int().nonnegative().nullable(),
  rawCells: z.array(z.string()),
})

export const netkeibaHorseRecordSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^\d+$/),
  sourceUrl: z.string().url(),
  profile: profileSchema.nullable(),
  pedigree: z.array(entityRefSchema.extend({
    generation: z.number().int().nonnegative(),
    row: z.number().int().nonnegative(),
    rowSpan: z.number().int().positive(),
  })),
  career: z.array(careerSchema),
  pageDocuments: z.record(z.string(), parsedDocumentSchema),
  pages: z.array(netkeibaPageManifestSchema),
  updatedAt: z.string().datetime(),
})

export const netkeibaRaceIndexSchema = z.object({
  schemaVersion: z.literal(1),
  year: z.number().int().min(1986),
  races: z.array(z.object({
    id: z.string().regex(/^\d{12}$/),
    jraRaceId: z.string().min(1),
    date: z.iso.date(),
    venue: z.string().min(1),
    number: z.number().int().positive(),
    name: z.string().min(1),
    path: z.string().min(1),
    horseIds: z.array(z.string().regex(/^\d+$/)),
  })),
  generatedAt: z.string().datetime(),
})

export const netkeibaHorseIndexSchema = z.object({
  schemaVersion: z.literal(1),
  horses: z.array(z.object({
    id: z.string().regex(/^\d+$/),
    name: nullableString,
    path: z.string().min(1),
    pageTypes: z.array(z.enum(NETKEIBA_PAGE_TYPES)),
    complete: z.boolean(),
  })),
  generatedAt: z.string().datetime(),
})
