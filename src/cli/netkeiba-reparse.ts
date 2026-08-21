import { DEFAULT_DATA_ROOT } from '../archive/store.js'
import { reparseNetkeibaArchive } from '../netkeiba/reparse.js'
import { argument, integerArgument, printReport } from './arguments.js'

const root = argument('--root') ?? DEFAULT_DATA_ROOT
const year = integerArgument('--year') ?? undefined
printReport(await reparseNetkeibaArchive(root, year))
