import { BattleStreams, RandomPlayerAI, Teams } from "@pkmn/sim";
import { readFile, writeFile, unlink } from "node:fs/promises";
import ts from "typescript";

const aiSource = await readFile(new URL("../src/pve-ai.ts", import.meta.url), "utf8");
const compiledAI = ts.transpileModule(aiSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const aiModuleUrl = new URL("../src/.pve-ai-smoke-runtime.mjs", import.meta.url);
await writeFile(aiModuleUrl, compiledAI);
const benchmarkSource = (await readFile(new URL("../src/benchmark.ts", import.meta.url), "utf8"))
  .replace('"./pve-ai"', '"./.pve-ai-smoke-runtime.mjs"');
const compiledBenchmark = ts.transpileModule(benchmarkSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const benchmarkModuleUrl = new URL("../src/.benchmark-smoke-runtime.mjs", import.meta.url);
await writeFile(benchmarkModuleUrl, compiledBenchmark);
let runExhaustiveBenchmark;
let loadFacilityOpponentPool;
let normalizeBenchmarkOutcome;
let chooseTacticalChoice;
try {
  ({ chooseTacticalChoice } = await import(aiModuleUrl.href));
  ({ runExhaustiveBenchmark, loadFacilityOpponentPool, normalizeBenchmarkOutcome } = await import(benchmarkModuleUrl.href));
} finally {
  await unlink(benchmarkModuleUrl);
  await unlink(aiModuleUrl);
}


const facilityPaths = {
  "3|Ruby / Sapphire|Battle Tower": "gen3-rs.json",
  "3|Emerald|Battle Frontier": "gen3.json",
  "4|Diamond / Pearl|Battle Tower": "gen4-dp.json",
  "4|Platinum|Battle Frontier": "gen4.json",
  "4|HeartGold / SoulSilver|Battle Frontier": "gen4.json",
  "5|Black / White|Battle Subway": "gen5.json",
  "5|Black 2 / White 2|Battle Subway": "gen5.json",
  "6|X / Y|Battle Maison": "gen6.json",
  "6|Omega Ruby / Alpha Sapphire|Battle Maison": "gen6.json",
  "7|Sun / Moon|Battle Tree": "gen7-sm.json",
  "7|Ultra Sun / Ultra Moon|Battle Tree": "gen7-usum.json",
  "8|Sword / Shield|Battle Tower": "gen8-swsh.json",
  "8|Brilliant Diamond / Shining Pearl|Battle Tower": "gen8-bdsp.json",
  "9|Scarlet / Violet|Academy Ace Tournament": "gen9.json",
};
const originalFetch = globalThis.fetch;
globalThis.fetch = async input => {
  const filename = String(input).split("/").pop();
  const data = await readFile(new URL("../public/data/facilities/" + filename, import.meta.url), "utf8");
  return new Response(data, { status: 200, headers: { "content-type": "application/json" } });
};
try {
  for (const [key, filename] of Object.entries(facilityPaths)) {
    const [generation, gameVersion, facility] = key.split("|");
    const loaded = await loadFacilityOpponentPool(Number(generation), gameVersion, facility);
    if (!loaded.opponents.length || loaded.sourceCount < loaded.opponents.length) throw new Error("No usable facility trainers for " + key + " (" + filename + ").");
    const first = loaded.opponents[0];
    if (!first.sets.length || first.sets.some(set => !Array.isArray(set.moves) || !set.moves.length || !set.species)) throw new Error("Incomplete facility sets for " + key + ".");
    if (Number(generation) === 9 && (!first.fixedTeam || first.sets.length !== 6)) throw new Error("Academy Ace Tournament must retain fixed six-Pokémon parties.");
    if (Number(generation) === 8 && gameVersion.startsWith("Brilliant") && (!first.fixedTeam || first.sets.length !== 3)) throw new Error("BDSP Master Class must retain fixed three-Pokémon parties.");
    console.log("Facility dataset loaded: " + key + " (" + loaded.opponents.length + "/" + loaded.sourceCount + ", " + loaded.rejected + " rejected).");
  }
} finally {
  globalThis.fetch = originalFetch;
}

const makeTeam = (species, move, ability) => Array.from({ length: 6 }, (_, index) => ({
  name: `${species} ${index + 1}`,
  species,
  level: 100,
  ability,
  moves: [move],
  evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
}));

const tacticalMoveRequest = {
  side: { pokemon: [{ details: "Pikachu, L100", condition: "100/100", active: true, stats: { atk: 100, spa: 100, spe: 100 }, moves: ["Thunderbolt", "Ice Beam"] }] },
  active: [{ moves: [{ move: "Thunderbolt", disabled: false }, { move: "Ice Beam", disabled: false }] }],
};
const tacticalMove = chooseTacticalChoice(tacticalMoveRequest, ["|switch|p2a: Garchomp|Garchomp, L100|100/100"], "p1", 9);
if (tacticalMove !== "move 2") throw new Error(`Tactical AI failed to select the super-effective move: ${tacticalMove}`);

const luxrayRequest = {
  side: { pokemon: [{ details: "Luxray, L100", condition: "364/364", active: true, stats: { atk: 372, spa: 176, spe: 176 }, moves: ["Double Kick", "Spark", "Crunch", "Ice Fang"] }] },
  active: [{ moves: [{ move: "Double Kick" }, { move: "Spark" }, { move: "Crunch" }, { move: "Ice Fang" }] }],
};
const gen6Cases = [
  ["Ferrothorn", "move 1"],
  ["Landorus-Therian", "move 4"],
  ["Slowbro", "move 2"],
  ["Clefable", "move 2"],
  ["Tyranitar", "move 1"],
];
for (const [foe, expected] of gen6Cases) {
  const choice = chooseTacticalChoice(luxrayRequest, [`|switch|p2a: ${foe}| ${foe}, L100|100/100`.replace("| ", "|")], "p1", 6);
  if (choice !== expected) throw new Error(`Gen 6 Luxray move selection against ${foe}: expected ${expected}, received ${choice}`);
}
console.log("Gen 6 move-selection tests passed: Double Kick is selected for Fighting weaknesses, Ice Fang for Landorus-T, Spark for Slowbro and Clefable.");
const tacticalSwitchRequest = {
  side: { pokemon: [
    { details: "Charizard, L100", condition: "100/100", active: true, stats: { atk: 100, spa: 100, spe: 100 }, moves: ["Flamethrower"] },
    { details: "Venusaur, L100", condition: "100/100", active: false, stats: { atk: 90, spa: 110, spe: 80 }, moves: ["Energy Ball"] },
  ] },
  active: [{ moves: [{ move: "Flamethrower", disabled: false }] }],
};
const tacticalSwitch = chooseTacticalChoice(tacticalSwitchRequest, ["|switch|p2a: Blastoise|Blastoise, L100|100/100"], "p1");
if (tacticalSwitch !== "switch 2") throw new Error(`Tactical AI failed to switch to a favourable counter: ${tacticalSwitch}`);
console.log("Tactical AI decision tests passed: super-effective move selection and matchup-aware switching.");

if (normalizeBenchmarkOutcome("tie") !== "loss" || normalizeBenchmarkOutcome("loss") !== "loss" || normalizeBenchmarkOutcome("win") !== "win") {
  throw new Error("Benchmark outcome normalization must count ties as player losses.");
}
console.log("Tie-scoring regression test passed: every tie is counted as a player loss.");

const streams = BattleStreams.getPlayerStreams(new BattleStreams.BattleStream());
const p1 = new RandomPlayerAI(streams.p1);
const p2 = new RandomPlayerAI(streams.p2);
void p1.start();
void p2.start();

let outcome = null;
let turns = 0;
const completed = (async () => {
  for await (const chunk of streams.omniscient) {
    for (const line of String(chunk).split("\n")) {
      if (!line.startsWith("|")) continue;
      const parts = line.split("|");
      if (parts[1] === "turn") turns = Number(parts[2]) || turns;
      if (parts[1] === "win") outcome = parts[2]?.trim() === "Benchmark Player" ? "win" : "loss";
      if (parts[1] === "tie") outcome = "tie";
    }
    if (outcome) return outcome;
  }
  throw new Error("Battle stream ended without a result.");
})();
let timeoutId;
const timeout = new Promise((_, reject) => {
  timeoutId = setTimeout(() => reject(new Error("Benchmark integration battle timed out.")), 30000);
});
void streams.omniscient.write(
  `>start ${JSON.stringify({ formatid: "gen9customgame" })}\n` +
  `>player p1 ${JSON.stringify({ name: "Benchmark Player", team: Teams.pack(makeTeam("Arceus", "Extreme Speed", "Multitype")) })}\n` +
  `>player p2 ${JSON.stringify({ name: "Benchmark Opponent", team: Teams.pack(makeTeam("Magikarp", "Splash", "Swift Swim")) })}`
);
try {
  const result = await Promise.race([completed, timeout]);
  if (result !== "win") throw new Error(`Expected a decisive player win, received ${result} after turn ${turns}.`);
  console.log("Benchmark integration test passed: player win correctly detected.");

  const playerSets = makeTeam("Arceus", "Extreme Speed", "Multitype");
  const opponentSets = makeTeam("Magikarp", "Splash", "Swift Swim");
  const telemetry = await runExhaustiveBenchmark({
    format: "gen9customgame",
    playerSets,
    opponents: [{ id: "magikarp", name: "Magikarp test team", sets: opponentSets }],
    repetitions: 1,
    shouldCancel: () => false,
    onProgress: () => {},
  });
  const playerDamage = telemetry.analysis.player.pokemon.reduce((sum, pokemon) => sum + pokemon.damageDealt, 0);
  const opponentTaken = telemetry.analysis.opponent.pokemon.reduce((sum, pokemon) => sum + pokemon.damageTaken, 0);
  if (playerDamage <= 0 || opponentTaken <= 0) {
    throw new Error(`Expected direct move damage attribution; player dealt ${playerDamage}, opponent took ${opponentTaken}.`);
  }
  if (!telemetry.analysis.player.moveDamage.length) {
    throw new Error("Expected direct move damage to appear in the move rankings.");
  }
  if (!telemetry.analysis.player.moveDamage.some(move => move.uses > 0)) {
    throw new Error("Expected move-use counts to be recorded independently of damage hits.");
  }
  console.log("Damage telemetry test passed: direct move damage is attributed to the attacking Pokémon and move.");

  const solo = await runExhaustiveBenchmark({
    format: "gen9customgame",
    playerSets: [makeTeam("Arceus", "Extreme Speed", "Multitype")[0]],
    opponents: [{ id: "solo-magikarp", name: "Magikarp · Splash", sets: [makeTeam("Magikarp", "Splash", "Swift Swim")[0]] }],
    repetitions: 1,
    shouldCancel: () => false,
    onProgress: () => {},
  });
  if (solo.completed !== 1 || solo.results.length !== 1 || solo.results[0].games !== 1) {
    throw new Error("Single-Pokémon benchmark did not complete one isolated 1v1 matchup.");
  }
  const playerFaints = solo.analysis.player.pokemon.reduce((sum, pokemon) => sum + pokemon.faints, 0);
  const opponentFaints = solo.analysis.opponent.pokemon.reduce((sum, pokemon) => sum + pokemon.faints, 0);
  if (playerFaints !== solo.losses || opponentFaints !== solo.wins) {
    throw new Error(`1v1 faint telemetry must reconcile with outcomes: player ${playerFaints}/${solo.losses} losses, opponent ${opponentFaints}/${solo.wins} wins.`);
  }
  console.log("Single-Pokémon benchmark test passed: isolated 1v1 faint totals reconcile exactly with wins and losses.");
} finally {
  clearTimeout(timeoutId);
}
