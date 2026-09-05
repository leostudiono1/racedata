import { updateArchive } from '../jra/crawler.js'
import { argument, printReport } from './arguments.js'

const root = argument('--root')
const scope = argument('--scope') ?? 'full'
if (scope !== 'full' && scope !== 'intraday') throw new Error('--scope must be full or intraday')
process.stdout.write(`JRA update scope=${scope}\n`)
const report = await updateArchive({ ...(root ? { root } : {}), scope })
printReport(report)
