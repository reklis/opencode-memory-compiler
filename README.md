# OpenCode Memory Compiler

Global OpenCode memory for every project, stored as a searchable markdown knowledge base.

OpenCode Memory Compiler is both an OpenCode plugin and an `opencode-memory` CLI. It captures useful conversation context automatically, writes daily logs, and compiles those logs into structured, cross-linked knowledge articles. It uses OpenCode itself for LLM work, so it follows the user's configured or last-selected OpenCode model and never hardcodes a provider.

## Requirements

- Node.js 20+
- OpenCode installed and authenticated

```bash
opencode auth login
```

## Install

```bash
npm install -g opencode-memory-compiler
opencode-memory install
```

`opencode-memory install` registers the package as a global OpenCode plugin. You can also register it directly:

```bash
opencode plugin opencode-memory-compiler --global
```

Verify the install:

```bash
opencode-memory doctor
```

## How It Works

```text
OpenCode session -> global plugin captures idle/compaction context
    -> opencode-memory flush-context -> daily/YYYY-MM-DD.md
    -> opencode-memory compile -> knowledge/concepts/, connections/, qa/
    -> plugin injects knowledge/index.md into future sessions
```

- Captures sessions on `session.idle` and before compaction.
- Stores memory outside repositories by default.
- Runs unattended memory work with `opencode run --dangerously-skip-permissions`.
- Never passes `--model`; OpenCode resolves the active/default/last-used model.

## Storage

Default per-project global storage:

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

```bash
OPENCODE_MEMORY_HOME=/custom/base opencode
OPENCODE_MEMORY_DIR=/exact/memory/root opencode
OPENCODE_MEMORY_STORAGE=project opencode
```

Use `OPENCODE_MEMORY_STORAGE=project` only when you intentionally want `daily/`, `knowledge/`, and reports in the current repo.

## CLI

```bash
opencode-memory compile                     # compile changed daily logs
opencode-memory compile --all               # force recompile all daily logs
opencode-memory compile --file 2026-05-07.md # compile one daily log
opencode-memory compile --dry-run           # show pending logs
opencode-memory query "question"             # ask the knowledge base
opencode-memory query "question" --file-back # ask and save Q&A article
opencode-memory lint                        # run all checks
opencode-memory lint --structural-only      # skip LLM contradiction check
opencode-memory doctor                      # show paths and OpenCode status
```

Common flags:

```bash
--project-root <path>   Project memory to operate on, default: cwd
--memory-root <path>    Override memory storage directory
--storage <mode>        global or project, default: global
```

## Development

```bash
npm install
npm run check
npm run build
node dist/cli.js doctor
npm pack --dry-run
```

## Cost Tracking

This package intentionally does not track costs. Use `opencode stats` for OpenCode usage or cost visibility.
