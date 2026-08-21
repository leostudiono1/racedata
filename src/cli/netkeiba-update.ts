import { DEFAULT_DATA_ROOT } from '../archive/store.js'
import { updateNetkeibaArchive } from '../netkeiba/crawler.js'
import { argument, integerArgument, printReport } from './arguments.js'

const root = argument('--root') ?? DEFAULT_DATA_ROOT
const year = integerArgument('--year') ?? undefined
const maxPages = integerArgument('--max-pages') ?? undefined
const report = await updateNetkeibaArchive({
  root,
  ...(year === undefined ? {} : { year }),
  ...(maxPages === undefined ? {} : { maxPages }),
})
printReport(report)
