# C4 diagrams

The `.mermaid` files in this folder are the **source of truth** for the architecture diagrams. Rendered images (PNG/SVG) are generated from them, never hand-edited.

| File | Level | Purpose |
|------|-------|---------|
| `level1-context.mermaid` | C4 L1 (Context) | System as one box with all external actors. Scope-alignment view. |
| `level2-container.mermaid` | C4 L2 (Container) | Major technical building blocks (Next.js frontend, Supabase, etc.) and their relationships. Where multi-tenancy, i18n, and feature-toggling decisions are made visible. |

Levels 3 and 4 are out of scope for v1.

## Rendering to images

Use the Mermaid CLI (`mmdc`). Requires Node.js (which provides `npm`).

```bash
# one-time install
npm i -g @mermaid-js/mermaid-cli

# from the repo root
mmdc -i docs/c4/level1-context.mermaid -o docs/c4/level1-context.png
mmdc -i docs/c4/level2-container.mermaid -o docs/c4/level2-container.png

# SVG instead of PNG (sharper, scalable):
mmdc -i docs/c4/level1-context.mermaid -o docs/c4/level1-context.svg
```

`mmdc` downloads a headless Chromium on first run. On a normal dev machine this just works. It does **not** work inside the Cowork sandbox (no root to install packages, and the proxy blocks the Chromium binary download), so diagram rendering is a local/CI task, not something to do in a Cowork session.

## Other ways to view

- **mermaid.live** — paste a `.mermaid` file's contents, export PNG/SVG. Zero install, good for a quick look.
- **VS Code** — extension "Markdown Preview Mermaid Support" renders inline; "Mermaid Editor" can export images.
- **GitHub** — renders ` ```mermaid ` fenced blocks natively in Markdown, so the diagrams display in the browser with no image step.

## Keeping images in sync (optional)

To avoid rendered images drifting from the source, consider a CI step (e.g. a GitHub Action running `mermaid-cli`) that regenerates the PNG/SVG on every push that touches a `.mermaid` file.

## Note on the branded Scope & Context PDF

The current "Viadal Event Planner - Scope & Context vX.pdf" was built in a Cowork session where `mmdc` could not run, so its embedded C4 L1 image was produced with a one-off matplotlib script rather than from `level1-context.mermaid`. That image is a parallel rendering and can drift from the source. When the PDF is next rebuilt, prefer embedding the `mmdc`-rendered `level1-context.png` so there is a single source of truth.
