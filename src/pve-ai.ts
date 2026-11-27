import { Dex } from "@pkmn/dex";
import { RandomPlayerAI } from "@pkmn/sim";

type SideID = "p1" | "p2";
type PokemonView = { ident?: string; details?: string; condition?: string; active?: boolean; stats?: Record<string, number>; moves?: string[]; reviving?: boolean; [key: string]: unknown };
type MoveView = { move: string; disabled?: boolean; [key: string]: unknown };
type RequestView = { wait?: boolean; teamPreview?: boolean; maxTeamSize?: number; forceSwitch?: boolean[]; active?: Array<{ moves?: MoveView[]; trapped?: boolean; canMegaEvo?: boolean; canDynamax?: boolean; canTerastallize?: boolean }>; side?: { pokemon: PokemonView[] } };

const toID = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const speciesName = (pokemon?: PokemonView) => (pokemon?.details || pokemon?.ident || "").split(",")[0].replace(/^p[1-4][a-z]?:\s*/i, "").trim();
const generationDex = (generation: number) => Dex.forGen(Math.max(1, Math.min(9, generation)));
const species = (name: string, generation: number): any => generationDex(generation).species.get(name);
const move = (name: string, generation: number): any => generationDex(generation).moves.get(name);
const hpRatio = (pokemon?: PokemonView) => {
  const value = pokemon?.condition || "";
  if (value.endsWith(" fnt")) return 0;
  const match = value.match(/^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)/);
  return match && Number(match[2]) ? Number(match[1]) / Number(match[2]) : 1;
};
function effectiveness(attackType: string, defendingTypes: string[], generation: number) {
  let result = 1;
  for (const type of defendingTypes) {
    const relation = (generationDex(generation).types.get(type) as any)?.damageTaken?.[attackType];
    if (relation === 1) result *= 2;
    else if (relation === 2) result *= 0.5;
    else if (relation === 3) return 0;
  }
  return result;
}
type Foe = { species: string; teraType?: string; ability?: string; status?: string; sideConditions?: Record<string, number>; hp: number } | null;
function getFoe(log: string[], ownSide: SideID, generationForAbilityInference: number): Foe {
  const foeSide = ownSide === "p1" ? "p2" : "p1";
  let foe: Foe = null;
  const foeSideConditions: Record<string, number> = {};
  for (const line of log) {
    const p = line.split("|");
    if (["switch", "drag", "replace"].includes(p[1]) && p[2]?.startsWith(foeSide)) {
      const foeSpecies = species(speciesName({ details: p[3], ident: p[2] }), generationForAbilityInference);
      const abilityOptions: string[] = foeSpecies?.abilities ? [...new Set(Object.values(foeSpecies.abilities).map(value => String(value)).filter(Boolean))] : [];
      foe = {
        species: speciesName({ details: p[3], ident: p[2] }),
        hp: hpRatio({ condition: p[4] }),
        sideConditions: foeSideConditions,
        ability: abilityOptions.length === 1 ? abilityOptions[0] : undefined,
      };
    } else if (p[1] === "detailschange" && p[2]?.startsWith(foeSide) && foe) {
      foe.species = speciesName({ details: p[3] });
    } else if (p[1] === "-terastallize" && p[2]?.startsWith(foeSide) && foe) {
      foe.teraType = p[3];
    } else if (p[1] === "-ability" && p[2]?.startsWith(foeSide) && foe) {
      foe.ability = p[3];
    } else if (p[1] === "-status" && p[2]?.startsWith(foeSide) && foe) {
      foe.status = p[3];
    } else if (p[1] === "-curestatus" && p[2]?.startsWith(foeSide) && foe) {
      foe.status = undefined;
    } else if (p[1] === "-sidestart" && p[2]?.startsWith(foeSide)) {
      const condition = toID((p[3] || "").replace(/^move: /, ""));
      if (condition) foeSideConditions[condition] = (foeSideConditions[condition] || 0) + 1;
    } else if (p[1] === "-sideend" && p[2]?.startsWith(foeSide)) {
      const condition = toID((p[3] || "").replace(/^move: /, ""));
      delete foeSideConditions[condition];
    } else if (p[1] === "faint" && p[2]?.startsWith(foeSide)) {
      foe = null;
    }
  }
  return foe;
}
function foeTypes(foe: Foe, generation: number) {
  if (!foe) return [];
  return foe.teraType ? [foe.teraType] : (species(foe.species, generation)?.types || []);
}
function moveScore(moveName: string, attackerName: string, defender: Foe, generation: number, attackerStats?: Record<string, number>, ownHP = 1) {
  const data = move(moveName, generation);
  if (!data?.exists) return 0;
  if (data.category === "Status" || !data.basePower) {
    let score = 6;
    if (data.heal) score += 20 + (1 - ownHP) * 95;
    if (data.boosts) score += Object.values(data.boosts as Record<string, number>).reduce((sum, n) => sum + Math.max(0, n) * 18, 0);
    if (data.status || data.volatileStatus) {
      if (data.status && defender) {
        if (defender.status) return 0;
        const status = toID(String(data.status));
        const types = foeTypes(defender, generation);
        if ((status === "psn" || status === "tox") && types.some((type: string) => type === "Poison" || type === "Steel")) return 0;
        if (status === "brn" && types.includes("Fire")) return 0;
        if (status === "par" && generation >= 6 && types.includes("Electric")) return 0;
        const abilityStatusImmunities: Record<string, string[]> = {
          immunity: ["psn", "tox"], waterveil: ["brn"], waterbubble: ["brn"],
          limber: ["par"], insomnia: ["slp"], vitalspirit: ["slp"],
          purifyingsalt: ["psn", "tox", "brn", "par", "slp", "frz"],
          comatose: ["psn", "tox", "brn", "par", "slp", "frz"],
        };
        if ((abilityStatusImmunities[toID(defender.ability || "")] || []).includes(status)) return 0;
      }
      score += 27;
    }
    if (data.sideCondition) {
      const condition = toID(String(data.sideCondition));
      const layers = defender?.sideConditions?.[condition] || 0;
      const maximum = condition === "spikes" ? 3 : condition === "toxicspikes" ? 2 : 1;
      if (layers >= maximum) return 0;
      score += 25 - layers * 5;
    }
    if (data.pseudoWeather) score += 25;
    if (data.forceSwitch || data.taunt || data.encore || data.disable) score += 24;
    if (data.weather || data.terrain) score += 15;
    if (data.self?.boosts) score += 14;
    return score;
  }
  const attacker = species(attackerName, generation);
  const defenderData = defender ? species(defender.species, generation) : null;
  const type = data.type || "Normal";
  const types = foeTypes(defender, generation);
  const effectivenessMultiplier = types.length ? effectiveness(type, types, generation) : 1;
  if (!effectivenessMultiplier) return 0;
  const abilityId = toID(defender?.ability || "");
  const abilityImmunities: Record<string, string[]> = {
    levitate: ["Ground"],
    flashfire: ["Fire"],
    waterabsorb: ["Water"], stormdrain: ["Water"], dryskin: ["Water"],
    voltabsorb: ["Electric"], lightningrod: ["Electric"], motordrive: ["Electric"],
    sapsipper: ["Grass"], wellbakedbody: ["Fire"], eartheater: ["Ground"],
  };
  if ((abilityImmunities[abilityId] || []).includes(type)) return 0;
  if (abilityId === "wonderguard" && effectivenessMultiplier <= 1) return 0;
  const stab = attacker?.types?.includes(type) ? 1.5 : 1;
  const accuracy = typeof data.accuracy === "number" ? data.accuracy / 100 : 1;
  const physical = data.category === "Physical";
  const attackingStat = physical ? (attackerStats?.atk || attacker?.baseStats?.atk || 80) : (attackerStats?.spa || attacker?.baseStats?.spa || 80);
  const defendingStat = physical ? (defenderData?.baseStats?.def || 90) : (defenderData?.baseStats?.spd || 90);
  const statRatio = Math.max(0.65, Math.min(1.45, attackingStat / Math.max(1, defendingStat)));
  const hits = Array.isArray(data.multihit) ? (data.multihit[0] + data.multihit[1]) / 2 : (typeof data.multihit === "number" ? data.multihit : 1);
  let score = data.basePower * effectivenessMultiplier * stab * accuracy * statRatio * hits;
  if ((abilityId === "thickfat" && (type === "Fire" || type === "Ice")) || (abilityId === "heatproof" && type === "Fire")) score *= 0.5;
  if (abilityId === "dryskin" && type === "Fire") score *= 1.25;
  if (abilityId === "fluffy" && type === "Fire") score *= 2;
  score += Math.max(0, data.priority || 0) * 8;
  if (data.drain) score *= 1.12;
  if (data.recoil) score *= 0.88;
  if (data.secondary?.chance >= 30) score *= 1.05;
  if (["knockoff", "rapidspin", "defog", "uturn", "voltswitch", "flipturn"].includes(toID(moveName))) score += 12;
  return score;
}
function bestAttack(pokemon: PokemonView, foe: Foe, generation: number) {
  const name = speciesName(pokemon);
  return Math.max(0, ...(pokemon.moves || []).map(nameOfMove => moveScore(nameOfMove, name, foe, generation, pokemon.stats, hpRatio(pokemon))));
}
function scoreSwitch(pokemon: PokemonView, foe: Foe, generation: number) {
  const name = speciesName(pokemon);
  const data = species(name, generation);
  if (!data?.exists) return -Infinity;
  const incoming = foeTypes(foe, generation).length ? Math.max(...foeTypes(foe, generation).map((type: string) => effectiveness(type, data.types || [], generation))) : 1;
  const speed = pokemon.stats?.spe || data.baseStats?.spe || 70;
  const foeSpeed = foe ? species(foe.species, generation)?.baseStats?.spe || 70 : 70;
  return bestAttack(pokemon, foe, generation) * 0.78 + (2 - incoming) * 28 + hpRatio(pokemon) * 18 + (speed > foeSpeed ? 7 : 0);
}
function previewOrder(team: PokemonView[], log: string[], side: SideID, generation: number) {
  const foeSide = side === "p1" ? "p2" : "p1";
  const foeRoster: string[] = [];
  for (const line of log) {
    const p = line.split("|");
    if (p[1] === "poke" && p[2] === foeSide && p[3]) foeRoster.push(p[3].split(",")[0]);
  }
  const foeTypesList = foeRoster.flatMap(name => species(name, generation)?.types || []);
  return team.map((pokemon, i) => {
    const name = speciesName(pokemon);
    const data = species(name, generation);
    const coverage = foeTypesList.length
      ? Math.max(0, ...(pokemon.moves || []).flatMap(m => foeTypesList.map(t => moveScore(m, name, { species: "Unknown", hp: 1 }, generation, pokemon.stats) * effectiveness((move(m, generation) as any)?.type || "Normal", [t], generation))))
      : bestAttack(pokemon, null, generation);
    const speed = data?.baseStats?.spe || 70;
    const bulk = ((data?.baseStats?.hp || 70) + (data?.baseStats?.def || 70) + (data?.baseStats?.spd || 70)) / 3;
    return { slot: i + 1, score: coverage * 0.55 + speed * 0.35 + bulk * 0.1 + hpRatio(pokemon) * 20 };
  }).sort((a, b) => b.score - a.score).map(x => x.slot).join("");
}
export function chooseTacticalChoice(request: RequestView, log: string[], side: SideID, generation = 9): string {
  const team = request.side?.pokemon || [];
  if (request.wait) return "pass";
  if (request.teamPreview) return `team ${previewOrder(team, log, side, generation).slice(0, request.maxTeamSize || team.length)}`;
  const foe = getFoe(log, side, generation);
  if (request.forceSwitch?.length) {
    const used: number[] = [];
    return request.forceSwitch.map(mustSwitch => {
      if (!mustSwitch) return "pass";
      const choices = team.map((pokemon, i) => ({ pokemon, slot: i + 1 }))
        .filter(x => !x.pokemon.active && !used.includes(x.slot) && hpRatio(x.pokemon) > 0);
      if (!choices.length) return "pass";
      const best = choices.sort((a, b) => scoreSwitch(b.pokemon, foe, generation) - scoreSwitch(a.pokemon, foe, generation))[0];
      used.push(best.slot);
      return `switch ${best.slot}`;
    }).join(", ");
  }
  if (!request.active?.length) return "pass";
  const choices: string[] = [];
  for (let i = 0; i < request.active.length; i++) {
    const active = request.active[i];
    const own = team.filter(p => p.active)[i] || team[i] || team.find(p => p.active);
    const ownName = speciesName(own);
    const moves = (active.moves || []).map((option, index) => ({ option, slot: index + 1 }))
      .filter(x => !x.option.disabled)
      .map(x => ({ ...x, score: moveScore(x.option.move, ownName, foe, generation, own?.stats, hpRatio(own)) }))
      .sort((a, b) => b.score - a.score);
    if (!moves.length) { choices.push("pass"); continue; }
    const bestMove = moves[0];
    const switches = active.trapped ? [] : team.map((pokemon, index) => ({ pokemon, slot: index + 1 }))
      .filter(x => !x.pokemon.active && hpRatio(x.pokemon) > 0)
      .map(x => ({ ...x, score: scoreSwitch(x.pokemon, foe, generation) }))
      .sort((a, b) => b.score - a.score);
    if (switches.length && foe) {
      const currentSpecies = species(ownName, generation);
      const incoming = foeTypes(foe, generation).length
        ? Math.max(...foeTypes(foe, generation).map((type: string) => effectiveness(type, currentSpecies?.types || [], generation))) : 1;
      const bestSwitch = switches[0];
      if ((incoming >= 2 && hpRatio(own) < 0.72) || bestSwitch.score > bestMove.score * 1.18 + 28) {
        choices.push(`switch ${bestSwitch.slot}`);
        continue;
      }
    }
    const moveTarget = String((move(bestMove.option.move, generation) as any)?.target || "");
    const needsExplicitTarget = request.active.length > 1 && ["normal", "adjacentFoe", "any", "adjacentAlly", "adjacentAllyOrSelf"].includes(moveTarget);
    const targetLocation = moveTarget === "adjacentAlly" || moveTarget === "adjacentAllyOrSelf" ? (i === 0 ? -2 : -1) : 1;
    let choice = `move ${bestMove.slot}${needsExplicitTarget ? ` ${targetLocation}` : ""}`;
    if (active.canMegaEvo) choice += " mega";
    else if (active.canDynamax && (hpRatio(own) < 0.65 || bestMove.score >= 100)) choice += " dynamax";
    else if (active.canTerastallize && foe && bestMove.score >= 95) choice += " terastallize";
    choices.push(choice);
  }
  return choices.join(", ");
}
export class TacticalPlayerAI extends RandomPlayerAI {
  private readonly side: SideID;
  private readonly generation: number;
  constructor(stream: any, side: SideID, generation = 9) {
    super(stream, { move: 1 });
    this.side = side;
    this.generation = generation;
  }
  override receiveRequest(request: any) {
    if (request.wait) return;
    this.choose(chooseTacticalChoice(request as RequestView, this.log, this.side, this.generation));
  }
}
