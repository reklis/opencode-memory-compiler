export const KNOWLEDGE_SCHEMA = String.raw`# OpenCode Memory Compiler Knowledge Schema

## Architecture

daily/ contains append-only conversation summaries. knowledge/ contains compiled markdown articles. The compiler updates knowledge/index.md, knowledge/log.md, knowledge/concepts/, knowledge/connections/, and knowledge/qa/.

## Daily Log Format

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

## Concept Article Format

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

## Connection Article Format

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

## Q&A Article Format

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

## Conventions

- Wikilinks use Obsidian-style [[path/to/article]] without .md.
- Article filenames are lowercase kebab-case.
- Article frontmatter includes at minimum title, sources, created, and updated.
- Sources always link back to daily logs.
- Knowledge articles should be factual, concise, self-contained, and cross-linked.
`
