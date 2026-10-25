# Prune frontend

React + TypeScript (Vite) build of the Prune website from the design handoff.

```bash
npm install
npm run dev       # Vite + backend on http://localhost:8000
npm run build     # typecheck + production build to dist/
npm run preview
```

Complete the [backend setup](../backend/analysis/README.md#setup) first.
Use `npm run dev:ui` to run only Vite (normally http://localhost:5173).

## Pages

| Route | Page | Source mockup |
|---|---|---|
| `/` | Garden: tree, pruning station, inspector, compost pile | `Website.dc.html` |
| `/calendar` | Day detail with prune buttons and prev/next day | `DayDetail.dc.html` |
| `/how-we-measure` | Definition, pipeline, accuracy, limits | `HowWeMeasure.dc.html` |
| `/settings` | Placeholder (no design yet) | none |

The Chrome side panel screens (`Main`, `FirstRun`, `DayOne`, `InContext`) are not part of this app.

## Structure

```
src/
  styles/tokens.css       colors, fonts, radii from the design README
  styles/app.css          all component styles
  data/topics.ts          topic API, hierarchy and branch sizes
  data/sample.ts          sample calendar data
  state/                  saved topic cuts, falling animation and compost state
  components/             Layout, Chip, Tree (SVG), icons, garden/*
  pages/                  Garden, Calendar, HowWeMeasure, Settings
```

## Topic tree

- The Garden reads the global topic hierarchy from `GET /local-sessions/taxonomy` and
  refreshes every ten seconds. Pruning saves a preference with `PATCH /local-sessions/taxonomy/preferences`.
  The branch and descendants fall together, then leave the drawing. Restore reverses the cut;
  independently pruned children stay removed. Reduced-motion preferences use a short fade.
- Topic sizes use their share of globally classified videos: sprout under 3%, growing 3–10%,
  full over 10%. Topic discovery does not supply hostility ratings, so leaves show **Not rated**.
- Cuts persist in the backend and are shared with extension preferences. They remove topics
  from the garden but do not yet change platform recommendations. Burning clears the current
  compost display; cuts remain saved. The Calendar still uses sample days.
