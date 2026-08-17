# Divvit Restaurant Dashboard

The web app a restaurant owner logs into. Built from the UI team's handoff
(`design_handoff_restaurant_dashboard/`) — the prototype there is a design
reference, not code to port, so these are native React components using the
handoff's exact tokens.

```bash
npm install
npm run dev     # http://localhost:3100
```

## Stack

Next.js 15 (App Router) · React 19 · TypeScript · Lucide icons. No CSS
framework — the design is token-driven and the token set is small, so
`app/globals.css` holds the variables, the `dv*` keyframes copied verbatim from
the prototype, and the handful of hover/interaction classes that inline styles
can't express.

## Routes

Navigation is real routing, with the parent/child relationships the handoff
asks for (breadcrumbs in the header follow them).

| Route | Screen |
|---|---|
| `/` | Dashboard |
| `/collection` | The Collection |
| `/collection/campaigns` | Campaigns *(child)* |
| `/content` | Content Manager |
| `/discover` | Discover |
| `/discover/brand-health` | Organic Brand Health *(child)* |
| `/editor` | Editor |
| `/rewards` | Rewards |
| `/rewards/creators` | Creators *(child)* |

## Layout

```
app/
  layout.tsx          fonts + <Shell>
  globals.css         tokens, dv* keyframes, hover classes, reduced-motion
  <route>/page.tsx    one screen each
components/
  Shell.tsx           sidebar, header, search, toasts, live feed context
  WeeklyReport.tsx    stepped-reveal modal
lib/
  data.ts             every fixture, annotated with the endpoint it stands for
  icons.tsx           prototype icon keys -> Lucide
  ui.tsx              Card, GlassCard, Segmented, TabPair, useCountUp, …
```

`Shell` owns the state that must survive navigation — sidebar collapse
(persisted per user in `localStorage`), the toast queue, and the live activity
feed — and exposes it through `useShell()`.

## Fidelity notes

- Colours, type scale, radii, shadows and copy are the handoff's values.
- All `dv*` keyframes are copied verbatim; they encode the "cozy & soft" feel.
- `prefers-reduced-motion` keeps fades and drops movement.
- The prototype's `<image-slot>` placeholders are replaced with real CSS
  backgrounds over the sample stills in `public/uploads/`. In production these
  become poster frames from the media pipeline.
- The prototype's `style-hover` attribute has no React equivalent, so recurring
  hover patterns live as classes (`.btnPurple`, `.cardLift`, `.hoverRowPurple`…).

## What is still fake

Everything in `lib/data.ts` is fixture data. `BACKEND.md` in the handoff lists
the endpoint each one maps to; swapping them for fetches shouldn't touch the
components. The specific stand-ins:

- **Live Feed / Creator activity** — `setInterval` over a pool. Wants WS/SSE.
- **Editor render** — interval-driven progress. Wants a job API (the UI already
  has the step labels and a queued state).
- **Search** — ranked substring match over `searchCorpus`. Wants a real endpoint.
- **`cmMetricsFor()`** — deterministic hash, not real metrics. Replace wholesale.
- **Accept/pass, publish, archive, reward edits** — local state only.
- **Discover scan** — cosmetic; `lastScannedAt` and the found-count are real fields.

CPM is computed everywhere it appears (`rewardsPaid / views * 1000`), never
hardcoded, so it stays honest when the numbers become real.
