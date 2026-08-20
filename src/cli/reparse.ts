import { reparseYear } from '../archive/reparse.js'
import { argument, integerArgument, printReport } from './arguments.js'

const year = integerArgument('--year')
if (!year) throw new Error('Use --year YYYY')
const report = await reparseYear(year, argument('--root'))
printReport(report)
