import { DEFAULT_DATA_ROOT } from '../archive/store.js'
import { updateNetkeibaHorseShard } from '../netkeiba/crawler.js'
import { argument, integerArgument, printReport } from './arguments.js'

const root = argument('--root') ?? DEFAULT_DATA_ROOT
const shard = integerArgument('--shard')
const shardCount = integerArgument('--shard-count')
const maxRuntimeMinutes = integerArgument('--max-runtime-minutes') ?? undefined
if (shard === null) throw new Error('--shard is required')
if (shardCount === null) throw new Error('--shard-count is required')

const report = await updateNetkeibaHorseShard({
  root,
  shard,
  shardCount,
  ...(maxRuntimeMinutes === undefined ? {} : { maxRuntimeMinutes }),
})
printReport(report)
