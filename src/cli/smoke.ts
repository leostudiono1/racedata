import { actionsByCname, findMenuAction, racePageActions } from '../jra/discovery.js'
import { fetchPage } from '../jra/http.js'
import { parseRacePage } from '../jra/parse.js'

if (process.env.JRA_LIVE_SMOKE !== '1') {
  throw new Error('Set JRA_LIVE_SMOKE=1 to run the opt-in live JRA smoke test')
}
const home = await fetchPage({ url: 'https://www.jra.go.jp/' })
const action = findMenuAction(home.html, '/JRADB/accessD.html', 'pw01dli')
const index = await fetchPage(action)
const meetings = actionsByCname(index.html, 'pw01drl')
const races = racePageActions(index.html, 'entry')
if (!meetings.length && !races.length) throw new Error('JRA entry navigation returned no meetings or races')
let sample = races[0]
if (!sample && meetings[0]) {
  const meeting = await fetchPage(meetings[0])
  sample = racePageActions(meeting.html, 'entry')[0]
}
if (!sample) throw new Error('JRA navigation returned no sample race')
const page = await fetchPage(sample)
const race = parseRacePage(page.html, page.finalUrl, sample.cname ?? page.finalUrl, page.fetchedAt)
const resultUrl = 'https://www.jra.go.jp/JRADB/accessS.html?CNAME=pw01sde0109202603010820260606%2FEA'
const resultPage = await fetchPage({ url: resultUrl })
const result = parseRacePage(resultPage.html, resultPage.finalUrl, new URL(resultUrl).searchParams.get('CNAME') ?? resultUrl, resultPage.fetchedAt)
if (!result.result || !result.runners.length || !result.payouts.length) {
  throw new Error(`JRA result parser smoke failed: runners=${result.runners.length}, payouts=${result.payouts.length}`)
}
process.stdout.write(`JRA live smoke succeeded: meetings=${meetings.length}, directRaces=${races.length}, entry=${race.date} ${race.venue} ${race.number}R/${race.runners.length}, result=${result.runners.length}, payouts=${result.payouts.length}\n`)
