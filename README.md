# Pokémon Battle Lab

**[Launch the live Pokémon Battle Simulator](https://pokemon-battle-simulator.melodystryx.workers.dev)**

An independent, responsive Pokémon team-building and battle-testing workspace built with React, TypeScript, Vite, and Pokémon Showdown's simulator.

## Current features

- Generation 1–9 ruleset selection and a separate game-version selector.
- Online PvP sample-team fetching by exact generation and tier, with current Showdown validation.
- Simulator setup controls for generation, game version, PvP/PvE type, PvP tier, and the selected game's available facility.
- Local-first team builder with six slots, multiple builds per Pokémon, export, and automatic browser storage.
- Generation-aware Pokédex selectors, gender handling, EVs, IVs, natures, and calculated battle stats.
- Legality analysis using Pokémon Showdown's team validator, including Generation 7 Battle Tree Super Singles roster restrictions.
- Battle execution using `@pkmn/sim`, with generation-specific ability, type, status, weather, residual-damage and entry-hazard mechanics handled by the battle engine.
- Ability compatibility warnings when a selected ability is unavailable to that species in the chosen generation.
- Exhaustive PvP benchmark against every distinct, complete, currently valid team in the published sample-team archive for the selected generation and tier, with 100 randomized baseline battles per team.
- Auto mode with random legal-choice control and Manual mode with move/switch selection.
- Switch between Auto and Manual during a battle without restarting it.
- Battle event log and battle-engine smoke test in CI.
- Responsive PWA foundation.

## Battle engine notes

Both automatic battle sides and benchmarks use the rules-based `TacticalPlayerAI`, which makes decisions from its own team data and information visible in the battle log. The exhaustive PvP benchmark fetches the archive index and complete team dataset from `pkmn/smogon`, deduplicates identical six-set teams, validates every team against the selected Showdown format, and runs 100 battles against every accepted team. It reports per-team results, aggregate results, rejected records and archive coverage. This is exhaustive for the complete teams published in that archive, not every team ever used on the ladder. Public usage statistics and replay logs do not expose complete team compositions in every case. Benchmark results are outcomes against this tactical AI, not a competitive-strength rating. Saved teams can also be selected directly. The Simulator exposes generation, game version, battle type, tier or facility controls. PvE live battles and benchmarks load version-specific facility trainer teams instead of using the saved-team library as a substitute.

Supported PvP singles tiers use their corresponding Showdown format when available. The Generation 7 Battle Tree legality checker validates Super Singles rosters: six registered Pokémon, choose three per battle, level-down to 50, Species Clause, Item Clause, and the restricted Pokémon list. Other PvE facilities, VGC regulations, and Custom tiers currently run in the generation's Custom Game sandbox; their facility- or regulation-specific rules are not enforced. Battle execution itself still uses the Custom Game sandbox for PvE.

The player side must have a saved team of up to six complete Pokémon. PvP opponents can use saved teams or published PvP teams. PvE opponents come from the selected game's facility data. Each Pokémon needs at least one move. The Showdown engine applies the selected generation's battle mechanics; facility-specific roster legality is not fully validated yet.

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

GitHub Actions runs the production build, battle-engine smoke test, ability/status/hazard regression tests, facility-data tests, and benchmark telemetry tests on pushes and pull requests.

## Benchmark coverage and limitations

- PvP coverage is the full set of distinct complete teams published for the exact Showdown format in the `pkmn/smogon` sample-team archive. The archive index is checked before loading a format dataset.
- The archive is a curated sample-team collection, not an exhaustive record of all ladder teams. The UI reports source record count, accepted distinct teams and rejected records.
- Replay logs and usage statistics are not silently converted into complete teams: they may omit unrevealed Pokémon or set details. Such partial evidence is not counted as a tested team.
- PvE facility pools are game-version-specific and are connected to live battles and the exhaustive benchmark. Supported sources include Ruby/Sapphire Battle Tower, Emerald Battle Frontier, FireRed/LeafGreen Trainer Tower, the Generation IV Battle Tower/Frontier, Generation V Battle Subway, Generation VI Battle Maison, Generation VII Battle Tree, Generation VIII Battle Tower, and the Generation IX Academy Ace Tournament.
- 100 battles are run per published team. Both sides use the rules-based TacticalPlayerAI described below; results are useful for comparing teams against a consistent heuristic, not as a substitute for human play or a tournament-grade competitive AI.

### Tactical battle AI

Automatic battles and exhaustive benchmarks use a rules-based tactical AI instead of random move selection. It evaluates move power, accuracy, STAB, type effectiveness, approximate offensive stats, useful status and setup effects, recovery, and matchup-aware switching. It also ranks the team preview order. The AI only uses its own team data and information visible in its battle log.

The AI accounts for revealed ability immunities, status already present, and existing hazard layers, but remains heuristic rather than an expert competitive player. The battle engine, not the AI, resolves abilities, type interactions, entry hazards, weather, status and residual damage. Matchup win rates are results against this specific AI, not guaranteed human-versus-human outcomes.

## All-team simulation and Matchup Analysis
- The Simulator's all-team run executes 100 battles per opponent.
- PvP Auto Teams benchmarks all distinct valid complete teams in the published sample archive for the selected format.
- Saved teams benchmarks every other complete team in the browser's local team library. PvE benchmarks use the selected facility's version-specific trainer pool.
- Per-opponent and aggregate wins, losses, ties, completion counts, selected game/ruleset, and source coverage are persisted locally and displayed in Matchup Analysis.
- Combat telemetry records HP damage taken, source-attributed damage dealt per Pokémon, faint counts, damage ratios, and passive damage grouped by entry hazards, poison, bad poison, burn, weather, abilities or items when the battle log identifies the source.
- Status telemetry records major status conditions applied to and cured from each Pokémon, separately from residual damage.
- Move rankings show damage attributed to individual moves for both teams. Residual damage and damage without a reliable source remain outside move rankings and are reported as unattributed.
- Trainer Tower Knockout Mode reports each one-Pokémon trainer battle separately; continuous HP carryover between consecutive Knockout battles is not currently simulated.
- A run can be cancelled; completed battles remain recorded.
