# Viadal Event Planner — documentation index

Handoff index for the development team. This `docs/` folder is the source of truth. The Markdown and Mermaid files are canonical; the branded PDF in the repo root is a stakeholder snapshot generated from them.

**Product in one line:** a multi-tenant web app for planning and running sport events (Viadal 6-day run is the design driver). One tenant = one event in v1.

## Read in this order

1. **`problem-statement-mvp-scope.md`** — what we're building and why, MVP scope (in/out), success criteria, key constraints/decisions, and the domain vocabulary. Start here.
2. **`c4/level1-context.mermaid`** — system context (external actors). `c4/level1-context.png` is a pre-rendered copy. See `c4/README.md` to render diagrams.
3. **`c4/level2-container.mermaid`** — container/architecture view: Next.js + TypeScript frontend, Supabase (Auth phone/OTP, Postgres + Row Level Security, Storage), Twilio for SMS, Race Results via embedded links. This is where multi-tenancy, i18n, feature-toggling and the data-access rule live.
4. **`flows/`** — one user flow per core use case (the behaviour/business rules). Suggested order: `event-creation-config` → `workstation-checklist-config` → `officials-management-registration` → `officials-scheduling` → `official-personal-account` → `event-info-view` → `communication`.
5. **`ia/screen-map.md`** — information architecture: every screen per role and how they connect (`ia/screen-map.mermaid` is the diagram).
6. **`screens/screen-documentation.md`** — the developer-ready screen spec in pipe format (IDs, blocks, states, flows). Build from this.
7. **Wireframes** — lo-fi wireframes are in Claude Design (Peter shares access). `screens/claude-design-prompt.md` shows how they were generated and the platform/navigation rules.

## Status

| Area | Status |
|------|--------|
| Scope & context (scope doc, C4 L1/L2) | Stable. Scope doc v0.7 (Stage model); C4 L2 v0.6. |
| Flows (race admin + official) | Complete. Updated for Stage model (work areas, per-stage scheduling). |
| Screen map | Complete (participant screens shown as placeholders). |
| Screen documentation | Complete for system admin + event admin + official (v0.4). |
| Wireframes | First pass generated in Claude Design; iterating. |

## Cross-cutting, non-negotiable

- **Multi-tenant** from day one (tenant isolation via Postgres Row Level Security; never use the Supabase service role for user-scoped tenant data).
- **i18n** architected with i18next or equivalent; English only in v1; no hardcoded UI strings.
- **Per-tenant feature toggling** (tiers standard/premium/professional; exactly one tier active per tenant in v1, mutually exclusive).
- **UI delivery:** one responsive codebase, no separate apps. Admin screens web-first (reachable but non-optimized on mobile); official/participant screens mobile-first. The scheduling matrix is edit-on-desktop, view-only on mobile.

## Deferred (not in this handoff)

- Participant (deltagare) flows and screens — to be written next.
- A read-only mobile schedule view for admins (checking coverage on site).
- Event dashboard (EVT-01) content may evolve; blocks defined but may be refined.
- Editing dates / scheduling granularity after publish (event-day side effects).

## Notes

- All architecture and product decisions are captured inline in the documents above; there is no separate decisions log.
- Sign in (AUTH-01) reuses the design Frida built for "Nattvandrarna"; deviations get checked with Peter.
