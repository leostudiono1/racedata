import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { DEFAULT_DATA_ROOT } from '../archive/store.js'
import { updateNetkeibaHorseShard } from '../netkeiba/crawler.js'
import { argument, integerArgument, printReport } from './arguments.js'

const root = argument('--root') ?? DEFAULT_DATA_ROOT
const shard = integerArgument('--shard')
const shardCount = integerArgument('--shard-count')
const maxRuntimeMinutes = integerArgument('--max-runtime-minutes') ?? undefined
const restrictionMarker = argument('--restriction-marker')
if (shard === null) throw new Error('--shard is required')
if (shardCount === null) throw new Error('--shard-count is required')

const report = await updateNetkeibaHorseShard({
  root,
  shard,
  shardCount,
  repairPartition: process.argv.includes('--repair-partition'),
  ...(maxRuntimeMinutes === undefined ? {} : { maxRuntimeMinutes }),
})
if (report.accessRestricted && restrictionMarker) {
  await mkdir(dirname(restrictionMarker), { recursive: true })
  await writeFile(restrictionMarker, `${new Date().toISOString()}\n`, 'utf8')
}
printReport(report)
