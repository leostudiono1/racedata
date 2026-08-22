import { DEFAULT_DATA_ROOT } from '../archive/store.js'
import { updateNetkeibaRaceYear } from '../netkeiba/crawler.js'
import { argument, integerArgument, printReport } from './arguments.js'

const root = argument('--root') ?? DEFAULT_DATA_ROOT
const year = integerArgument('--year')
const maxRuntimeMinutes = integerArgument('--max-runtime-minutes') ?? undefined
if (year === null) throw new Error('--year is required')

const report = await updateNetkeibaRaceYear({
  root,
  year,
  ...(maxRuntimeMinutes === undefined ? {} : { maxRuntimeMinutes }),
})
printReport(report)
