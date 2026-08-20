import { verifyArchive } from '../archive/verify.js'
import { argument, integerArgument } from './arguments.js'

const result = await verifyArchive(argument('--root'), integerArgument('--year') ?? undefined)
process.stdout.write(`Verified ${result.races} races and ${result.pages} raw pages across ${result.years.length} years.\n`)
for (const error of result.errors) process.stderr.write(`- ${error}\n`)
if (result.errors.length) process.exitCode = 1
