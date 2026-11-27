import { useEffect, useMemo, useRef, useState } from "react";
import { Dex } from "@pkmn/dex";
import { BattleStreams, TeamValidator, Teams } from "@pkmn/sim";
import { TacticalPlayerAI, chooseTacticalChoice } from "./pve-ai";
import { loadCompleteOpponentPool, loadFacilityOpponentPool, loadMetaPokemonPool, runExhaustiveBenchmark, type BenchmarkProgress, type BenchmarkOpponent } from "./benchmark";

declare const __BUILD_NUMBER__: string;
type BattleType = "PvP" | "PvE";
type BattleMode = "Auto" | "Manual";
type BenchmarkMode = "Teams" | "Single Pokémon";
type Page = "Overview" | "Team Builder" | "Legality analysis" | "Simulator" | "Matchup Analysis";
const generations = Array.from({ length: 9 }, (_, i) => i + 1);
const tiers = ["Anything Goes", "Ubers", "OU", "UU", "RU", "NU", "PU", "ZU", "Little Cup", "Battle Spot Singles", "VGC", "Custom"];
const facilityOptionsByGame: Record<number, Record<string, string[]>> = {
  3: { "Ruby / Sapphire": ["Battle Tower"], "Emerald": ["Battle Frontier"] },
  4: { "Diamond / Pearl": ["Battle Tower"], "Platinum": ["Battle Frontier"], "HeartGold / SoulSilver": ["Battle Frontier"] },
  5: { "Black / White": ["Battle Subway"], "Black 2 / White 2": ["Battle Subway"] },
  6: { "X / Y": ["Battle Maison"], "Omega Ruby / Alpha Sapphire": ["Battle Maison"] },
  7: { "Sun / Moon": ["Battle Tree"], "Ultra Sun / Ultra Moon": ["Battle Tree"] },
  8: { "Sword / Shield": ["Battle Tower"], "Brilliant Diamond / Shining Pearl": ["Battle Tower"] },
  9: { "Scarlet / Violet": ["Academy Ace Tournament"] },
};
function facilitiesFor(generation: number, gameVersion: string) {
  return facilityOptionsByGame[generation]?.[gameVersion] || [];
}
const gameVersions: Record<number, string[]> = {
  1: ["Red / Blue", "Yellow"], 2: ["Gold / Silver", "Crystal"],
  3: ["Ruby / Sapphire", "Emerald", "FireRed / LeafGreen"],
  4: ["Diamond / Pearl", "Platinum", "HeartGold / SoulSilver"],
  5: ["Black / White", "Black 2 / White 2"],
  6: ["X / Y", "Omega Ruby / Alpha Sapphire"],
  7: ["Sun / Moon", "Ultra Sun / Ultra Moon"],
  8: ["Sword / Shield", "Brilliant Diamond / Shining Pearl"],
  9: ["Scarlet / Violet"],
};
type Settings = { generation: number; gameVersion: string; battleType: BattleType; tier: string; facility: string; mode: BattleMode };
const defaults: Settings = { generation: 9, gameVersion: "Scarlet / Violet", battleType: "PvP", tier: "OU", facility: "Academy Ace Tournament", mode: "Auto" };
function normalizeSettings(s: Settings): Settings {
  const generation = s.battleType === "PvE" && s.generation < 3 ? 3 : s.generation;
  const versions = gameVersions[generation] || [];
  const gameVersion = versions.includes(s.gameVersion) ? s.gameVersion : (versions[0] || "");
  const facilities = facilitiesFor(generation, gameVersion);
  return { ...s, generation, gameVersion, facility: facilities.includes(s.facility) ? s.facility : (facilities[0] || "") };
}
function readSettings(): Settings { try { const saved = localStorage.getItem("battle-lab-settings"); return saved ? normalizeSettings({ ...defaults, ...JSON.parse(saved) }) : defaults; } catch { return defaults; } }

type PokemonBuild = {
  id: string; name: string; label: string; nickname: string; level: number; gender: string; ability: string; nature: string; item: string;
  moves: string[]; evs: Record<string, number>; ivs: Record<string, number>; shiny: boolean; happiness: number; teraType: string;
};
type TeamSlot = { id: string; builds: PokemonBuild[]; activeBuildId: string };
type Team = { id: string; name: string; slots: TeamSlot[]; updatedAt: string };
type BattleRequest = { active?: Array<{ moves: Array<{ move: string; id?: string; disabled?: boolean; pp?: number; maxpp?: number }> }>; side?: { pokemon: Array<{ ident: string; details: string; condition: string; active?: boolean }> }; forceSwitch?: boolean[]; teamPreview?: boolean; maxTeamSize?: number; wait?: boolean };
type BattleController = { streams: any; stopped: boolean };
type OnlineOpponent = { name: string; author?: string; format: string; source: string; sets: Record<string, unknown>[] };
type MatchupAnalysisRun = BenchmarkProgress & {
  id: string;
  createdAt: string;
  playerTeamId: string;
  playerTeamName: string;
  generation: number;
  gameVersion: string;
  battleType: BattleType;
  tier: string;
  facility: string;
  opponentSource: string;
  sourceCount: number;
  validCount: number;
  rejected: number;
  sourceUrl: string;
  benchmarkMode?: BenchmarkMode;
};
function readMatchupRun(): MatchupAnalysisRun | null {
  try { const value = localStorage.getItem("battle-lab-matchup-results"); return value ? JSON.parse(value) as MatchupAnalysisRun : null; }
  catch { return null; }
}
const defaultBattleMusicUrl = "https://nu.vgmtreasurechest.com/soundtracks/pokemon-heartgold-and-soulsilver/nyaijyqjri/15.%20Pok%C3%A9mon%20Center.mp3";
const statNames = ["HP", "Atk", "Def", "SpA", "SpD", "Spe"];
const hiddenPowerTypes = ["Fighting","Flying","Poison","Ground","Rock","Bug","Ghost","Steel","Fire","Water","Grass","Electric","Psychic","Ice","Dragon","Dark"];
function hiddenPowerTypeFromMove(move: string) {
  const normalized = move.toLowerCase().replaceAll("[", " ").replaceAll("]", " ").trim().split(" ").filter(Boolean).join(" ");
  const match = normalized.match(/^hidden power (.+)$/);
  if (!match) return undefined;
  return hiddenPowerTypes.find(type => type.toLowerCase() === match[1]);
}
function hiddenPowerTypeFromIvs(ivs: Record<string, number>) {
  const bits = ["HP","Atk","Def","Spe","SpA","SpD"].reduce((value, stat, index) => value + ((ivs[stat] || 0) % 2) * (2 ** index), 0);
  return hiddenPowerTypes[Math.floor(bits * 15 / 63)];
}
function ivsForHiddenPowerType(type: string, current: Record<string, number>) {
  const target = hiddenPowerTypes.indexOf(type);
  if (target < 0) return current;
  const stats = ["HP","Atk","Def","Spe","SpA","SpD"];
  let best = { ivs: current, cost: Number.POSITIVE_INFINITY, total: -1 };
  for (let mask = 0; mask < 64; mask++) {
    const bits = stats.reduce((value, _stat, index) => value + (((mask >> index) & 1) * (2 ** index)), 0);
    if (Math.floor(bits * 15 / 63) !== target) continue;
    const next = { ...current };
    let cost = 0, total = 0;
    for (let index = 0; index < stats.length; index++) {
      const stat = stats[index], parity = (mask >> index) & 1;
      const old = Math.max(0, Math.min(31, Number(current[stat] ?? 31)));
      const lower = old - ((old % 2) !== parity ? 1 : 0);
      const upper = lower + 2;
      const chosen = [lower, upper].filter(value => value >= 0 && value <= 31).sort((a,b) => Math.abs(a-old)-Math.abs(b-old) || b-a)[0] ?? (parity ? 31 : 30);
      next[stat] = chosen;
      cost += Math.abs(chosen - old);
      total += chosen;
    }
    if (cost < best.cost || (cost === best.cost && total > best.total)) best = { ivs: next, cost, total };
  }
  return best.ivs;
}
const natures = ["Hardy","Lonely","Brave","Adamant","Naughty","Bold","Docile","Relaxed","Impish","Lax","Timid","Hasty","Serious","Jolly","Naive","Modest","Mild","Quiet","Bashful","Rash","Calm","Gentle","Sassy","Careful","Quirky"];
const uid = () => crypto.randomUUID();
const natureChanges: Record<string, [string, string]> = {
  Lonely: ["atk", "def"], Brave: ["atk", "spe"], Adamant: ["atk", "spa"], Naughty: ["atk", "spd"],
  Bold: ["def", "atk"], Relaxed: ["def", "spe"], Impish: ["def", "spa"], Lax: ["def", "spd"],
  Timid: ["spe", "atk"], Hasty: ["spe", "def"], Jolly: ["spe", "spa"], Naive: ["spe", "spd"],
  Modest: ["spa", "atk"], Mild: ["spa", "def"], Quiet: ["spa", "spe"], Rash: ["spa", "spd"],
  Calm: ["spd", "atk"], Gentle: ["spd", "def"], Sassy: ["spd", "spe"], Careful: ["spd", "spa"],
};
function calculateFinalStat(base: number, iv: number, ev: number, level: number, stat: string, nature: string) {
  const value = Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100);
  if (stat === "hp") return base === 1 && stat === "hp" ? 1 : value + level + 10;
  const [up, down] = natureChanges[nature] || ["", ""];
  const natureModifier = stat === up ? 1.1 : stat === down ? 0.9 : 1;
  return Math.floor((value + 5) * natureModifier);
}
function calculateBattleStat(value: number, stat: string, ability: string, item: string) {
  let result = value;
  const abilityName = ability.toLowerCase();
  const itemName = item.toLowerCase();
  if (stat === "atk") {
    if (abilityName === "huge power" || abilityName === "pure power") result = Math.floor(result * 2);
    if (abilityName === "gorilla tactics") result = Math.floor(result * 1.5);
    if (itemName === "choice band") result = Math.floor(result * 1.5);
  }
  if (stat === "def") {
    if (abilityName === "fur coat") result = Math.floor(result * 2);
  }
  if (stat === "spa") {
    if (itemName === "choice specs") result = Math.floor(result * 1.5);
  }
  if (stat === "spe") {
    if (itemName === "choice scarf") result = Math.floor(result * 1.5);
  }
  return result;
}
function newBuild(name = ""): PokemonBuild {
  return { id: uid(), name, label: "", nickname: "", level: 100, gender: "", ability: "", nature: "Hardy", item: "", moves: ["","","",""], evs: { HP:0, Atk:0, Def:0, SpA:0, SpD:0, Spe:0 }, ivs: { HP:31, Atk:31, Def:31, SpA:31, SpD:31, Spe:31 }, shiny: false, happiness: 255, teraType: "" };
}
function readTeams(): Team[] { try { return JSON.parse(localStorage.getItem("battle-lab-teams") || "[]"); } catch { return []; } }
function activeBuild(slot: TeamSlot) { return slot.builds.find(b => b.id === slot.activeBuildId) || slot.builds[0]; }
function formatBattleLine(line: string): string {
  const parts = line.split("|");
  const tag = parts[1];
  const pokemonName = (value: string) => value?.split(": ").slice(1).join(": ") || value || "Pokémon";
  if (tag === "turn") return `Turn ${parts[2]}`;
  if (tag === "player") return `${parts[3]} joined the battle`;
  if (tag === "switch" || tag === "drag") return `${pokemonName(parts[2])} entered the battle (${parts[4] || parts[3] || ""})`;
  if (tag === "move") return `${pokemonName(parts[2])} used ${parts[3]}`;
  if (tag === "-damage") return `${pokemonName(parts[2])} took damage (${parts[3]})`;
  if (tag === "-heal") return `${pokemonName(parts[2])} recovered HP (${parts[3]})`;
  if (tag === "faint") return `${pokemonName(parts[2])} fainted`;
  if (tag === "win") return `${parts[2]} wins`;
  if (tag === "tie") return "The battle ended in a tie";
  if (tag === "-status") return `${pokemonName(parts[2])} was afflicted with ${parts[3]}`;
  if (tag === "-curestatus") return `${pokemonName(parts[2])} recovered from ${parts[3]}`;
  if (tag === "-boost" || tag === "-unboost") return `${pokemonName(parts[2])}'s ${parts[3]} was ${tag === "-boost" ? "raised" : "lowered"}`;
  if (tag === "message") return parts.slice(2).join("|");
  if (tag === "error") return parts.slice(2).join("|");
  return "";
}
function submitBattleChoiceFromController(controller: BattleController, choice: string) {
  if (!controller.stopped) void controller.streams.p1.write(`>p1 ${choice}`);
}


export default function App() {
  const [settings, setSettings] = useState<Settings>(readSettings);
  const [activePage, setActivePage] = useState<Page>("Overview");
  const [teams, setTeams] = useState<Team[]>(readTeams);
  const [activeTeamId, setActiveTeamId] = useState("");
  const [selectedSlotId, setSelectedSlotId] = useState("");
  const [battlePlayerTeamId, setBattlePlayerTeamId] = useState("");
  const [battleOpponentTeamId, setBattleOpponentTeamId] = useState("");
  const [onlineOpponent, setOnlineOpponent] = useState<OnlineOpponent | null>(null);
  const [onlineOpponentPool, setOnlineOpponentPool] = useState<OnlineOpponent[]>([]);
  const [opponentSource, setOpponentSource] = useState<"Saved teams" | "Auto Teams">(settings.battleType === "PvP" ? "Auto Teams" : "Saved teams");
  const [fetchingOpponent, setFetchingOpponent] = useState(false);
  const [opponentSourceError, setOpponentSourceError] = useState("");
  const [benchmarkBusy, setBenchmarkBusy] = useState(false);
  const [benchmarkMode, setBenchmarkMode] = useState<BenchmarkMode>("Teams");
  const [selectedSinglePokemonKey, setSelectedSinglePokemonKey] = useState("");
  const [benchmarkProgress, setBenchmarkProgress] = useState<BenchmarkProgress | null>(null);
  const [benchmarkError, setBenchmarkError] = useState("");
  const [benchmarkCoverage, setBenchmarkCoverage] = useState<{sourceCount:number;validCount:number;rejected:number;sourceUrl:string} | null>(null);
  const [matchupRun, setMatchupRun] = useState<MatchupAnalysisRun | null>(readMatchupRun);
  const benchmarkCancel = useRef(false);
  const battleDecisionLog = useRef<string[]>([]);
  const [battleActive, setBattleActive] = useState(false);
  const [battleLog, setBattleLog] = useState<string[]>([]);
  const [battleError, setBattleError] = useState("");
  const [simulationLegalityWarning, setSimulationLegalityWarning] = useState("");
  const [manualRequest, setManualRequest] = useState<BattleRequest | null>(null);
  const [teamPreviewSelection, setTeamPreviewSelection] = useState<number[]>([]);
  const [teamTextOpen, setTeamTextOpen] = useState(false);
  const [teamText, setTeamText] = useState("");
  const [teamTextError, setTeamTextError] = useState("");
  const [battleMusicEnabled, setBattleMusicEnabled] = useState(() => localStorage.getItem("battle-lab-music-enabled") !== "false");
  const battleMusicUrl = defaultBattleMusicUrl;
  const battleMusicRef = useRef<HTMLAudioElement | null>(null);
  const battleController = useRef<BattleController | null>(null);
  const battleModeRef = useRef(settings.mode);
  useEffect(() => { localStorage.setItem("battle-lab-settings", JSON.stringify(settings)); }, [settings]);
  useEffect(() => { battleModeRef.current = settings.mode; }, [settings.mode]);
  useEffect(() => { localStorage.setItem("battle-lab-music-enabled", String(battleMusicEnabled)); }, [battleMusicEnabled]);
  useEffect(() => {
    const audio = battleMusicRef.current;
    if (!audio) return;
    audio.src = battleMusicUrl;
    audio.loop = true;
    audio.volume = 0.28;
    if (battleMusicEnabled) void audio.play().catch(() => {});
    else audio.pause();
    const resumeAfterGesture = () => {
      if (battleMusicEnabled && audio.paused) void audio.play().catch(() => {});
    };
    window.addEventListener("pointerdown", resumeAfterGesture);
    window.addEventListener("keydown", resumeAfterGesture);
    return () => {
      window.removeEventListener("pointerdown", resumeAfterGesture);
      window.removeEventListener("keydown", resumeAfterGesture);
      audio.pause();
    };
  }, [battleMusicEnabled, battleMusicUrl]);
  useEffect(() => { localStorage.setItem("battle-lab-teams", JSON.stringify(teams)); }, [teams]);
  useEffect(() => {
    if (!matchupRun) return;
    try {
      localStorage.setItem("battle-lab-matchup-results", JSON.stringify(matchupRun));
    } catch {
      setBenchmarkError("The browser storage limit was reached. This run can continue, but the latest checkpoint could not be saved locally.");
    }
  }, [matchupRun]);
  const updateSetting = <K extends keyof Settings>(key: K, value: Settings[K]) => setSettings(s => normalizeSettings({ ...s, [key]: value }));
  const activeTeam = teams.find(t => t.id === activeTeamId) || teams[0];
  const selectedSlot = activeTeam?.slots.find(s => s.id === selectedSlotId) || activeTeam?.slots[0];
  const selectedBuild = selectedSlot ? activeBuild(selectedSlot) : undefined;
  const singlePokemonOptions = teams.flatMap(team => team.slots.map(slot => ({ key: team.id + ":" + slot.id, team, slot, build: activeBuild(slot) }))).filter(option => option.build?.name.trim() && option.build.moves.some(move => move.trim()));
  const selectedSinglePokemon = singlePokemonOptions.find(option => option.key === selectedSinglePokemonKey) || singlePokemonOptions[0];
  const generationDex = useMemo(() => Dex.forGen(settings.generation), [settings.generation]);
  const speciesOptions = useMemo(() => generationDex.species.all().filter(p => p.exists && !p.isNonstandard).sort((a,b) => a.name.localeCompare(b.name)), [generationDex]);
  const moveOptions = useMemo(() => generationDex.moves.all().filter(m => m.exists && !m.isNonstandard).sort((a,b) => a.name.localeCompare(b.name)), [generationDex]);
  const abilityOptions = useMemo(() => generationDex.abilities.all().filter(a => a.exists && !a.isNonstandard).sort((a,b) => a.name.localeCompare(b.name)), [generationDex]);
  const itemOptions = useMemo(() => generationDex.items.all().filter(i => i.exists && !i.isNonstandard).sort((a,b) => a.name.localeCompare(b.name)), [generationDex]);
  const selectedSpecies = selectedBuild ? speciesOptions.find(p => p.name.toLowerCase() === selectedBuild.name.trim().toLowerCase()) : undefined;
  const legality = useMemo(() => {
    if (!activeTeam) return { status: "No team", messages: [] as string[] };

    const builds = activeTeam.slots.map(slot => activeBuild(slot));
    const namedBuilds = builds.filter(build => build.name.trim());
    if (namedBuilds.length !== 6 || builds.length !== 6) {
      return {
        status: "Incomplete",
        messages: [`Select six Pokémon to validate this team (${namedBuilds.length}/6 selected).`],
      };
    }

    const incompleteSets = namedBuilds
      .filter(build => (settings.generation >= 3 && !build.ability.trim()) || !build.moves.some(move => move.trim()))
      .map(build => build.nickname.trim() || build.name);
    if (incompleteSets.length) {
      return {
        status: "Incomplete",
        messages: [`Choose an ability where the generation supports abilities, and at least one move for: ${incompleteSets.join(", ")}.`],
      };
    }

    const sets = namedBuilds.map(build => ({
      name: build.nickname || build.name,
      species: build.name,
      level: build.level,
      ability: build.ability,
      item: build.item,
      nature: build.nature,
      gender: build.gender || undefined,
      moves: build.moves.filter(Boolean),
      evs: { hp: build.evs.HP, atk: build.evs.Atk, def: build.evs.Def, spa: build.evs.SpA, spd: build.evs.SpD, spe: build.evs.Spe },
      ivs: { hp: build.ivs.HP, atk: build.ivs.Atk, def: build.ivs.Def, spa: build.ivs.Spa, spd: build.ivs.SpD, spe: build.ivs.Spe },
    }));

    if (settings.battleType === "PvE") {
      if (settings.generation !== 7) {
        return {
          status: "Unsupported format",
          messages: [`${settings.facility || "This facility"} rules are not configured yet. A generic validator cannot certify facility legality.`],
        };
      }

      // Battle Tree Super Singles: six-Pokémon registration roster, choose three to battle.
      // Pokémon above level 50 are scaled down; lower-level Pokémon are not raised.
      const bannedSpecies = new Set([
        "mewtwo", "mew", "lugia", "hooh", "celebi", "kyogre", "groudon", "rayquaza",
        "jirachi", "deoxys", "dialga", "palkia", "giratina", "phione", "manaphy",
        "darkrai", "shaymin", "arceus", "victini", "reshiram", "zekrom", "kyurem",
        "keldeo", "meloetta", "genesect", "xerneas", "yveltal", "zygarde", "diancie",
        "hoopa", "volcanion", "cosmog", "cosmoem", "solgaleo", "lunala", "necrozma",
        "magearna", "marshadow", "zeraora",
      ]);
      const treeProblems: string[] = [];
      const seenSpecies = new Map<number, string>();
      const seenItems = new Map<string, string>();

      for (const build of namedBuilds) {
        const label = build.nickname.trim() || build.name;
        const species = generationDex.species.get(build.name);
        if (species.exists) {
          const speciesId = (species.baseSpecies || species.name).toLowerCase().replace(/[^a-z0-9]/g, "");
          if (bannedSpecies.has(speciesId)) {
            treeProblems.push(`${label}: ${species.name} is restricted in Battle Tree Super Singles.`);
          }
          const previousSpecies = seenSpecies.get(species.num);
          if (previousSpecies) {
            treeProblems.push(`${label}: duplicates ${previousSpecies} by National Pokédex number (Species Clause).`);
          } else {
            seenSpecies.set(species.num, label);
          }
        }

        const itemId = build.item.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
        if (itemId) {
          const previousItem = seenItems.get(itemId);
          if (previousItem) {
            treeProblems.push(`${label}: held item ${build.item} is also assigned to ${previousItem} (Item Clause).`);
          } else {
            seenItems.set(itemId, label);
          }
        }
      }

      try {
        const setProblems = TeamValidator.get("gen7anythinggoes").validateTeam(sets as any) || [];
        // AG's default level-100 and nonzero-EV reminders are not Battle Tree restrictions.
        const relevantSetProblems = setProblems.filter(problem =>
          !problem.includes("has exactly 0 EVs - did you forget to EV it?") &&
          !/is level \d+, but this format allows level 100 Pokémon/.test(problem)
        );
        const allProblems = [...treeProblems, ...relevantSetProblems];
        return allProblems.length
          ? { status: "Illegal", messages: allProblems }
          : {
              status: "Legal",
              messages: [
                "All six registered sets pass Generation 7 Showdown set validation and the implemented Battle Tree Super Singles checks.",
                "Register six Pokémon and choose three for each battle. Pokémon above level 50 are scaled down; Pokémon below level 50 remain at their level.",
                "Species Clause, Item Clause and the restricted Pokémon list are clear.",
              ],
            };
      } catch {
        return {
          status: "Unavailable",
          messages: ["Generation 7 Showdown set validation is unavailable. No Battle Tree legality result was produced."],
        };
      }
    }
    if (settings.tier === "Battle Spot Singles" && settings.generation !== 6 && settings.generation !== 7) return { status: "Unsupported format", messages: ["Battle Spot Singles is supported here only for Generations 6 and 7."] };
    if (settings.tier === "VGC") {
      return {
        status: "Unsupported format",
        messages: ["VGC requires a specific regulation and battle format. Select a supported singles tier for now."],
      };
    }
    if (settings.tier === "Custom") {
      return {
        status: "Unsupported format",
        messages: ["Custom battles have no defined legality rules. The checker will not label an unrestricted set as legal."],
      };
    }

    const tierIds: Record<string, string> = { "Battle Spot Singles": "battlespotsingles",
      "Anything Goes": "anythinggoes",
      "Ubers": "ubers",
      "OU": "ou",
      "UU": "uu",
      "RU": "ru",
      "NU": "nu",
      "PU": "pu",
      "ZU": "zu",
      "Little Cup": "lc",
    };
    const tierId = tierIds[settings.tier];
    if (!tierId) {
      return { status: "Unsupported format", messages: [`No validator mapping exists for the ${settings.tier} tier.`] };
    }

    const format = `gen${settings.generation}${tierId}`;


    try {
      const problems = TeamValidator.get(format).validateTeam(sets as any) || [];
      return problems.length
        ? { status: "Illegal", messages: problems }
        : { status: "Legal", messages: [`${namedBuilds.length} Pokémon pass the Generation ${settings.generation} ${settings.tier} validator.`] };
    } catch {
      return {
        status: "Unavailable",
        messages: [`The ${format} rules are not available in the installed validator data. No legality result was produced.`],
      };
    }
  }, [activeTeam, settings.generation, settings.battleType, settings.tier]);
  const speciesAbilities = selectedSpecies ? Object.values(selectedSpecies.abilities).filter(Boolean) : [];
  const patchTeam = (teamId: string, updater: (team: Team) => Team) => setTeams(all => all.map(t => t.id === teamId ? { ...updater(t), updatedAt: new Date().toISOString() } : t));
  const createTeam = () => {
    const team: Team = { id: uid(), name: "New Team", slots: [], updatedAt: new Date().toISOString() };
    setTeams(all => [...all, team]); setActiveTeamId(team.id); setSelectedSlotId("");
  };
  const addPokemon = () => {
    if (!activeTeam || activeTeam.slots.length >= 6) return;
    const build = newBuild();
    const slot: TeamSlot = { id: uid(), builds: [build], activeBuildId: build.id };
    patchTeam(activeTeam.id, t => ({ ...t, slots: [...t.slots, slot] }));
    setSelectedSlotId(slot.id);
  };
  const patchBuild = (patch: Partial<PokemonBuild>) => {
    if (!activeTeam || !selectedSlot || !selectedBuild) return;
    patchTeam(activeTeam.id, t => ({ ...t, slots: t.slots.map(s => s.id !== selectedSlot.id ? s : { ...s, builds: s.builds.map(b => b.id === selectedBuild.id ? { ...b, ...patch } : b) }) }));
  };
  const createBuildVariant = () => {
    if (!activeTeam || !selectedSlot || !selectedBuild) return;
    const variant = { ...selectedBuild, id: uid(), name: selectedBuild.name, label: selectedBuild.label ? selectedBuild.label + " copy" : "Variant " + (selectedSlot.builds.length + 1), moves: [...selectedBuild.moves], evs: { ...selectedBuild.evs }, ivs: { ...selectedBuild.ivs } };
    patchTeam(activeTeam.id, t => ({ ...t, slots: t.slots.map(s => s.id === selectedSlot.id ? { ...s, builds: [...s.builds, variant], activeBuildId: variant.id } : s) }));
  };
  const deleteSelectedBuild = () => {
    if (!activeTeam || !selectedSlot || !selectedBuild || selectedSlot.builds.length < 2) return;
    patchTeam(activeTeam.id, t => ({ ...t, slots: t.slots.map(s => {
      if (s.id !== selectedSlot.id) return s;
      const builds = s.builds.filter(b => b.id !== selectedBuild.id);
      return { ...s, builds, activeBuildId: builds[0].id };
    }) }));
  };
  const moveSlot = (slotId: string, direction: -1 | 1) => {
    if (!activeTeam) return;
    const index = activeTeam.slots.findIndex(slot => slot.id === slotId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= activeTeam.slots.length) return;
    patchTeam(activeTeam.id, team => { const slots = [...team.slots]; [slots[index], slots[target]] = [slots[target], slots[index]]; return { ...team, slots }; });
  };
  const removeSlot = (slotId: string) => {
    if (!activeTeam) return;
    patchTeam(activeTeam.id, t => ({ ...t, slots: t.slots.filter(s => s.id !== slotId) }));
    if (selectedSlotId === slotId) setSelectedSlotId("");
  };
  const renameTeam = (name: string) => { if (activeTeam) patchTeam(activeTeam.id, t => ({ ...t, name })); };
  const deleteTeam = () => {
    if (!activeTeam || !window.confirm("Delete this team and all its builds?")) return;
    const remaining = teams.filter(t => t.id !== activeTeam.id);
    setTeams(remaining); setActiveTeamId(remaining[0]?.id || ""); setSelectedSlotId("");
  };
  const makeBattleSet = (build: PokemonBuild, generation: number) => {
    const set: Record<string, unknown> = {
      name: build.nickname || build.name, species: build.name, level: build.level, moves: build.moves.filter(Boolean), shiny: build.shiny, happiness: build.happiness,
      evs: { hp: build.evs.HP, atk: build.evs.Atk, def: build.evs.Def, spa: build.evs.SpA, spd: build.evs.SpD, spe: build.evs.Spe },
      ivs: { hp: build.ivs.HP, atk: build.ivs.Atk, def: build.ivs.Def, spa: build.ivs.SpA, spd: build.ivs.SpD, spe: build.ivs.Spe },
    };
    if (generation >= 2 && build.item) set.item = build.item;
    if (generation >= 3) { if (build.ability) set.ability = build.ability; set.nature = build.nature; }
    if (generation >= 2 && build.gender) set.gender = build.gender;
    if (generation >= 9 && build.teraType) set.teraType = build.teraType;
    return set;
  };
  const makeBattleSets = (team: Team, generation: number) => team.slots.map(slot => makeBattleSet(activeBuild(slot), generation));
  const battleFormat = () => {
    if (settings.battleType === "PvE" || settings.tier === "Custom" || settings.tier === "VGC" || (settings.tier === "Battle Spot Singles" && settings.generation !== 6 && settings.generation !== 7)) return `gen${settings.generation}customgame`;
    const ids: Record<string, string> = { "Battle Spot Singles": "battlespotsingles", "Anything Goes": "anythinggoes", Ubers: "ubers", OU: "ou", UU: "uu", RU: "ru", NU: "nu", PU: "pu", ZU: "zu", "Little Cup": "lc" };
    return `gen${settings.generation}${ids[settings.tier] || "customgame"}`;
  };
  const fetchOnlineOpponent = async () => {
    const format = battleFormat();
    if (settings.battleType !== "PvP" || settings.tier === "VGC" || settings.tier === "Custom") {
      setOpponentSourceError("Online sample teams are not available for this ruleset yet.");
      return;
    }
    setFetchingOpponent(true);
    setOpponentSourceError("");
    try {
      const response = await fetch(`https://pkmn.github.io/smogon/data/teams/${format}.json`);
      if (!response.ok) throw new Error(`Sample-team source returned HTTP ${response.status} for ${format}.`);
      const samples = await response.json() as Array<{name?: string; author?: string; data?: Record<string, unknown>[] }>;
      const valid = samples.filter(sample => Array.isArray(sample.data) && sample.data.length === 6)
        .filter(sample => {
          try { return (TeamValidator.get(format).validateTeam(sample.data as any) || []).length === 0; }
          catch { return false; }
        });
      if (!valid.length) throw new Error(`No currently valid six-Pokémon sample teams were found for ${format}.`);
      const pool = valid.map(sample => ({ name: sample.name || ("Online " + format.toUpperCase() + " sample"), author: sample.author, format, source: "Smogon sample teams via pkmn/smogon", sets: sample.data! }));
      setOnlineOpponentPool(pool);
      setOnlineOpponent(pool[Math.floor(Math.random() * pool.length)]);
      setBattleOpponentTeamId("");
    } catch (error) {
      setOnlineOpponent(null);
      setOnlineOpponentPool([]);
      setOpponentSourceError(error instanceof Error ? error.message : "Could not fetch online teams.");
    } finally { setFetchingOpponent(false); }
  };
  useEffect(() => {
    if (activePage === "Simulator" && settings.battleType === "PvP" && settings.tier !== "VGC" && settings.tier !== "Custom" && onlineOpponent?.format !== battleFormat() && !fetchingOpponent) {
      void fetchOnlineOpponent();
    }
  }, [activePage, settings.generation, settings.battleType, settings.tier]);
  const runFullBenchmark = async () => {
    const singleMode = benchmarkMode === "Single Pokémon";
    const selected = singleMode ? selectedSinglePokemon : undefined;
    const playerTeam = singleMode ? selected?.team : teams.find(team => team.id === (battlePlayerTeamId || activeTeam?.id || ""));
    if (singleMode) {
      if (settings.battleType !== "PvP") { setBenchmarkError("1 vs Meta currently requires PvP and a published tier dataset."); return; }
      if (!selected?.build?.name.trim() || !selected.build.moves.some(move => move.trim())) { setBenchmarkError("Select a saved Pokémon build with at least one move."); return; }
    } else if (!playerTeam || playerTeam.slots.length < (settings.battleType === "PvE" ? (settings.generation === 9 ? 6 : 3) : 1) || playerTeam.slots.length > 6 || !playerTeam.slots.every(slot => {
      const build = activeBuild(slot); return Boolean(build?.name.trim() && build.moves.some(move => move.trim()));
    })) { setBenchmarkError(settings.battleType === "PvE" ? (settings.generation === 9 ? "The Academy Ace Tournament requires a complete six-Pokémon team." : "Select a facility roster of 3 to 6 complete Pokémon. Three are selected for each battle.") : "Select a team of 1 to 6 complete Pokémon, each with at least one move."); return; }
    setBenchmarkBusy(true); setBenchmarkError(""); setSimulationLegalityWarning(""); setBenchmarkProgress(null); setBenchmarkCoverage(null); benchmarkCancel.current = false;
    try {
      const tierFormat = battleFormat();
      const format = singleMode ? `gen${settings.generation}customgame` : tierFormat;
      const rawPlayerSets = singleMode ? [makeBattleSet(selected!.build, settings.generation)] : makeBattleSets(playerTeam!, settings.generation);
      const playerSets = settings.battleType === "PvE" && settings.generation < 9
        ? rawPlayerSets.map(set => ({ ...set, level: Math.min(50, Number(set.level || 50)) }))
        : rawPlayerSets;
      if (!singleMode && settings.battleType === "PvP") {
        try {
          const problems = TeamValidator.get(format).validateTeam(playerSets as any) || [];
          if (problems.length) setSimulationLegalityWarning(`Your team is illegal for ${format.toUpperCase()}: ${problems.slice(0, 6).join(" | ")} Simulation will run anyway.`);
        } catch (error) {
          setSimulationLegalityWarning(`Your team legality could not be verified for ${format.toUpperCase()}: ${error instanceof Error ? error.message : "validator unavailable"} Simulation will run anyway.`);
        }
      }
      let opponents: BenchmarkOpponent[] = [];
      let sourceCount = 0, rejected = 0, sourceUrl = "Saved teams stored in this browser";
      if (singleMode) {
        const dataset = await loadMetaPokemonPool(tierFormat);
        opponents = dataset.opponents; sourceCount = dataset.sourceCount; rejected = dataset.rejected; sourceUrl = dataset.sourceUrl;
      } else if (settings.battleType === "PvE") {
        const dataset = await loadFacilityOpponentPool(settings.generation, settings.gameVersion, settings.facility);
        opponents = dataset.opponents; sourceCount = dataset.sourceCount; rejected = dataset.rejected; sourceUrl = dataset.sourceUrl;
      } else if (opponentSource === "Auto Teams") {
        const dataset = await loadCompleteOpponentPool(format);
        opponents = dataset.opponents; sourceCount = dataset.sourceCount; rejected = dataset.rejected; sourceUrl = dataset.sourceUrl;
      } else {
        const otherTeams = teams.filter(team => team.id !== playerTeam!.id);
        sourceCount = otherTeams.length;
        for (const team of otherTeams) {
          if (team.slots.length < 1 || team.slots.length > 6 || !team.slots.every(slot => { const build = activeBuild(slot); return Boolean(build?.name.trim() && build.moves.some(move => move.trim())); })) { rejected++; continue; }
          const sets = makeBattleSets(team, settings.generation);
          try { if ((TeamValidator.get(format).validateTeam(sets as any) || []).length) { rejected++; continue; } }
          catch { rejected++; continue; }
          opponents.push({ id: team.id, name: team.name, sets });
        }
      }
      if (!opponents.length) throw new Error(singleMode
        ? `No individual Pokémon sets were found in the published ${settings.tier} archive for Generation ${settings.generation}.`
        : settings.battleType === "PvE" ? "No valid facility trainers were loaded. Check the selected game's supported facility dataset." : "No other complete, usable teams were found. Add another team with 1 to 6 Pokémon or load the online Auto Teams pool.");
      const coverage = { sourceCount, validCount: opponents.length, rejected, sourceUrl };
      setBenchmarkCoverage(coverage);
      const meta = {
        id: uid(), createdAt: new Date().toISOString(), playerTeamId: playerTeam!.id,
        playerTeamName: singleMode ? `${selected!.build.nickname || selected!.build.name} · 1 vs Meta` : playerTeam!.name,
        generation: settings.generation, gameVersion: settings.gameVersion, battleType: settings.battleType,
        tier: settings.tier, facility: settings.facility,
        opponentSource: singleMode ? "Published meta Pokémon sets" : settings.battleType === "PvE" ? "In-game facility trainer pools" : opponentSource === "Auto Teams" ? "Published sample teams" : "Saved teams",
        benchmarkMode, ...coverage,
      };
      const result = await runExhaustiveBenchmark({
        format, playerSets, opponents, repetitions: 100, playerSelectionSize: settings.battleType === "PvE" && settings.generation < 9 ? 3 : undefined, shouldCancel: () => benchmarkCancel.current,
        onProgress: progress => { setBenchmarkProgress(progress); setMatchupRun({ ...meta, ...progress }); },
      });
      setBenchmarkProgress(result); setMatchupRun({ ...meta, ...result });
      if (benchmarkCancel.current) setBenchmarkError("Run cancelled. Matchup Analysis contains completed battles only.");
      else setBenchmarkError("");
      setOpponentSourceError("");
    } catch (error) { setBenchmarkError(error instanceof Error ? error.message : "The simulation failed."); }
    finally { setBenchmarkBusy(false); }
  };
  const stopBattle = () => {
    const controller = battleController.current;
    if (controller && !controller.stopped) {
      controller.stopped = true;
      try { void controller.streams.omniscient.write(">forcetie"); } catch { /* battle already closed */ }
    }
    battleController.current = null;
    setBattleActive(false);
    setManualRequest(null);
  };
  const submitBattleChoice = (choice: string) => {
    const controller = battleController.current;
    if (!controller || controller.stopped) return;
    setManualRequest(null);
    void controller.streams.p1.write(`>p1 ${choice}`);
  };
  const chooseAutomatically = (request: BattleRequest) => chooseTacticalChoice(request, battleDecisionLog.current, "p1", settings.generation);
  useEffect(() => {
    if (settings.mode === "Auto" && manualRequest) {
      const request = manualRequest;
      setManualRequest(null);
      submitBattleChoice(chooseAutomatically(request));
    }
  }, [settings.mode, manualRequest]);
  const startBattle = () => {
    const playerId = battlePlayerTeamId || activeTeam?.id || "";
    const opponentId = battleOpponentTeamId || teams.find(team => team.id !== playerId)?.id || "";
    const playerTeam = teams.find(t => t.id === playerId);
    const opponentTeam = teams.find(t => t.id === opponentId);
    const useAutoTeams = opponentSource === "Auto Teams";
    const currentPool = onlineOpponentPool.filter(team => team.format === battleFormat());
    const selectedOnlineOpponent = useAutoTeams && settings.battleType === "PvP" && currentPool.length
      ? currentPool[Math.floor(Math.random() * currentPool.length)] : null;
    const useOnlineOpponent = Boolean(selectedOnlineOpponent);
    if (!playerTeam || (useAutoTeams && !useOnlineOpponent) || (!useAutoTeams && !opponentTeam)) {
      setBattleError(useAutoTeams && settings.battleType === "PvE"
        ? "The selected game's facility trainer pool is not connected yet. Choose Saved teams instead."
        : useAutoTeams ? "Load the Auto Teams pool for this generation and tier first." : "Choose a saved opponent team.");
      return;
    }
    if (playerTeam.slots.length < 1 || playerTeam.slots.length > 6 || (!useAutoTeams && (opponentTeam!.slots.length < 1 || opponentTeam!.slots.length > 6))) { setBattleError("Each team must contain between 1 and 6 Pokémon."); return; }
    const playerComplete = playerTeam.slots.length > 0 && playerTeam.slots.every(slot => {
      const build = activeBuild(slot);
      return Boolean(build.name.trim() && build.moves.some(move => move.trim()));
    });
    const opponentComplete = useOnlineOpponent || (Boolean(opponentTeam?.slots.length) && opponentTeam?.slots.every(slot => {
      const build = activeBuild(slot);
      return Boolean(build.name.trim() && build.moves.some(move => move.trim()));
    }) === true);
    if (!playerComplete || !opponentComplete) { setBattleError("Every Pokémon needs a species and at least one move."); return; }
    stopBattle();
    setBattleError("");
    setSimulationLegalityWarning("");
    if (settings.battleType === "PvP") {
      try {
        const format = battleFormat();
        const problems = TeamValidator.get(format).validateTeam(makeBattleSets(playerTeam, settings.generation) as any) || [];
        if (problems.length) setSimulationLegalityWarning(`Your team is illegal for ${format.toUpperCase()}: ${problems.slice(0, 6).join(" | ")} Simulation will run anyway.`);
      } catch (error) {
        setSimulationLegalityWarning(`Your team legality could not be verified: ${error instanceof Error ? error.message : "validator unavailable"} Simulation will run anyway.`);
      }
    }
    setBattleLog([]);
    setManualRequest(null);
    try {
      const streams = BattleStreams.getPlayerStreams(new BattleStreams.BattleStream());
      const controller: BattleController = { streams, stopped: false };
      battleController.current = controller;
      battleDecisionLog.current = [];
      const p2AI = new TacticalPlayerAI(streams.p2, "p2", settings.generation);
      void p2AI.start();
      void (async () => {
        try {
          for await (const chunk of streams.omniscient) {
            if (controller.stopped) break;
            const lines = String(chunk).split("\\n").filter(Boolean);
            setBattleLog(old => [...old, ...lines.map(formatBattleLine).filter(Boolean)].slice(-400));
            if (lines.some(line => line.startsWith("|win|") || line === "|tie")) {
              setBattleActive(false);
              setManualRequest(null);
            }
          }
        } catch (error) {
          if (!controller.stopped) setBattleError(error instanceof Error ? error.message : "Battle output failed.");
        }
      })();
      void (async () => {
        try {
          for await (const chunk of streams.p1) {
            if (controller.stopped) break;
            const lines = String(chunk).split("\\n");
            battleDecisionLog.current.push(...lines.filter(line => line.startsWith("|") && !line.startsWith("|request|")));
            if (battleDecisionLog.current.length > 1200) battleDecisionLog.current = battleDecisionLog.current.slice(-900);
            for (const line of lines) {
              const marker = line.indexOf("|request|");
              if (marker < 0) continue;
              const payload = line.slice(marker + 9).trim();
              if (!payload || payload === "null") continue;
              let request: BattleRequest;
              try { request = JSON.parse(payload) as BattleRequest; } catch { continue; }
              if (request.wait) continue;
              if (battleModeRef.current === "Auto") {
                submitBattleChoiceFromController(controller, chooseAutomatically(request));
              } else {
                setManualRequest(request);
                if (request.teamPreview) setTeamPreviewSelection(Array.from({ length: Math.min(request.maxTeamSize || request.side?.pokemon.length || 6, request.side?.pokemon.length || 6) }, (_, index) => index + 1));
              }
            }
          }
        } catch (error) {
          if (!controller.stopped) setBattleError(error instanceof Error ? error.message : "Player input stream failed.");
        }
      })();
      const formatid = battleFormat();
      const p1spec = { name: playerTeam.name || "Player", team: Teams.pack(makeBattleSets(playerTeam, settings.generation) as any) };
      const p2spec = useOnlineOpponent
        ? { name: selectedOnlineOpponent!.name, team: Teams.pack(selectedOnlineOpponent!.sets as any) }
        : { name: opponentTeam!.name || "Opponent", team: Teams.pack(makeBattleSets(opponentTeam!, settings.generation) as any) };
      void streams.omniscient.write(`>start ${JSON.stringify({ formatid })}
>player p1 ${JSON.stringify(p1spec)}
>player p2 ${JSON.stringify(p2spec)}`);
      setBattleActive(true);
    } catch (error) {
      setBattleError(error instanceof Error ? error.message : "Could not initialize the battle engine.");
      setBattleActive(false);
    }
  };
  const openTeamText = () => {
    setTeamText(activeTeam ? Teams.export(makeBattleSets(activeTeam, settings.generation) as any) : "");
    setTeamTextError("");
    setTeamTextOpen(true);
  };
  const importShowdownText = () => {
    try {
      if (!activeTeam) throw new Error("Create or select a team before importing.");
      const imported = (Teams as any).import(teamText) as Array<Record<string, any>>;
      if (!Array.isArray(imported) || !imported.length) throw new Error("No Pokémon sets were found in that text.");
      if (imported.length > 6) throw new Error(`The import contains ${imported.length} Pokémon. A team can contain at most six.`);
      const slots: TeamSlot[] = imported.map(set => {
        const speciesName = String(set.species || set.name || "").trim();
        const build = newBuild(speciesName);
        const statValue = (source: any, key: string, fallback: number) => Number.isFinite(Number(source?.[key])) ? Math.max(0, Number(source[key])) : fallback;
        build.nickname = set.name && set.name !== speciesName ? String(set.name) : "";
        build.level = Math.max(1, Math.min(100, Number(set.level) || 100));
        build.gender = String(set.gender || "");
        build.ability = String(set.ability || "");
        build.nature = String(set.nature || "Hardy");
        build.item = String(set.item || "");
        build.moves = [...(Array.isArray(set.moves) ? set.moves : [])].slice(0, 4).map(String);
        build.evs = { HP:statValue(set.evs,"hp",0), Atk:statValue(set.evs,"atk",0), Def:statValue(set.evs,"def",0), SpA:statValue(set.evs,"spa",0), SpD:statValue(set.evs,"spd",0), Spe:statValue(set.evs,"spe",0) };
        build.ivs = { HP:statValue(set.ivs,"hp",31), Atk:statValue(set.ivs,"atk",31), Def:statValue(set.ivs,"def",31), SpA:statValue(set.ivs,"spa",31), SpD:statValue(set.ivs,"spd",31), Spe:statValue(set.ivs,"spe",31) };
        build.shiny = Boolean(set.shiny);
        build.happiness = Math.max(0, Math.min(255, Number(set.happiness ?? 255)));
        build.teraType = String(set.teraType || "");
        return { id:uid(), builds:[build], activeBuildId:build.id };
      });
      patchTeam(activeTeam.id, team => ({ ...team, slots }));
      setSelectedSlotId(slots[0]?.id || "");
      setTeamTextOpen(false);
      setTeamTextError("");
    } catch (error) {
      setTeamTextError(error instanceof Error ? error.message : "Could not parse Pokémon Showdown text.");
    }
  };
  const copyShowdownText = async () => {
    try { await navigator.clipboard.writeText(teamText); setTeamTextError("Copied Showdown text to clipboard."); }
    catch { setTeamTextError("Clipboard access was blocked. Select and copy the text manually."); }
  };
  const exportTeam = () => {
    if (!activeTeam) return;
    const blob = new Blob([JSON.stringify(activeTeam, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = activeTeam.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + ".json"; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <main className="app-shell">
      <audio ref={battleMusicRef} preload="auto" autoPlay loop />
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">P</div><div><strong>Pokémon Battle Lab</strong><span>TEAM TESTING SUITE</span></div></div>
        <nav aria-label="Main navigation">
          {(["Overview", "Team Builder", "Legality analysis", "Simulator", "Matchup Analysis"] as Page[]).map(page => <button className={activePage === page ? "nav-item active" : "nav-item"} key={page} onClick={() => setActivePage(page)}><span className="nav-dot" />{page}</button>)}
        </nav>
        <div className="sidebar-note"><span className="status-dot" /><span>Local workspace</span></div>
      </aside>
      <section className="main-content">
        <header className="topbar"><div><div className="eyebrow">POKÉMON TEAM TESTING</div><h1>{activePage}</h1></div><div className="topbar-actions"><button type="button" className={battleMusicEnabled ? "music-toggle active" : "music-toggle"} aria-pressed={battleMusicEnabled} onClick={() => setBattleMusicEnabled(enabled => !enabled)} title={battleMusicEnabled ? "Turn Pokémon Center music off" : "Turn Pokémon Center music on"}>{battleMusicEnabled ? "♫ Music on" : "♫ Music off"}</button><button type="button" className="google-login-button" disabled title="Google authentication is not connected yet">Google Login</button><div className="topbar-tag">BUILD <span>{__BUILD_NUMBER__}</span></div></div></header>
        {activePage === "Overview" && <>
          <section className="intro"><div><div className="eyebrow">SIMULATION SETUP</div><h2>Configure your ruleset.</h2><p>Choose a generation and battle environment. Your settings are saved on this device.</p></div><div className="intro-symbol" aria-hidden="true">◈</div></section>
          <section className="panel setup-panel">
            <div className="panel-heading"><div><span className="eyebrow">01 / CONFIGURATION</span><h3>Battle environment</h3></div><span className="saved-indicator"><span className="status-dot" /> Settings saved locally</span></div>
            <div className="field-grid">
              <label className="field"><span>Generation</span><select value={settings.generation} onChange={e => updateSetting("generation", Number(e.target.value))}>{generations.map(g => <option value={g} key={g} disabled={settings.battleType === "PvE" && g < 3}>Generation {g}</option>)}</select></label>
              <label className="field"><span>Game version</span><select value={settings.gameVersion} onChange={e => updateSetting("gameVersion", e.target.value)}>{(gameVersions[settings.generation] || []).map(version => <option key={version}>{version}</option>)}</select></label>
              <fieldset className="field battle-type-field"><legend>Battle type</legend><div className="segmented">{(["PvP","PvE"] as BattleType[]).map(type => <button type="button" key={type} className={settings.battleType === type ? "selected" : ""} aria-pressed={settings.battleType === type} onClick={() => updateSetting("battleType", type)}>{type}</button>)}</div></fieldset>
              {settings.battleType === "PvP" ? <label className="field conditional-field"><span>PvP tier</span><select value={settings.tier} onChange={e => updateSetting("tier", e.target.value)}>{tiers.map(t => <option key={t} disabled={t === "Battle Spot Singles" && settings.generation !== 6 && settings.generation !== 7}>{t}</option>)}</select></label> : <div className="field conditional-field"><span>PvE facility</span><div className="derived-value">{settings.facility || "No facility configured"}</div></div>}
            </div>
            <div className="config-summary"><span className="summary-label">ACTIVE RULESET</span><strong>Gen {settings.generation} · {settings.battleType === "PvP" ? settings.tier : settings.facility}</strong><span className="summary-copy">The selected ruleset governs legality analysis and battle execution where supported.</span></div>
          </section>
          <section className="lower-grid">
            <section className="panel mode-panel"><div className="panel-heading"><div><span className="eyebrow">02 / CONTROL</span><h3>Battle control</h3></div></div><p className="panel-description">Choose how decisions are made during a simulation.</p><div className="mode-options">{(["Auto","Manual"] as BattleMode[]).map(mode => <button type="button" className={settings.mode === mode ? "mode-option chosen" : "mode-option"} key={mode} onClick={() => updateSetting("mode", mode)}><span className="mode-icon">{mode === "Auto" ? "↻" : "⌁"}</span><span><strong>{mode}</strong><small>{mode === "Auto" ? "AI controls decisions" : "You control decisions"}</small></span><span className="radio-mark">{settings.mode === mode ? "●" : "○"}</span></button>)}</div><p className="hint">Auto / Manual switching will be available during live battles without resetting battle state.</p></section>
            <section className="panel roadmap-panel"><div className="panel-heading"><div><span className="eyebrow">03 / WORKSPACE</span><h3>Build status</h3></div><span className="build-version">0.2.0</span></div><div className="roadmap-list"><div className="roadmap-row done"><span>✓</span><div><strong>Responsive app foundation</strong><small>Desktop and mobile layout</small></div><em>Ready</em></div><div className="roadmap-row done"><span>✓</span><div><strong>Ruleset configuration</strong><small>Generation, PvP tier and automatic PvE facility</small></div><em>Ready</em></div><div className="roadmap-row done"><span>✓</span><div><strong>Local team builder</strong><small>Six slots, set variants and browser storage</small></div><em>Ready</em></div><button type="button" className="roadmap-row done" onClick={() => setActivePage("Legality analysis")}><span>✓</span><div><strong>Legality analysis</strong><small>Generation-aware Showdown validation</small></div><em>Ready · Open</em></button><button type="button" className="roadmap-row done" onClick={() => setActivePage("Simulator")}><span>✓</span><div><strong>Battle simulation</strong><small>Pokémon Showdown engine, Auto and Manual control</small></div><em>Ready · Open</em></button></div></section>
          </section>
        </>}
        {activePage === "Team Builder" && <>
          <section className="intro"><div><div className="eyebrow">LOCAL TEAM WORKSPACE</div><h2>Build and tune your teams.</h2><p>Teams and Pokémon sets save automatically in this browser. Each team supports six slots and multiple builds per Pokémon.</p></div></section>
          <div className="team-builder-layout">
            <section className="panel team-list-panel">
              <div className="panel-heading"><div><span className="eyebrow">TEAM LIBRARY</span><h3>Your teams</h3></div><button className="primary-button" onClick={createTeam}>+ New</button></div>
              {teams.length === 0 ? <div className="empty-state"><strong>No teams yet</strong><p>Create a team to start adding Pokémon.</p></div> : <div className="team-list">{teams.map(team => <button key={team.id} className={activeTeam?.id === team.id ? "team-list-item current" : "team-list-item"} onClick={() => { setActiveTeamId(team.id); setSelectedSlotId(team.slots[0]?.id || ""); }}><span><strong>{team.name || "Untitled team"}</strong><small>{team.slots.length}/6 Pokémon</small></span><span className="team-arrow">›</span></button>)}</div>}
              {activeTeam && <div className="roster-section"><div className="roster-heading"><strong>{activeTeam.name || "Untitled team"}</strong><span>{activeTeam.slots.length}/6</span></div><div className="team-slots">{Array.from({length:6}, (_,i) => activeTeam.slots[i]).map((slot,index) => slot ? <div key={slot.id} className={selectedSlot?.id === slot.id ? "team-slot active-slot" : "team-slot"}><button className="slot-select" onClick={() => setSelectedSlotId(slot.id)}><span className="slot-number">{index+1}</span><span className="slot-name">{activeBuild(slot)?.name || "Empty Pokémon"}</span></button><div className="slot-reorder"><button type="button" aria-label={`Move ${activeBuild(slot)?.name || "Pokémon"} up`} disabled={index === 0} onClick={() => moveSlot(slot.id,-1)}>↑</button><button type="button" aria-label={`Move ${activeBuild(slot)?.name || "Pokémon"} down`} disabled={index === activeTeam.slots.length-1} onClick={() => moveSlot(slot.id,1)}>↓</button></div><button className="slot-remove" aria-label="Remove Pokémon slot" onClick={() => removeSlot(slot.id)}>×</button></div> : <div className="team-slot vacant" key={"empty-"+index}><span className="slot-number">{index+1}</span><span>Empty slot</span></div>)}</div>{activeTeam.slots.length < 6 && <button className="add-pokemon-button" onClick={addPokemon}>+ Add Pokémon</button>}</div>}
              <p className="hint team-format-hint">Format: Gen {settings.generation} · {settings.battleType === "PvP" ? settings.tier : settings.facility}</p>
            </section>
            <section className="panel team-editor-panel">
              {!activeTeam ? <div className="empty-state"><strong>Select or create a team</strong><p>Your team editor will appear here.</p></div> : <>
                <div className="panel-heading team-title-row"><div><span className="eyebrow">TEAM EDITOR</span><input className="team-name-input" aria-label="Team name" value={activeTeam.name} onChange={e => renameTeam(e.target.value)} /></div><div className="team-actions"><button className="secondary-button" onClick={openTeamText}>Import / Export</button><button className="secondary-button" onClick={exportTeam}>Export JSON</button><button className="danger-button" onClick={deleteTeam}>Delete team</button></div></div>
                {teamTextOpen && <div className="showdown-import-panel"><div className="editor-section-title">Pokémon Showdown text import / export <small>Paste a team or copy this export into Showdown.</small></div><textarea aria-label="Pokémon Showdown team text" value={teamText} onChange={e => { setTeamText(e.target.value); setTeamTextError(""); }} rows={12} spellCheck={false} placeholder="Pokémon Showdown team text…" /><div className="team-actions"><button className="primary-button" onClick={importShowdownText}>Import team</button><button className="secondary-button" onClick={copyShowdownText}>Copy export</button><button className="secondary-button" onClick={() => setTeamTextOpen(false)}>Close</button></div>{teamTextError && <p className="hint">{teamTextError}</p>}</div>}
                {selectedSlot && selectedBuild ? <div className="pokemon-editor">
                  <div className="editor-heading"><div><span className="eyebrow">POKÉMON SET</span><h3>{selectedBuild.name || "New Pokémon"}</h3></div><div className="team-actions"><select aria-label="Active build" value={selectedBuild.id} onChange={e => patchTeam(activeTeam.id, t => ({...t, slots:t.slots.map(s => s.id === selectedSlot.id ? {...s, activeBuildId:e.target.value} : s)}))}>{selectedSlot.builds.map((b,i) => <option value={b.id} key={b.id}>{b.label || "Build "+(i+1)}</option>)}</select><button className="secondary-button" onClick={createBuildVariant}>+ Variant</button><button className="danger-button" disabled={selectedSlot.builds.length < 2} onClick={deleteSelectedBuild}>Delete build</button></div></div>
                  <div className={`legality-note legality-${legality.status.toLowerCase().replace(/[^a-z]+/g,"-")}`}><span className="status-dot status-muted" /> Team legality: <strong>{legality.status}</strong><span>{legality.messages.join(" · ")}</span></div>
                  {selectedSpecies ? <div className="species-summary">
                    <div className="species-summary-top"><strong>{selectedSpecies.name}</strong><span>National Dex #{selectedSpecies.num}</span><span className="type-tags">{selectedSpecies.types.map(type => <em key={type} className={"type-tag type-"+type.toLowerCase()}>{type}</em>)}</span></div>
                    <div className="species-abilities"><small>Species abilities</small>{speciesAbilities.map(ability => <span key={ability}>{ability}</span>)}</div>
                  </div> : selectedBuild.name.trim() ? <div className="species-summary species-unmatched">No exact species match in Generation {settings.generation}. You can keep custom text for experimental sets.</div> : null}
                  <div className="pokemon-fields">
                    <label className="field"><span>Pokémon species</span><input list="showdown-species" value={selectedBuild.name} placeholder="Search Pokémon…" onChange={e => { const name=e.target.value; const match=speciesOptions.find(p => p.name.toLowerCase() === name.toLowerCase()); patchBuild({name,gender:match?.gender === "N" || match?.gender === "M" || match?.gender === "F" ? match.gender : ""}); }} /></label>
                    <label className="field"><span>Nickname</span><input value={selectedBuild.nickname} placeholder="Optional" onChange={e => patchBuild({nickname:e.target.value})} /></label>
                    <label className="field"><span>Level</span><input type="number" min="1" max="100" value={selectedBuild.level} onChange={e => patchBuild({level:Math.max(1,Math.min(100,Number(e.target.value)||1))})} /></label>
                    <label className="field"><span>Gender</span><select value={selectedSpecies?.gender === "N" ? "N" : selectedSpecies?.gender === "M" || selectedSpecies?.gender === "F" ? selectedSpecies.gender : selectedBuild.gender} disabled={selectedSpecies?.gender === "N" || selectedSpecies?.gender === "M" || selectedSpecies?.gender === "F"} onChange={e => patchBuild({gender:e.target.value})}><option value="">Auto / unspecified</option><option value="M">Male</option><option value="F">Female</option><option value="N">Genderless</option></select></label>
                    <label className="field"><span>Ability</span><input list="showdown-abilities" value={selectedBuild.ability} placeholder="Search ability…" onChange={e => patchBuild({ability:e.target.value})} /></label>
                    <label className="field"><span>Nature</span><select value={selectedBuild.nature} onChange={e => patchBuild({nature:e.target.value})}>{natures.map(n => <option key={n}>{n}</option>)}</select></label>
                    <label className="field"><span>Held item</span><input list="showdown-items" value={selectedBuild.item} placeholder="Search item…" onChange={e => patchBuild({item:e.target.value})} /></label>
                    <label className="field"><span>Happiness</span><input type="number" min="0" max="255" value={selectedBuild.happiness} onChange={e => patchBuild({happiness:Math.max(0,Math.min(255,Number(e.target.value)||0))})} /></label>
                    <label className="field"><span>Shiny</span><select value={selectedBuild.shiny ? "yes" : "no"} onChange={e => patchBuild({shiny:e.target.value === "yes"})}><option value="no">No</option><option value="yes">Yes</option></select></label>
                    {settings.generation >= 9 && <label className="field"><span>Tera type</span><select value={selectedBuild.teraType} onChange={e => patchBuild({teraType:e.target.value})}><option value="">Default</option>{["Normal","Fire","Water","Electric","Grass","Ice","Fighting","Poison","Ground","Flying","Psychic","Bug","Rock","Ghost","Dragon","Dark","Steel","Fairy","Stellar"].map(type => <option key={type}>{type}</option>)}</select></label>}
                    <datalist id="showdown-species">{speciesOptions.map(p => <option key={p.name} value={p.name} />)}</datalist>
                    <datalist id="showdown-abilities">{(speciesAbilities.length ? speciesAbilities : abilityOptions.map(x => x.name)).map(name => <option key={name} value={name} />)}</datalist>
                    <datalist id="showdown-items">{itemOptions.map(item => <option key={item.name} value={item.name} />)}</datalist>
                    <datalist id="showdown-moves">{moveOptions.map(option => <option key={option.name} value={option.name} />)}</datalist>
                  </div>
                  {selectedSpecies && <div className="editor-section final-stats-section"><div className="editor-section-title">Final stats <small>Level {selectedBuild.level} · {selectedBuild.nature} · Ability and item modifiers included</small></div><div className="base-stat-row">{statNames.map((label, index) => { const stat = (["hp","atk","def","spa","spd","spe"] as const)[index]; const baseValue = calculateFinalStat(selectedSpecies.baseStats[stat], selectedBuild.ivs[label], selectedBuild.evs[label], selectedBuild.level, stat, selectedBuild.nature); const value = calculateBattleStat(baseValue, stat, selectedBuild.ability, selectedBuild.item); return <div key={stat}><small>{label}</small><strong>{value}</strong>{value !== baseValue && <small className="stat-modifier">Base {baseValue}</small>}</div>; })}<div className="bst-total"><small>Total</small><strong>{statNames.reduce((sum, label, index) => { const stat = (["hp","atk","def","spa","spd","spe"] as const)[index]; const baseValue = calculateFinalStat(selectedSpecies.baseStats[stat], selectedBuild.ivs[label], selectedBuild.evs[label], selectedBuild.level, stat, selectedBuild.nature); return sum + calculateBattleStat(baseValue, stat, selectedBuild.ability, selectedBuild.item); }, 0)}</strong></div></div>{["wise glasses", "muscle band"].includes(selectedBuild.item.toLowerCase()) && <p className="stat-total">Damage modifiers: {selectedBuild.item.toLowerCase() === "wise glasses" ? "Wise Glasses: special-move damage ×1.1." : "Muscle Band: physical-move damage ×1.1."} These boost move damage, not the displayed offensive stat.</p>}</div>}
                  <div className="editor-section"><div className="editor-section-title">Moves <small>{moveOptions.length} moves in Gen {settings.generation} data</small></div><div className="move-grid">{selectedBuild.moves.map((move,i) => <label className="field" key={i}><span>Move {i+1}</span><input list="showdown-moves" value={move} placeholder="Search move…" onChange={e => { const moves = selectedBuild.moves.map((m,j) => j===i ? e.target.value : m); const hiddenPowerType = settings.generation >= 3 && settings.generation <= 7 ? hiddenPowerTypeFromMove(e.target.value) : undefined; patchBuild({moves, ...(hiddenPowerType ? {ivs:ivsForHiddenPowerType(hiddenPowerType, selectedBuild.ivs)} : {})}); }} /></label>)}</div></div>
                  <div className="editor-section"><div className="editor-section-title">Effort values (EVs) <small>510 total maximum</small></div><div className="stat-grid">{statNames.map(stat => <label className="field" key={stat}><span>{stat}</span><div className="stat-input-pair"><input className="stat-range" aria-label={`${stat} EV slider`} type="range" min="0" max="252" step="1" value={selectedBuild.evs[stat]} onChange={e => patchBuild({evs:{...selectedBuild.evs,[stat]:Number(e.target.value)}})} /><input className="stat-number" aria-label={`${stat} EV`} type="number" min="0" max="252" value={selectedBuild.evs[stat]} onChange={e => patchBuild({evs:{...selectedBuild.evs,[stat]:Math.max(0,Math.min(252,Number(e.target.value)||0))}})} /></div></label>)}</div><p className="stat-total">Total EVs: {Object.values(selectedBuild.evs).reduce((a,b)=>a+b,0)} / 510</p></div>
                  <div className="editor-section"><div className="editor-section-title">Individual values (IVs) <small>Hidden Power helper available in Generations 3-7</small></div>{settings.generation >= 3 && settings.generation <= 7 && <label className="field hidden-power-field"><span>Hidden Power type · auto-set IVs</span><select value={hiddenPowerTypeFromIvs(selectedBuild.ivs)} onChange={e => patchBuild({ivs:ivsForHiddenPowerType(e.target.value, selectedBuild.ivs)})}>{hiddenPowerTypes.map(type => <option key={type} value={type}>{type}</option>)}</select><small>Chooses the closest IV combination that produces the selected type, preserving your current IVs where possible.</small></label>}<div className="stat-grid">{statNames.map(stat => <label className="field" key={stat}><span>{stat}</span><div className="stat-input-pair"><input className="stat-range" aria-label={`${stat} IV slider`} type="range" min="0" max="31" step="1" value={selectedBuild.ivs[stat]} onChange={e => patchBuild({ivs:{...selectedBuild.ivs,[stat]:Number(e.target.value)}})} /><input className="stat-number" aria-label={`${stat} IV`} type="number" min="0" max="31" value={selectedBuild.ivs[stat]} onChange={e => patchBuild({ivs:{...selectedBuild.ivs,[stat]:Math.max(0,Math.min(31,Number(e.target.value)||0))}})} /></div></label>)}</div></div>
                  <label className="field build-label-field"><span>Build label</span><input value={selectedBuild.label} placeholder="e.g. Choice Scarf, Defensive, Setup" onChange={e => patchBuild({label:e.target.value})} /></label>
                </div> : activeTeam.slots.length > 0 ? <div className="empty-state"><strong>Select a Pokémon slot</strong><p>Choose a filled slot above to edit its set.</p></div> : <div className="empty-state"><strong>Your team is empty</strong><p>Add a Pokémon to begin building your team.</p></div>}
              </>}
            </section>
          </div>
          <p className="hint team-storage-hint">Local-first storage: your teams remain on this device. Account sync and Google login will be connected separately.</p>
        </>}
        {activePage === "Legality analysis" && <>
          <section className="intro"><div><div className="eyebrow">TEAM VALIDATION</div><h2>Legality analysis.</h2><p>Validate a team of up to six Pokémon against the selected PvP tier or supported facility rules. Battle Tree uses Super Singles restrictions.</p></div></section>
          <section className="panel legality-analysis-panel">
            <div className="panel-heading"><div><span className="eyebrow">ACTIVE RULESET</span><h3>{settings.battleType === "PvP" ? `Generation ${settings.generation} · ${settings.tier}` : settings.generation === 7 ? "Generation 7 · Battle Tree Super Singles" : `Generation ${settings.generation} · ${settings.facility || "PvE facility"}`}</h3></div><button type="button" className="secondary-button" onClick={() => setActivePage("Team Builder")}>Open Team Builder</button></div>
            <label className="field"><span>Team to analyse</span><select value={activeTeam?.id || ""} onChange={e => setActiveTeamId(e.target.value)}><option value="" disabled>Select a team...</option>{teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
            {!activeTeam ? <div className="empty-state"><strong>No team available</strong><p>Create a team in Team Builder before running legality analysis.</p></div> : <>
              <div className={`legality-report legality-${legality.status.toLowerCase().replace(/[^a-z]+/g,"-")}`}>
                <div className="legality-report-heading"><span className="status-dot status-muted" /><strong>{legality.status}</strong><span>{activeTeam.slots.filter(slot => activeBuild(slot)?.name.trim()).length} / 6 {settings.battleType === "PvE" && settings.generation === 7 ? "registered · choose 3" : "Pokémon selected"}</span></div>
                <ul>{legality.messages.map((message,index) => <li key={index}>{message}</li>)}</ul>
              </div>
              <div className="legality-team-list">{activeTeam.slots.map((slot,index) => { const build = activeBuild(slot); return <div className="legality-team-row" key={slot.id}><span>{index+1}</span><strong>{build?.nickname || build?.name || "Empty slot"}</strong><small>{build?.name ? [build.level ? `Lv. ${build.level}` : "",build.ability,build.item].filter(Boolean).join(" · ") : "Add a Pokémon in Team Builder"}</small></div>; })}</div>
            </>}
          </section>
        </>}
        {activePage === "Simulator" && <>
          <section className="intro"><div><div className="eyebrow">BATTLE ENGINE</div><h2>Run the simulator.</h2><p>Execute a Generation {settings.generation} battle using the selected game rules and a saved opponent team.</p></div></section>
          <section className="panel battle-setup-panel">
            <div className="panel-heading"><div><span className="eyebrow">BATTLE SETUP</span><h3>Choose teams</h3></div><span className="build-version">{settings.mode} mode</span></div>
            <div className="field-grid simulator-rules-grid">
              <label className="field"><span>Battle type</span><select value={settings.battleType} onChange={e => { updateSetting("battleType", e.target.value as BattleType); if (e.target.value === "PvE") setOpponentSource("Saved teams"); setBattleError(""); }}><option value="PvP">PvP</option><option value="PvE">PvE</option></select></label>
              <label className="field"><span>Generation</span><select value={settings.generation} onChange={e => updateSetting("generation", Number(e.target.value))}>{generations.map(generation => <option key={generation} value={generation} disabled={settings.battleType === "PvE" && generation < 3}>Generation {generation}</option>)}</select></label>
              <label className="field"><span>Game version</span><select value={settings.gameVersion} onChange={e => updateSetting("gameVersion", e.target.value)}>{(gameVersions[settings.generation] || []).map(version => <option key={version} value={version}>{version}</option>)}</select></label>
              {settings.battleType === "PvP" ? <label className="field"><span>Format / tier</span><select value={settings.tier} onChange={e => updateSetting("tier", e.target.value)}>{tiers.map(tier => <option key={tier}>{tier}</option>)}</select></label> : <label className="field"><span>Battle facility</span><select value={settings.facility} onChange={e => updateSetting("facility", e.target.value)}>{facilitiesFor(settings.generation, settings.gameVersion).map(facility => <option key={facility}>{facility}</option>)}</select></label>}
              {benchmarkMode === "Teams" && <label className="field"><span>Your team</span><select value={battlePlayerTeamId || activeTeam?.id || ""} onChange={e => setBattlePlayerTeamId(e.target.value)}><option value="">Select team</option>{teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>}
              {benchmarkMode === "Teams" && (settings.battleType === "PvP" ? <label className="field"><span>Opponent source</span><select value={opponentSource} onChange={e => { setOpponentSource(e.target.value as "Saved teams" | "Auto Teams"); setBattleError(""); }}><option>Saved teams</option><option>Auto Teams</option></select></label> : <div className="field"><span>Opponent source</span><div className="derived-value">In-game facility trainers</div></div>)}
              {settings.battleType === "PvP" && opponentSource === "Saved teams" ? <label className="field"><span>Single-battle opponent</span><select value={battleOpponentTeamId || teams.find(team => team.id !== (battlePlayerTeamId || activeTeam?.id))?.id || ""} onChange={e => setBattleOpponentTeamId(e.target.value)}><option value="">Select opponent</option>{teams.filter(team => team.id !== (battlePlayerTeamId || activeTeam?.id)).map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label> : <div className="field"><span>Auto Teams pool</span><div className="derived-value">{settings.battleType === "PvP" ? onlineOpponentPool.filter(team => team.format === battleFormat()).length + " verified " + settings.tier + " teams loaded" : "Authentic NPC trainer dataset"}</div></div>}
              <div className="field"><span>Ruleset</span><div className="derived-value">Gen {settings.generation} · {settings.battleType === "PvP" ? settings.tier : `${settings.gameVersion} · ${settings.facility}`}</div></div>
            </div>
            {settings.battleType === "PvP" && opponentSource === "Auto Teams" && <div className="battle-actions"><button type="button" className="secondary-button" onClick={fetchOnlineOpponent} disabled={fetchingOpponent}>{fetchingOpponent ? "Loading team pool…" : onlineOpponentPool.length ? "Refresh Auto Teams pool" : "Load Auto Teams pool"}</button><span className="hint">{onlineOpponent ? "Example: " + onlineOpponent.name + " · " + onlineOpponent.source + (onlineOpponent.author ? " · " + onlineOpponent.author : "") : "Loads the published sample archive. The all-team run tests every distinct valid team 100 times."}</span></div>}
            
            {opponentSourceError && <p className="battle-error">{opponentSourceError}</p>}
            {(settings.tier === "VGC" || settings.tier === "Custom") && <p className="battle-warning">This selection runs in the generation's Custom Game sandbox. VGC regulation and custom tier rules are not enforced.</p>}
            <section className="benchmark-panel">
              <div className="editor-section-title">Simulation analysis <small>100 battles per matchup</small></div>
              <label className="field"><span>Benchmark type</span><select value={benchmarkMode} onChange={e => { const next = e.target.value as BenchmarkMode; setBenchmarkMode(next); if (next === "Single Pokémon") setOpponentSource("Auto Teams"); setBenchmarkError(""); }}><option value="Teams">Full team vs full team</option><option value="Single Pokémon">Single Pokémon vs all meta Pokémon</option></select></label>
              {benchmarkMode === "Single Pokémon" ? <>
                <label className="field"><span>Pokémon build</span><select value={selectedSinglePokemon?.key || ""} onChange={e => setSelectedSinglePokemonKey(e.target.value)}>{singlePokemonOptions.map(option => <option key={option.key} value={option.key}>{option.team.name} · {option.build.nickname || option.build.name} ({option.build.name})</option>)}</select></label>
                <p className="hint">Runs one saved Pokémon against every distinct individual set found in valid published {settings.tier} sample teams for Generation {settings.generation}. Each matchup is a separate 1v1 with no teammates or switching. 100 battles per opposing set.</p>
                {settings.battleType !== "PvP" && <p className="battle-warning">Switch to PvP to use the published meta Pokémon dataset.</p>}
              </> : <p className="hint">Runs 100 battles per opponent and records every matchup in Matchup Analysis. PvP Auto Teams uses the published sample archive. Saved teams tests every other complete team in your local team library. PvE draws opponents from the selected game's in-game facility trainer pool. Unsupported facilities stop with an explicit error.</p>}
              <div className="battle-actions">
                <button type="button" className="primary-button" onClick={runFullBenchmark} disabled={benchmarkBusy || battleActive || (benchmarkMode === "Single Pokémon" && settings.battleType !== "PvP")}>{benchmarkBusy ? "Simulation running…" : benchmarkMode === "Single Pokémon" ? "Run 1 vs Meta · 100 per matchup" : "Run simulator · 100 per team"}</button>
                {benchmarkBusy && <button type="button" className="secondary-button" onClick={() => { benchmarkCancel.current = true; }}>Cancel simulation</button>}
                <button type="button" className="secondary-button" onClick={() => setActivePage("Matchup Analysis")}>View Matchup Analysis</button>
              </div>
              {benchmarkProgress && <div className="benchmark-results">
                <strong>{benchmarkProgress.completed.toLocaleString()} / {benchmarkProgress.total.toLocaleString()} battles completed</strong>
                <div className="benchmark-summary"><span>Wins: {benchmarkProgress.wins}</span><span>Losses: {benchmarkProgress.losses}</span><span>Ties: {benchmarkProgress.ties}</span><span>Win rate: {benchmarkProgress.completed ? ((benchmarkProgress.wins / benchmarkProgress.completed) * 100).toFixed(1) : "0.0"}%</span></div>
                {benchmarkBusy && <p className="hint">Current opponent: {benchmarkProgress.currentOpponent}</p>}
                {benchmarkCoverage && <p className="hint">{benchmarkMode === "Single Pokémon" ? "Source Pokémon sets" : "Source teams"}: {benchmarkCoverage.sourceCount} · tested {benchmarkMode === "Single Pokémon" ? "sets" : "teams"}: {benchmarkCoverage.validCount} · skipped: {benchmarkCoverage.rejected}. {benchmarkCoverage.sourceUrl.startsWith("http") ? <a href={benchmarkCoverage.sourceUrl} target="_blank" rel="noreferrer">Dataset source</a> : benchmarkCoverage.sourceUrl}</p>}
                <div className="benchmark-matchups">{[...benchmarkProgress.results].sort((a,b) => (b.wins / Math.max(1,b.games)) - (a.wins / Math.max(1,a.games))).map(result => <div key={result.opponentId}><strong>{result.opponentName}</strong><span>{result.wins}W / {result.losses}L / {result.ties}T</span></div>)}</div>
              </div>}
              {benchmarkError && <p className="battle-error">{benchmarkError}</p>}
            </section>
            {simulationLegalityWarning && <p className="battle-warning">{simulationLegalityWarning}</p>}
            {battleError && <p className="battle-error">{battleError}</p>}
            <div className="battle-actions"><button type="button" className="primary-button" onClick={startBattle}>Start single battle</button><button type="button" className="secondary-button" onClick={stopBattle} disabled={!battleActive}>End battle</button><button type="button" className="secondary-button" onClick={() => setSettings(s => ({...s, mode: s.mode === "Auto" ? "Manual" : "Auto"}))}>{settings.mode === "Auto" ? "Switch to Manual" : "Switch to Auto"}</button></div>
          </section>
          {(battleActive || battleLog.length > 0) && <section className="panel battle-live-panel">
            <div className="panel-heading"><div><span className="eyebrow">LIVE BATTLE</span><h3>{battleActive ? "Battle in progress" : "Battle finished"}</h3></div><span className="saved-indicator"><span className="status-dot" /> {settings.mode} control</span></div>
            {manualRequest && settings.mode === "Manual" && <div className="manual-controls">
              <strong>Your decision</strong>
              {manualRequest.teamPreview && <div className="team-preview-choice"><p className="hint">Team preview is active. Choose {manualRequest.maxTeamSize || manualRequest.side?.pokemon.length || 6} Pokémon in your preferred order.</p><div className="team-preview-choice-list">{(manualRequest.side?.pokemon || []).map((pokemon,index) => { const slot = index + 1; const selected = teamPreviewSelection.includes(slot); const limit = manualRequest.maxTeamSize || manualRequest.side?.pokemon.length || 6; return <button type="button" key={pokemon.ident} className={selected ? "secondary-button selected" : "secondary-button"} disabled={!selected && teamPreviewSelection.length >= limit} onClick={() => setTeamPreviewSelection(current => selected ? current.filter(value => value !== slot) : [...current, slot])}>{selected ? `${teamPreviewSelection.indexOf(slot)+1}. ` : ""}{pokemon.ident.split(": ").slice(1).join(": ") || pokemon.details}</button>; })}</div><button type="button" className="secondary-button" disabled={teamPreviewSelection.length !== (manualRequest.maxTeamSize || manualRequest.side?.pokemon.length || 6)} onClick={() => submitBattleChoice(`team ${teamPreviewSelection.join("")}`)}>Confirm selection</button></div> }
              {manualRequest.active?.[0]?.moves && <div className="battle-choice-grid">{manualRequest.active[0].moves.map((move,index) => <button type="button" className="secondary-button" key={move.id || move.move} disabled={move.disabled} onClick={() => submitBattleChoice(`move ${index+1}`)}>{move.move} <small>{move.pp ?? "?"}/{move.maxpp ?? "?"} PP</small></button>)}</div>}
              {manualRequest.forceSwitch?.some(Boolean) && <div className="battle-choice-grid">{(manualRequest.side?.pokemon || []).map((pokemon,index) => ({pokemon,index})).filter(({pokemon}) => !pokemon.active && !pokemon.condition.endsWith(" fnt")).map(({pokemon,index}) => <button type="button" className="secondary-button" key={pokemon.ident} onClick={() => submitBattleChoice(`switch ${index+1}`)}>{pokemon.ident.split(": ").slice(1).join(": ") || pokemon.details}</button>)}</div>}
              {!manualRequest.active?.[0]?.moves?.length && !manualRequest.forceSwitch?.some(Boolean) && !manualRequest.teamPreview && <p className="hint">Waiting for the next decision.</p>}
            </div>}
            <div className="battle-log" aria-live="polite">{battleLog.length ? battleLog.map((line,index) => <div key={index}>{line}</div>) : <p>Waiting for the battle to begin…</p>}</div>
          </section>}
        </>}
        {activePage === "Matchup Analysis" && <>
          <section className="intro"><div><div className="eyebrow">ANALYSIS WORKSPACE</div><h2>Matchup Analysis</h2><p>Results from the latest benchmark, with 100 battles per matchup.</p></div></section>
          {!matchupRun ? <section className="panel empty-state"><strong>No simulation results yet</strong><p>Run the Simulator to test a full team or an individual Pokémon against the available opponents. Results will be saved here automatically.</p><button type="button" className="primary-button" onClick={() => setActivePage("Simulator")}>Open Simulator</button></section> : <>
            <section className="panel">
              <div className="panel-heading"><div><span className="eyebrow">LATEST RUN</span><h3>{matchupRun.playerTeamName}</h3></div><span className="build-version">{new Date(matchupRun.createdAt).toLocaleString()}</span></div>
              <p className="hint">Gen {matchupRun.generation} · {matchupRun.gameVersion} · {matchupRun.battleType === "PvP" ? matchupRun.tier : matchupRun.facility} · {matchupRun.opponentSource}</p>
              <div className="benchmark-summary"><span>{matchupRun.benchmarkMode === "Single Pokémon" ? "Meta Pokémon sets tested" : "Teams tested"}: {matchupRun.validCount}</span><span>Battles: {matchupRun.completed.toLocaleString()} / {matchupRun.total.toLocaleString()}</span><span>Wins: {matchupRun.wins}</span><span>Losses: {matchupRun.losses}</span><span>Ties: {matchupRun.ties}</span><span>Win rate: {matchupRun.completed ? (matchupRun.wins / matchupRun.completed * 100).toFixed(1) : "0.0"}%</span></div>
              <p className="hint">Source entries: {matchupRun.sourceCount} · skipped: {matchupRun.rejected} · Saved locally in this browser.</p>
              {matchupRun.sourceUrl.startsWith("http") && <p className="hint"><a href={matchupRun.sourceUrl} target="_blank" rel="noreferrer">Open opponent dataset</a></p>}
            </section>
            {matchupRun.analysis && <section className="panel">
              <div className="panel-heading"><div><span className="eyebrow">COMBAT TELEMETRY</span><h3>Damage performance</h3></div><span className="build-version">{matchupRun.completed.toLocaleString()} battles</span></div>
              <p className="hint">Actual HP lost, aggregated across completed battles. Damage ratio = source-attributed damage dealt ÷ total damage taken. Damage is credited to a Pokémon only when the battle log identifies its source; residual and unattributed damage is reported separately. Move rankings include only damage explicitly attributed to a move.</p>
              <div className="damage-overview-grid">
                <div><small>{matchupRun.benchmarkMode === "Single Pokémon" ? "Your Pokémon damage dealt" : "Your team damage dealt"}</small><strong>{matchupRun.analysis.player.pokemon.reduce((sum, p) => sum + p.damageDealt, 0).toLocaleString()}</strong></div>
                <div><small>{matchupRun.benchmarkMode === "Single Pokémon" ? "Your Pokémon damage taken" : "Your team damage taken"}</small><strong>{matchupRun.analysis.player.pokemon.reduce((sum, p) => sum + p.damageTaken, 0).toLocaleString()}</strong></div>
                <div><small>Opponent damage dealt</small><strong>{matchupRun.analysis.opponent.pokemon.reduce((sum, p) => sum + p.damageDealt, 0).toLocaleString()}</strong></div>
                <div><small>Unattributed damage</small><strong>{matchupRun.analysis.unattributedDamage.toLocaleString()}</strong></div>
              </div>
              <div className="damage-analysis-grid">
                <div>
                  <h4>{matchupRun.benchmarkMode === "Single Pokémon" ? "Selected Pokémon" : "Your Pokémon"}</h4>
                  <div className="damage-table">
                    <div className="damage-table-head"><span>Pokémon</span><span>Dealt</span><span>Taken</span><span>Ratio</span><span>Faints</span></div>
                    {[...matchupRun.analysis.player.pokemon].sort((a,b) => b.damageDealt-a.damageDealt).map(p => <div className="damage-table-row" key={p.pokemon}><strong>{p.pokemon}</strong><span>{p.damageDealt.toLocaleString()}</span><span>{p.damageTaken.toLocaleString()}</span><span>{p.damageTaken ? (p.damageDealt/p.damageTaken).toFixed(2) : p.damageDealt ? "∞" : "0.00"}</span><span>{p.faints}</span></div>)}
                  </div>
                </div>
                <div>
                  <h4>Opponent Pokémon</h4>
                  <div className="damage-table">
                    <div className="damage-table-head"><span>Pokémon</span><span>Dealt</span><span>Taken</span><span>Ratio</span><span>Faints</span></div>
                    {[...matchupRun.analysis.opponent.pokemon].sort((a,b) => b.damageDealt-a.damageDealt).map(p => <div className="damage-table-row" key={p.pokemon}><strong>{p.pokemon}</strong><span>{p.damageDealt.toLocaleString()}</span><span>{p.damageTaken.toLocaleString()}</span><span>{p.damageTaken ? (p.damageDealt/p.damageTaken).toFixed(2) : p.damageDealt ? "∞" : "0.00"}</span><span>{p.faints}</span></div>)}
                  </div>
                </div>
              </div>
              <div className="damage-analysis-grid damage-moves-grid">
                <div><h4>Your highest-damage moves</h4><div className="damage-move-list">{[...matchupRun.analysis.player.moveDamage].sort((a,b) => b.damage-a.damage).slice(0,10).map(move => <div key={move.move}><strong>{move.move}</strong><span>{move.damage.toLocaleString()} damage · {(move.uses || 0).toLocaleString()} uses · {move.hits.toLocaleString()} hit packets · {move.uses ? Math.round(move.damage / move.uses).toLocaleString() : "0"} damage/use</span></div>)}{!matchupRun.analysis.player.moveDamage.length && <p className="hint">No move-attributed damage was recorded.</p>}</div></div>
                <div><h4>Highest-damage moves against you</h4><div className="damage-move-list">{[...matchupRun.analysis.opponent.moveDamage].sort((a,b) => b.damage-a.damage).slice(0,10).map(move => <div key={move.move}><strong>{move.move}</strong><span>{move.damage.toLocaleString()} damage · {(move.uses || 0).toLocaleString()} uses · {move.hits.toLocaleString()} hit packets · {move.uses ? Math.round(move.damage / move.uses).toLocaleString() : "0"} damage/use</span></div>)}{!matchupRun.analysis.opponent.moveDamage.length && <p className="hint">No move-attributed damage was recorded.</p>}</div></div>
              </div>
            </section>}
            <section className="panel">
              <div className="panel-heading"><div><span className="eyebrow">{matchupRun.benchmarkMode === "Single Pokémon" ? "PER-POKÉMON RESULTS" : "PER-TEAM RESULTS"}</span><h3>Opponent matchups</h3></div><span className="build-version">{matchupRun.results.length} {matchupRun.benchmarkMode === "Single Pokémon" ? "sets" : "teams"}</span></div>
              <div className="benchmark-matchups matchup-analysis-list">{[...matchupRun.results].sort((a,b) => (b.wins / Math.max(1,b.games)) - (a.wins / Math.max(1,a.games))).map(result => <div key={result.opponentId}><strong>{result.opponentName}</strong><span>{result.wins}W / {result.losses}L / {result.ties}T · {result.games ? (result.wins / result.games * 100).toFixed(1) : "0.0"}% win rate</span></div>)}</div>
            </section>
          </>}
        </>}
        <footer>Pokémon Battle Lab <span>·</span> An independent team analysis tool</footer>
      </section>
    </main>
  );
}
