Capture something worth remembering across sessions.

Claude has a persistent file-based memory directory (see the memory
instructions in the system prompt). Write there — one file per fact, with the
required frontmatter — and add a one-line pointer to MEMORY.md.

Rules:

- One fact per file. Check MEMORY.md for an existing file covering the same
  ground and update that instead of creating a near-duplicate.
- Don't save what the repo already records (code structure, git history, what's
  in CLAUDE.md or the reference docs). If asked to remember one of those, ask
  what was non-obvious about it and save that instead.
- Convert relative dates to absolute ones.
- Durable project conventions belong in .claude/CLAUDE.md or
  .claude/reference/ instead — memory is for things that don't fit the repo.
