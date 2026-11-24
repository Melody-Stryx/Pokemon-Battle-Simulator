import { runExhaustiveBenchmark } from "../src/benchmark.ts";

const makeTeam = (species, move, ability) => Array.from({ length: 6 }, (_, index) => ({
  name: `${species} ${index + 1}`,
  species,
  level: 100,
  ability,
  moves: [move],
  evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
}));

const result = await runExhaustiveBenchmark({
  format: "gen9customgame",
  playerSets: makeTeam("Arceus", "Extreme Speed", "Multitype"),
  opponents: [{
    id: "magikarp-test",
    name: "Magikarp control team",
    sets: makeTeam("Magikarp", "Splash", "Swift Swim"),
  }],
  repetitions: 1,
  shouldCancel: () => false,
  onProgress: () => {},
});

if (result.completed !== 1 || result.total !== 1) {
  throw new Error(`Benchmark did not complete exactly one battle: ${result.completed}/${result.total}`);
}
if (result.wins !== 1 || result.losses !== 0 || result.ties !== 0) {
  throw new Error(`Benchmark result detection failed. Expected a player win, got ${result.wins}W/${result.losses}L/${result.ties}T.`);
}
console.log("Benchmark integration test passed: battle winner correctly recorded.");
