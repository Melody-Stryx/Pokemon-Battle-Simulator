import { BattleStreams, RandomPlayerAI, TeamValidator, Teams } from "@pkmn/sim";

const gen7Set = {
  name: "Pikachu",
  species: "Pikachu",
  level: 50,
  ability: "Static",
  item: "Leftovers",
  nature: "Hardy",
  moves: ["Thunderbolt", "Quick Attack"],
  evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
};
const gen7Team = Array.from({ length: 6 }, (_, index) => ({
  ...gen7Set,
  name: `Pikachu ${index + 1}`,
}));
const gen7Validator = TeamValidator.get("gen7anythinggoes");
const legalGen7Problems = (gen7Validator.validateTeam(gen7Team) || []).filter(problem =>
  !problem.includes("has exactly 0 EVs - did you forget to EV it?") &&
  !/is level \d+, but this format allows level 100 Pokémon/.test(problem)
);
if (legalGen7Problems.length) {
  throw new Error(`Generation 7 test roster was rejected: ${legalGen7Problems.join(" | ")}`);
}
const illegalGen7Team = gen7Team.map((pokemon, index) => index === 0
  ? { ...pokemon, moves: ["Doom Desire"] }
  : pokemon);
if (!(gen7Validator.validateTeam(illegalGen7Team) || []).length) {
  throw new Error("Generation 7 set validation failed to reject an illegal move.");
}

const set = {
  name: "Pikachu",
  species: "Pikachu",
  level: 50,
  ability: "Static",
  item: "Leftovers",
  nature: "Hardy",
  moves: ["Thunderbolt", "Quick Attack"],
  evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
};
const packedTeam = Teams.pack(Array.from({ length: 6 }, (_, index) => ({
  ...set,
  name: `Pikachu ${index + 1}`,
})));
const streams = BattleStreams.getPlayerStreams(new BattleStreams.BattleStream());
const p1 = new RandomPlayerAI(streams.p1);
const p2 = new RandomPlayerAI(streams.p2);
void p1.start();
void p2.start();

const completed = (async () => {
  for await (const chunk of streams.omniscient) {
    const output = String(chunk);
    if (output.includes("|win|") || output.includes("|tie")) return output;
  }
  throw new Error("Battle stream ended without a result.");
})();
let timeoutId;
const timeout = new Promise((_, reject) => {
  timeoutId = setTimeout(() => reject(new Error("Battle smoke test timed out.")), 30000);
});
void streams.omniscient.write(`>start ${JSON.stringify({ formatid: "gen9customgame" })}\n>player p1 ${JSON.stringify({ name: "Smoke Test 1", team: packedTeam })}\n>player p2 ${JSON.stringify({ name: "Smoke Test 2", team: packedTeam })}`);
const result = await Promise.race([completed, timeout]);
clearTimeout(timeoutId);
if (!String(result).includes("|win|") && !String(result).includes("|tie")) {
  throw new Error("Battle engine did not report a winner or tie.");
}
console.log("Battle engine smoke test passed.");
