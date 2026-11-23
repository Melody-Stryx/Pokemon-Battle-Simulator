# Pokémon Battle Lab

An independent, mobile-friendly Pokémon team testing and battle analysis tool.

## Foundation build

This first build establishes the responsive React + TypeScript application and the persistent simulation configuration:

- Generations 1–9
- PvP / PvE selection
- Conditional PvP tier or PvE facility dropdown
- Auto / Manual control selection
- Local persistence of configuration
- Progressive Web App support

The battle engine, Pokémon data, legality analysis, team builder and matchup analytics are not connected yet.

## Development

```bash
npm install
npm run dev
```

## Production build

```bash
npm run build
npm run preview
```

## Planned foundation

Pokémon Showdown's battle simulator and validator will be evaluated as the battle and legality foundation. The application UI and team-testing workflows will remain independent.
