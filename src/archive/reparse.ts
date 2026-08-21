import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { archiveRaceResponse } from './archive.js'
import { rebuildYearIndex } from './index.js'
import { DEFAULT_DATA_ROOT, readJson } from './store.js'
import type { FetchResponse, PageManifest, RaceManifest } from '../types.js'

async function manifestFiles(directory: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  return (await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return manifestFiles(path)
    return entry.isFile() && entry.name === 'manifest.json' && path.includes(`${join('races', '')}`) ? [path] : []
  }))).flat()
}

function order(page: PageManifest) {
  if (page.pageType === 'entry') return 0
  if (page.pageType === 'result') return 1
  if (page.pageType.startsWith('odds-')) return 2
  return 3
}

export async function reparseYear(year: number, root = DEFAULT_DATA_ROOT) {
  const files = await manifestFiles(join(root, 'archive', String(year)))
  const errors: string[] = []
  let parsed = 0
  for (const file of files) {
    const manifest = await readJson<RaceManifest>(file)
    if (!manifest?.pages) continue
    const pages = [...manifest.pages].sort((a, b) => order(a) - order(b))
    for (const [pageIndex, page] of pages.entries()) {
      try {
        const compressed = await readFile(join(root, page.rawPath))
        const bytes = new Uint8Array(gunzipSync(compressed))
        const html = new TextDecoder(page.charset).decode(bytes)
        const response: FetchResponse = {
          action: { url: page.sourceUrl, ...(page.cname ? { cname: page.cname } : {}) },
          finalUrl: page.sourceUrl,
          status: page.httpStatus,
          headers: page.headers,
          charset: page.charset,
          bytes,
          html,
          fetchedAt: page.fetchedAt,
        }
        const result = await archiveRaceResponse(response, page.pageType, root, true, pageIndex === 0)
        if (result.error) errors.push(result.error)
        else parsed += 1
      } catch (error) {
        errors.push(`${dirname(file)}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
  await rebuildYearIndex(year, root)
  return { parsed, errors }
}
