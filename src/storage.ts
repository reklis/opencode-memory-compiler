import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

export type StorageMode = "global" | "project"

export type MemoryOptions = {
  memoryRoot?: string
  storage?: StorageMode
}

export type MemoryPaths = {
  projectRoot: string
  memoryRoot: string
  dailyDir: string
  knowledgeDir: string
  conceptsDir: string
  connectionsDir: string
  qaDir: string
  reportsDir: string
  tmpDir: string
  logsDir: string
  indexFile: string
  logFile: string
  stateFile: string
  lastFlushFile: string
}

export type CompilerState = {
  ingested: Record<string, { hash: string; compiled_at: string }>
  query_count: number
  last_lint: string | null
}

export type FlushState = {
  sessions?: Record<string, { context_hash: string; timestamp: number }>
}

export function sha16(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16)
}

function dataHome(): string {
  if (process.env.OPENCODE_MEMORY_HOME) return process.env.OPENCODE_MEMORY_HOME
  const xdg = process.env.XDG_DATA_HOME
  return path.join(xdg || path.join(os.homedir(), ".local", "share"), "opencode-memory-compiler")
}

function projectStorageName(projectRoot: string): string {
  const base = path.basename(projectRoot).replace(/[^a-zA-Z0-9_.-]/g, "-") || "project"
  return `${base}-${sha16(projectRoot)}`
}

export async function normalizeProjectRoot(projectRoot = process.cwd()): Promise<string> {
  try {
    return await realpath(path.resolve(projectRoot))
  } catch {
    return path.resolve(projectRoot)
  }
}

export async function resolveMemoryPaths(
  projectRoot = process.cwd(),
  options: MemoryOptions = {},
): Promise<MemoryPaths> {
  const normalizedProjectRoot = await normalizeProjectRoot(projectRoot)
  const storage = options.storage || (process.env.OPENCODE_MEMORY_STORAGE as StorageMode | undefined) || "global"
  const configuredRoot = options.memoryRoot || process.env.OPENCODE_MEMORY_DIR
  const memoryRoot = configuredRoot
    ? path.resolve(configuredRoot)
    : storage === "project"
      ? normalizedProjectRoot
      : path.join(dataHome(), "projects", projectStorageName(normalizedProjectRoot))

  const knowledgeDir = path.join(memoryRoot, "knowledge")
  return {
    projectRoot: normalizedProjectRoot,
    memoryRoot,
    dailyDir: path.join(memoryRoot, "daily"),
    knowledgeDir,
    conceptsDir: path.join(knowledgeDir, "concepts"),
    connectionsDir: path.join(knowledgeDir, "connections"),
    qaDir: path.join(knowledgeDir, "qa"),
    reportsDir: path.join(memoryRoot, "reports"),
    tmpDir: path.join(memoryRoot, "tmp"),
    logsDir: path.join(memoryRoot, "logs"),
    indexFile: path.join(knowledgeDir, "index.md"),
    logFile: path.join(knowledgeDir, "log.md"),
    stateFile: path.join(memoryRoot, "state.json"),
    lastFlushFile: path.join(memoryRoot, "last-flush.json"),
  }
}

export async function ensureMemoryDirs(paths: MemoryPaths): Promise<void> {
  await Promise.all([
    mkdir(paths.dailyDir, { recursive: true }),
    mkdir(paths.conceptsDir, { recursive: true }),
    mkdir(paths.connectionsDir, { recursive: true }),
    mkdir(paths.qaDir, { recursive: true }),
    mkdir(paths.reportsDir, { recursive: true }),
    mkdir(paths.tmpDir, { recursive: true }),
    mkdir(paths.logsDir, { recursive: true }),
  ])
}

export async function readText(file: string, fallback = ""): Promise<string> {
  try {
    return await readFile(file, "utf8")
  } catch {
    return fallback
  }
}

export async function writeText(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, content, "utf8")
}

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T
  } catch {
    return fallback
  }
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  await writeText(file, `${JSON.stringify(value, null, 2)}\n`)
}

export async function loadState(paths: MemoryPaths): Promise<CompilerState> {
  return readJson<CompilerState>(paths.stateFile, { ingested: {}, query_count: 0, last_lint: null })
}

export async function saveState(paths: MemoryPaths, state: CompilerState): Promise<void> {
  await writeJson(paths.stateFile, state)
}

export async function loadFlushState(paths: MemoryPaths): Promise<FlushState> {
  return readJson<FlushState>(paths.lastFlushFile, {})
}

export async function saveFlushState(paths: MemoryPaths, state: FlushState): Promise<void> {
  await writeJson(paths.lastFlushFile, state)
}

export async function fileHash(file: string): Promise<string> {
  return sha16(await readFile(file))
}

async function listMarkdownFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir)
    const files: string[] = []
    for (const entry of entries.sort()) {
      const full = path.join(dir, entry)
      const info = await stat(full)
      if (info.isFile() && entry.endsWith(".md")) files.push(full)
    }
    return files
  } catch {
    return []
  }
}

export async function listDailyLogs(paths: MemoryPaths): Promise<string[]> {
  return listMarkdownFiles(paths.dailyDir)
}

export async function listWikiArticles(paths: MemoryPaths): Promise<string[]> {
  const groups = await Promise.all([
    listMarkdownFiles(paths.conceptsDir),
    listMarkdownFiles(paths.connectionsDir),
    listMarkdownFiles(paths.qaDir),
  ])
  return groups.flat().sort()
}

export function relativeArticlePath(paths: MemoryPaths, file: string): string {
  return path.relative(paths.knowledgeDir, file).replaceAll(path.sep, "/")
}

export function articleTarget(paths: MemoryPaths, file: string): string {
  return relativeArticlePath(paths, file).replace(/\.md$/, "")
}

export function wikiArticleExists(paths: MemoryPaths, link: string): boolean {
  return existsSync(path.join(paths.knowledgeDir, `${link}.md`))
}

export async function readWikiIndex(paths: MemoryPaths): Promise<string> {
  return readText(
    paths.indexFile,
    "# Knowledge Base Index\n\n| Article | Summary | Compiled From | Updated |\n|---------|---------|---------------|---------|",
  )
}

export async function readAllWikiContent(paths: MemoryPaths): Promise<string> {
  const parts = [`## INDEX\n\n${await readWikiIndex(paths)}`]
  for (const article of await listWikiArticles(paths)) {
    parts.push(`## ${relativeArticlePath(paths, article)}\n\n${await readText(article)}`)
  }
  return parts.join("\n\n---\n\n")
}

export async function appendLog(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  const current = await readText(file)
  await writeFile(file, `${current}${content}`, "utf8")
}
