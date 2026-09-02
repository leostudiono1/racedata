import { repairRaceManifestIds } from '../archive/repair.js'
import { DEFAULT_DATA_ROOT } from '../archive/store.js'
import { argument, integerArgument } from './arguments.js'

const report = await repairRaceManifestIds(
  argument('--root') ?? DEFAULT_DATA_ROOT,
  integerArgument('--year') ?? undefined,
)
process.stdout.write(`scanned=${report.scanned}, repaired=${report.repaired}, errors=${report.errors.length}\n`)
for (const error of report.errors) process.stderr.write(`- ${error}\n`)
if (report.errors.length) process.exitCode = 1
