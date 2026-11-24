import { useEffect, useMemo, useRef, useState } from "react";
import { Dex } from "@pkmn/dex";
import { BattleStreams, RandomPlayerAI, TeamValidator, Teams } from "@pkmn/sim";
import { loadCompleteOpponentPool, runExhaustiveBenchmark, type BenchmarkProgress, type BenchmarkOpponent } from "./benchmark";

declare const __BUILD_NUMBER__: string;
type BattleType = "PvP" | "PvE";
type BattleMode = "Auto" | "Manual";
type Page = "Overview" | "Team Builder" | "Legality analysis" | "Simulator" | "Matchup Analysis";
const generations = Array.from({ length: 9 }, (_, i) => i + 1);
const tiers = ["Anything Goes", "Ubers", "OU", "UU", "RU", "NU", "PU", "ZU", "Little Cup", "VGC", "Custom"];
const facilityOptionsByGame: Record<number, Record<string, string[]>> = {
  3: { "Ruby / Sapphire": ["Battle Tower"], "Emerald": ["Battle Frontier"], "FireRed / LeafGreen": ["Trainer Tower"] },
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
  moves: string[]; evs: Record<string, number>; ivs: Record<string, number>;
};
type TeamSlot = { id: string; builds: PokemonBuild[]; activeBuildId: string };
type Team = { id: string; name: string; slots: TeamSlot[]; updatedAt: string };
type BattleRequest = { active?: Array<{ moves: Array<{ move: string; id?: string; disabled?: boolean; pp?: number; maxpp?: number }> }>; side?: { pokemon: Array<{ ident: string; details: string; condition: string; active?: boolean }> }; forceSwitch?: boolean[]; teamPreview?: boolean; wait?: boolean };
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
};
function readMatchupRun(): MatchupAnalysisRun | null {
  try { const value = localStorage.getItem("battle-lab-matchup-results"); return value ? JSON.parse(value) as MatchupAnalysisRun : null; }
  catch { return null; }
}
const statNames = ["HP", "Atk", "Def", "SpA", "SpD", "Spe"];
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
  return { id: uid(), name, label: "", nickname: "", level: 100, gender: "", ability: "", nature: "Hardy", item: "", moves: ["","","",""], evs: { HP:0, Atk:0, Def:0, SpA:0, SpD:0, Spe:0 }, ivs: { HP:31, Atk:31, Def:31, SpA:31, SpD:31, Spe:31 } };
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
  const [benchmarkProgress, setBenchmarkProgress] = useState<BenchmarkProgress | null>(null);
  const [benchmarkError, setBenchmarkError] = useState("");
  const [benchmarkCoverage, setBenchmarkCoverage] = useState<{sourceCount:number;validCount:number;rejected:number;sourceUrl:string} | null>(null);
  const [matchupRun, setMatchupRun] = useState<MatchupAnalysisRun | null>(readMatchupRun);
  const benchmarkCancel = useRef(false);
  const [battleActive, setBattleActive] = useState(false);
  const [battleLog, setBattleLog] = useState<string[]>([]);
  const [battleError, setBattleError] = useState("");
  const [manualRequest, setManualRequest] = useState<BattleRequest | null>(null);
  const battleController = useRef<BattleController | null>(null);
  const battleModeRef = useRef(settings.mode);
  useEffect(() => { localStorage.setItem("battle-lab-settings", JSON.stringify(settings)); }, [settings]);
  useEffect(() => { battleModeRef.current = settings.mode; }, [settings.mode]);
  useEffect(() => { localStorage.setItem("battle-lab-teams", JSON.stringify(teams)); }, [teams]);
  useEffect(() => { if (matchupRun) localStorage.setItem("battle-lab-matchup-results", JSON.stringify(matchupRun)); }, [matchupRun]);
  const updateSetting = <K extends keyof Settings>(key: K, value: Settings[K]) => setSettings(s => normalizeSettings({ ...s, [key]: value }));
  const activeTeam = teams.find(t => t.id === activeTeamId) || teams[0];
  const selectedSlot = activeTeam?.slots.find(s => s.id === selectedSlotId) || activeTeam?.slots[0];
  const selectedBuild = selectedSlot ? activeBuild(selectedSlot) : undefined;
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
                "All six sets pass Generation 7 Showdown set validation and Battle Tree Super Singles restrictions.",
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

    const tierIds: Record<string, string> = {
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
        : { status: "Legal", messages: [`All six sets pass the Generation ${settings.generation} ${settings.tier} validator.`] };
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
  const makeBattleSets = (team: Team, generation: number) => team.slots.map(slot => {
    const build = activeBuild(slot);
    const set: Record<string, unknown> = {
      name: build.nickname || build.name,
      species: build.name,
      level: build.level,
      moves: build.moves.filter(Boolean),
      evs: { hp: build.evs.HP, atk: build.evs.Atk, def: build.evs.Def, spa: build.evs.SpA, spd: build.evs.SpD, spe: build.evs.Spe },
      ivs: { hp: build.ivs.HP, atk: build.ivs.Atk, def: build.ivs.Def, spa: build.ivs.SpA, spd: build.ivs.SpD, spe: build.ivs.Spe },
    };
    if (generation >= 2 && build.item) set.item = build.item;
    if (generation >= 3) {
      if (build.ability) set.ability = build.ability;
      set.nature = build.nature;
    }
    if (generation >= 2 && build.gender) set.gender = build.gender;
    return set;
  });
  const battleFormat = () => {
    if (settings.battleType === "PvE" || settings.tier === "Custom" || settings.tier === "VGC") return `gen${settings.generation}customgame`;
    const ids: Record<string, string> = { "Anything Goes": "anythinggoes", Ubers: "ubers", OU: "ou", UU: "uu", RU: "ru", NU: "nu", PU: "pu", ZU: "zu", "Little Cup": "lc" };
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
    const playerId = battlePlayerTeamId || activeTeam?.id || "";
    const playerTeam = teams.find(team => team.id === playerId);
    if (!playerTeam || playerTeam.slots.length !== 6 || !playerTeam.slots.every(slot => {
      const build = activeBuild(slot);
      return Boolean(build?.name.trim() && build.moves.some(move => move.trim()));
    })) {
      setBenchmarkError("Select a complete six-Pokémon team with at least one move per Pokémon.");
      return;
    }
    setBenchmarkBusy(true);
    setBenchmarkError("");
    setBenchmarkProgress(null);
    setBenchmarkCoverage(null);
    benchmarkCancel.current = false;
    try {
      const format = battleFormat();
      const playerSets = makeBattleSets(playerTeam, settings.generation);
      let opponents: BenchmarkOpponent[] = [];
      let sourceCount = 0, rejected = 0, sourceUrl = "Saved teams stored in this browser";
      if (opponentSource === "Auto Teams" && settings.battleType === "PvP") {
        const dataset = await loadCompleteOpponentPool(format);
        opponents = dataset.opponents;
        sourceCount = dataset.sourceCount;
        rejected = dataset.rejected;
        sourceUrl = dataset.sourceUrl;
      } else {
        const otherTeams = teams.filter(team => team.id !== playerTeam.id);
        sourceCount = otherTeams.length;
        for (const team of otherTeams) {
          if (team.slots.length !== 6 || !team.slots.every(slot => {
            const build = activeBuild(slot);
            return Boolean(build?.name.trim() && build.moves.some(move => move.trim()));
          })) { rejected++; continue; }
          const sets = makeBattleSets(team, settings.generation);
          if (settings.battleType === "PvP") {
            try {
              if ((TeamValidator.get(format).validateTeam(sets as any) || []).length) { rejected++; continue; }
            } catch { rejected++; continue; }
          }
          opponents.push({ id: team.id, name: team.name, sets });
        }
      }
      if (!opponents.length) throw new Error("No other complete, usable teams were found. Add another six-Pokémon team or load the online Auto Teams pool.");
      const coverage = { sourceCount, validCount: opponents.length, rejected, sourceUrl };
      setBenchmarkCoverage(coverage);
      const meta = {
        id: uid(), createdAt: new Date().toISOString(), playerTeamId: playerTeam.id, playerTeamName: playerTeam.name,
        generation: settings.generation, gameVersion: settings.gameVersion, battleType: settings.battleType,
        tier: settings.tier, facility: settings.facility, opponentSource: opponentSource === "Auto Teams" && settings.battleType === "PvP" ? "Published sample teams" : "Saved teams",
        ...coverage,
      };
      const result = await runExhaustiveBenchmark({
        format, playerSets, opponents, repetitions: 100,
        shouldCancel: () => benchmarkCancel.current,
        onProgress: progress => {
          setBenchmarkProgress(progress);
          setMatchupRun({ ...meta, ...progress });
        },
      });
      setBenchmarkProgress(result);
      setMatchupRun({ ...meta, ...result });
      if (benchmarkCancel.current) setBenchmarkError("Run cancelled. Matchup Analysis contains completed battles only.");
      else setBenchmarkError("");
      setOpponentSourceError("");
    } catch (error) {
      setBenchmarkError(error instanceof Error ? error.message : "The all-team simulation failed.");
    } finally { setBenchmarkBusy(false); }
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
  const chooseAutomatically = (request: BattleRequest) => {
    if (request.teamPreview) return "team 123456";
    if (request.forceSwitch?.some(Boolean)) {
      const pokemon = request.side?.pokemon || [];
      const available = pokemon.map((p, i) => ({ p, slot: i + 1 })).filter(({p}) => !p.active && !p.condition.endsWith(" fnt"));
      if (available.length) return `switch ${available[Math.floor(Math.random() * available.length)].slot}`;
      return "pass";
    }
    const moves = request.active?.[0]?.moves || [];
    const availableMoves = moves.map((move, i) => ({move, slot: i + 1})).filter(entry => !entry.move.disabled);
    const pokemon = request.side?.pokemon || [];
    const switches = pokemon.map((p, i) => ({p, slot: i + 1})).filter(({p}) => !p.active && !p.condition.endsWith(" fnt"));
    if (availableMoves.length && (Math.random() < 0.85 || !switches.length)) return `move ${availableMoves[Math.floor(Math.random() * availableMoves.length)].slot}`;
    if (switches.length) return `switch ${switches[Math.floor(Math.random() * switches.length)].slot}`;
    return availableMoves.length ? `move ${availableMoves[0].slot}` : "pass";
  };
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
    if (playerTeam.slots.length !== 6 || (!useAutoTeams && opponentTeam!.slots.length !== 6)) { setBattleError("Both registered teams need exactly six Pokémon."); return; }
    const playerComplete = playerTeam.slots.every(slot => {
      const build = activeBuild(slot);
      return Boolean(build.name.trim() && build.moves.some(move => move.trim()));
    });
    const opponentComplete = useOnlineOpponent || (opponentTeam?.slots.every(slot => {
      const build = activeBuild(slot);
      return Boolean(build.name.trim() && build.moves.some(move => move.trim()));
    }) === true);
    if (!playerComplete || !opponentComplete) { setBattleError("Every Pokémon needs a species and at least one move."); return; }
    stopBattle();
    setBattleError("");
    setBattleLog([]);
    setManualRequest(null);
    try {
      const streams = BattleStreams.getPlayerStreams(new BattleStreams.BattleStream());
      const controller: BattleController = { streams, stopped: false };
      battleController.current = controller;
      const p2AI = new RandomPlayerAI(streams.p2);
      void p2AI.start();
      void (async () => {
        try {
          for await (const chunk of streams.omniscient) {
            if (controller.stopped) break;
            const lines = String(chunk).split("\n").filter(Boolean);
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
            const lines = String(chunk).split("\n");
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
      void streams.omniscient.write(`>start ${JSON.stringify({ formatid })}\n>player p1 ${JSON.stringify(p1spec)}\n>player p2 ${JSON.stringify(p2spec)}`);
      setBattleActive(true);
    } catch (error) {
      setBattleError(error instanceof Error ? error.message : "Could not initialize the battle engine.");
      setBattleActive(false);
    }
  };
  const exportTeam = () => {
    if (!activeTeam) return;
    const blob = new Blob([JSON.stringify(activeTeam, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = activeTeam.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + ".json"; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">P</div><div><strong>Pokémon Battle Lab</strong><span>TEAM TESTING SUITE</span></div></div>
        <nav aria-label="Main navigation">
          {(["Overview", "Team Builder", "Legality analysis", "Simulator", "Matchup Analysis"] as Page[]).map(page => <button className={activePage === page ? "nav-item active" : "nav-item"} key={page} onClick={() => setActivePage(page)}><span className="nav-dot" />{page}</button>)}
        </nav>
        <div className="sidebar-note"><span className="status-dot" /><span>Local workspace</span></div>
      </aside>
      <section className="main-content">
        <header className="topbar"><div><div className="eyebrow">POKÉMON TEAM TESTING</div><h1>{activePage}</h1></div><div className="topbar-tag">BUILD <span>{__BUILD_NUMBER__}</span></div></header>
        {activePage === "Overview" && <>
          <section className="intro"><div><div className="eyebrow">SIMULATION SETUP</div><h2>Configure your ruleset.</h2><p>Choose a generation and battle environment. Your settings are saved on this device.</p></div><div className="intro-symbol" aria-hidden="true">◈</div></section>
          <section className="panel setup-panel">
            <div className="panel-heading"><div><span className="eyebrow">01 / CONFIGURATION</span><h3>Battle environment</h3></div><span className="saved-indicator"><span className="status-dot" /> Settings saved locally</span></div>
            <div className="field-grid">
              <label className="field"><span>Generation</span><select value={settings.generation} onChange={e => updateSetting("generation", Number(e.target.value))}>{generations.map(g => <option value={g} key={g} disabled={settings.battleType === "PvE" && g < 3}>Generation {g}</option>)}</select></label>
              <label className="field"><span>Game version</span><select value={settings.gameVersion} onChange={e => updateSetting("gameVersion", e.target.value)}>{(gameVersions[settings.generation] || []).map(version => <option key={version}>{version}</option>)}</select></label>
              <fieldset className="field battle-type-field"><legend>Battle type</legend><div className="segmented">{(["PvP","PvE"] as BattleType[]).map(type => <button type="button" key={type} className={settings.battleType === type ? "selected" : ""} aria-pressed={settings.battleType === type} onClick={() => updateSetting("battleType", type)}>{type}</button>)}</div></fieldset>
              {settings.battleType === "PvP" ? <label className="field conditional-field"><span>PvP tier</span><select value={settings.tier} onChange={e => updateSetting("tier", e.target.value)}>{tiers.map(t => <option key={t}>{t}</option>)}</select></label> : <div className="field conditional-field"><span>PvE facility</span><div className="derived-value">{settings.facility || "No facility configured"}</div></div>}
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
              <div className="panel-heading"><div><span className="eyebrow">YOUR TEAMS</span><h3>Team library</h3></div><button className="primary-button" onClick={createTeam}>+ New team</button></div>
              {teams.length === 0 ? <div className="empty-state"><strong>No teams yet</strong><p>Create a team to start adding Pokémon.</p></div> : <div className="team-list">{teams.map(team => <button key={team.id} className={activeTeam?.id === team.id ? "team-list-item current" : "team-list-item"} onClick={() => { setActiveTeamId(team.id); setSelectedSlotId(team.slots[0]?.id || ""); }}><span><strong>{team.name || "Untitled team"}</strong><small>{team.slots.length}/6 Pokémon</small></span><span className="team-arrow">›</span></button>)}</div>}
            </section>
            <section className="panel team-editor-panel">
              {!activeTeam ? <div className="empty-state"><strong>Select or create a team</strong><p>Your team editor will appear here.</p></div> : <>
                <div className="panel-heading team-title-row"><div><span className="eyebrow">TEAM EDITOR · {activeTeam.slots.length}/6 SLOTS</span><input className="team-name-input" aria-label="Team name" value={activeTeam.name} onChange={e => renameTeam(e.target.value)} /></div><div className="team-actions"><button className="secondary-button" onClick={exportTeam}>Export JSON</button><button className="danger-button" onClick={deleteTeam}>Delete</button></div></div>
                <div className="team-slots">{Array.from({length:6}, (_,i) => activeTeam.slots[i]).map((slot, index) => slot ? <div key={slot.id} className={selectedSlot?.id === slot.id ? "team-slot active-slot" : "team-slot"}><button className="slot-select" onClick={() => setSelectedSlotId(slot.id)}><span className="slot-number">{index+1}</span><span className="slot-name">{activeBuild(slot)?.name || "Empty Pokémon"}</span><small>{slot.builds.length} build{slot.builds.length === 1 ? "" : "s"}</small></button><button className="slot-remove" aria-label="Remove Pokémon slot" onClick={() => removeSlot(slot.id)}>×</button></div> : <div className="team-slot vacant" key={"empty-"+index}><span className="slot-number">{index+1}</span><span>Empty slot</span></div>)}</div>
                {activeTeam.slots.length < 6 && <button className="add-pokemon-button" onClick={addPokemon}>+ Add Pokémon</button>}
                {selectedSlot && selectedBuild ? <div className="pokemon-editor">
                  <div className="editor-heading"><div><span className="eyebrow">POKÉMON SET</span><h3>{selectedBuild.name || "New Pokémon"}</h3></div><div className="team-actions"><select aria-label="Active build" value={selectedBuild.id} onChange={e => patchTeam(activeTeam.id, t => ({...t, slots:t.slots.map(s => s.id === selectedSlot.id ? {...s, activeBuildId:e.target.value} : s)}))}>{selectedSlot.builds.map((b,i) => <option value={b.id} key={b.id}>{b.label || "Build "+(i+1)}</option>)}</select><button className="secondary-button" onClick={createBuildVariant}>+ Variant</button><button className="danger-button" disabled={selectedSlot.builds.length < 2} onClick={deleteSelectedBuild}>Delete build</button></div></div>
                  <div className={`legality-note legality-${legality.status.toLowerCase().replace(/[^a-z]+/g,"-")}`}><span className="status-dot status-muted" /> Team legality: <strong>{legality.status}</strong><span>{legality.messages.join(" · ")}</span></div>
                  {selectedSpecies ? <div className="species-summary">
                    <div className="species-summary-top"><strong>{selectedSpecies.name}</strong><span>National Dex #{selectedSpecies.num}</span><span className="type-tags">{selectedSpecies.types.map(type => <em key={type} className={"type-tag type-"+type.toLowerCase()}>{type}</em>)}</span></div>
                    <div className="species-abilities"><small>Species abilities</small>{speciesAbilities.map(ability => <span key={ability}>{ability}</span>)}</div>
                  </div> : selectedBuild.name.trim() ? <div className="species-summary species-unmatched">No exact species match in Generation {settings.generation}. You can keep custom text for experimental sets.</div> : null}
                  <div className="pokemon-fields">
                    <label className="field"><span>Pokémon species</span><select value={selectedBuild.name} onChange={e => { const name = e.target.value; const match = speciesOptions.find(p => p.name === name); patchBuild({name, gender: match?.gender === "N" || match?.gender === "M" || match?.gender === "F" ? match.gender : ""}); }}><option value="">Select Pokémon...</option>{selectedBuild.name && !selectedSpecies && <option value={selectedBuild.name}>{selectedBuild.name} (custom)</option>}{speciesOptions.map(p => <option value={p.name} key={p.name}>{p.name}</option>)}</select></label>
                    <label className="field"><span>Nickname</span><input value={selectedBuild.nickname} placeholder="Optional" onChange={e => patchBuild({nickname:e.target.value})} /></label>
                    <label className="field"><span>Level</span><input type="number" min="1" max="100" value={selectedBuild.level} onChange={e => patchBuild({level:Math.max(1,Math.min(100,Number(e.target.value)||1))})} /></label>
                    <label className="field"><span>Gender</span><select value={selectedSpecies?.gender === "N" ? "N" : selectedSpecies?.gender === "M" || selectedSpecies?.gender === "F" ? selectedSpecies.gender : selectedBuild.gender} disabled={selectedSpecies?.gender === "N" || selectedSpecies?.gender === "M" || selectedSpecies?.gender === "F"} onChange={e => patchBuild({gender:e.target.value})}><option value="">Auto / unspecified</option><option value="M">Male</option><option value="F">Female</option><option value="N">Genderless</option></select></label>
                    <label className="field"><span>Ability</span><select value={selectedBuild.ability} onChange={e => patchBuild({ability:e.target.value})}><option value="">Select ability...</option>{selectedBuild.ability && !(speciesAbilities.length ? speciesAbilities : abilityOptions.map(x => x.name)).includes(selectedBuild.ability) && <option value={selectedBuild.ability}>{selectedBuild.ability} (custom)</option>}{(speciesAbilities.length ? speciesAbilities : abilityOptions.map(x => x.name)).map(name => <option value={name} key={name}>{name}</option>)}</select></label>
                    <label className="field"><span>Nature</span><select value={selectedBuild.nature} onChange={e => patchBuild({nature:e.target.value})}>{natures.map(n => <option key={n}>{n}</option>)}</select></label>
                    <label className="field"><span>Held item</span><select value={selectedBuild.item} onChange={e => patchBuild({item:e.target.value})}><option value="">No item</option>{selectedBuild.item && !itemOptions.some(i => i.name === selectedBuild.item) && <option value={selectedBuild.item}>{selectedBuild.item} (custom)</option>}{itemOptions.map(i => <option value={i.name} key={i.name}>{i.name}</option>)}</select></label>
                  </div>
                  {selectedSpecies && <div className="editor-section final-stats-section"><div className="editor-section-title">Final stats <small>Level {selectedBuild.level} · {selectedBuild.nature} · Ability and item modifiers included</small></div><div className="base-stat-row">{statNames.map((label, index) => { const stat = (["hp","atk","def","spa","spd","spe"] as const)[index]; const baseValue = calculateFinalStat(selectedSpecies.baseStats[stat], selectedBuild.ivs[label], selectedBuild.evs[label], selectedBuild.level, stat, selectedBuild.nature); const value = calculateBattleStat(baseValue, stat, selectedBuild.ability, selectedBuild.item); return <div key={stat}><small>{label}</small><strong>{value}</strong>{value !== baseValue && <small className="stat-modifier">Base {baseValue}</small>}</div>; })}<div className="bst-total"><small>Total</small><strong>{statNames.reduce((sum, label, index) => { const stat = (["hp","atk","def","spa","spd","spe"] as const)[index]; const baseValue = calculateFinalStat(selectedSpecies.baseStats[stat], selectedBuild.ivs[label], selectedBuild.evs[label], selectedBuild.level, stat, selectedBuild.nature); return sum + calculateBattleStat(baseValue, stat, selectedBuild.ability, selectedBuild.item); }, 0)}</strong></div></div>{["wise glasses", "muscle band"].includes(selectedBuild.item.toLowerCase()) && <p className="stat-total">Damage modifiers: {selectedBuild.item.toLowerCase() === "wise glasses" ? "Wise Glasses: special-move damage ×1.1." : "Muscle Band: physical-move damage ×1.1."} These boost move damage, not the displayed offensive stat.</p>}</div>}
                  <div className="editor-section"><div className="editor-section-title">Moves <small>{moveOptions.length} moves in Gen {settings.generation} data</small></div><div className="move-grid">{selectedBuild.moves.map((move,i) => <label className="field" key={i}><span>Move {i+1}</span><select value={move} onChange={e => patchBuild({moves:selectedBuild.moves.map((m,j) => j===i ? e.target.value : m)})}><option value="">Select move...</option>{move && !moveOptions.some(option => option.name === move) && <option value={move}>{move} (custom)</option>}{moveOptions.map(option => <option value={option.name} key={option.name}>{option.name}</option>)}</select></label>)}</div></div>
                  <div className="editor-section"><div className="editor-section-title">Effort values (EVs) <small>510 total maximum</small></div><div className="stat-grid">{statNames.map(stat => <label className="field" key={stat}><span>{stat}</span><input type="number" min="0" max="252" value={selectedBuild.evs[stat]} onChange={e => patchBuild({evs:{...selectedBuild.evs,[stat]:Math.max(0,Math.min(252,Number(e.target.value)||0))}})} /></label>)}</div><p className="stat-total">Total EVs: {Object.values(selectedBuild.evs).reduce((a,b)=>a+b,0)} / 510</p></div>
                  <div className="editor-section"><div className="editor-section-title">Individual values (IVs)</div><div className="stat-grid">{statNames.map(stat => <label className="field" key={stat}><span>{stat}</span><input type="number" min="0" max="31" value={selectedBuild.ivs[stat]} onChange={e => patchBuild({ivs:{...selectedBuild.ivs,[stat]:Math.max(0,Math.min(31,Number(e.target.value)||0))}})} /></label>)}</div></div>
                  <label className="field build-label-field"><span>Build label</span><input value={selectedBuild.label} placeholder="e.g. Choice Scarf, Defensive, Setup" onChange={e => patchBuild({label:e.target.value})} /></label>
                </div> : activeTeam.slots.length > 0 ? <div className="empty-state"><strong>Select a Pokémon slot</strong><p>Choose a filled slot above to edit its set.</p></div> : <div className="empty-state"><strong>Your team is empty</strong><p>Add a Pokémon to begin building your team.</p></div>}
              </>}
            </section>
          </div>
          <p className="hint team-storage-hint">Local-first storage: your teams remain on this device. Account sync and Google login will be connected separately.</p>
        </>}
        {activePage === "Legality analysis" && <>
          <section className="intro"><div><div className="eyebrow">TEAM VALIDATION</div><h2>Legality analysis.</h2><p>Validate a six-Pokémon roster against the selected PvP tier or supported facility rules. Battle Tree uses Super Singles restrictions.</p></div></section>
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
              <label className="field"><span>Your team</span><select value={battlePlayerTeamId || activeTeam?.id || ""} onChange={e => setBattlePlayerTeamId(e.target.value)}><option value="">Select team</option>{teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
              {settings.battleType === "PvP" ? <label className="field"><span>Opponent source</span><select value={opponentSource} onChange={e => { setOpponentSource(e.target.value as "Saved teams" | "Auto Teams"); setBattleError(""); }}><option>Saved teams</option><option>Auto Teams</option></select></label> : <div className="field"><span>Opponent source</span><div className="derived-value">Saved teams</div></div>}
              {opponentSource === "Saved teams" ? <label className="field"><span>Single-battle opponent</span><select value={battleOpponentTeamId || teams.find(team => team.id !== (battlePlayerTeamId || activeTeam?.id))?.id || ""} onChange={e => setBattleOpponentTeamId(e.target.value)}><option value="">Select opponent</option>{teams.filter(team => team.id !== (battlePlayerTeamId || activeTeam?.id)).map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label> : <div className="field"><span>Auto Teams pool</span><div className="derived-value">{settings.battleType === "PvP" ? onlineOpponentPool.filter(team => team.format === battleFormat()).length + " verified " + settings.tier + " teams loaded" : "No verified facility pool connected yet"}</div></div>}
              <div className="field"><span>Ruleset</span><div className="derived-value">Gen {settings.generation} · {settings.battleType === "PvP" ? settings.tier : `${settings.gameVersion} · ${settings.facility}`}</div></div>
            </div>
            {settings.battleType === "PvP" && opponentSource === "Auto Teams" && <div className="battle-actions"><button type="button" className="secondary-button" onClick={fetchOnlineOpponent} disabled={fetchingOpponent}>{fetchingOpponent ? "Loading team pool…" : onlineOpponentPool.length ? "Refresh Auto Teams pool" : "Load Auto Teams pool"}</button><span className="hint">{onlineOpponent ? "Example: " + onlineOpponent.name + " · " + onlineOpponent.source + (onlineOpponent.author ? " · " + onlineOpponent.author : "") : "Loads the published sample archive. The all-team run tests every distinct valid team 100 times."}</span></div>}
            
            {opponentSourceError && <p className="battle-error">{opponentSourceError}</p>}
            {(settings.battleType === "PvE" || settings.tier === "VGC" || settings.tier === "Custom") && <p className="battle-warning">This selection runs in the generation's Custom Game sandbox. Facility-specific, VGC regulation and custom tier rules are not enforced.</p>}
            <section className="benchmark-panel">
              <div className="editor-section-title">All-team simulation <small>100 battles against every available opposing team</small></div>
              <p className="hint">Runs 100 battles per opponent and records every matchup in Matchup Analysis. PvP Auto Teams uses the published sample archive. Saved teams tests every other complete team in your local team library. PvE uses Saved teams until facility trainer data is connected.</p>
              <div className="battle-actions">
                <button type="button" className="primary-button" onClick={runFullBenchmark} disabled={benchmarkBusy || battleActive}>{benchmarkBusy ? "Simulation running…" : "Run simulator · 100 per team"}</button>
                {benchmarkBusy && <button type="button" className="secondary-button" onClick={() => { benchmarkCancel.current = true; }}>Cancel simulation</button>}
                <button type="button" className="secondary-button" onClick={() => setActivePage("Matchup Analysis")}>View Matchup Analysis</button>
              </div>
              {benchmarkProgress && <div className="benchmark-results">
                <strong>{benchmarkProgress.completed.toLocaleString()} / {benchmarkProgress.total.toLocaleString()} battles completed</strong>
                <div className="benchmark-summary"><span>Wins: {benchmarkProgress.wins}</span><span>Losses: {benchmarkProgress.losses}</span><span>Ties: {benchmarkProgress.ties}</span><span>Win rate: {benchmarkProgress.completed ? ((benchmarkProgress.wins / benchmarkProgress.completed) * 100).toFixed(1) : "0.0"}%</span></div>
                {benchmarkBusy && <p className="hint">Current opponent: {benchmarkProgress.currentOpponent}</p>}
                {benchmarkCoverage && <p className="hint">Source teams: {benchmarkCoverage.sourceCount} · tested teams: {benchmarkCoverage.validCount} · skipped: {benchmarkCoverage.rejected}. {benchmarkCoverage.sourceUrl.startsWith("http") ? <a href={benchmarkCoverage.sourceUrl} target="_blank" rel="noreferrer">Dataset source</a> : benchmarkCoverage.sourceUrl}</p>}
                <div className="benchmark-matchups">{[...benchmarkProgress.results].sort((a,b) => (b.wins / Math.max(1,b.games)) - (a.wins / Math.max(1,a.games))).map(result => <div key={result.opponentId}><strong>{result.opponentName}</strong><span>{result.wins}W / {result.losses}L / {result.ties}T</span></div>)}</div>
              </div>}
              {benchmarkError && <p className="battle-error">{benchmarkError}</p>}
            </section>
            {battleError && <p className="battle-error">{battleError}</p>}
            <div className="battle-actions"><button type="button" className="primary-button" onClick={startBattle}>Start single battle</button><button type="button" className="secondary-button" onClick={stopBattle} disabled={!battleActive}>End battle</button><button type="button" className="secondary-button" onClick={() => setSettings(s => ({...s, mode: s.mode === "Auto" ? "Manual" : "Auto"}))}>{settings.mode === "Auto" ? "Switch to Manual" : "Switch to Auto"}</button></div>
          </section>
          {(battleActive || battleLog.length > 0) && <section className="panel battle-live-panel">
            <div className="panel-heading"><div><span className="eyebrow">LIVE BATTLE</span><h3>{battleActive ? "Battle in progress" : "Battle finished"}</h3></div><span className="saved-indicator"><span className="status-dot" /> {settings.mode} control</span></div>
            {manualRequest && settings.mode === "Manual" && <div className="manual-controls">
              <strong>Your decision</strong>
              {manualRequest.teamPreview && <div className="team-preview-choice"><p className="hint">Team preview is active. Select the six Pokémon in their current order.</p><button type="button" className="secondary-button" onClick={() => submitBattleChoice("team 123456")}>Confirm team order</button></div> }
              {manualRequest.active?.[0]?.moves && <div className="battle-choice-grid">{manualRequest.active[0].moves.map((move,index) => <button type="button" className="secondary-button" key={move.id || move.move} disabled={move.disabled} onClick={() => submitBattleChoice(`move ${index+1}`)}>{move.move} <small>{move.pp ?? "?"}/{move.maxpp ?? "?"} PP</small></button>)}</div>}
              {manualRequest.forceSwitch?.some(Boolean) && <div className="battle-choice-grid">{(manualRequest.side?.pokemon || []).map((pokemon,index) => ({pokemon,index})).filter(({pokemon}) => !pokemon.active && !pokemon.condition.endsWith(" fnt")).map(({pokemon,index}) => <button type="button" className="secondary-button" key={pokemon.ident} onClick={() => submitBattleChoice(`switch ${index+1}`)}>{pokemon.ident.split(": ").slice(1).join(": ") || pokemon.details}</button>)}</div>}
              {!manualRequest.active?.[0]?.moves?.length && !manualRequest.forceSwitch?.some(Boolean) && !manualRequest.teamPreview && <p className="hint">Waiting for the next decision.</p>}
            </div>}
            <div className="battle-log" aria-live="polite">{battleLog.length ? battleLog.map((line,index) => <div key={index}>{line}</div>) : <p>Waiting for the battle to begin…</p>}</div>
          </section>}
        </>}
        {activePage === "Matchup Analysis" && <>
          <section className="intro"><div><div className="eyebrow">ANALYSIS WORKSPACE</div><h2>Matchup Analysis</h2><p>Results from the latest all-team simulation, with 100 battles per opponent.</p></div></section>
          {!matchupRun ? <section className="panel empty-state"><strong>No simulation results yet</strong><p>Run the Simulator to test your team against every available opposing team. Results will be saved here automatically.</p><button type="button" className="primary-button" onClick={() => setActivePage("Simulator")}>Open Simulator</button></section> : <>
            <section className="panel">
              <div className="panel-heading"><div><span className="eyebrow">LATEST RUN</span><h3>{matchupRun.playerTeamName}</h3></div><span className="build-version">{new Date(matchupRun.createdAt).toLocaleString()}</span></div>
              <p className="hint">Gen {matchupRun.generation} · {matchupRun.gameVersion} · {matchupRun.battleType === "PvP" ? matchupRun.tier : matchupRun.facility} · {matchupRun.opponentSource}</p>
              <div className="benchmark-summary"><span>Teams tested: {matchupRun.validCount}</span><span>Battles: {matchupRun.completed.toLocaleString()} / {matchupRun.total.toLocaleString()}</span><span>Wins: {matchupRun.wins}</span><span>Losses: {matchupRun.losses}</span><span>Ties: {matchupRun.ties}</span><span>Win rate: {matchupRun.completed ? (matchupRun.wins / matchupRun.completed * 100).toFixed(1) : "0.0"}%</span></div>
              <p className="hint">Source entries: {matchupRun.sourceCount} · skipped: {matchupRun.rejected} · Saved locally in this browser.</p>
              {matchupRun.sourceUrl.startsWith("http") && <p className="hint"><a href={matchupRun.sourceUrl} target="_blank" rel="noreferrer">Open opponent dataset</a></p>}
            </section>
            <section className="panel">
              <div className="panel-heading"><div><span className="eyebrow">PER-TEAM RESULTS</span><h3>Opponent matchups</h3></div><span className="build-version">{matchupRun.results.length} teams</span></div>
              <div className="benchmark-matchups matchup-analysis-list">{[...matchupRun.results].sort((a,b) => (b.wins / Math.max(1,b.games)) - (a.wins / Math.max(1,a.games))).map(result => <div key={result.opponentId}><strong>{result.opponentName}</strong><span>{result.wins}W / {result.losses}L / {result.ties}T · {result.games ? (result.wins / result.games * 100).toFixed(1) : "0.0"}% win rate</span></div>)}</div>
            </section>
          </>}
        </>}
        <footer>Pokémon Battle Lab <span>·</span> An independent team analysis tool</footer>
      </section>
    </main>
  );
}
