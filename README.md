# OpenCode Memory Compiler

**Your OpenCode conversations compile themselves into a searchable markdown knowledge base.**

This project adapts Karpathy's LLM knowledge-base idea to personal AI coding sessions. OpenCode automatically captures useful conversation context, appends it to daily logs, and compiles those logs into structured, cross-linked knowledge articles. Retrieval is index-guided markdown, not RAG: the model reads `knowledge/index.md`, selects relevant articles, and answers from the knowledge base.

## Quick Start

1. Install dependencies:

```bash
uv sync
```

2. Make sure OpenCode is authenticated with the provider/model you want:

```bash
opencode auth login
```

3. Start OpenCode in this project. The plugin in `.opencode/plugins/memory-compiler.js` loads automatically.

```bash
opencode
```

OpenCode captures sessions automatically when they become idle and before compaction. After 6 PM local time, a flush can trigger compilation of changed daily logs. You can also run compilation manually at any time.

## Model Selection

The memory compiler does not hardcode a model and does not pass `--model` to OpenCode. It uses OpenCode's normal resolution order: CLI/config model, last-used model, then OpenCode's default.

All unattended memory tasks run with `--dangerously-skip-permissions` so background compilation can complete without prompts.

## How It Works

```text
OpenCode session -> .opencode plugin captures idle/compaction context
    -> scripts/flush.py -> daily/YYYY-MM-DD.md
    -> scripts/compile.py -> knowledge/concepts/, connections/, qa/
    -> plugin injects knowledge/index.md into future sessions
```

- `.opencode/plugins/memory-compiler.js` injects memory context, captures idle sessions, and catches pre-compaction context.
- `scripts/flush.py` asks OpenCode what is worth saving and appends the result to `daily/`.
- `scripts/compile.py` turns daily logs into organized concept and connection articles.
- `scripts/query.py` answers questions using index-guided retrieval.
- `scripts/lint.py` runs structural checks and an optional LLM contradiction check.

## Key Commands

```bash
uv run python scripts/compile.py                     # compile new daily logs
uv run python scripts/compile.py --dry-run           # show pending logs
uv run python scripts/query.py "question"             # ask the knowledge base
uv run python scripts/query.py "question" --file-back # ask and save answer
uv run python scripts/lint.py                         # run all health checks
uv run python scripts/lint.py --structural-only       # skip LLM contradiction check
```

## Cost Tracking

This project intentionally does not track costs. Use `opencode stats` if you want usage or cost visibility.

## Why No RAG?

At personal knowledge-base scale, a structured `knowledge/index.md` is usually better than vector search. The model can reason over article summaries, select relevant pages, and synthesize an answer with wikilink citations. RAG becomes useful later if the index grows beyond the context window.

## Technical Reference

See [AGENTS.md](AGENTS.md) for the full schema, article formats, OpenCode integration details, and script behavior.
