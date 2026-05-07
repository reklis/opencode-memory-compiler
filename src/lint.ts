import path from "node:path"
import { runOpenCode } from "./opencode-runner.js"
import {
  articleTarget,
  ensureMemoryDirs,
  fileHash,
  listDailyLogs,
  listWikiArticles,
  loadState,
  readAllWikiContent,
  readText,
  relativeArticlePath,
  saveState,
  type MemoryPaths,
  writeText,
} from "./storage.js"
import { nowIso, todayIso } from "./time.js"
import { articleWordCount, brokenLinks, countInboundLinks, extractWikilinks } from "./wikilinks.js"

export type LintIssue = {
  severity: "error" | "warning" | "suggestion"
  check: string
  file: string
  detail: string
  auto_fixable?: boolean
}

export async function lint(paths: MemoryPaths, options: { structuralOnly?: boolean } = {}): Promise<number> {
  await ensureMemoryDirs(paths)
  console.log("Running knowledge base lint checks...")
  const allIssues: LintIssue[] = []
  const checks: Array<[string, () => Promise<LintIssue[]>]> = [
    ["Broken links", () => checkBrokenLinks(paths)],
    ["Orphan pages", () => checkOrphanPages(paths)],
    ["Orphan sources", () => checkOrphanSources(paths)],
    ["Stale articles", () => checkStaleArticles(paths)],
    ["Missing backlinks", () => checkMissingBacklinks(paths)],
    ["Sparse articles", () => checkSparseArticles(paths)],
  ]

  for (const [name, check] of checks) {
    console.log(`  Checking: ${name}...`)
    const issues = await check()
    allIssues.push(...issues)
    console.log(`    Found ${issues.length} issue(s)`)
  }

  if (!options.structuralOnly) {
    console.log("  Checking: Contradictions (LLM)...")
    const issues = await checkContradictions(paths)
    allIssues.push(...issues)
    console.log(`    Found ${issues.length} issue(s)`)
  } else {
    console.log("  Skipping: Contradictions (--structural-only)")
  }

  const report = generateReport(allIssues)
  const reportPath = path.join(paths.reportsDir, `lint-${todayIso()}.md`)
  await writeText(reportPath, report)
  console.log(`\nReport saved to: ${reportPath}`)

  const state = await loadState(paths)
  state.last_lint = nowIso()
  await saveState(paths, state)

  const errors = allIssues.filter((issue) => issue.severity === "error").length
  const warnings = allIssues.filter((issue) => issue.severity === "warning").length
  const suggestions = allIssues.filter((issue) => issue.severity === "suggestion").length
  console.log(`\nResults: ${errors} errors, ${warnings} warnings, ${suggestions} suggestions`)
  if (errors > 0) {
    console.log("\nErrors found - knowledge base needs attention!")
    return 1
  }
  return 0
}

async function checkBrokenLinks(paths: MemoryPaths): Promise<LintIssue[]> {
  const issues: LintIssue[] = []
  for (const article of await listWikiArticles(paths)) {
    const rel = relativeArticlePath(paths, article)
    for (const link of await brokenLinks(paths, article)) {
      issues.push({ severity: "error", check: "broken_link", file: rel, detail: `Broken link: [[${link}]] - target does not exist` })
    }
  }
  return issues
}

async function checkOrphanPages(paths: MemoryPaths): Promise<LintIssue[]> {
  const issues: LintIssue[] = []
  for (const article of await listWikiArticles(paths)) {
    const target = articleTarget(paths, article)
    const inbound = await countInboundLinks(paths, target)
    if (inbound === 0) {
      issues.push({ severity: "warning", check: "orphan_page", file: relativeArticlePath(paths, article), detail: `Orphan page: no other articles link to [[${target}]]` })
    }
  }
  return issues
}

async function checkOrphanSources(paths: MemoryPaths): Promise<LintIssue[]> {
  const state = await loadState(paths)
  const issues: LintIssue[] = []
  for (const logPath of await listDailyLogs(paths)) {
    const name = path.basename(logPath)
    if (!state.ingested[name]) {
      issues.push({ severity: "warning", check: "orphan_source", file: `daily/${name}`, detail: `Uncompiled daily log: ${name} has not been ingested` })
    }
  }
  return issues
}

async function checkStaleArticles(paths: MemoryPaths): Promise<LintIssue[]> {
  const state = await loadState(paths)
  const issues: LintIssue[] = []
  for (const logPath of await listDailyLogs(paths)) {
    const name = path.basename(logPath)
    const previous = state.ingested[name]
    if (previous && previous.hash !== (await fileHash(logPath))) {
      issues.push({ severity: "warning", check: "stale_article", file: `daily/${name}`, detail: `Stale: ${name} has changed since last compilation` })
    }
  }
  return issues
}

async function checkMissingBacklinks(paths: MemoryPaths): Promise<LintIssue[]> {
  const issues: LintIssue[] = []
  for (const article of await listWikiArticles(paths)) {
    const rel = relativeArticlePath(paths, article)
    const source = articleTarget(paths, article)
    for (const link of extractWikilinks(await readText(article))) {
      if (link.startsWith("daily/")) continue
      const targetContent = await readText(path.join(paths.knowledgeDir, `${link}.md`))
      if (targetContent && !targetContent.includes(`[[${source}]]`)) {
        issues.push({ severity: "suggestion", check: "missing_backlink", file: rel, detail: `[[${source}]] links to [[${link}]] but not vice versa`, auto_fixable: true })
      }
    }
  }
  return issues
}

async function checkSparseArticles(paths: MemoryPaths): Promise<LintIssue[]> {
  const issues: LintIssue[] = []
  for (const article of await listWikiArticles(paths)) {
    const count = articleWordCount(await readText(article))
    if (count < 200) {
      issues.push({ severity: "suggestion", check: "sparse_article", file: relativeArticlePath(paths, article), detail: `Sparse article: ${count} words (minimum recommended: 200)` })
    }
  }
  return issues
}

async function checkContradictions(paths: MemoryPaths): Promise<LintIssue[]> {
  const prompt = `Review this knowledge base for contradictions, inconsistencies, or conflicting claims across articles.

## Knowledge Base

${await readAllWikiContent(paths)}

## Instructions

Look for:
- Direct contradictions (article A says X, article B says not-X)
- Inconsistent recommendations (different articles recommend conflicting approaches)
- Outdated information that conflicts with newer entries

For each issue found, output EXACTLY one line in this format:
CONTRADICTION: [file1] vs [file2] - description of the conflict
INCONSISTENCY: [file] - description of the inconsistency

If no issues found, output exactly: NO_ISSUES

Do NOT output anything else - no preamble, no explanation, just the formatted lines.`

  try {
    const response = await runOpenCode({ projectRoot: paths.projectRoot, prompt, agent: "plan", title: "knowledge lint", timeoutMs: 600_000 })
    if (response.includes("NO_ISSUES")) return []
    return response
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("CONTRADICTION:") || line.startsWith("INCONSISTENCY:"))
      .map((line) => ({ severity: "warning", check: "contradiction", file: "(cross-article)", detail: line }))
  } catch (error) {
    return [{ severity: "error", check: "contradiction", file: "(system)", detail: `LLM check failed: ${error instanceof Error ? error.message : String(error)}` }]
  }
}

function generateReport(allIssues: LintIssue[]): string {
  const errors = allIssues.filter((issue) => issue.severity === "error")
  const warnings = allIssues.filter((issue) => issue.severity === "warning")
  const suggestions = allIssues.filter((issue) => issue.severity === "suggestion")
  const lines = [
    `# Lint Report - ${todayIso()}`,
    "",
    `**Total issues:** ${allIssues.length}`,
    `- Errors: ${errors.length}`,
    `- Warnings: ${warnings.length}`,
    `- Suggestions: ${suggestions.length}`,
    "",
  ]

  for (const [label, marker, issues] of [
    ["Errors", "x", errors],
    ["Warnings", "!", warnings],
    ["Suggestions", "?", suggestions],
  ] as const) {
    if (issues.length === 0) continue
    lines.push(`## ${label}`, "")
    for (const issue of issues) {
      lines.push(`- **[${marker}]** \`${issue.file}\` - ${issue.detail}${issue.auto_fixable ? " (auto-fixable)" : ""}`)
    }
    lines.push("")
  }

  if (allIssues.length === 0) lines.push("All checks passed. Knowledge base is healthy.", "")
  return lines.join("\n")
}
