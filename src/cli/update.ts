import { updateArchive } from '../jra/crawler.js'
import { argument, printReport } from './arguments.js'

const root = argument('--root')
const report = await updateArchive(root ? { root } : {})
printReport(report)
