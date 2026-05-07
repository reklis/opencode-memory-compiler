# AGENTS.md - OpenCode Memory Compiler

This repo builds a global OpenCode plugin and CLI that compiles OpenCode conversations into a markdown knowledge base.

## Runtime Shape

```text
OpenCode global plugin
|-- captures session.created, session.idle, and compaction events
|-- stores per-project memory under ~/.local/share/opencode-memory-compiler/projects/
|-- spawns opencode-memory flush-context for unattended background flushes

opencode-memory CLI
|-- compile
|-- query
|-- lint
|-- doctor
|-- install
```

## Package Structure

```text
src/
|-- plugin.ts          # OpenCode plugin entrypoint
|-- cli.ts             # opencode-memory binary
|-- storage.ts         # per-project global storage paths and JSON state
|-- opencode-runner.ts # opencode run wrapper, no hardcoded model
|-- flush.ts           # conversation context -> daily log
|-- compile.ts         # daily logs -> knowledge articles
|-- query.ts           # index-guided querying and optional file-back
|-- lint.ts            # structural checks and optional contradiction check
|-- schema.ts          # bundled knowledge article schema prompt
|-- wikilinks.ts       # wikilink parsing and backlink helpers
|-- time.ts            # date helpers
```

## Model Behavior

The compiler never passes `--model` and does not set model configuration. OpenCode chooses the model from its normal resolution order: CLI/config model, last-used model, then internal default.

Unattended compiler calls use `--dangerously-skip-permissions` because automatic capture and compilation must complete without prompts.

## Storage

Default storage is global and per-project:

```text
~/.local/share/opencode-memory-compiler/projects/<project-name>-<hash>/
|-- daily/
|-- knowledge/
|   |-- index.md
|   |-- log.md
|   |-- concepts/
|   |-- connections/
|   |-- qa/
|-- reports/
|-- tmp/
|-- logs/
|-- state.json
|-- last-flush.json
```

Environment overrides:

- `OPENCODE_MEMORY_HOME`: base data directory for global storage.
- `OPENCODE_MEMORY_DIR`: exact memory root.
- `OPENCODE_MEMORY_STORAGE=project`: use the project root as the memory root.
- `OPENCODE_MEMORY_COMPILER=1`: recursion guard for compiler-created OpenCode sessions.

## Knowledge Schema

### Daily Log Format

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

### Concept Articles

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

### Connection Articles

Created when a conversation reveals a non-obvious relationship between two or more concepts.

### Q&A Articles

Created by `opencode-memory query "..." --file-back` under `knowledge/qa/`.

## CLI Commands

```bash
opencode-memory compile
opencode-memory compile --all
opencode-memory compile --file daily/2026-04-01.md
opencode-memory compile --dry-run
opencode-memory query "What auth patterns do I use?"
opencode-memory query "What's my error handling strategy?" --file-back
opencode-memory lint
opencode-memory lint --structural-only
opencode-memory doctor
opencode-memory install
```

## State Tracking

`state.json` tracks:

- `ingested`: daily log filename -> hash and compile timestamp
- `query_count`: total query invocations
- `last_lint`: timestamp of the most recent lint

`last-flush.json` tracks flush deduplication by session id and context hash.

## Development

```bash
npm install
npm run check
npm run build
node dist/cli.js doctor
```

Do not reintroduce Python or `uv` runtime dependencies. This package is intended to install cleanly through npm and run inside OpenCode's JavaScript plugin system.
