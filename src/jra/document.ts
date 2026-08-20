import * as cheerio from 'cheerio'
import type { DocumentBlock, DocumentLink, ParsedDocument } from '../types.js'

export function compact(value: string) {
  return value.replace(/[\u00a0\u3000\s]+/g, ' ').trim()
}

function absoluteUrl(value: string, sourceUrl: string) {
  try {
    return new URL(value, sourceUrl).toString()
  } catch {
    return value
  }
}

export function parseDocument(html: string, sourceUrl: string): ParsedDocument {
  const $ = cheerio.load(html)
  $('script, style, noscript, svg, picture, video, audio, canvas, iframe').remove()
  const root = $('#main, #contentsBody, main, [role="main"]').first().length
    ? $('#main, #contentsBody, main, [role="main"]').first()
    : $('body').first()
  root.find('header, footer, nav, [class*="breadcrumb"], [class*="utility"], [class*="global_nav"]').remove()
  const blocks: DocumentBlock[] = []

  root.find('h1, h2, h3, h4, h5, h6, table, dl, p, ul, ol').each((_, element) => {
    const node = $(element)
    if (node.parents('table, dl, ul, ol').length > 0) return
    const tag = (element as { tagName?: string }).tagName?.toLowerCase() ?? ''
    if (/^h[1-6]$/.test(tag)) {
      const text = compact(node.text())
      if (text) blocks.push({ type: 'heading', level: Number(tag.slice(1)), text })
      return
    }
    if (tag === 'table') {
      const headers = node.find('thead th').toArray().map((cell) => compact($(cell).text()))
      const rows = node.find('tbody tr').length ? node.find('tbody tr') : node.find('tr')
      const parsedRows = rows.toArray()
        .map((row) => $(row).find('th, td').toArray().map((cell) => compact($(cell).text())))
        .filter((row) => row.some(Boolean))
      const firstRowIsHeader = headers.length === 0 && node.find('tr').first().find('th').length > 0
      const resolvedHeaders = firstRowIsHeader ? (parsedRows.shift() ?? []) : headers
      if (resolvedHeaders.length || parsedRows.length) {
        blocks.push({
          type: 'table',
          caption: compact(node.find('caption').first().text()) || null,
          headers: resolvedHeaders,
          rows: parsedRows,
        })
      }
      return
    }
    if (tag === 'dl') {
      const entries: Array<{ key: string; value: string }> = []
      node.find('dt').each((__, dt) => {
        const key = compact($(dt).text())
        const value = compact($(dt).nextUntil('dt').text())
        if (key || value) entries.push({ key, value })
      })
      if (entries.length) blocks.push({ type: 'keyValue', entries })
      return
    }
    if (tag === 'ul' || tag === 'ol') {
      const items = node.children('li').toArray().map((item) => compact($(item).text())).filter(Boolean)
      if (items.length) blocks.push({ type: 'list', items })
      return
    }
    const text = compact(node.text())
    if (!text) return
    const links: DocumentLink[] = node.find('a[href]').toArray().map((anchor) => ({
      text: compact($(anchor).text()),
      href: absoluteUrl($(anchor).attr('href') ?? '', sourceUrl),
    })).filter((link) => link.href)
    blocks.push({ type: 'paragraph', text, links })
  })

  if (blocks.length === 0) {
    const text = compact(root.text())
    if (text) blocks.push({ type: 'paragraph', text, links: [] })
  }
  return {
    title: compact($('title').first().text()),
    language: $('html').attr('lang') ?? null,
    blocks,
  }
}
