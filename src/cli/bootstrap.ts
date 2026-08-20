import { bootstrapYear } from '../jra/crawler.js'
import { argument, integerArgument, printReport } from './arguments.js'

const year = integerArgument('--year')
if (!year) throw new Error('Use --year YYYY')
const root = argument('--root')
const report = await bootstrapYear(year, root ? { root } : {})
printReport(report)
