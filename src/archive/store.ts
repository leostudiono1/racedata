import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { gzipSync } from 'node:zlib'

export const DEFAULT_DATA_ROOT = process.env.JRA_DATA_ROOT ?? 'data'

export function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex')
}

export function deterministicGzip(bytes: Uint8Array) {
  return gzipSync(bytes, { level: 9 })
}

export async function exists(path: string) {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

export async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export async function writeFileAtomic(path: string, value: Uint8Array | string) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, value)
  await rename(temporary, path)
}

export async function writeJsonAtomic(path: string, value: unknown) {
  await writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`)
}

export function repositoryPath(root: string, path: string) {
  return relative(root, path).split(sep).join('/')
}

export function archiveDatePath(root: string, date: string) {
  const [year, month, day] = date.split('-')
  if (!year || !month || !day) throw new Error(`Invalid archive date: ${date}`)
  return join(root, 'archive', year, month, day)
}
