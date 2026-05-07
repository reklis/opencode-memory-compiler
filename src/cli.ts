#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { rm } from "node:fs/promises"
import path from "node:path"
import { compile } from "./compile.js"
import { flushContext } from "./flush.js"
import { lint } from "./lint.js"
import { printQueryResult } from "./query.js"
import { ensureMemoryDirs, resolveMemoryPaths, type MemoryOptions } from "./storage.js"

type Parsed = {
  command: string
  args: string[]
  flags: Record<string, string | boolean>
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2))
  if (!parsed.command || parsed.flags.help) {
    printHelp()
    return 0
  }

  const paths = await pathsFor(parsed)
  switch (parsed.command) {
    case "compile":
      await compile(paths, {
        all: Boolean(parsed.flags.all),
        dryRun: Boolean(parsed.flags["dry-run"]),
        file: stringFlag(parsed.flags.file),
      })
      return 0
    case "query": {
      const question = parsed.args.join(" ").trim()
      if (!question) throw new Error("query requires a question")
      await printQueryResult(paths, question, Boolean(parsed.flags["file-back"]))
      return 0
    }
    case "lint":
      return lint(paths, { structuralOnly: Boolean(parsed.flags["structural-only"]) })
    case "flush-context": {
      const contextFile = requiredFlag(parsed.flags, "context-file")
      const sessionID = requiredFlag(parsed.flags, "session-id")
      try {
        await flushContext(paths, contextFile, sessionID, { compileAfterHour: numberFlag(parsed.flags["compile-after-hour"], 18) })
      } finally {
        await rm(contextFile, { force: true }).catch(() => undefined)
      }
      return 0
    }
    case "doctor":
      await doctor(paths)
      return 0
    case "install":
      return installPlugin()
    default:
      throw new Error(`unknown command: ${parsed.command}`)
  }
}

function parseArgs(argv: string[]): Parsed {
  const [command = "", ...rest] = argv
  const args: string[] = []
  const flags: Record<string, string | boolean> = {}
  for (let i = 0; i < rest.length; i += 1) {
    const item = rest[i]
    if (!item.startsWith("--")) {
      args.push(item)
      continue
    }
    const raw = item.slice(2)
    const [key, inline] = raw.split("=", 2)
    if (inline !== undefined) {
      flags[key] = inline
      continue
    }
    const next = rest[i + 1]
    if (next && !next.startsWith("--")) {
      flags[key] = next
      i += 1
    } else {
      flags[key] = true
    }
  }
  return { command, args, flags }
}

async function pathsFor(parsed: Parsed) {
  const options: MemoryOptions = {
    memoryRoot: stringFlag(parsed.flags["memory-root"]),
    storage: stringFlag(parsed.flags.storage) as MemoryOptions["storage"],
  }
  return resolveMemoryPaths(stringFlag(parsed.flags["project-root"]) || process.cwd(), options)
}

function stringFlag(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined
}

function numberFlag(value: string | boolean | undefined, fallback: number): number {
  const parsed = typeof value === "string" ? Number(value) : NaN
  return Number.isFinite(parsed) ? parsed : fallback
}

function requiredFlag(flags: Record<string, string | boolean>, name: string): string {
  const value = stringFlag(flags[name])
  if (!value) throw new Error(`missing required flag --${name}`)
  return value
}

async function doctor(paths: Awaited<ReturnType<typeof resolveMemoryPaths>>): Promise<void> {
  await ensureMemoryDirs(paths)
  const opencode = spawnSync("opencode", ["--version"], { encoding: "utf8" })
  console.log(`Project root: ${paths.projectRoot}`)
  console.log(`Memory root: ${paths.memoryRoot}`)
  console.log(`OpenCode: ${opencode.status === 0 ? opencode.stdout.trim() : "not found"}`)
  console.log(`Knowledge index: ${existsSync(paths.indexFile) ? paths.indexFile : "not created yet"}`)
}

function installPlugin(): number {
  const result = spawnSync("opencode", ["plugin", "opencode-memory-compiler", "--global"], {
    stdio: "inherit",
  })
  return result.status || 0
}

function printHelp(): void {
  console.log(`opencode-memory

Usage:
  opencode-memory compile [--all] [--file daily.md] [--dry-run]
  opencode-memory query "question" [--file-back]
  opencode-memory lint [--structural-only]
  opencode-memory doctor
  opencode-memory install

Common flags:
  --project-root <path>   Project to compile/query memory for (default: cwd)
  --memory-root <path>    Override memory storage directory
  --storage <mode>        global or project (default: global)
`)
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
