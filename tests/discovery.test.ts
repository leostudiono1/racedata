import { readFile } from 'node:fs/promises'
import {
  classifyOddsPage,
  dateFromCname,
  extractActions,
  oddsPageActions,
  raceNumberFromCname,
  racePageActions,
} from '../src/jra/discovery.js'

describe('JRA navigation discovery', () => {
  it('extracts same-origin POST actions and ignores external links', async () => {
    const html = await readFile('tests/fixtures/navigation.html', 'utf8')
    const actions = extractActions(html)
    expect(actions).toHaveLength(4)
    expect(racePageActions(html, 'entry')).toHaveLength(1)
    expect(oddsPageActions(html, '2026-08-22', 7)).toHaveLength(1)
  })

  it('extracts the final date and race number from CNAME', () => {
    const cname = 'pw01dde1007202602090720260822/08'
    expect(dateFromCname(cname)).toBe('2026-08-22')
    expect(raceNumberFromCname(cname)).toBe(7)
  })

  it('classifies every supported odds family', () => {
    expect(classifyOddsPage('単勝・複勝')).toBe('odds-win-place')
    expect(classifyOddsPage('3連単')).toBe('odds-trifecta')
    expect(classifyOddsPage('ワイド')).toBe('odds-wide')
  })
})
