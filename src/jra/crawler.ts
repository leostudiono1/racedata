import { archiveMeetingResponse, archiveRaceResponse } from '../archive/archive.js'
import { rebuildYearIndex } from '../archive/index.js'
import { DEFAULT_DATA_ROOT } from '../archive/store.js'
import type { CrawlReport, FetchResponse, JraAction, PageType } from '../types.js'
import {
  actionsByCname,
  classifyContextPage,
  classifyOddsPage,
  dateFromCname,
  findMenuAction,
  historicalMonthAction,
  oddsPageDescriptor,
  oddsPageActions,
  parseMonthChecksums,
  raceNumberFromCname,
  racePageActions,
  relatedContextActions,
  uniqueActions,
} from './discovery.js'
import { fetchPage } from './http.js'

const HOME_URL = 'https://www.jra.go.jp/'
export type PageFetcher = (action: JraAction) => Promise<FetchResponse>

function tokyoDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}

function recentCutoff(now: Date, days = 35) {
  const cutoff = new Date(now)
  cutoff.setUTCDate(cutoff.getUTCDate() - days)
  return cutoff.toISOString().slice(0, 10)
}

function withinDays(date: string, now: Date, days: number) {
  if (!date) return false
  const cutoff = recentCutoff(now, days)
  return date >= cutoff && date <= tokyoDate(now)
}

function cachedFetcher(fetcher: PageFetcher): PageFetcher {
  const cache = new Map<string, Promise<FetchResponse>>()
  return (action) => {
    const key = `${action.url}|${action.cname ?? ''}`
    const pending = cache.get(key) ?? fetcher(action)
    cache.set(key, pending)
    return pending
  }
}

function emptyReport(): CrawlReport {
  return { fetched: 0, changed: 0, unchanged: 0, errors: [], years: [] }
}

function addYear(report: CrawlReport, year: number | null) {
  if (year && !report.years.includes(year)) report.years.push(year)
}

async function fetchTracked(fetcher: PageFetcher, action: JraAction, report: CrawlReport) {
  const response = await fetcher(action)
  report.fetched += 1
  return response
}

async function archiveAction(
  fetcher: PageFetcher,
  action: JraAction,
  pageType: PageType,
  report: CrawlReport,
  root: string,
) {
  try {
    const response = await fetchTracked(fetcher, action, report)
    const result = await archiveRaceResponse(response, pageType, root)
    if (result.changed) report.changed += 1
    else report.unchanged += 1
    addYear(report, result.year)
    if (result.error) report.errors.push(result.error)
    return response
  } catch (error) {
    report.errors.push(error instanceof Error ? error.message : String(error))
    return null
  }
}

async function discoverCurrentEntryActions(home: FetchResponse, fetcher: PageFetcher, report: CrawlReport) {
  const indexAction = findMenuAction(home.html, '/JRADB/accessD.html', 'pw01dli')
  const index = await fetchTracked(fetcher, indexAction, report)
  const races = racePageActions(index.html, 'entry')
  const contexts = relatedContextActions(index.html)
  const meetingPages: FetchResponse[] = []
  for (const meetingAction of actionsByCname(index.html, 'pw01drl')) {
    const meeting = await fetchTracked(fetcher, meetingAction, report)
    meetingPages.push(meeting)
    races.push(...racePageActions(meeting.html, 'entry'))
    contexts.push(...relatedContextActions(meeting.html))
  }
  return { races: uniqueActions(races), contexts: uniqueActions(contexts), meetingPages }
}

async function discoverRecentResultActions(home: FetchResponse, fetcher: PageFetcher, report: CrawlReport, now: Date) {
  const indexAction = findMenuAction(home.html, '/JRADB/accessS.html', 'pw01sli')
  const index = await fetchTracked(fetcher, indexAction, report)
  const cutoff = recentCutoff(now)
  const races = racePageActions(index.html, 'result')
  const meetingPages: FetchResponse[] = []
  for (const meetingAction of actionsByCname(index.html, 'pw01srl').filter((action) => dateFromCname(action.cname) >= cutoff)) {
    const meeting = await fetchTracked(fetcher, meetingAction, report)
    meetingPages.push(meeting)
    races.push(...racePageActions(meeting.html, 'result'))
  }
  return { races: uniqueActions(races).filter((action) => {
    const date = dateFromCname(action.cname)
    return !date || date >= cutoff
  }), meetingPages }
}

async function archiveFinalOdds(
  resultResponse: FetchResponse,
  resultAction: JraAction,
  fetcher: PageFetcher,
  report: CrawlReport,
  root: string,
) {
  const date = dateFromCname(resultAction.cname)
  const number = raceNumberFromCname(resultAction.cname)
  const queue = oddsPageActions(resultResponse.html, date, number ?? undefined)
  const seen = new Set<string>()
  while (queue.length) {
    const action = queue.shift()
    if (!action) continue
    const key = `${action.url}|${action.cname ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    try {
      const response = await fetchTracked(fetcher, action, report)
      const nestedActions = oddsPageActions(response.html, date, number ?? undefined)
      const type = classifyOddsPage(`${action.label ?? ''} ${oddsPageDescriptor(response.html)}`)
      const actionIsRaceSpecific = dateFromCname(action.cname) === date && raceNumberFromCname(action.cname) === number
      if (type !== 'odds-unknown' || actionIsRaceSpecific) {
        const result = await archiveRaceResponse(response, type, root)
        if (result.changed) report.changed += 1
        else report.unchanged += 1
        addYear(report, result.year)
        if (result.error) report.errors.push(result.error)
      }
      for (const nested of nestedActions) {
        const nestedKey = `${nested.url}|${nested.cname ?? ''}`
        if (!seen.has(nestedKey)) queue.push(nested)
      }
    } catch (error) {
      report.errors.push(error instanceof Error ? error.message : String(error))
    }
  }
}

export async function updateArchive(options: { root?: string; fetcher?: PageFetcher; now?: Date } = {}) {
  const root = options.root ?? DEFAULT_DATA_ROOT
  const fetcher = cachedFetcher(options.fetcher ?? fetchPage)
  const now = options.now ?? new Date()
  const report = emptyReport()
  try {
    const home = await fetchTracked(fetcher, { url: HOME_URL }, report)
    const entries = await discoverCurrentEntryActions(home, fetcher, report)
    const results = await discoverRecentResultActions(home, fetcher, report, now)
    for (const action of entries.races) await archiveAction(fetcher, action, 'entry', report, root)
    for (const action of results.races) {
      const response = await archiveAction(fetcher, action, 'result', report, root)
      if (response && withinDays(dateFromCname(action.cname), now, 3)) {
        await archiveFinalOdds(response, action, fetcher, report, root)
      }
    }
    const meetingPages = [...entries.meetingPages, ...results.meetingPages]
    const savedMeetings = new Set<string>()
    for (const meeting of meetingPages) {
      const key = `${meeting.action.url}|${meeting.action.cname ?? ''}`
      if (savedMeetings.has(key)) continue
      savedMeetings.add(key)
      const date = dateFromCname(meeting.action.cname) || tokyoDate(now)
      try {
        const changed = await archiveMeetingResponse(meeting, 'meeting-notice', date, root)
        if (changed) report.changed += 1
        else report.unchanged += 1
      } catch (error) {
        report.errors.push(error instanceof Error ? error.message : String(error))
      }
    }
    const contexts = uniqueActions([...relatedContextActions(home.html), ...entries.contexts])
    for (const action of contexts) {
      try {
        const response = await fetchTracked(fetcher, action, report)
        const changed = await archiveMeetingResponse(response, classifyContextPage(action), tokyoDate(now), root)
        if (changed) report.changed += 1
        else report.unchanged += 1
      } catch (error) {
        report.errors.push(error instanceof Error ? error.message : String(error))
      }
    }
  } catch (error) {
    report.errors.push(error instanceof Error ? error.message : String(error))
  } finally {
    for (const year of [...new Set(report.years)].sort()) {
      try {
        await rebuildYearIndex(year, root)
      } catch (error) {
        report.errors.push(error instanceof Error ? error.message : String(error))
      }
    }
  }
  return report
}

async function discoverHistoricalChecksums(fetcher: PageFetcher, report: CrawlReport) {
  const home = await fetchTracked(fetcher, { url: HOME_URL }, report)
  const searchAction = findMenuAction(home.html, '/JRADB/accessS.html', 'pw01skl00')
  const search = await fetchTracked(fetcher, searchAction, report)
  return parseMonthChecksums(search.html)
}

export async function bootstrapYear(year: number, options: { root?: string; fetcher?: PageFetcher } = {}) {
  if (!Number.isInteger(year) || year < 1986 || year > new Date().getUTCFullYear()) {
    throw new Error(`Invalid bootstrap year: ${year}`)
  }
  const root = options.root ?? DEFAULT_DATA_ROOT
  const fetcher = options.fetcher ?? fetchPage
  const report = emptyReport()
  try {
    const checksums = await discoverHistoricalChecksums(fetcher, report)
    for (let month = 1; month <= 12; month += 1) {
      try {
        const monthPage = await fetchTracked(fetcher, historicalMonthAction(year, month, checksums), report)
        const meetings = actionsByCname(monthPage.html, 'pw01srl').filter((action) => action.cname?.includes(String(year)))
        for (const meetingAction of meetings) {
          const meeting = await fetchTracked(fetcher, meetingAction, report)
          for (const raceAction of uniqueActions(racePageActions(meeting.html, 'result'))) {
            await archiveAction(fetcher, raceAction, 'result', report, root)
          }
        }
      } catch (error) {
        report.errors.push(`${year}-${String(month).padStart(2, '0')}: ${error instanceof Error ? error.message : String(error)}`)
      }
      process.stdout.write(`${year}-${String(month).padStart(2, '0')}: fetched=${report.fetched}, changed=${report.changed}, errors=${report.errors.length}\n`)
    }
  } finally {
    try {
      await rebuildYearIndex(year, root)
    } catch (error) {
      report.errors.push(error instanceof Error ? error.message : String(error))
    }
  }
  return report
}
