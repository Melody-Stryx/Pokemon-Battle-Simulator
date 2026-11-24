# Pokémon Battle Lab

An independent, responsive Pokémon team-building and battle-testing workspace built with React, TypeScript, Vite, and Pokémon Showdown's simulator.

## Current features

- Generation 1–9 ruleset selection and a separate game-version selector.
- Online PvP sample-team fetching by exact generation and tier, with current Showdown validation.
- PvP tiers and PvE facility selection.
- Local-first team builder with six slots, multiple builds per Pokémon, export, and automatic browser storage.
- Generation-aware Pokédex selectors, gender handling, EVs, IVs, natures, and calculated battle stats.
- Legality analysis using Pokémon Showdown's team validator, including Generation 7 Battle Tree Super Singles roster restrictions.
- Battle execution using `@pkmn/sim`.
- Choose saved teams or Auto Teams as the opponent source; PvP Auto Teams loads and randomly selects from the verified sample-team pool for the selected generation and tier.
- Auto mode with random legal-choice control and Manual mode with move/switch selection.
- Switch between Auto and Manual during a battle without restarting it.
- Battle event log and battle-engine smoke test in CI.
- Responsive PWA foundation.

## Battle engine notes

The opponent currently uses Pokémon Showdown's `RandomPlayerAI`. Auto mode on the player's side uses a random legal move/switch choice, not a strategic search AI. PvP Auto Teams fetches the available sample-team pool from the `pkmn/smogon` dataset for the selected generation and tier, validates each team with the installed Showdown validator, and randomly selects a team for each battle. Saved teams can also be selected directly. The game-version selector is separate because PvE facility pools are title-specific; Auto Teams for PvE is shown as an option but cannot be used until verified trainer datasets are connected for each game version.

Supported PvP singles tiers use their corresponding Showdown format when available. The Generation 7 Battle Tree legality checker validates Super Singles rosters: six registered Pokémon, choose three per battle, level-down to 50, Species Clause, Item Clause, and the restricted Pokémon list. Other PvE facilities, VGC regulations, and Custom tiers currently run in the generation's Custom Game sandbox; their facility- or regulation-specific rules are not enforced. Battle execution itself still uses the Custom Game sandbox for PvE.

The player side must have a saved team with six selected Pokémon. The opponent can use a saved team or a validated online PvP sample team. Each Pokémon needs at least one move. The simulator applies the selected generation's battle mechanics and format rules.

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
