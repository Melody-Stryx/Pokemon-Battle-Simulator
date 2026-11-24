# Pokémon Battle Lab

An independent, responsive Pokémon team-building and battle-testing workspace built with React, TypeScript, Vite, and Pokémon Showdown's simulator.

## Current features

- Generation 1–9 ruleset selection and a separate game-version selector.
- Online PvP sample-team fetching by exact generation and tier, with current Showdown validation.
- Simulator setup controls for generation, game version, PvP/PvE type, PvP tier, and the selected game's available facility.
- Local-first team builder with six slots, multiple builds per Pokémon, export, and automatic browser storage.
- Generation-aware Pokédex selectors, gender handling, EVs, IVs, natures, and calculated battle stats.
- Legality analysis using Pokémon Showdown's team validator, including Generation 7 Battle Tree Super Singles roster restrictions.
- Battle execution using `@pkmn/sim`.
- Exhaustive PvP benchmark against every distinct, complete, currently valid team in the published sample-team archive for the selected generation and tier, with 100 randomized baseline battles per team.
- Auto mode with random legal-choice control and Manual mode with move/switch selection.
- Switch between Auto and Manual during a battle without restarting it.
- Battle event log and battle-engine smoke test in CI.
- Responsive PWA foundation.

## Battle engine notes

The opponent currently uses Pokémon Showdown's `RandomPlayerAI`. Auto mode on the player's side uses a random legal move/switch choice, not a strategic search AI. The exhaustive PvP benchmark fetches the archive index and complete team dataset from `pkmn/smogon`, deduplicates identical six-set teams, validates every team against the selected Showdown format, and runs 100 battles against every accepted team. It reports per-team results, aggregate results, rejected records and archive coverage. This is exhaustive for the complete teams published in that archive, not every team ever used on the ladder. Public usage statistics and replay logs do not expose complete team compositions in every case. The current benchmark uses random legal-choice AI on both sides and is a baseline harness, not a competitive-strength rating. Saved teams can also be selected directly. The Simulator exposes generation, game version, battle type, tier or facility controls. PvE currently uses Saved teams only. Auto Teams is not offered for PvE because the selected game's facility trainer pool is not connected yet.

Supported PvP singles tiers use their corresponding Showdown format when available. The Generation 7 Battle Tree legality checker validates Super Singles rosters: six registered Pokémon, choose three per battle, level-down to 50, Species Clause, Item Clause, and the restricted Pokémon list. Other PvE facilities, VGC regulations, and Custom tiers currently run in the generation's Custom Game sandbox; their facility- or regulation-specific rules are not enforced. Battle execution itself still uses the Custom Game sandbox for PvE.

The player side must have a saved team with six selected Pokémon. The opponent can use a saved team or the exhaustive published PvP team benchmark. Each Pokémon needs at least one move. The simulator applies the selected generation's battle mechanics and format rules.

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


## Benchmark coverage and limitations

- PvP coverage is the full set of distinct complete teams published for the exact Showdown format in the `pkmn/smogon` sample-team archive. The archive index is checked before loading a format dataset.
- The archive is a curated sample-team collection, not an exhaustive record of all ladder teams. The UI reports source record count, accepted distinct teams and rejected records.
- Replay logs and usage statistics are not silently converted into complete teams: they may omit unrevealed Pokémon or set details. Such partial evidence is not counted as a tested team.
- PvE facility team pools are game-version-specific and are not yet connected to the exhaustive benchmark. Auto Teams for PvE must not claim exhaustive coverage until verified trainer and set pools for that exact game version are integrated.
- 100 battles are run per published team. Both sides currently use random legal-choice AI; meaningful competitive win-rate estimates require the planned strategic, information-limited AI.


### Tactical battle AI

Automatic battles and exhaustive benchmarks use a rules-based tactical AI instead of random move selection. It evaluates move power, accuracy, STAB, type effectiveness, approximate offensive stats, useful status and setup effects, recovery, and matchup-aware switching. It also ranks the team preview order. The AI only uses its own team data and information visible in its battle log.

This is a human-style baseline, not an expert competitive player or an exact damage calculator. It does not yet model every battle mechanic, predict opponent choices, or optimise long-term strategy. Matchup win rates should be interpreted as results against this specific AI, not as guaranteed human-versus-human outcomes.

## All-team simulation and Matchup Analysis
- The Simulator's all-team run executes 100 battles per opponent.
- PvP Auto Teams benchmarks all distinct valid complete teams in the published sample archive for the selected format.
- Saved teams benchmarks every other complete team in the browser's local team library. PvE uses Saved teams until version-specific facility trainer pools are connected.
- Per-opponent and aggregate wins, losses, ties, completion counts, selected game/ruleset, and source coverage are persisted locally and displayed in Matchup Analysis.
- Combat telemetry records HP damage taken, source-attributed damage dealt per Pokémon, faint counts, and damage ratios.
- Move rankings show damage attributed to individual moves for both teams. Residual damage and damage without a reliable source remain outside move rankings and are reported as unattributed.
- Results use random-choice AI on both sides at present; win rates are baseline simulator outcomes, not competitive-strength estimates.
- A run can be cancelled; completed battles remain recorded.
