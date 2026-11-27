import { BattleStreams, TeamValidator, Teams } from "@pkmn/sim";
import { TacticalPlayerAI } from "./pve-ai";

export type BenchmarkOpponent = {
  id: string;
  name: string;
  author?: string;
  sets: Record<string, unknown>[];
  teamPool?: Record<string, unknown>[][];
};

export type MoveDamageSummary = { move: string; damage: number; hits: number; uses: number };
export type PokemonDamageSummary = {
  pokemon: string;
  damageDealt: number;
  damageTaken: number;
  faints: number;
  moveDamage: MoveDamageSummary[];
};
export type SideDamageSummary = { pokemon: PokemonDamageSummary[]; moveDamage: MoveDamageSummary[] };
export type BattleAnalysis = { player: SideDamageSummary; opponent: SideDamageSummary; unattributedDamage: number };

export type BenchmarkResult = {
  opponentId: string;
  opponentName: string;
  wins: number;
  losses: number;
  ties: number;
  games: number;
  analysis: BattleAnalysis;
};

export type BenchmarkProgress = {
  completed: number;
  total: number;
  wins: number;
  losses: number;
  ties: number;
  currentOpponent: string;
  results: BenchmarkResult[];
  analysis: BattleAnalysis;
};

type SampleTeam = { name?: string; author?: string; data?: Record<string, unknown>[] };

function emptySide(): SideDamageSummary { return { pokemon: [], moveDamage: [] }; }
function emptyAnalysis(): BattleAnalysis { return { player: emptySide(), opponent: emptySide(), unattributedDamage: 0 }; }
function canonicalSet(set: Record<string, unknown>[]) {
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === "object") return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalize(item)])
    );
    return typeof value === "string" ? value.trim().toLowerCase() : value;
  };
  return JSON.stringify((normalize(set) as Record<string, unknown>[]));
}

export async function loadCompleteOpponentPool(format: string): Promise<{
  opponents: BenchmarkOpponent[];
  sourceCount: number;
  rejected: number;
  sourceUrl: string;
}> {
  const base = "https://pkmn.github.io/smogon/data/teams";
  const indexResponse = await fetch(`${base}/index.json`);
  if (!indexResponse.ok) throw new Error(`Could not load team archive index (HTTP ${indexResponse.status}).`);
  const index = await indexResponse.json() as Record<string, unknown>;
  if (!(format in index)) throw new Error(`The published team archive has no dataset for ${format}.`);
  const response = await fetch(`${base}/${format}.json`);
  if (!response.ok) throw new Error(`Could not load ${format} team archive (HTTP ${response.status}).`);
  const samples = await response.json() as SampleTeam[];
  const validator = TeamValidator.get(format);
  const seen = new Set<string>();
  const opponents: BenchmarkOpponent[] = [];
  let rejected = 0;
  for (const sample of samples) {
    if (!Array.isArray(sample.data) || sample.data.length !== 6) { rejected++; continue; }
    const key = canonicalSet(sample.data);
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      if ((validator.validateTeam(sample.data as any) || []).length) { rejected++; continue; }
    } catch {
      rejected++;
      continue;
    }
    opponents.push({
      id: key,
      name: sample.name?.trim() || `Published ${format.toUpperCase()} team ${opponents.length + 1}`,
      author: sample.author,
      sets: sample.data,
    });
  }
  return { opponents, sourceCount: samples.length, rejected, sourceUrl: `${base}/${format}.json` };
}

type FacilityDataset = {
  generation: number;
  trainers: Array<{ name: string; trainerClass: string; orasName?: string; pokemon: string[]; ivs?: Record<string, number> }>;
  pokemon: Array<Record<string, unknown> & { name: string; species: string }>;
};

export async function loadFacilityOpponentPool(generation: number, gameVersion: string, facility: string): Promise<{
  opponents: BenchmarkOpponent[];
  sourceCount: number;
  rejected: number;
  sourceUrl: string;
}> {
  const supported: Record<number, { version: string; facility: string; url: string }> = {
    3: { version: "Emerald", facility: "Battle Frontier", url: "/data/facilities/gen3.json" },
    4: { version: "HeartGold / SoulSilver", facility: "Battle Frontier", url: "/data/facilities/gen4.json" },
    5: { version: "Black / White", facility: "Battle Subway", url: "/data/facilities/gen5.json" },
    6: { version: "X / Y", facility: "Battle Maison", url: "/data/facilities/gen6.json" },
  };
  const source = generation === 6 && gameVersion === "Omega Ruby / Alpha Sapphire"
    ? { version: "Omega Ruby / Alpha Sapphire", facility: "Battle Maison", url: "/data/facilities/gen6.json" }
    : supported[generation];
  if (!source || source.version !== gameVersion || source.facility !== facility) {
    throw new Error(`Authentic trainer data is not yet available for Generation ${generation} ${gameVersion} ${facility}. The simulator will not substitute saved teams or fabricate opponents.`);
  }
  const response = await fetch(source.url);
  if (!response.ok) throw new Error(`Could not load the Generation ${generation} facility dataset (HTTP ${response.status}).`);
  const dataset = await response.json() as FacilityDataset;
  const setsByName = new Map(dataset.pokemon.map(set => [String(set.name).toLowerCase(), set]));
  const opponents: BenchmarkOpponent[] = [];
  let rejected = 0;
  for (const trainer of dataset.trainers) {
    const pool = trainer.pokemon.map(name => setsByName.get(name.toLowerCase())).filter((set): set is FacilityDataset["pokemon"][number] => Boolean(set));
    if (pool.length < 3) { rejected++; continue; }
    // Store the trainer's real selectable Pokémon pool. A fresh legal three-Pokémon
    // roster is drawn for each battle, rather than treating the entire pool as a team.
    const uniqueSpecies = new Set(pool.map(set => String(set.species).toLowerCase()));
    if (uniqueSpecies.size < 3) { rejected++; continue; }
    const converted = pool.map(set => ({
      name: String(set.species),
      species: String(set.species),
      level: 50,
      nature: String(set.nature || "Serious"),
      item: String(set.item || ""),
      moves: Array.isArray(set.moves) ? set.moves.map(String) : [set.move1, set.move2, set.move3, set.move4].filter(value => typeof value === "string" && value.trim()).map(String),
      ivs: trainer.ivs || { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
      evs: (set.evs as Record<string, number> | undefined) || { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    }));
    opponents.push({
      id: `facility-${generation}-${trainer.name}-${opponents.length}`,
      name: `${trainer.trainerClass} ${gameVersion === "Omega Ruby / Alpha Sapphire" ? (trainer.orasName || trainer.name) : trainer.name}`,
      sets: converted.slice(0, 3),
      teamPool: [converted],
    });
  }
  return { opponents, sourceCount: dataset.trainers.length, rejected, sourceUrl: source.url };
}

export async function loadMetaPokemonPool(format: string): Promise<{
  opponents: BenchmarkOpponent[];
  sourceCount: number;
  rejected: number;
  sourceUrl: string;
}> {
  const teams = await loadCompleteOpponentPool(format);
  const seen = new Set<string>();
  const opponents: BenchmarkOpponent[] = [];
  let sourceCount = 0;
  for (const team of teams.opponents) {
    for (const set of team.sets) {
      sourceCount++;
      const id = canonicalSet([set]);
      if (seen.has(id)) continue;
      seen.add(id);
      const species = String(set.species || set.name || "Unknown Pokémon");
      const item = String(set.item || "No item");
      const moves = Array.isArray(set.moves) ? set.moves.map(String).join(" / ") : "";
      opponents.push({ id, name: [species, item, moves].filter(Boolean).join(" · "), author: team.author, sets: [set] });
    }
  }
  return { opponents, sourceCount, rejected: teams.rejected, sourceUrl: teams.sourceUrl };
}

function addPokemonDamage(side: SideDamageSummary, pokemon: string, dealt: number, taken: number, move?: string, faint = false) {
  let entry = side.pokemon.find(item => item.pokemon === pokemon);
  if (!entry) {
    entry = { pokemon, damageDealt: 0, damageTaken: 0, faints: 0, moveDamage: [] };
    side.pokemon.push(entry);
  }
  entry.damageDealt += dealt;
  entry.damageTaken += taken;
  if (faint) entry.faints++;
  if (move && dealt > 0) {
    let moveEntry = entry.moveDamage.find(item => item.move === move);
    if (!moveEntry) { moveEntry = { move, damage: 0, hits: 0, uses: 0 }; entry.moveDamage.push(moveEntry); }
    moveEntry.damage += dealt;
    moveEntry.hits++;
  }
}
function addMoveDamage(side: SideDamageSummary, move: string, damage: number) {
  if (!move || damage <= 0) return;
  let entry = side.moveDamage.find(item => item.move === move);
  if (!entry) { entry = { move, damage: 0, hits: 0, uses: 0 }; side.moveDamage.push(entry); }
  entry.damage += damage;
  entry.hits++;
}
function addMoveUse(side: SideDamageSummary, pokemon: string, move: string) {
  if (!move) return;
  let sideEntry = side.moveDamage.find(item => item.move === move);
  if (!sideEntry) { sideEntry = { move, damage: 0, hits: 0, uses: 0 }; side.moveDamage.push(sideEntry); }
  sideEntry.uses++;
  let pokemonEntry = side.pokemon.find(item => item.pokemon === pokemon);
  if (!pokemonEntry) {
    pokemonEntry = { pokemon, damageDealt: 0, damageTaken: 0, faints: 0, moveDamage: [] };
    side.pokemon.push(pokemonEntry);
  }
  let pokemonMove = pokemonEntry.moveDamage.find(item => item.move === move);
  if (!pokemonMove) { pokemonMove = { move, damage: 0, hits: 0, uses: 0 }; pokemonEntry.moveDamage.push(pokemonMove); }
  pokemonMove.uses++;
}
function mergeSide(target: SideDamageSummary, source: SideDamageSummary) {
  for (const pokemon of source.pokemon) {
    addPokemonDamage(target, pokemon.pokemon, pokemon.damageDealt, pokemon.damageTaken);
    const entry = target.pokemon.find(item => item.pokemon === pokemon.pokemon)!;
    entry.faints += pokemon.faints;
    for (const move of pokemon.moveDamage) {
      let existing = entry.moveDamage.find(item => item.move === move.move);
      if (!existing) { existing = { move: move.move, damage: 0, hits: 0, uses: 0 }; entry.moveDamage.push(existing); }
      existing.damage += move.damage; existing.hits += move.hits; existing.uses += move.uses;
    }
  }
  for (const move of source.moveDamage) {
    let existing = target.moveDamage.find(item => item.move === move.move);
    if (!existing) { existing = { move: move.move, damage: 0, hits: 0, uses: 0 }; target.moveDamage.push(existing); }
    existing.damage += move.damage;
    existing.hits += move.hits;
    existing.uses += move.uses;
  }
}
function mergeAnalysis(target: BattleAnalysis, source: BattleAnalysis) {
  mergeSide(target.player, source.player);
  mergeSide(target.opponent, source.opponent);
  target.unattributedDamage += source.unattributedDamage;
}
function parseCondition(value: string): { hp: number; maxHp: number } | null {
  const match = value.match(/^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)/);
  return match ? { hp: Number(match[1]), maxHp: Number(match[2]) } : null;
}
function identName(ident: string, details?: string) {
  const nickname = ident.split(": ").slice(1).join(": ").trim();
  const species = details?.split(",")[0]?.trim();
  return nickname && species && nickname.toLowerCase() !== species.toLowerCase() ? `${nickname} (${species})` : (species || nickname || ident);
}

async function playOneBattle(format: string, playerSets: Record<string, unknown>[], opponentSets: Record<string, unknown>[]): Promise<{ outcome: "win" | "loss" | "tie"; analysis: BattleAnalysis }> {
  const streams = BattleStreams.getPlayerStreams(new BattleStreams.BattleStream());
  const generation = Number(format.match(/^gen(\d+)/)?.[1] || 9);
  const p1 = new TacticalPlayerAI(streams.p1, "p1", generation);
  const p2 = new TacticalPlayerAI(streams.p2, "p2", generation);
  void p1.start();
  void p2.start();
  const analysis = emptyAnalysis();
  const seedRoster = (side: SideDamageSummary, sets: Record<string, unknown>[]) => {
    for (const set of sets) {
      const species = String(set.species || set.name || "Pokémon");
      const nickname = String(set.name || species);
      const label = nickname.toLowerCase() !== species.toLowerCase() ? `${nickname} (${species})` : species;
      addPokemonDamage(side, label, 0, 0);
    }
  };
  seedRoster(analysis.player, playerSets);
  seedRoster(analysis.opponent, opponentSets);
  const hpByIdent = new Map<string, number>();
  const namesByIdent = new Map<string, string>();
  const faintedIdents = new Set<string>();
  const isolatedOneVsOne = playerSets.length === 1 && opponentSets.length === 1;
  const rosterLabel = (set: Record<string, unknown>) => {
    const species = String(set.species || set.name || "Pokémon");
    const nickname = String(set.name || species);
    return nickname.toLowerCase() !== species.toLowerCase() ? `${nickname} (${species})` : species;
  };
  const latestMoveByTarget = new Map<string, { ident: string; name: string }>();
  let outcome: "win" | "loss" | "tie" | null = null;
  let turnCount = 0;
  let moveCount = 0;
  const finished: Promise<{ outcome: "win" | "loss" | "tie"; analysis: BattleAnalysis }> = (async () => {
    for await (const chunk of streams.omniscient) {
      for (const line of String(chunk).split("\n")) {
        if (!line.startsWith("|")) continue;
        const parts = line.split("|");
        const tag = parts[1];
        if (tag === "error") {
          throw new Error(`Showdown rejected a benchmark battle: ${parts.slice(2).join("|")}`);
        }
        if (tag === "turn") turnCount = Number(parts[2]) || turnCount;
        if (tag === "move") moveCount++;
        if (tag === "win") {
          outcome = parts[2]?.trim() === "Benchmark Player" ? "win" : "loss";
          continue;
        }
        if (tag === "tie") { outcome = "tie"; continue; }
        if (tag === "switch" || tag === "drag" || tag === "replace") {
          const ident = parts[2];
          const hp = parseCondition(parts[4] || "");
          namesByIdent.set(ident, identName(ident, parts[3]));
          if (hp) hpByIdent.set(ident, hp.hp);
          continue;
        }
        if (tag === "move") {
          const actor = parts[2];
          const target = parts[4];
          const actorSide = actor?.slice(0, 2);
          if (actorSide === "p1" || actorSide === "p2") {
            const actorName = namesByIdent.get(actor) || identName(actor);
            addMoveUse(actorSide === "p1" ? analysis.player : analysis.opponent, actorName, parts[3] || "Unknown move");
          }
          if (target?.startsWith("p1") || target?.startsWith("p2")) {
            latestMoveByTarget.set(target, { ident: actor, name: parts[3] || "Unknown move" });
          }
          continue;
        }
        if (tag === "-heal" || tag === "-sethp") {
          const healed = parseCondition(parts[3] || "");
          if (healed) hpByIdent.set(parts[2], healed.hp);
          if (tag === "-sethp") {
            for (let index = 4; index < parts.length; index++) {
              if (parts[index].startsWith("p1") || parts[index].startsWith("p2")) {
                const condition = parseCondition(parts[index + 1] || "");
                if (condition) hpByIdent.set(parts[index], condition.hp);
              }
            }
          }
          continue;
        }
        if (tag === "-damage") {
          const target = parts[2];
          const condition = parseCondition(parts[3] || "") || (String(parts[3] || "").endsWith(" fnt") ? { hp: 0, maxHp: 0 } : null);
          if (!condition) continue;
          const previous = hpByIdent.get(target);
          hpByIdent.set(target, condition.hp);
          if (previous === undefined) continue;
          const damage = Math.max(0, Math.round(previous - condition.hp));
          if (!damage) continue;
          const targetSide = target.slice(0, 2);
          const sourceSide = targetSide === "p1" ? "p2" : "p1";
          const sourceMarker = parts.slice(4).find(part => part.startsWith("[from]"));
          const sourceIdentMarker = parts.slice(4).find(part => part.startsWith("[of]"));
          const loggedMove = latestMoveByTarget.get(target);
          let source: { ident: string; name: string } | undefined;
          let moveName = "";
          const sourceIdent = sourceIdentMarker?.slice("[of]".length).trim();
          if (sourceIdent) source = { ident: sourceIdent, name: "" };
          if (sourceMarker?.startsWith("[from] move:")) {
            moveName = sourceMarker.slice("[from] move:".length).trim();
            if (!source && loggedMove && loggedMove.ident.slice(0, 2) === sourceSide) source = loggedMove;
          } else if (!sourceMarker && loggedMove && loggedMove.ident.slice(0, 2) === sourceSide) {
            // Ordinary direct attacks usually have no [from] annotation. Match the damage
            // to the move line's explicit target rather than guessing from the last actor.
            source = loggedMove;
            moveName = loggedMove.name;
          }
          const targetName = namesByIdent.get(target) || identName(target);
          const targetSummary = targetSide === "p1" ? analysis.player : analysis.opponent;
          addPokemonDamage(targetSummary, targetName, 0, damage);
          if (source && source.ident.slice(0, 2) !== targetSide) {
            const sourceName = namesByIdent.get(source.ident) || identName(source.ident);
            const sourceSummary = source.ident.slice(0, 2) === "p1" ? analysis.player : analysis.opponent;
            addPokemonDamage(sourceSummary, sourceName, damage, 0, moveName || undefined);
            if (moveName) addMoveDamage(sourceSummary, moveName, damage);
          } else {
            analysis.unattributedDamage += damage;
          }
          continue;
        }
        if (tag === "faint") {
          const ident = parts[2];
          // In isolated 1v1 benchmarks, derive the defeated Pokémon from the
          // completed battle result below. This avoids duplicate/alias faint
          // log entries drifting away from the actual matchup W/L totals.
          if (isolatedOneVsOne || faintedIdents.has(ident)) continue;
          faintedIdents.add(ident);
          const side = ident.slice(0, 2) === "p1" ? analysis.player : analysis.opponent;
          addPokemonDamage(side, namesByIdent.get(ident) || identName(ident), 0, 0, undefined, true);
        }
      }
      if (outcome === "tie" && (!turnCount || !moveCount)) {
        throw new Error("Showdown ended a benchmark battle in a tie before any turns or moves. The result is invalid and was not counted.");
      }
      if (outcome) return { outcome, analysis };
    }
    throw new Error("Battle stream ended without a result.");
  })();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("A benchmark battle exceeded 30 seconds.")), 30000);
  });
  try {
    void streams.omniscient.write(
      `>start ${JSON.stringify({ formatid: format })}\n` +
      `>player p1 ${JSON.stringify({ name: "Benchmark Player", team: Teams.pack(playerSets as any) })}\n` +
      `>player p2 ${JSON.stringify({ name: "Benchmark Opponent", team: Teams.pack(opponentSets as any) })}`
    );
    const result = await Promise.race([finished, timeout]);
    if (isolatedOneVsOne && result.outcome !== "tie") {
      const defeatedSide = result.outcome === "win" ? analysis.opponent : analysis.player;
      const defeatedSet = result.outcome === "win" ? opponentSets[0] : playerSets[0];
      addPokemonDamage(defeatedSide, rosterLabel(defeatedSet), 0, 0, undefined, true);
    }
    return result;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function shuffledCopy<T>(items: T[]): T[] {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function createFacilityTeam(pool: Record<string, unknown>[]): Record<string, unknown>[] {
  const shuffled = shuffledCopy(pool);
  const selected: Record<string, unknown>[] = [];
  const species = new Set<string>();
  const items = new Set<string>();
  for (const set of shuffled) {
    const speciesId = String(set.species || set.name || "").toLowerCase();
    const itemId = String(set.item || "").toLowerCase();
    if (species.has(speciesId) || (itemId && items.has(itemId))) continue;
    species.add(speciesId);
    if (itemId) items.add(itemId);
    selected.push(set);
    if (selected.length === 3) break;
  }
  if (selected.length !== 3) throw new Error("Facility trainer pool could not produce a legal three-Pokémon roster.");
  return selected;
}

export async function runExhaustiveBenchmark(args: {
  format: string;
  playerSets: Record<string, unknown>[];
  opponents: BenchmarkOpponent[];
  repetitions: number;
  playerSelectionSize?: number;
  onProgress: (progress: BenchmarkProgress) => void;
  shouldCancel: () => boolean;
}): Promise<BenchmarkProgress> {
  const results: BenchmarkResult[] = [];
  const analysis = emptyAnalysis();
  let wins = 0, losses = 0, ties = 0, completed = 0;
  const total = args.opponents.length * args.repetitions;
  for (const opponent of args.opponents) {
    const result: BenchmarkResult = { opponentId: opponent.id, opponentName: opponent.name, wins: 0, losses: 0, ties: 0, games: 0, analysis: emptyAnalysis() };
    for (let repetition = 0; repetition < args.repetitions; repetition++) {
      if (args.shouldCancel()) return { completed, total, wins, losses, ties, currentOpponent: opponent.name, results, analysis };
      const battleTeam = opponent.teamPool?.length ? createFacilityTeam(opponent.teamPool[0]) : opponent.sets;
      const playerTeam = args.playerSelectionSize && args.playerSets.length > args.playerSelectionSize
        ? shuffledCopy(args.playerSets).slice(0, args.playerSelectionSize)
        : args.playerSets;
      const battle = await playOneBattle(args.format, playerTeam, battleTeam);
      const outcome = battle.outcome;
      result[outcome === "win" ? "wins" : outcome === "loss" ? "losses" : "ties"]++;
      result.games++;
      if (outcome === "win") wins++;
      else if (outcome === "loss") losses++;
      else ties++;
      mergeAnalysis(result.analysis, battle.analysis);
      mergeAnalysis(analysis, battle.analysis);
      completed++;
      // Full progress snapshots trigger React renders and synchronous localStorage writes.
      // Checkpoint every 100 battles rather than every 10 to keep large runs responsive.
      if (completed % 100 === 0 || completed === total) {
        args.onProgress({
          completed, total, wins, losses, ties, currentOpponent: opponent.name,
          results: [...results, { ...result, analysis: JSON.parse(JSON.stringify(result.analysis)) as BattleAnalysis }],
          analysis: JSON.parse(JSON.stringify(analysis)) as BattleAnalysis,
        });
      }
      // Give the browser a chance to paint, process input and handle cancellation.
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    results.push(result);
  }
  return { completed, total, wins, losses, ties, currentOpponent: "", results, analysis };
}
