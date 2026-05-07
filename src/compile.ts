import path from "node:path"
import { KNOWLEDGE_SCHEMA } from "./schema.js"
import {
  ensureMemoryDirs,
  fileHash,
  listDailyLogs,
  listWikiArticles,
  loadState,
  readText,
  readWikiIndex,
  relativeArticlePath,
  saveState,
  type MemoryPaths,
} from "./storage.js"
import { nowIso } from "./time.js"
import { runOpenCode } from "./opencode-runner.js"

export type CompileOptions = {
  all?: boolean
  file?: string
  dryRun?: boolean
}

export async function compile(paths: MemoryPaths, options: CompileOptions = {}): Promise<{ total: number; compiled: number }> {
  await ensureMemoryDirs(paths)
  const state = await loadState(paths)
  const logs = await selectLogs(paths, options, state)

  if (logs.length === 0) {
    console.log("Nothing to compile - all daily logs are up to date.")
    return { total: 0, compiled: 0 }
  }

  console.log(`${options.dryRun ? "[DRY RUN] " : ""}Files to compile (${logs.length}):`)
  for (const file of logs) console.log(`  - ${path.basename(file)}`)
  if (options.dryRun) return { total: logs.length, compiled: 0 }

  let compiled = 0
  for (let i = 0; i < logs.length; i += 1) {
    const logPath = logs[i]
    console.log(`\n[${i + 1}/${logs.length}] Compiling ${path.basename(logPath)}...`)
    const ok = await compileDailyLog(paths, logPath)
    if (ok) {
      compiled += 1
      state.ingested[path.basename(logPath)] = {
        hash: await fileHash(logPath),
        compiled_at: nowIso(),
      }
      await saveState(paths, state)
      console.log("  Done.")
    }
  }

  console.log(`\nCompilation complete. Compiled: ${compiled}/${logs.length}`)
  console.log(`Knowledge base: ${(await listWikiArticles(paths)).length} articles`)
  return { total: logs.length, compiled }
}

async function selectLogs(paths: MemoryPaths, options: CompileOptions, state: Awaited<ReturnType<typeof loadState>>): Promise<string[]> {
  if (options.file) {
    const candidate = path.isAbsolute(options.file) ? options.file : path.join(paths.dailyDir, path.basename(options.file))
    return [candidate]
  }

  const allLogs = await listDailyLogs(paths)
  if (options.all) return allLogs

  const changed: string[] = []
  for (const logPath of allLogs) {
    const name = path.basename(logPath)
    const previous = state.ingested[name]
    if (!previous || previous.hash !== (await fileHash(logPath))) changed.push(logPath)
  }
  return changed
}

export async function compileDailyLog(paths: MemoryPaths, logPath: string): Promise<boolean> {
  const logContent = await readText(logPath)
  if (!logContent) {
    console.error(`  Error: ${logPath} not found or empty`)
    return false
  }

  const existingArticles = await listWikiArticles(paths)
  const existingContext = existingArticles.length
    ? (
        await Promise.all(
          existingArticles.map(async (article) => {
            const rel = relativeArticlePath(paths, article)
            return `### ${rel}\n\`\`\`markdown\n${await readText(article)}\n\`\`\``
          }),
        )
      ).join("\n\n")
    : "(No existing articles yet)"

  const timestamp = nowIso()
  const prompt = `You are a knowledge compiler. Your job is to read a daily conversation log and extract knowledge into structured wiki articles.

## Schema

${KNOWLEDGE_SCHEMA}

## Current Wiki Index

${await readWikiIndex(paths)}

## Existing Wiki Articles

${existingContext}

## Daily Log to Compile

**File:** ${path.basename(logPath)}

${logContent}

## Your Task

Read the daily log above and compile it into wiki articles following the schema exactly.

### Rules

1. Extract 3-7 distinct concepts worth their own article.
2. Create concept articles in ${paths.conceptsDir}.
3. Create connection articles in ${paths.connectionsDir} if the log reveals non-obvious relationships.
4. Update existing articles if this log adds new information to existing concepts.
5. Update ${paths.indexFile} with new or changed entries.
6. Append to ${paths.logFile}:
   ## [${timestamp}] compile | ${path.basename(logPath)}
   - Source: daily/${path.basename(logPath)}
   - Articles created: [[concepts/x]], [[concepts/y]]
   - Articles updated: [[concepts/z]] (if any)

### Quality Standards

- Every article must have complete YAML frontmatter.
- Every article should link to related articles via [[wikilinks]] when relevant.
- Key Points should have 3-5 bullets.
- Details should have 2+ paragraphs for substantial concepts.
- Sources should cite the daily log with specific claims extracted.
`

  try {
    await runOpenCode({ projectRoot: paths.projectRoot, prompt, agent: "build", title: `compile ${path.basename(logPath)}` })
    return true
  } catch (error) {
    console.error(`  Error: ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}
