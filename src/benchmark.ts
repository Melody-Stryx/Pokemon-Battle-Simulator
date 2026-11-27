import { Dex } from "@pkmn/dex";
import { BattleStreams, TeamValidator, Teams } from "@pkmn/sim";
import { TacticalPlayerAI } from "./pve-ai";

export type BenchmarkOpponent = {
  id: string;
  name: string;
  author?: string;
  sets: Record<string, unknown>[];
  teamPool?: Record<string, unknown>[][];
  fixedTeam?: boolean;
  format?: string;
  scaleLevelToPlayer?: boolean;
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
export type DamageSourceSummary = { source: string; damage: number; hits: number };
export type BattleAnalysis = {
  player: SideDamageSummary;
  opponent: SideDamageSummary;
  unattributedDamage: number;
  passiveDamage: { player: DamageSourceSummary[]; opponent: DamageSourceSummary[] };
};

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
function emptyAnalysis(): BattleAnalysis { return { player: emptySide(), opponent: emptySide(), unattributedDamage: 0, passiveDamage: { player: [], opponent: [] } }; }
function addPassiveDamage(analysis: BattleAnalysis, side: "player" | "opponent", source: string, damage: number) {
  const normalized = ({ psn: "Poison", tox: "Bad poison", brn: "Burn", par: "Paralysis", sandstorm: "Sandstorm", hail: "Hail", snow: "Snow" } as Record<string, string>)[source.toLowerCase()] || source;
  const entries = analysis.passiveDamage[side];
  let entry = entries.find(item => item.source === normalized);
  if (!entry) { entry = { source: normalized, damage: 0, hits: 0 }; entries.push(entry); }
  entry.damage += damage;
  entry.hits++;
}
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
  trainers: Array<{ name: string; trainerClass?: string; displayName?: string; orasName?: string; pokemon: string[]; ivs?: Record<string, number>; level?: number; fixedTeam?: boolean; teamSize?: number }>;
  pokemon: Array<Record<string, unknown> & { name: string; species: string; moves?: string[] }>;
};

export async function loadFacilityOpponentPool(generation: number, gameVersion: string, facility: string): Promise<{ opponents: BenchmarkOpponent[]; sourceCount: number; rejected: number; sourceUrl: string }> {
  const sources: Record<string, { url: string; label: string }> = {
    "3|Ruby / Sapphire|Battle Tower": { url: "/data/facilities/gen3-rs.json", label: "Ruby / Sapphire Battle Tower" },
    "3|Emerald|Battle Frontier": { url: "/data/facilities/gen3.json", label: "Emerald Battle Frontier" },
    "3|FireRed / LeafGreen|Trainer Tower - Single Mode": { url: "/data/facilities/gen3-frlg-trainer-tower.json", label: "FireRed / LeafGreen Trainer Tower Single Mode" },
    "3|FireRed / LeafGreen|Trainer Tower - Double Mode": { url: "/data/facilities/gen3-frlg-trainer-tower.json", label: "FireRed / LeafGreen Trainer Tower Double Mode" },
    "3|FireRed / LeafGreen|Trainer Tower - Knockout Mode": { url: "/data/facilities/gen3-frlg-trainer-tower.json", label: "FireRed / LeafGreen Trainer Tower Knockout Mode" },
    "3|FireRed / LeafGreen|Trainer Tower - Mixed Mode": { url: "/data/facilities/gen3-frlg-trainer-tower.json", label: "FireRed / LeafGreen Trainer Tower Mixed Mode" },
    "4|Diamond / Pearl|Battle Tower": { url: "/data/facilities/gen4-dp.json", label: "Diamond / Pearl Battle Tower" },
    "4|Platinum|Battle Frontier": { url: "/data/facilities/gen4.json", label: "Platinum Battle Frontier" },
    "4|HeartGold / SoulSilver|Battle Frontier": { url: "/data/facilities/gen4.json", label: "HeartGold / SoulSilver Battle Frontier" },
    "5|Black / White|Battle Subway": { url: "/data/facilities/gen5.json", label: "Black / White Battle Subway" },
    "5|Black 2 / White 2|Battle Subway": { url: "/data/facilities/gen5.json", label: "Black 2 / White 2 Battle Subway" },
    "6|X / Y|Battle Maison": { url: "/data/facilities/gen6.json", label: "X / Y Battle Maison" },
    "6|Omega Ruby / Alpha Sapphire|Battle Maison": { url: "/data/facilities/gen6.json", label: "Omega Ruby / Alpha Sapphire Battle Maison" },
    "7|Sun / Moon|Battle Tree": { url: "/data/facilities/gen7-sm.json", label: "Sun / Moon Battle Tree" },
    "7|Ultra Sun / Ultra Moon|Battle Tree": { url: "/data/facilities/gen7-usum.json", label: "Ultra Sun / Ultra Moon Battle Tree" },
    "8|Sword / Shield|Battle Tower": { url: "/data/facilities/gen8-swsh.json", label: "Sword / Shield Battle Tower" },
    "8|Brilliant Diamond / Shining Pearl|Battle Tower": { url: "/data/facilities/gen8-bdsp.json", label: "Brilliant Diamond / Shining Pearl Battle Tower" },
    "9|Scarlet / Violet|Academy Ace Tournament": { url: "/data/facilities/gen9.json", label: "Scarlet / Violet Academy Ace Tournament" },
  };
  const source = sources[generation + "|" + gameVersion + "|" + facility];
  if (!source) throw new Error("Authentic opponent data is not available for " + gameVersion + " " + facility + ". No saved teams or generated stand-ins will be substituted.");
  const response = await fetch(source.url);
  if (!response.ok) throw new Error("Could not load " + source.label + " dataset (HTTP " + response.status + ").");
  const dataset = await response.json() as FacilityDataset & {
    modes?: Record<string, Array<{
      floor: number;
      challengeType: "SINGLE" | "DOUBLE" | "KNOCKOUT";
      trainers: Array<{
        name: string;
        trainerClass: string;
        pokemon: Array<{
          species: string; item: string; moves: string[]; abilityNum: number; nature: string; gender?: string;
          happiness: number; ivs: Record<string, number>; evs: Record<string, number>;
        }>;
      }>;
    }>>;
  };
  if (dataset.modes) {
    const floors = dataset.modes[facility];
    if (!floors?.length) throw new Error("The Trainer Tower dataset has no floor data for " + facility + ".");
    const dex = Dex.forGen(3);
    const idOf = (value: string) => value.toLowerCase().replace(/_/g, "");
    const trainerClassName = (value: string) => value.replace(/^RS_/, "").replace(/^PKMN_/, "POKEMON_").split("_")
      .map(part => part === "F" || part === "M" ? part : part.charAt(0) + part.slice(1).toLowerCase())
      .join(" ");
    const convertTowerSet = (raw: NonNullable<typeof floors>[number]["trainers"][number]["pokemon"][number]) => {
      const speciesId = raw.species === "NIDORAN_F" ? "nidoranfemale" : raw.species === "NIDORAN_M" ? "nidoranmale" : idOf(raw.species);
      const species = dex.species.get(speciesId);
      if (!species.exists) throw new Error("Unknown Trainer Tower species macro: " + raw.species);
      const moves = raw.moves.map(moveId => {
        const move = dex.moves.get(idOf(moveId));
        if (!move.exists) throw new Error("Unknown Trainer Tower move macro: " + moveId);
        return move.name;
      });
      const item = raw.item ? dex.items.get(idOf(raw.item)) : null;
      if (item && !item.exists) throw new Error("Unknown Trainer Tower item macro: " + raw.item);
      const ability = Object.entries(species.abilities).find(([key]) => key === String(raw.abilityNum))?.[1] || species.abilities["0"];
      if (!ability) throw new Error("No Generation 3 ability found for " + species.name + ".");
      return {
        name: species.name, species: species.name, ability, item: item?.name || "",
        nature: raw.nature.charAt(0) + raw.nature.slice(1).toLowerCase(),
        gender: raw.gender, happiness: raw.happiness, moves,
        ivs: raw.ivs, evs: raw.evs,
      } as Record<string, unknown>;
    };
    const opponents: BenchmarkOpponent[] = [];
    let sourceCount = 0;
    for (const floor of floors) {
      sourceCount += floor.trainers.length;
      const addOpponent = (name: string, sets: Record<string, unknown>[], format: string) => {
        opponents.push({
          id: "frlg-trainer-tower-" + facility.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-floor-" + floor.floor + "-" + opponents.length,
          name, sets, fixedTeam: true, format, scaleLevelToPlayer: true,
        });
      };
      if (floor.challengeType === "SINGLE") {
        const trainer = floor.trainers[0];
        addOpponent(
          "Floor " + floor.floor + " · " + trainerClassName(trainer.trainerClass) + " " + trainer.name,
          trainer.pokemon.map(convertTowerSet),
          "gen3customgame",
        );
      } else if (floor.challengeType === "DOUBLE") {
        const trainerNames = floor.trainers.map(trainer => trainerClassName(trainer.trainerClass) + " " + trainer.name);
        addOpponent(
          "Floor " + floor.floor + " · " + trainerNames.join(" & "),
          floor.trainers.flatMap(trainer => trainer.pokemon.map(convertTowerSet)),
          "gen3doublescustomgame",
        );
      } else {
        for (const trainer of floor.trainers) {
          addOpponent(
            "Floor " + floor.floor + " · " + trainerClassName(trainer.trainerClass) + " " + trainer.name + " (Knockout)",
            trainer.pokemon.map(convertTowerSet),
            "gen3customgame",
          );
        }
      }
    }
    return { opponents, sourceCount, rejected: 0, sourceUrl: source.url };
  }
  const setsByName = new Map(dataset.pokemon.map(set => [String(set.name).toLowerCase(), set]));
  const setsBySpeciesTier = new Map(dataset.pokemon.filter(set => set.tier !== undefined).map(set => [String(set.species).toLowerCase() + "-" + String(set.tier), set]));
  const opponents: BenchmarkOpponent[] = [];
  let rejected = 0;
  for (const trainer of dataset.trainers) {
    const rawSets = trainer.pokemon.map(name => {
      const key = name.toLowerCase();
      if (setsByName.has(key)) return setsByName.get(key);
      return setsBySpeciesTier.get(key);
    }).filter((set): set is FacilityDataset["pokemon"][number] => Boolean(set));
    if (!rawSets.length) { rejected++; continue; }
    const converted = rawSets.map(set => {
      const species = String(set.species || set.baseSpecies || set.name);
      const moves = Array.isArray(set.moves) ? set.moves.map(String) : [set.move1, set.move2, set.move3, set.move4].filter((move): move is string => typeof move === "string" && Boolean(move.trim()));
      const stats = (input?: Record<string, number>, fallback = 31) => input && Object.keys(input).length ? { hp: Number(input.hp ?? fallback), atk: Number(input.atk ?? fallback), def: Number(input.def ?? fallback), spa: Number(input.spa ?? fallback), spd: Number(input.spd ?? fallback), spe: Number(input.spe ?? fallback) } : undefined;
      return {
        name: species, species, ...(set.baseSpecies ? { baseSpecies: String(set.baseSpecies) } : {}), level: Number(set.level || trainer.level || 50),
        nature: String(set.nature || "Serious"), ability: String(set.ability || ""),
        item: String(set.item || ""), moves,
        ivs: { ...(stats(trainer.ivs) || { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }), ...(set.ivs as Record<string, number> | undefined) },
        evs: stats(set.evs as Record<string, number> | undefined, 0) || { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
      } as Record<string, unknown>;
    }).filter(set => Array.isArray(set.moves) && (set.moves as string[]).length > 0);
    if (!converted.length) { rejected++; continue; }
    const fixedTeam = Boolean(trainer.fixedTeam);
    const teamSize = Number(trainer.teamSize || (generation === 9 ? 6 : 3));
    if (fixedTeam && converted.length !== teamSize) { rejected++; continue; }
    if (!fixedTeam && new Set(converted.map(set => String(set.species).toLowerCase())).size < 3) { rejected++; continue; }
    const trainerName = generation === 6 && gameVersion === "Omega Ruby / Alpha Sapphire" && trainer.orasName ? trainer.orasName : trainer.name;
    const displayName = trainer.displayName || [trainer.trainerClass, trainerName].filter(Boolean).join(" ");
    opponents.push({
      id: "facility-" + generation + "-" + gameVersion + "-" + trainerName + "-" + opponents.length,
      name: displayName || "Facility Trainer " + (opponents.length + 1),
      sets: fixedTeam ? converted : converted.slice(0, 3),
      ...(fixedTeam ? { fixedTeam: true } : { teamPool: [converted] }),
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
  for (const side of ["player", "opponent"] as const) {
    for (const item of source.passiveDamage?.[side] || []) addPassiveDamage(target, side, item.source, item.damage);
    for (const item of source.passiveDamage?.[side] || []) {
      const merged = target.passiveDamage[side].find(entry => entry.source === item.source);
      if (merged) merged.hits += item.hits - 1;
    }
  }
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
  const recentBattleEvents: string[] = [];
  let outcome: "win" | "loss" | "tie" | null = null;
  const finished: Promise<{ outcome: "win" | "loss" | "tie"; analysis: BattleAnalysis }> = (async () => {
    for await (const chunk of streams.omniscient) {
      for (const line of String(chunk).split("\n")) {
        if (!line.startsWith("|")) continue;
        const parts = line.split("|");
        const tag = parts[1];
        recentBattleEvents.push(line);
        if (recentBattleEvents.length > 40) recentBattleEvents.shift();
        if (tag === "error") {
          throw new Error(`Showdown rejected a benchmark battle: ${parts.slice(2).join("|")}`);
        }
        if (tag === "win") {
          outcome = parts[2]?.trim() === "Benchmark Player" ? "win" : "loss";
          continue;
        }
        if (tag === "tie") {
          console.warn("[Benchmark] Showdown tie counted as a player loss.", {
            format,
            player: playerSets.map(rosterLabel),
            opponent: opponentSets.map(rosterLabel),
            recentEvents: [...recentBattleEvents],
          });
          outcome = normalizeBenchmarkOutcome("tie");
          continue;
        }
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
          const isPassiveSource = Boolean(sourceMarker && !sourceMarker.startsWith("[from] move:"));
          if (isPassiveSource) {
            let sourceLabel = sourceMarker!.slice("[from] ".length).replace(/^ability: /, "Ability: ").replace(/^item: /, "Item: ");
            if (sourceLabel === "psn" && /\btox\b/.test(String(parts[3] || ""))) sourceLabel = "Bad poison";
            addPassiveDamage(analysis, targetSide === "p1" ? "player" : "opponent", sourceLabel, damage);
          }
          if (source && source.ident.slice(0, 2) !== targetSide) {
            const sourceName = namesByIdent.get(source.ident) || identName(source.ident);
            const sourceSummary = source.ident.slice(0, 2) === "p1" ? analysis.player : analysis.opponent;
            addPokemonDamage(sourceSummary, sourceName, damage, 0, moveName || undefined);
            if (moveName) addMoveDamage(sourceSummary, moveName, damage);
          } else if (!isPassiveSource) {
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

export function createFacilityTeam(pool: Record<string, unknown>[], teamSize = 3): Record<string, unknown>[] {
  const shuffled = shuffledCopy(pool);
  const selected: Record<string, unknown>[] = [];
  const species = new Set<string>();
  const items = new Set<string>();
  for (const set of shuffled) {
    const speciesId = String(set.baseSpecies || set.species || set.name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const itemId = String(set.item || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (species.has(speciesId) || (itemId && items.has(itemId))) continue;
    species.add(speciesId);
    if (itemId) items.add(itemId);
    selected.push(set);
    if (selected.length === teamSize) break;
  }
  if (selected.length !== teamSize) throw new Error(`Facility pool could not produce a legal ${teamSize}-Pokémon roster without duplicate species or held items.`);
  return selected;
}

export function normalizeBenchmarkOutcome(outcome: "win" | "loss" | "tie"): "win" | "loss" {
  return outcome === "win" ? "win" : "loss";
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
      const playerTeam = args.playerSelectionSize
        ? createFacilityTeam(args.playerSets, Math.min(args.playerSelectionSize, args.playerSets.length))
        : args.playerSets;
      const rawBattleTeam = opponent.teamPool?.length ? createFacilityTeam(opponent.teamPool[0]) : opponent.sets;
      const playerMaxLevel = Math.max(1, ...playerTeam.map(set => Number(set.level) || 100));
      const battleTeam = opponent.scaleLevelToPlayer
        ? rawBattleTeam.map(set => ({ ...set, level: playerMaxLevel }))
        : rawBattleTeam;
      const battle = await playOneBattle(opponent.format || args.format, playerTeam, battleTeam);
      const outcome = normalizeBenchmarkOutcome(battle.outcome);
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
