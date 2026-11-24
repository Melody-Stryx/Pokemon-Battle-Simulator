import { Dex } from "@pkmn/dex";
import { RandomPlayerAI } from "@pkmn/sim";

type SideID = "p1" | "p2";
type PokemonView = { ident?: string; details?: string; condition?: string; active?: boolean; stats?: Record<string, number>; moves?: string[]; reviving?: boolean; [key: string]: unknown };
type MoveView = { move: string; disabled?: boolean; [key: string]: unknown };
type RequestView = { wait?: boolean; teamPreview?: boolean; forceSwitch?: boolean[]; active?: Array<{ moves?: MoveView[]; trapped?: boolean; canMegaEvo?: boolean; canDynamax?: boolean; canTerastallize?: boolean }>; side?: { pokemon: PokemonView[] } };

const toID = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const speciesName = (pokemon?: PokemonView) => (pokemon?.details || pokemon?.ident || "").split(",")[0].replace(/^p[1-4][a-z]?:\s*/i, "").trim();
const species = (name: string): any => Dex.species.get(name);
const move = (name: string): any => Dex.moves.get(name);
const hpRatio = (pokemon?: PokemonView) => {
  const value = pokemon?.condition || "";
  if (value.endsWith(" fnt")) return 0;
  const match = value.match(/^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)/);
  return match && Number(match[2]) ? Number(match[1]) / Number(match[2]) : 1;
};
function effectiveness(attackType: string, defendingTypes: string[]) {
  let result = 1;
  for (const type of defendingTypes) {
    const relation = (Dex.types.get(type) as any)?.damageTaken?.[attackType];
    if (relation === 1) result *= 2;
    else if (relation === 2) result *= 0.5;
    else if (relation === 3) return 0;
  }
  return result;
}
type Foe = { species: string; teraType?: string; hp: number } | null;
function getFoe(log: string[], ownSide: SideID): Foe {
  const foeSide = ownSide === "p1" ? "p2" : "p1";
  let foe: Foe = null;
  for (const line of log) {
    const p = line.split("|");
    if (["switch", "drag", "replace"].includes(p[1]) && p[2]?.startsWith(foeSide)) {
      foe = { species: speciesName({ details: p[3], ident: p[2] }), hp: hpRatio({ condition: p[4] }) };
    } else if (p[1] === "detailschange" && p[2]?.startsWith(foeSide) && foe) {
      foe.species = speciesName({ details: p[3] });
    } else if (p[1] === "-terastallize" && p[2]?.startsWith(foeSide) && foe) {
      foe.teraType = p[3];
    } else if (p[1] === "faint" && p[2]?.startsWith(foeSide)) {
      foe = null;
    }
  }
  return foe;
}
function foeTypes(foe: Foe) {
  if (!foe) return [];
  return foe.teraType ? [foe.teraType] : (species(foe.species)?.types || []);
}
function moveScore(moveName: string, attackerName: string, defender: Foe, attackerStats?: Record<string, number>, ownHP = 1) {
  const data = move(moveName);
  if (!data?.exists) return 0;
  if (data.category === "Status" || !data.basePower) {
    let score = 6;
    if (data.heal) score += 20 + (1 - ownHP) * 95;
    if (data.boosts) score += Object.values(data.boosts as Record<string, number>).reduce((sum, n) => sum + Math.max(0, n) * 18, 0);
    if (data.status || data.volatileStatus) score += 27;
    if (data.sideCondition || data.pseudoWeather) score += 25;
    if (data.forceSwitch || data.taunt || data.encore || data.disable) score += 24;
    if (data.weather || data.terrain) score += 15;
    if (data.self?.boosts) score += 14;
    return score;
  }
  const attacker = species(attackerName);
  const defenderData = defender ? species(defender.species) : null;
  const type = data.type || "Normal";
  const types = foeTypes(defender);
  const effectivenessMultiplier = types.length ? effectiveness(type, types) : 1;
  if (!effectivenessMultiplier) return 0;
  const stab = attacker?.types?.includes(type) ? 1.5 : 1;
  const accuracy = typeof data.accuracy === "number" ? data.accuracy / 100 : 1;
  const physical = data.category === "Physical";
  const attackingStat = physical ? (attackerStats?.atk || attacker?.baseStats?.atk || 80) : (attackerStats?.spa || attacker?.baseStats?.spa || 80);
  const defendingStat = physical ? (defenderData?.baseStats?.def || 90) : (defenderData?.baseStats?.spd || 90);
  const statRatio = Math.max(0.65, Math.min(1.45, attackingStat / Math.max(1, defendingStat)));
  const hits = Array.isArray(data.multihit) ? (data.multihit[0] + data.multihit[1]) / 2 : (typeof data.multihit === "number" ? data.multihit : 1);
  let score = data.basePower * effectivenessMultiplier * stab * accuracy * statRatio * hits;
  score += Math.max(0, data.priority || 0) * 8;
  if (data.drain) score *= 1.12;
  if (data.recoil) score *= 0.88;
  if (data.secondary?.chance >= 30) score *= 1.05;
  if (["knockoff", "rapidspin", "defog", "uturn", "voltswitch", "flipturn"].includes(toID(moveName))) score += 12;
  return score;
}
function bestAttack(pokemon: PokemonView, foe: Foe) {
  const name = speciesName(pokemon);
  return Math.max(0, ...(pokemon.moves || []).map(nameOfMove => moveScore(nameOfMove, name, foe, pokemon.stats, hpRatio(pokemon))));
}
function scoreSwitch(pokemon: PokemonView, foe: Foe) {
  const name = speciesName(pokemon);
  const data = species(name);
  if (!data?.exists) return -Infinity;
  const incoming = foeTypes(foe).length ? Math.max(...foeTypes(foe).map((type: string) => effectiveness(type, data.types || []))) : 1;
  const speed = pokemon.stats?.spe || data.baseStats?.spe || 70;
  const foeSpeed = foe ? species(foe.species)?.baseStats?.spe || 70 : 70;
  return bestAttack(pokemon, foe) * 0.78 + (2 - incoming) * 28 + hpRatio(pokemon) * 18 + (speed > foeSpeed ? 7 : 0);
}
function previewOrder(team: PokemonView[], log: string[], side: SideID) {
  const foeSide = side === "p1" ? "p2" : "p1";
  const foeRoster: string[] = [];
  for (const line of log) {
    const p = line.split("|");
    if (p[1] === "poke" && p[2] === foeSide && p[3]) foeRoster.push(p[3].split(",")[0]);
  }
  const foeTypes = foeRoster.flatMap(name => species(name)?.types || []);
  return team.map((pokemon, i) => {
    const name = speciesName(pokemon);
    const data = species(name);
    const coverage = foeTypes.length
      ? Math.max(0, ...(pokemon.moves || []).flatMap(m => foeTypes.map(t => moveScore(m, name, { species: "Unknown", hp: 1 }, pokemon.stats) * effectiveness((move(m) as any)?.type || "Normal", [t]))))
      : bestAttack(pokemon, null);
    const speed = data?.baseStats?.spe || 70;
    const bulk = ((data?.baseStats?.hp || 70) + (data?.baseStats?.def || 70) + (data?.baseStats?.spd || 70)) / 3;
    return { slot: i + 1, score: coverage * 0.55 + speed * 0.35 + bulk * 0.1 + hpRatio(pokemon) * 20 };
  }).sort((a, b) => b.score - a.score).map(x => x.slot).join("");
}
export function chooseTacticalChoice(request: RequestView, log: string[], side: SideID): string {
  const team = request.side?.pokemon || [];
  if (request.wait) return "pass";
  if (request.teamPreview) return `team ${previewOrder(team, log, side)}`;
  const foe = getFoe(log, side);
  if (request.forceSwitch?.length) {
    const used: number[] = [];
    return request.forceSwitch.map(mustSwitch => {
      if (!mustSwitch) return "pass";
      const choices = team.map((pokemon, i) => ({ pokemon, slot: i + 1 }))
        .filter(x => !x.pokemon.active && !used.includes(x.slot) && hpRatio(x.pokemon) > 0);
      if (!choices.length) return "pass";
      const best = choices.sort((a, b) => scoreSwitch(b.pokemon, foe) - scoreSwitch(a.pokemon, foe))[0];
      used.push(best.slot);
      return `switch ${best.slot}`;
    }).join(", ");
  }
  if (!request.active?.length) return "pass";
  const choices: string[] = [];
  for (let i = 0; i < request.active.length; i++) {
    const active = request.active[i];
    const own = team.find(p => p.active) || team[i];
    const ownName = speciesName(own);
    const moves = (active.moves || []).map((option, index) => ({ option, slot: index + 1 }))
      .filter(x => !x.option.disabled)
      .map(x => ({ ...x, score: moveScore(x.option.move, ownName, foe, own?.stats, hpRatio(own)) }))
      .sort((a, b) => b.score - a.score);
    if (!moves.length) { choices.push("pass"); continue; }
    const bestMove = moves[0];
    const switches = active.trapped ? [] : team.map((pokemon, index) => ({ pokemon, slot: index + 1 }))
      .filter(x => !x.pokemon.active && hpRatio(x.pokemon) > 0)
      .map(x => ({ ...x, score: scoreSwitch(x.pokemon, foe) }))
      .sort((a, b) => b.score - a.score);
    if (switches.length && foe) {
      const currentSpecies = species(ownName);
      const incoming = foeTypes(foe).length
        ? Math.max(...foeTypes(foe).map(type => effectiveness(type, currentSpecies?.types || []))) : 1;
      const bestSwitch = switches[0];
      if ((incoming >= 2 && hpRatio(own) < 0.72) || bestSwitch.score > bestMove.score * 1.18 + 28) {
        choices.push(`switch ${bestSwitch.slot}`);
        continue;
      }
    }
    let choice = `move ${bestMove.slot}`;
    if (active.canMegaEvo) choice += " mega";
    else if (active.canDynamax && (hpRatio(own) < 0.65 || bestMove.score >= 100)) choice += " dynamax";
    else if (active.canTerastallize && foe && bestMove.score >= 95) choice += " terastallize";
    choices.push(choice);
  }
  return choices.join(", ");
}
export class TacticalPlayerAI extends RandomPlayerAI {
  private readonly side: SideID;
  constructor(stream: any, side: SideID) {
    super(stream, { move: 1 });
    this.side = side;
  }
  override receiveRequest(request: any) {
    if (request.wait) return;
    this.choose(chooseTacticalChoice(request as RequestView, this.log, this.side));
  }
}
