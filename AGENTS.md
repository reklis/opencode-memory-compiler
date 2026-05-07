# AGENTS.md - OpenCode Memory Compiler Schema

> Adapted from Andrej Karpathy's LLM knowledge-base architecture.
> Instead of ingesting external articles, this system compiles knowledge from OpenCode conversations.

## Compiler Analogy

```text
daily/          = source code    (conversation summaries)
OpenCode model  = compiler       (extracts and organizes knowledge)
knowledge/      = executable     (structured, queryable knowledge base)
lint            = test suite     (health checks)
queries         = runtime        (using the knowledge)
```

The user has conversations. OpenCode captures useful session context automatically, then the compiler scripts synthesize the durable knowledge base.

## Architecture

### Layer 1: `daily/` - Conversation Logs

Daily logs are append-only source material captured from OpenCode sessions.

```text
daily/
|-- 2026-04-01.md
|-- 2026-04-02.md
|-- ...
```

Format:

```markdown
# Daily Log: YYYY-MM-DD

## Sessions

### Session (HH:MM)

**Context:** What the user was working on.

**Key Exchanges:**
- User asked about X, assistant explained Y

**Decisions Made:**
- Chose approach Z because...

**Lessons Learned:**
- The gotcha with W is...

**Action Items:**
- [ ] Follow up on X
```

### Layer 2: `knowledge/` - Compiled Knowledge

The LLM owns this directory. Humans read it, but the compiler updates it.

```text
knowledge/
|-- index.md
|-- log.md
|-- concepts/
|-- connections/
|-- qa/
```

### Layer 3: OpenCode Integration

OpenCode automation lives in `.opencode/plugins/memory-compiler.js`.

- `session.created`: injects today's date, `knowledge/index.md`, and the recent daily log into the session with `noReply: true`.
- `session.idle`: captures recent user/assistant text, writes a temp context file under `scripts/`, and spawns `scripts/flush.py` in the background.
- `experimental.session.compacting`: injects memory context into the compaction prompt and triggers a pre-compaction capture.
- `OPENCODE_MEMORY_COMPILER=1`: disables plugin recursion for sessions created by the memory compiler itself.

## OpenCode Model Behavior

The compiler never passes `--model` and does not set model configuration in code. OpenCode selects the model using its normal order: explicit CLI/config model, last-used model, then internal default.

Unattended compiler calls use `--dangerously-skip-permissions` because automatic capture and compilation must complete without interactive prompts.

## Structural Files

### `knowledge/index.md`

Master catalog. Query operations read this first and select relevant articles from it.

```markdown
# Knowledge Base Index

| Article | Summary | Compiled From | Updated |
|---------|---------|---------------|---------|
| [[concepts/supabase-auth]] | Row-level security patterns and JWT gotchas | daily/2026-04-02.md | 2026-04-02 |
```

### `knowledge/log.md`

Append-only build log.

```markdown
# Build Log

## [2026-04-01T14:30:00] compile | 2026-04-01.md
- Source: daily/2026-04-01.md
- Articles created: [[concepts/nextjs-project-structure]]
- Articles updated: (none)
```

## Article Formats

### Concept Articles (`knowledge/concepts/`)

```markdown
---
title: "Concept Name"
aliases: [alternate-name]
tags: [domain, topic]
sources:
  - "daily/2026-04-01.md"
created: 2026-04-01
updated: 2026-04-01
---

# Concept Name

[2-4 sentence core explanation]

## Key Points

- [Self-contained point]

## Details

[Deeper explanation]

## Related Concepts

- [[concepts/related-concept]] - How it connects

## Sources

- [[daily/2026-04-01.md]] - Source context
```

### Connection Articles (`knowledge/connections/`)

Created when a conversation reveals a non-obvious relationship between two or more concepts.

```markdown
---
title: "Connection: X and Y"
connects:
  - "concepts/concept-x"
  - "concepts/concept-y"
sources:
  - "daily/2026-04-04.md"
created: 2026-04-04
updated: 2026-04-04
---

# Connection: X and Y

## The Connection

[What links these concepts]

## Key Insight

[The non-obvious relationship]

## Evidence

[Specific examples]

## Related Concepts

- [[concepts/concept-x]]
- [[concepts/concept-y]]
```

### Q&A Articles (`knowledge/qa/`)

Filed answers from `scripts/query.py --file-back`.

```markdown
---
title: "Q: Original Question"
question: "The exact question asked"
consulted:
  - "concepts/article-1"
filed: 2026-04-05
---

# Q: Original Question

## Answer

[Answer with [[wikilink]] citations]

## Sources Consulted

- [[concepts/article-1]] - Relevant because...
```

## Core Operations

### Auto Capture

The plugin extracts recent text turns from OpenCode session messages and writes a temporary markdown context file. `scripts/flush.py` then asks OpenCode to summarize only durable knowledge and append it to the current daily log.

Flush deduplication is based on a hash of the captured context per session, stored in `scripts/last-flush.json`.

### Compile (`daily/` -> `knowledge/`)

`scripts/compile.py` reads changed daily logs, the schema, the index, and existing articles. It asks OpenCode to create or update articles directly in `knowledge/`, then records the daily log hash in `scripts/state.json`.

CLI:

```bash
uv run python scripts/compile.py
uv run python scripts/compile.py --all
uv run python scripts/compile.py --file daily/2026-04-01.md
uv run python scripts/compile.py --dry-run
```

### Query

`scripts/query.py` loads the index and all articles into context. With `--file-back`, it also creates a Q&A article and updates the index/log.

CLI:

```bash
uv run python scripts/query.py "What auth patterns do I use?"
uv run python scripts/query.py "What's my error handling strategy?" --file-back
```

### Lint

`scripts/lint.py` performs structural checks and an optional LLM contradiction check.

Checks:

- Broken links
- Orphan pages
- Orphan sources
- Stale articles
- Missing backlinks
- Sparse articles
- Contradictions

CLI:

```bash
uv run python scripts/lint.py
uv run python scripts/lint.py --structural-only
```

Reports are written to `reports/lint-YYYY-MM-DD.md`.

## Script Details

### `scripts/opencode_llm.py`

Central adapter for all LLM-backed script work.

- Writes the prompt to a temp file to avoid command-line length limits.
- Runs `opencode run --pure --dir <repo> --agent <agent> --dangerously-skip-permissions --file <prompt-file>`.
- Does not pass `--model`.
- Sets `OPENCODE_MEMORY_COMPILER=1` to avoid recursive plugin capture.
- Returns stdout as plain text.

### `scripts/flush.py`

Reads a pre-extracted context file, calls the OpenCode adapter with the `plan` agent, appends the result to `daily/YYYY-MM-DD.md`, and optionally triggers end-of-day compilation after 6 PM local time.

### `scripts/compile.py`

Calls the OpenCode adapter with the `build` agent because it needs file-edit access.

### `scripts/query.py`

Uses the `plan` agent for read-only answers and the `build` agent for `--file-back`.

### `scripts/lint.py`

Runs structural checks locally. The contradiction check uses the `plan` agent.

## State Tracking

`scripts/state.json` tracks:

- `ingested`: daily log filename -> hash and compile timestamp
- `query_count`: total query invocations
- `last_lint`: timestamp of the most recent lint

`scripts/last-flush.json` tracks flush deduplication by session id and context hash.

These files are gitignored and regenerated automatically.

## Dependencies

`pyproject.toml` requires Python 3.12+ and uses `uv` for dependency management. OpenCode itself is expected to be installed and authenticated separately.

## Conventions

- Wikilinks use Obsidian-style `[[path/to/article]]` without `.md`.
- Article filenames are lowercase kebab-case.
- Article frontmatter includes at minimum `title`, `sources`, `created`, and `updated`.
- Sources always link back to daily logs.
- Knowledge articles should be factual, concise, self-contained, and cross-linked.

## Full Project Structure

```text
opencode-memory-compiler/
|-- .opencode/
|   |-- plugins/
|   |   |-- memory-compiler.js
|-- AGENTS.md
|-- README.md
|-- pyproject.toml
|-- daily/
|-- knowledge/
|   |-- index.md
|   |-- log.md
|   |-- concepts/
|   |-- connections/
|   |-- qa/
|-- scripts/
|   |-- opencode_llm.py
|   |-- compile.py
|   |-- query.py
|   |-- lint.py
|   |-- flush.py
|   |-- config.py
|   |-- utils.py
|-- reports/
```
