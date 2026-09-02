export function argument(name: string) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

export function integerArgument(name: string) {
  const value = argument(name)
  if (!value) return null
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) throw new Error(`${name} must be an integer`)
  return parsed
}

export function printReport(report: { fetched?: number; changed?: number; unchanged?: number; skipped?: number; parsed?: number; timeLimitReached?: boolean; accessRestricted?: boolean; errors: string[] }) {
  const summary = [
    report.fetched === undefined ? null : `fetched=${report.fetched}`,
    report.changed === undefined ? null : `changed=${report.changed}`,
    report.unchanged === undefined ? null : `unchanged=${report.unchanged}`,
    report.skipped === undefined ? null : `skipped=${report.skipped}`,
    report.parsed === undefined ? null : `parsed=${report.parsed}`,
    report.timeLimitReached === undefined ? null : `timeLimitReached=${report.timeLimitReached}`,
    report.accessRestricted === undefined ? null : `accessRestricted=${report.accessRestricted}`,
    `errors=${report.errors.length}`,
  ].filter(Boolean).join(', ')
  process.stdout.write(`${summary}\n`)
  for (const error of report.errors) process.stderr.write(`- ${error}\n`)
  if (report.errors.length) process.exitCode = 1
}
