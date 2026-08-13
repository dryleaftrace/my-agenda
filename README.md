# My Agenda

A local reimplementation of the core loop of the "Day Planner" community plugin: reads timed checkbox tasks from your daily notes and renders them as a draggable Week/Month timeline in the sidebar.

## Features

- **Week view** — seven interactive timeline columns (Monday–Sunday) side by side, each with an hour grid, a "now" line on today, and fully draggable/resizable task blocks.
- **Month view** — a 6-week calendar grid with a done/total badge per day; click a day to jump into Week view centered on it.
- **Click-to-create** — click any empty spot on a Week timeline, type, and it creates a new timed task right there, no need to leave the sidebar.
- **Drag to move / resize** — drag a task block to shift its time, or drag the bottom handle to resize just the end time.
- **Sticky headers** — the day/date header row and hour-label gutter stay pinned while you scroll.
- **Live refresh** — the view updates automatically whenever the underlying notes change on disk.

## On-disk format

Tasks are read from a heading (default `# Day planner`) in your daily notes, in the format:

```
# Day planner

- [x] 10:00 - 11:00 Stretch/meditate
- [ ] 11:00 - 11:30 call the health insurance place
```

Notes are located by matching your vault's configured Daily Notes filename format against markdown files anywhere in the vault (not a single fixed folder).

## Installation

1. Clone or download this repo into your vault's `.obsidian/plugins/my-agenda/` folder.
2. Run `npm install && node esbuild.config.mjs` to produce `main.js` (or use the one already committed here).
3. Enable **My Agenda** in Obsidian's Community Plugins settings.

## Settings

- **Planner heading** — heading text to match (default `Day planner`).
- **Start hour / End hour** — timeline bounds (default 6–24).
- **Snap increment** — minutes to snap drag/resize/click-to-create to (default 10).
- **Default task duration** — length of a newly click-created task (default 30 min).

## Development

```
npm install
node esbuild.config.mjs
```

Reload Obsidian (or use the Hot Reload plugin) to pick up changes to `main.js`.
