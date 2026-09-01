import { DEFAULT_DATA_ROOT } from '../archive/store.js'
import { reparseNetkeibaHorseShard } from '../netkeiba/reparse.js'
import { argument, integerArgument, printReport } from './arguments.js'

const root = argument('--root') ?? DEFAULT_DATA_ROOT
const shard = integerArgument('--shard')
const shardCount = integerArgument('--shard-count')
if (shard === null) throw new Error('--shard is required')
if (shardCount === null) throw new Error('--shard-count is required')

printReport(await reparseNetkeibaHorseShard({
  root,
  shard,
  shardCount,
  failedOnly: !process.argv.includes('--all-pages'),
}))
