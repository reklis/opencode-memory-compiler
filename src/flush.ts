import path from "node:path"
import { compile } from "./compile.js"
import { runOpenCode } from "./opencode-runner.js"
import {
  appendLog,
  ensureMemoryDirs,
  fileHash,
  loadFlushState,
  loadState,
  readText,
  saveFlushState,
  sha16,
  type MemoryPaths,
  writeText,
} from "./storage.js"
import { localDateParts } from "./time.js"

export async function flushContext(
  paths: MemoryPaths,
  contextFile: string,
  sessionID: string,
  options: { compile?: boolean; compileAfterHour?: number } = {},
): Promise<void> {
  await ensureMemoryDirs(paths)
  await log(paths, `flush started for session ${sessionID}, context: ${contextFile}`)
  const context = (await readText(contextFile)).trim()
  if (!context) {
    await log(paths, "context file empty, skipping")
    return
  }

  const state = await loadFlushState(paths)
  state.sessions ||= {}
  const contextHash = sha16(context)
  if (state.sessions[sessionID]?.context_hash === contextHash) {
    await log(paths, `skipping duplicate flush for session ${sessionID}`)
    return
  }

  const response = await runFlush(paths, context)
  if (response.includes("FLUSH_OK")) {
    await appendDailyLog(paths, "FLUSH_OK - Nothing worth saving from this session", "Memory Flush")
  } else if (response.includes("FLUSH_ERROR")) {
    await appendDailyLog(paths, response, "Memory Flush")
  } else {
    await appendDailyLog(paths, response, "Session")
  }

  state.sessions[sessionID] = { context_hash: contextHash, timestamp: Date.now() / 1000 }
  await saveFlushState(paths, state)
  await maybeTriggerCompilation(paths, options)
  await log(paths, `flush complete for session ${sessionID}`)
}

export async function runFlush(paths: MemoryPaths, context: string): Promise<string> {
  const prompt = `Review the conversation context below and respond with a concise summary of important items that should be preserved in the daily log.
Do NOT use any tools - just return plain text.

Format your response as a structured daily log entry with these sections:

**Context:** [One line about what the user was working on]

**Key Exchanges:**
- [Important Q&A or discussions]

**Decisions Made:**
- [Any decisions with rationale]

**Lessons Learned:**
- [Gotchas, patterns, or insights discovered]

**Action Items:**
- [Follow-ups or TODOs mentioned]

Skip routine tool calls, trivial exchanges, and obvious content. Only include sections that have actual content. If nothing is worth saving, respond with exactly: FLUSH_OK

## Conversation Context

${context}`

  try {
    return await runOpenCode({ projectRoot: paths.projectRoot, prompt, agent: "plan", title: "memory flush", timeoutMs: 600_000 })
  } catch (error) {
    const message = `FLUSH_ERROR: ${error instanceof Error ? error.message : String(error)}`
    await log(paths, message)
    return message
  }
}

export async function appendDailyLog(paths: MemoryPaths, content: string, section = "Session"): Promise<void> {
  const parts = localDateParts()
  const logPath = path.join(paths.dailyDir, `${parts.date}.md`)
  if (!(await readText(logPath))) {
    await writeText(logPath, `# Daily Log: ${parts.date}\n\n## Sessions\n\n## Memory Maintenance\n\n`)
  }
  await appendLog(logPath, `### ${section} (${parts.time})\n\n${content}\n\n`)
}

async function maybeTriggerCompilation(paths: MemoryPaths, options: { compile?: boolean; compileAfterHour?: number }): Promise<void> {
  if (options.compile === false) return
  const now = new Date()
  if (options.compileAfterHour !== undefined && now.getHours() < options.compileAfterHour) return
  const today = localDateParts(now).date
  const logPath = path.join(paths.dailyDir, `${today}.md`)
  const state = await loadState(paths)
  const previous = state.ingested[`${today}.md`]
  if (previous && previous.hash === (await fileHash(logPath).catch(() => ""))) return
  const reason = options.compileAfterHour === undefined
    ? "automatic compilation triggered"
    : `end-of-day compilation triggered after ${options.compileAfterHour}:00`
  await log(paths, reason)
  await compile(paths)
}

async function log(paths: MemoryPaths, message: string): Promise<void> {
  const line = `${new Date().toISOString()} ${message}\n`
  await appendLog(path.join(paths.logsDir, "flush.log"), line).catch(() => undefined)
}
