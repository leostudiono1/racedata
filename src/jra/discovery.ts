import * as cheerio from 'cheerio'
import type { JraAction, PageType } from '../types.js'

export const JRA_ORIGIN = 'https://www.jra.go.jp'

function compact(value: string) {
  return value.replace(/[\u00a0\u3000\s]+/g, ' ').trim()
}

export function extractActions(html: string, baseUrl = JRA_ORIGIN): JraAction[] {
  const $ = cheerio.load(html)
  const actions: JraAction[] = []
  const seen = new Set<string>()

  const add = (urlValue: string, cname?: string, label?: string) => {
    try {
      const url = new URL(urlValue, baseUrl)
      if (!['jra.go.jp', 'www.jra.go.jp'].includes(url.hostname)) return
      const queryCname = url.searchParams.get('CNAME') ?? undefined
      const action: JraAction = { url: url.toString() }
      const resolvedCname = cname ?? queryCname
      const resolvedLabel = compact(label ?? '')
      if (resolvedCname) action.cname = resolvedCname
      if (resolvedLabel) action.label = resolvedLabel
      const key = `${action.url.split('#')[0]}|${action.cname ?? ''}`
      if (seen.has(key)) return
      seen.add(key)
      actions.push(action)
    } catch {
      // JRA pages contain non-navigation JavaScript fragments that resemble URLs.
    }
  }

  $('a, button, input[type="button"]').each((_, element) => {
    const root = $(element)
    const label = root.text() || root.attr('value') || root.attr('title') || ''
    const href = root.attr('href')
    if (href && href !== '#') add(href, undefined, label)
    const handler = root.attr('onclick') ?? root.attr('onClick') ?? ''
    for (const match of handler.matchAll(/doAction\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/gi)) {
      if (match[1] && match[2]) add(match[1], match[2], label)
    }
  })

  return actions
}

export function uniqueActions(actions: JraAction[]) {
  return [...new Map(actions.map((action) => [`${action.url.split('#')[0]}|${action.cname ?? ''}`, action])).values()]
}

export function findMenuAction(html: string, pathPart: string, cnamePrefix: string) {
  const action = extractActions(html).find((candidate) =>
    candidate.url.includes(pathPart) && candidate.cname?.startsWith(cnamePrefix),
  )
  if (!action) throw new Error(`JRA navigation action not found: ${pathPart} ${cnamePrefix}`)
  return action
}

export function actionsByCname(html: string, prefix: string) {
  return extractActions(html).filter((action) => action.cname?.startsWith(prefix))
}

export function racePageActions(html: string, mode: 'entry' | 'result') {
  const path = mode === 'entry' ? '/JRADB/accessD.html' : '/JRADB/accessS.html'
  const prefix = mode === 'entry' ? 'pw01dde' : 'pw01sde'
  return extractActions(html).filter((action) => action.url.includes(path) && action.cname?.startsWith(prefix))
}

export function oddsPageActions(html: string, raceDate?: string, raceNumber?: number) {
  return uniqueActions(extractActions(html).filter((action) => {
    if (!action.url.includes('/JRADB/accessO.html')) return false
    const date = dateFromCname(action.cname)
    const number = raceNumberFromCname(action.cname)
    return (!raceDate || !date || date === raceDate) && (!raceNumber || !number || number === raceNumber)
  }))
}

export function relatedContextActions(html: string) {
  const allowed = /開催お知らせ|特別レース登録馬|馬場情報/
  return uniqueActions(extractActions(html).filter((action) => allowed.test(action.label ?? '')))
}

export function classifyContextPage(action: JraAction): 'special-entry' | 'meeting-notice' | 'track-info' {
  const label = action.label ?? ''
  if (/馬場情報/.test(label)) return 'track-info'
  if (/特別レース登録馬/.test(label)) return 'special-entry'
  return 'meeting-notice'
}

export function classifyOddsPage(labelOrText: string): PageType {
  const text = compact(labelOrText)
  if (/3連単|三連単/.test(text)) return 'odds-trifecta'
  if (/3連複|三連複/.test(text)) return 'odds-trio'
  if (/馬単/.test(text)) return 'odds-exacta'
  if (/ワイド/.test(text)) return 'odds-wide'
  if (/馬連/.test(text)) return 'odds-quinella'
  if (/枠連/.test(text)) return 'odds-frame'
  if (/単勝|複勝/.test(text)) return 'odds-win-place'
  return 'odds-unknown'
}

export function oddsPageDescriptor(html: string) {
  const $ = cheerio.load(html)
  return compact($('#contentsBody h1, #contentsBody h2, #contentsBody h3, main h1, main h2, main h3, title').slice(0, 12).text())
}

export function parseMonthChecksums(html: string) {
  const result = new Map<string, string>()
  for (const match of html.matchAll(/objParam\["(\d{4})"\]\s*=\s*"([A-F0-9]{2})"/g)) {
    if (match[1] && match[2]) result.set(match[1], match[2])
  }
  return result
}

export function historicalMonthAction(year: number, month: number, checksums: Map<string, string>): JraAction {
  const yyyymm = `${year}${String(month).padStart(2, '0')}`
  const checksum = checksums.get(yyyymm.slice(2))
  if (!checksum) throw new Error(`No JRA month checksum found for ${yyyymm}`)
  return {
    url: `${JRA_ORIGIN}/JRADB/accessS.html`,
    cname: `pw01skl10${yyyymm}/${checksum}`,
    label: yyyymm,
  }
}

export function dateFromCname(cname: string | undefined) {
  const matches = [...(cname?.matchAll(/20\d{6}/g) ?? [])]
  return matches.at(-1)?.[0]?.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3') ?? ''
}

export function raceNumberFromCname(cname: string | undefined) {
  const compactCname = cname?.replace(/\?.*$/, '') ?? ''
  const date = [...compactCname.matchAll(/20\d{6}/g)].at(-1)
  if (date?.index === undefined) return null
  const prefix = compactCname.slice(0, date.index)
  const value = Number(prefix.slice(-2))
  return Number.isInteger(value) && value >= 1 && value <= 12 ? value : null
}
