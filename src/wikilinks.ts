import path from "node:path"
import { readText, type MemoryPaths, listWikiArticles, articleTarget, wikiArticleExists } from "./storage.js"

export function extractWikilinks(content: string): string[] {
  return Array.from(content.matchAll(/\[\[([^\]]+)\]\]/g), (match) => match[1])
}

export async function countInboundLinks(paths: MemoryPaths, target: string, excludeFile?: string): Promise<number> {
  let count = 0
  for (const article of await listWikiArticles(paths)) {
    if (excludeFile && article === excludeFile) continue
    const content = await readText(article)
    if (content.includes(`[[${target}]]`)) count += 1
  }
  return count
}

export function articleWordCount(content: string): number {
  let body = content
  if (body.startsWith("---")) {
    const end = body.indexOf("---", 3)
    if (end !== -1) body = body.slice(end + 3)
  }
  return body.trim() ? body.trim().split(/\s+/).length : 0
}

export async function brokenLinks(paths: MemoryPaths, article: string): Promise<string[]> {
  const content = await readText(article)
  return extractWikilinks(content).filter((link) => !link.startsWith("daily/") && !wikiArticleExists(paths, link))
}

export async function missingBacklinks(paths: MemoryPaths, article: string): Promise<string[]> {
  const content = await readText(article)
  const source = articleTarget(paths, article)
  const missing: string[] = []
  for (const link of extractWikilinks(content)) {
    if (link.startsWith("daily/")) continue
    const target = path.join(paths.knowledgeDir, `${link}.md`)
    const targetContent = await readText(target)
    if (targetContent && !targetContent.includes(`[[${source}]]`)) missing.push(link)
  }
  return missing
}
