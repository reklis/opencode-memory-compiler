import path from "node:path"
import { runOpenCode } from "./opencode-runner.js"
import { ensureMemoryDirs, loadState, readAllWikiContent, saveState, type MemoryPaths } from "./storage.js"
import { nowIso } from "./time.js"

export async function queryKnowledge(
  paths: MemoryPaths,
  question: string,
  options: { fileBack?: boolean } = {},
): Promise<string> {
  await ensureMemoryDirs(paths)
  const wikiContent = await readAllWikiContent(paths)
  const fileBackInstructions = options.fileBack
    ? `

## File Back Instructions

After answering, do the following:
1. Create a Q&A article at ${paths.qaDir}/ with the filename being a slugified version of the question.
2. Use the Q&A article format from the schema: frontmatter with title, question, consulted articles, and filed date.
3. Update ${paths.indexFile} with a new row for this Q&A article.
4. Append to ${paths.logFile}:
   ## [${nowIso()}] query (filed) | question summary
   - Question: ${question}
   - Consulted: [[list of articles read]]
   - Filed to: [[qa/article-name]]
`
    : ""

  const prompt = `You are a knowledge base query engine. Answer the user's question by consulting the knowledge base below.

## How to Answer

1. Read the INDEX section first - it lists every article with a one-line summary.
2. Identify 3-10 articles that are relevant to the question.
3. Read those articles carefully; they are included below.
4. Synthesize a clear, thorough answer.
5. Cite your sources using [[wikilinks]], for example [[concepts/supabase-auth]].
6. If the knowledge base does not contain relevant information, say so honestly.

## Knowledge Base

${wikiContent}

## Question

${question}
${fileBackInstructions}`

  let answer: string
  try {
    answer = await runOpenCode({
      projectRoot: paths.projectRoot,
      prompt,
      agent: options.fileBack ? "build" : "plan",
      title: "knowledge query",
      timeoutMs: 900_000,
    })
  } catch (error) {
    answer = `Error querying knowledge base: ${error instanceof Error ? error.message : String(error)}`
  }

  const state = await loadState(paths)
  state.query_count = (state.query_count || 0) + 1
  await saveState(paths, state)
  return answer
}

export async function printQueryResult(paths: MemoryPaths, question: string, fileBack = false): Promise<void> {
  console.log(`Question: ${question}`)
  console.log(`File back: ${fileBack ? "yes" : "no"}`)
  console.log("-".repeat(60))
  console.log(await queryKnowledge(paths, question, { fileBack }))
  if (fileBack) {
    console.log(`\n${"-".repeat(60)}`)
    console.log(`Answer filed to ${path.relative(paths.memoryRoot, paths.qaDir)}/`)
  }
}
