import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { spawn } from "node:child_process"
import path from "node:path"

const MAX_TURNS = 30
const MAX_CONTEXT_CHARS = 15_000
const MAX_MEMORY_CONTEXT_CHARS = 20_000
const MAX_LOG_LINES = 30
const recentFingerprints = new Map()

function digest(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16)
}

function safeSessionID(sessionID) {
  return sessionID.replace(/[^a-zA-Z0-9_.-]/g, "-")
}

async function readIfExists(file, fallback = "") {
  try {
    return await readFile(file, "utf8")
  } catch {
    return fallback
  }
}

async function recentDailyLog(root) {
  const dailyDir = path.join(root, "daily")
  const now = new Date()
  for (let offset = 0; offset < 2; offset += 1) {
    const date = new Date(now)
    date.setDate(now.getDate() - offset)
    const yyyy = date.getFullYear()
    const mm = String(date.getMonth() + 1).padStart(2, "0")
    const dd = String(date.getDate()).padStart(2, "0")
    const logPath = path.join(dailyDir, `${yyyy}-${mm}-${dd}.md`)
    if (!existsSync(logPath)) continue
    const lines = (await readIfExists(logPath)).split(/\r?\n/)
    return lines.slice(-MAX_LOG_LINES).join("\n")
  }
  return "(no recent daily log)"
}

async function buildMemoryContext(root) {
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  })
  const indexPath = path.join(root, "knowledge", "index.md")
  const index = existsSync(indexPath)
    ? await readIfExists(indexPath)
    : "(empty - no articles compiled yet)"

  let context = [
    `## Today\n${today}`,
    `## Knowledge Base Index\n\n${index}`,
    `## Recent Daily Log\n\n${await recentDailyLog(root)}`,
  ].join("\n\n---\n\n")

  if (context.length > MAX_MEMORY_CONTEXT_CHARS) {
    context = `${context.slice(0, MAX_MEMORY_CONTEXT_CHARS)}\n\n...(truncated)`
  }
  return context
}

function partText(part) {
  if (part?.metadata?.opencodeMemoryCompiler) return ""
  if (part?.ignored) return ""
  if (part?.type === "text" && part.text?.trim()) return part.text.trim()
  return ""
}

async function getMessages(client, sessionID) {
  const result = await client.session.messages({
    path: { id: sessionID },
    query: { limit: MAX_TURNS * 2 },
  })
  return result.data ?? []
}

async function conversationContext(client, sessionID) {
  const messages = await getMessages(client, sessionID)
  const turns = []

  for (const message of messages) {
    const role = message?.info?.role
    if (role !== "user" && role !== "assistant") continue

    const text = (message.parts ?? []).map(partText).filter(Boolean).join("\n").trim()
    if (!text) continue

    const label = role === "user" ? "User" : "Assistant"
    turns.push(`**${label}:** ${text}\n`)
  }

  let context = turns.slice(-MAX_TURNS).join("\n")
  if (context.length > MAX_CONTEXT_CHARS) {
    context = context.slice(-MAX_CONTEXT_CHARS)
    const boundary = context.indexOf("\n**")
    if (boundary > 0) context = context.slice(boundary + 1)
  }
  return { context, turnCount: turns.length }
}

async function log(client, level, message, extra = {}) {
  try {
    await client.app.log({
      body: { service: "memory-compiler", level, message, extra },
    })
  } catch {
    // Logging must never break user sessions.
  }
}

async function injectMemory(client, root, sessionID) {
  const context = await buildMemoryContext(root)
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

async function captureSession(client, root, sessionID, reason, minTurns = 1) {
  const { context, turnCount } = await conversationContext(client, sessionID)
  if (!context.trim() || turnCount < minTurns) return

  const fingerprint = digest(context)
  if (recentFingerprints.get(sessionID) === fingerprint) return
  recentFingerprints.set(sessionID, fingerprint)

  const scriptsDir = path.join(root, "scripts")
  await mkdir(scriptsDir, { recursive: true })
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
  const contextFile = path.join(
    scriptsDir,
    `opencode-flush-${safeSessionID(sessionID)}-${reason}-${timestamp}.md`,
  )
  await writeFile(contextFile, context, "utf8")

  const child = spawn(
    "uv",
    ["run", "--directory", root, "python", path.join(scriptsDir, "flush.py"), contextFile, sessionID],
    {
      cwd: root,
      detached: true,
      stdio: "ignore",
      env: { ...process.env, OPENCODE_MEMORY_COMPILER: "1" },
    },
  )
  child.unref()
}

export const MemoryCompilerPlugin = async ({ client, directory, worktree }) => {
  if (process.env.OPENCODE_MEMORY_COMPILER) return {}

  const root = worktree || directory

  return {
    event: async ({ event }) => {
      const sessionID = event?.properties?.sessionID
      if (!sessionID) return

      if (event.type === "session.created") {
        try {
          await injectMemory(client, root, sessionID)
        } catch (error) {
          await log(client, "warn", "failed to inject memory context", { error: String(error) })
        }
        return
      }

      if (event.type === "session.idle") {
        try {
          await captureSession(client, root, sessionID, "idle")
        } catch (error) {
          await log(client, "error", "failed to capture idle session", { error: String(error) })
        }
      }
    },

    "experimental.session.compacting": async (input, output) => {
      output.context.push(await buildMemoryContext(root))
      try {
        await captureSession(client, root, input.sessionID, "compact", 5)
      } catch (error) {
        await log(client, "error", "failed to capture compacting session", { error: String(error) })
      }
    },
  }
}
