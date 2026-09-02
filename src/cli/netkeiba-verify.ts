import { DEFAULT_DATA_ROOT } from '../archive/store.js'
import { verifyNetkeibaArchive } from '../netkeiba/verify.js'
import { argument, integerArgument } from './arguments.js'

const root = argument('--root') ?? DEFAULT_DATA_ROOT
const year = integerArgument('--year') ?? undefined
const report = await verifyNetkeibaArchive(root, year, {
  requireCompleteHorses: process.argv.includes('--require-complete-horses'),
})
process.stdout.write(
  `races=${report.races}, horses=${report.horses}, pages=${report.pages}, `
  + `referencedHorses=${report.referencedHorses}, completeHorses=${report.completeHorses}, `
  + `missingHorseRecords=${report.missingHorseRecords}, incompleteHorses=${report.incompleteHorses}, `
  + `errors=${report.errors.length}\n`,
)
for (const error of report.errors) process.stderr.write(`- ${error}\n`)
if (report.errors.length) process.exitCode = 1
