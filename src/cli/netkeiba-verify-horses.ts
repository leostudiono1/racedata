import { DEFAULT_DATA_ROOT } from '../archive/store.js'
import { verifyNetkeibaHorseShard } from '../netkeiba/verify.js'
import { argument, integerArgument } from './arguments.js'

const root = argument('--root') ?? DEFAULT_DATA_ROOT
const shard = integerArgument('--shard')
const shardCount = integerArgument('--shard-count')
if (shard === null) throw new Error('--shard is required')
if (shardCount === null) throw new Error('--shard-count is required')

const report = await verifyNetkeibaHorseShard(root, shard, shardCount)
process.stdout.write(`horses=${report.horses}, pages=${report.pages}, errors=${report.errors.length}\n`)
for (const error of report.errors) process.stderr.write(`- ${error}\n`)
if (report.errors.length) process.exitCode = 1
