# Prune frontend

React + TypeScript (Vite) build of the Prune website from the design handoff.

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # typecheck + production build to dist/
npm run preview
```

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
  data/sample.ts          SAMPLE data (branches, days). Replace with API data
  state/                  prune/snip/compost state shared by Garden and Calendar
  components/             Layout, Chip, Tree (SVG), icons, garden/*
  pages/                  Garden, Calendar, HowWeMeasure, Settings
```

## Still to wire up

- `data/sample.ts` is mockup data. Branch levels should come from `GET /hostility/{video_id}`
  (`calm`, `some`, `heavy`, `not_rated`). Branch size: sprout under 3% of the last 30 days of
  Shorts, growing 3 to 10%, full over 10%.
- `state/PruneProvider.tsx` keeps pruning in memory only. Pruning a branch should hide that
  category's Shorts, snipping hides one channel, and burning the compost pile clears history
  only (pruned branches stay pruned).
- Placeholders from the design are left as `[level]` and the privacy line on How we measure.
