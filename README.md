# Pokémon Battle Lab

An independent, responsive Pokémon team-building and battle-testing workspace built with React, TypeScript, Vite, and Pokémon Showdown's simulator.

## Current features

- Generation 1–9 ruleset selection.
- PvP tiers and PvE facility selection.
- Local-first team builder with six slots, multiple builds per Pokémon, export, and automatic browser storage.
- Generation-aware Pokédex selectors, gender handling, EVs, IVs, natures, and calculated battle stats.
- Legality analysis using Pokémon Showdown's team validator.
- Battle execution using `@pkmn/sim`.
- Battles between two saved teams.
- Auto mode with random legal-choice control and Manual mode with move/switch selection.
- Switch between Auto and Manual during a battle without restarting it.
- Battle event log and battle-engine smoke test in CI.
- Responsive PWA foundation.

## Battle engine notes

The opponent currently uses Pokémon Showdown's `RandomPlayerAI`. Auto mode on the player's side uses a random legal move/switch choice, not a strategic search AI.

Supported PvP singles tiers use their corresponding Showdown format when available. PvE facilities, VGC regulations, and Custom tiers currently run in the generation's Custom Game sandbox; their facility- or regulation-specific rules are not enforced.

Both sides must have a saved team with six selected Pokémon. Each Pokémon needs at least one move. The simulator applies the selected generation's battle mechanics and format rules.

## Development

```bash
npm install
npm run dev
```

## Production build and engine test

```bash
npm run build
npm run test:battle
npm run preview
```

GitHub Actions runs both the production build and battle-engine smoke test on pushes and pull requests.
