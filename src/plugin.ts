import { createHash } from "node:crypto"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { appendLog, ensureMemoryDirs, readText, resolveMemoryPaths, type MemoryOptions, type MemoryPaths, writeText } from "./storage.js"
import { localDateParts } from "./time.js"

const MAX_TURNS = 30
const MAX_CONTEXT_CHARS = 15_000
const MAX_MEMORY_CONTEXT_CHARS = 20_000
const MAX_LOG_LINES = 30
const recentFingerprints = new Map<string, string>()

type PluginClient = {
  session: {
    messages(input: { path: { id: string }; query?: { limit?: number } }): Promise<{ data?: Array<{ info?: { role?: string }; parts?: unknown[] }> }>
    prompt(input: { path: { id: string }; body: { noReply?: boolean; parts: Array<Record<string, unknown>> } }): Promise<unknown>
  }
  app: {
    log(input: { body: { service: string; level: string; message: string; extra?: Record<string, unknown> } }): Promise<unknown>
  }
}

type PluginInput = {
  client: PluginClient
  directory: string
  worktree?: string
}

type PluginOptions = MemoryOptions & {
  enabled?: boolean
  autoCompileHour?: number
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16)
}

function safeSessionID(sessionID: string): string {
  return sessionID.replace(/[^a-zA-Z0-9_.-]/g, "-")
}

async function recentDailyLog(paths: MemoryPaths): Promise<string> {
  const now = new Date()
  for (let offset = 0; offset < 2; offset += 1) {
    const date = new Date(now)
    date.setDate(now.getDate() - offset)
    const day = localDateParts(date).date
    const logPath = path.join(paths.dailyDir, `${day}.md`)
    const content = await readText(logPath)
    if (!content) continue
    return content.split(/\r?\n/).slice(-MAX_LOG_LINES).join("\n")
  }
  return "(no recent daily log)"
}

async function buildMemoryContext(paths: MemoryPaths): Promise<string> {
  const today = localDateParts().display
  const index = (await readText(paths.indexFile)) || "(empty - no articles compiled yet)"
  let context = [
    `## Today\n${today}`,
    `## Memory Storage\n${paths.memoryRoot}`,
    `## Knowledge Base Index\n\n${index}`,
    `## Recent Daily Log\n\n${await recentDailyLog(paths)}`,
  ].join("\n\n---\n\n")
  if (context.length > MAX_MEMORY_CONTEXT_CHARS) context = `${context.slice(0, MAX_MEMORY_CONTEXT_CHARS)}\n\n...(truncated)`
  return context
}

function partText(part: unknown): string {
  const p = part as { type?: string; text?: string; ignored?: boolean; metadata?: Record<string, unknown> }
  if (p?.metadata?.opencodeMemoryCompiler) return ""
  if (p?.ignored) return ""
  if (p?.type === "text" && p.text?.trim()) return p.text.trim()
  return ""
}

async function conversationContext(client: PluginClient, sessionID: string): Promise<{ context: string; turnCount: number }> {
  const result = await client.session.messages({ path: { id: sessionID }, query: { limit: MAX_TURNS * 2 } })
  const turns: string[] = []
  for (const message of result.data ?? []) {
    const role = message.info?.role
    if (role !== "user" && role !== "assistant") continue
    const text = (message.parts ?? []).map(partText).filter(Boolean).join("\n").trim()
    if (!text) continue
    turns.push(`**${role === "user" ? "User" : "Assistant"}:** ${text}\n`)
  }

  let context = turns.slice(-MAX_TURNS).join("\n")
  if (context.length > MAX_CONTEXT_CHARS) {
    context = context.slice(-MAX_CONTEXT_CHARS)
    const boundary = context.indexOf("\n**")
    if (boundary > 0) context = context.slice(boundary + 1)
  }
  return { context, turnCount: turns.length }
}

async function log(client: PluginClient, paths: MemoryPaths, level: string, message: string, extra: Record<string, unknown> = {}): Promise<void> {
  await client.app.log({ body: { service: "memory-compiler", level, message, extra } }).catch(() => undefined)
  await appendLog(path.join(paths.logsDir, "plugin.log"), `${new Date().toISOString()} ${level} ${message} ${JSON.stringify(extra)}\n`).catch(() => undefined)
}

async function injectMemory(client: PluginClient, paths: MemoryPaths, sessionID: string): Promise<void> {
  const context = await buildMemoryContext(paths)
  await client.session.prompt({
    path: { id: sessionID },
    body: {
      noReply: true,
      parts: [
        {
          type: "text",
          text: `# Memory Compiler Context\n\n${context}`,
          synthetic: true,
          metadata: { opencodeMemoryCompiler: true },
        },
      ],
    },
  })
}

async function captureSession(
  client: PluginClient,
  paths: MemoryPaths,
  sessionID: string,
  reason: string,
  minTurns: number,
  options: PluginOptions,
): Promise<void> {
  const { context, turnCount } = await conversationContext(client, sessionID)
  if (!context.trim() || turnCount < minTurns) return
  const fingerprint = digest(context)
  if (recentFingerprints.get(sessionID) === fingerprint) return
  recentFingerprints.set(sessionID, fingerprint)

  await ensureMemoryDirs(paths)
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
  const contextFile = path.join(paths.tmpDir, `opencode-flush-${safeSessionID(sessionID)}-${reason}-${timestamp}.md`)
  await writeText(contextFile, context)

  const cliPath = fileURLToPath(new URL("./cli.js", import.meta.url))
  const args = [
    cliPath,
    "flush-context",
    "--project-root",
    paths.projectRoot,
    "--memory-root",
    paths.memoryRoot,
    "--context-file",
    contextFile,
    "--session-id",
    sessionID,
    "--compile-after-hour",
    String(options.autoCompileHour ?? 18),
  ]
  const child = spawn(process.execPath, args, {
    cwd: paths.projectRoot,
    detached: true,
    stdio: "ignore",
    env: { ...process.env, OPENCODE_MEMORY_COMPILER: "1" },
  })
  child.unref()
}

export const MemoryCompilerPlugin = async ({ client, directory, worktree }: PluginInput, options: PluginOptions = {}) => {
  if (process.env.OPENCODE_MEMORY_COMPILER || options.enabled === false) return {}
  const projectRoot = worktree || directory
  const paths = await resolveMemoryPaths(projectRoot, options)
  await ensureMemoryDirs(paths)

  return {
    event: async ({ event }: { event: { type?: string; properties?: { sessionID?: string } } }) => {
      const sessionID = event?.properties?.sessionID
      if (!sessionID) return

      if (event.type === "session.created") {
        try {
          await injectMemory(client, paths, sessionID)
        } catch (error) {
          await log(client, paths, "warn", "failed to inject memory context", { error: String(error) })
        }
        return
      }

      if (event.type === "session.idle") {
        try {
          await captureSession(client, paths, sessionID, "idle", 1, options)
        } catch (error) {
          await log(client, paths, "error", "failed to capture idle session", { error: String(error) })
        }
      }
    },

    "experimental.session.compacting": async (input: { sessionID: string }, output: { context: string[] }) => {
      output.context.push(await buildMemoryContext(paths))
      try {
        await captureSession(client, paths, input.sessionID, "compact", 5, options)
      } catch (error) {
        await log(client, paths, "error", "failed to capture compacting session", { error: String(error) })
      }
    },
  }
}

export default MemoryCompilerPlugin
