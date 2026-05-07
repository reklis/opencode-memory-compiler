import { spawn } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

export type RunOpenCodeOptions = {
  projectRoot: string
  prompt: string
  agent?: "plan" | "build" | string
  title?: string
  timeoutMs?: number
}

export class OpenCodeRunError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "OpenCodeRunError"
  }
}

export async function runOpenCode(options: RunOpenCodeOptions): Promise<string> {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "opencode-memory-"))
  const promptFile = path.join(tmpRoot, "prompt.md")
  await mkdir(tmpRoot, { recursive: true })
  await writeFile(promptFile, options.prompt, "utf8")

  const args = [
    "run",
    "--pure",
    "--dir",
    options.projectRoot,
    "--agent",
    options.agent || "build",
    "--title",
    options.title || "memory compiler",
    "--dangerously-skip-permissions",
    "--file",
    promptFile,
    "Follow the instructions in the attached prompt file exactly.",
  ]

  try {
    const { stdout, stderr, code } = await spawnCollect("opencode", args, {
      cwd: options.projectRoot,
      env: { ...process.env, OPENCODE_MEMORY_COMPILER: "1" },
      timeoutMs: options.timeoutMs || 1_800_000,
    })
    if (code !== 0) {
      const details = stderr.trim() || stdout.trim() || "unknown error"
      throw new OpenCodeRunError(`opencode run failed (${code}): ${details}`)
    }
    return stdout.trim()
  } finally {
    await rm(tmpRoot, { recursive: true, force: true })
  }
}

function spawnCollect(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number },
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    const timer = setTimeout(() => {
      child.kill("SIGTERM")
      reject(new OpenCodeRunError(`opencode run timed out after ${options.timeoutMs}ms`))
    }, options.timeoutMs)

    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk) => {
      stdout += chunk
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk
    })
    child.on("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      resolve({ stdout, stderr, code })
    })
  })
}
