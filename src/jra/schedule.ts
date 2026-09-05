import type { JraAction, PageType, RaceRecord } from '../types.js'
import { dateFromCname } from './discovery.js'

export const PRE_RACE_MINUTES = 30
const RESULT_RECHECK_MINUTES = 70
const FINAL_PAGES: PageType[] = [
  'result', 'odds-win-place', 'odds-frame', 'odds-quinella', 'odds-wide',
  'odds-exacta', 'odds-trio', 'odds-trifecta',
]

export function tokyoDate(now: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}

// Entry/result actions have different prefixes and checksums for the same race.
function raceActionKey(cname: string) {
  return cname.replace(/^pw01[ds]de/, '').split('/')[0] ?? cname
}

export function raceSchedule(records: RaceRecord[]) {
  const schedule = new Map<string, RaceRecord>()
  for (const record of records) {
    schedule.set(raceActionKey(record.cname), record)
    for (const page of record.pages) {
      if (page.cname && (page.pageType === 'entry' || page.pageType === 'result')) {
        schedule.set(raceActionKey(page.cname), record)
      }
    }
  }
  return schedule
}

export function shouldUpdateRace(
  action: JraAction,
  mode: 'entry' | 'result',
  schedule: Map<string, RaceRecord>,
  now: Date,
) {
  const date = dateFromCname(action.cname)
  if (date && date !== tokyoDate(now)) return false
  const record = action.cname ? schedule.get(raceActionKey(action.cname)) : undefined
  // Discover new races and recover unknown times instead of silently omitting them.
  if (!record) return true
  if (record.date !== tokyoDate(now)) return false
  const start = record.startTime && /^\d{2}:\d{2}$/.test(record.startTime)
    ? Date.parse(`${record.date}T${record.startTime}:00+09:00`)
    : NaN
  if (!Number.isFinite(start)) return true
  const minutesToStart = (Number(start) - now.getTime()) / 60_000
  const hasResult = record.result?.final === true
    && record.pages.some((page) => page.pageType === 'result' && page.parseStatus === 'parsed')
  if (mode === 'entry') {
    // Continue checking a delayed start until a final result is available.
    return !hasResult && minutesToStart <= PRE_RACE_MINUTES
  }
  if (minutesToStart > 0) return false
  const pages = new Set(record.pages.filter((page) => page.parseStatus === 'parsed').map((page) => page.pageType))
  return !hasResult || !FINAL_PAGES.every((page) => pages.has(page))
    || minutesToStart >= -RESULT_RECHECK_MINUTES
}
