import { BattleStreams, RandomPlayerAI, Teams } from "@pkmn/sim";

const makeTeam = (species, move, ability) => Array.from({ length: 6 }, (_, index) => ({
  name: `${species} ${index + 1}`,
  species,
  level: 100,
  ability,
  moves: [move],
  evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
}));

const streams = BattleStreams.getPlayerStreams(new BattleStreams.BattleStream());
const p1 = new RandomPlayerAI(streams.p1);
const p2 = new RandomPlayerAI(streams.p2);
void p1.start();
void p2.start();

let outcome = null;
let turns = 0;
const completed = (async () => {
  for await (const chunk of streams.omniscient) {
    for (const line of String(chunk).split("\\n")) {
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
  `>start ${JSON.stringify({ formatid: "gen9customgame" })}\\n` +
  `>player p1 ${JSON.stringify({ name: "Benchmark Player", team: Teams.pack(makeTeam("Arceus", "Extreme Speed", "Multitype")) })}\\n` +
  `>player p2 ${JSON.stringify({ name: "Benchmark Opponent", team: Teams.pack(makeTeam("Magikarp", "Splash", "Swift Swim")) })}`
);
try {
  const result = await Promise.race([completed, timeout]);
  if (result !== "win") throw new Error(`Expected a decisive player win, received ${result} after turn ${turns}.`);
  console.log("Benchmark integration test passed: player win correctly detected.");
} finally {
  clearTimeout(timeoutId);
}
