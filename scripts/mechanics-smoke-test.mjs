import { BattleStreams, RandomPlayerAI, Teams } from "@pkmn/sim";

class ScriptedPlayer extends RandomPlayerAI {
  constructor(stream, chooseRequest) {
    super(stream);
    this.chooseRequest = chooseRequest;
  }
  receiveRequest(request) {
    if (request.wait) return;
    this.choose(this.chooseRequest(request));
  }
}

const makeSet = (species, ability, moves, level = 100) => ({
  name: species,
  species,
  level,
  ability,
  moves,
  evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
});

async function runUntilEvent({ player, opponent, choosePlayer, chooseOpponent, expected, label, format = "gen9customgame" }) {
  const streams = BattleStreams.getPlayerStreams(new BattleStreams.BattleStream());
  const p1 = new ScriptedPlayer(streams.p1, choosePlayer);
  const p2 = new ScriptedPlayer(streams.p2, chooseOpponent);
  void p1.start();
  void p2.start();

  let timeoutId;
  const observedEvents = [];
  const observed = new Promise((resolve, reject) => {
    const timeout = new Promise((_, fail) => {
      timeoutId = setTimeout(() => fail(new Error(label + " did not trigger within 15 seconds.")), 15000);
    });
    const read = (async () => {
      for await (const chunk of streams.omniscient) {
        for (const line of String(chunk).split("\n")) {
          if (line.startsWith("|")) observedEvents.push(line);
          if (expected(line)) {
            void streams.omniscient.write(">forcetie");
            return line;
          }
          if (line.startsWith("|win|") || line.startsWith("|tie|")) {
            throw new Error(label + " battle ended before the expected mechanic triggered. Initial events: " + observedEvents.slice(0, 40).join(" || ") + " || Recent events: " + observedEvents.slice(-20).join(" || "));
          }
        }
      }
      throw new Error(label + " battle stream closed before the expected mechanic triggered.");
    })();
    Promise.race([read, timeout]).then(resolve, reject);
  });

  try {
    await streams.omniscient.write(
      `>start ${JSON.stringify({ formatid: format })}\n` +
      `>player p1 ${JSON.stringify({ name: "Mechanics Test Player", team: Teams.pack(player) })}\n` +
      `>player p2 ${JSON.stringify({ name: "Mechanics Test Opponent", team: Teams.pack(opponent) })}`
    );
    const line = await observed;
    console.log(label + " passed: " + line);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

const preview = count => "team " + Array.from({ length: count }, (_, i) => i + 1).join("");
const moveOne = request => request.teamPreview ? preview(request.maxTeamSize || request.side?.pokemon.length || 1) : "move 1";

await runUntilEvent({
  label: "Intimidate activation",
  player: [makeSet("Arcanine", "Intimidate", ["Splash"])],
  opponent: [makeSet("Magikarp", "Swift Swim", ["Splash"])],
  choosePlayer: request => moveOne(request),
  chooseOpponent: request => moveOne(request),
  expected: line => line.startsWith("|-ability|p1a: Arcanine|Intimidate|boost"),
});

await runUntilEvent({
  label: "Bad poison residual damage",
  player: [makeSet("Gengar", "Cursed Body", ["Toxic"])],
  opponent: [makeSet("Magikarp", "Swift Swim", ["Splash"])],
  choosePlayer: request => moveOne(request),
  chooseOpponent: request => moveOne(request),
  expected: line => line.startsWith("|-damage|p2a: Magikarp|") && line.includes("[from] psn"),
});

let playerMoveRequests = 0;
await runUntilEvent({
  label: "Stealth Rock switch-in damage",
  player: [makeSet("Aerodactyl", "Pressure", ["Stealth Rock", "Roar"])],
  opponent: [
    makeSet("Magikarp", "Swift Swim", ["Splash"]),
    makeSet("Pidgey", "Keen Eye", ["Splash"]),
  ],
  choosePlayer: request => {
    if (request.teamPreview) return preview(request.maxTeamSize || 1);
    playerMoveRequests++;
    return playerMoveRequests === 1 ? "move 1" : "move 2";
  },
  chooseOpponent: request => {
    if (request.teamPreview) return preview(request.maxTeamSize || request.side?.pokemon.length || 2);
    if (request.forceSwitch?.some(Boolean)) return "switch 2";
    return "move 1";
  },
  expected: line => line.startsWith("|-damage|p2a: Pidgey|") && line.includes("[from] Stealth Rock"),
});


await runUntilEvent({
  label: "Flash Fire blocks Fire damage and activates",
  player: [makeSet("Typhlosion", "Blaze", ["Flamethrower"])],
  opponent: [makeSet("Heatran", "Flash Fire", ["Splash"])],
  choosePlayer: request => moveOne(request),
  chooseOpponent: request => moveOne(request),
  expected: line => line.startsWith("|-immune|p2a: Heatran") && line.includes("Flash Fire"),
});

await runUntilEvent({
  label: "Water Absorb blocks incoming Water damage",
  player: [makeSet("Vaporeon", "Water Absorb", ["Splash"])],
  opponent: [makeSet("Golduck", "Swift Swim", ["Surf"])],
  choosePlayer: request => moveOne(request),
  chooseOpponent: request => moveOne(request),
  expected: line => line.startsWith("|-immune|p1a: Vaporeon|") && line.includes("Water Absorb"),
});

await runUntilEvent({
  label: "Rough Skin damages contact attackers",
  player: [makeSet("Rattata", "Run Away", ["Tackle"])],
  opponent: [makeSet("Garchomp", "Rough Skin", ["Splash"])],
  choosePlayer: request => moveOne(request),
  chooseOpponent: request => moveOne(request),
  expected: line => line.startsWith("|-damage|p1a: Rattata|") && line.includes("Rough Skin"),
});

await runUntilEvent({
  label: "Levitate blocks Ground-type damage",
  format: "gen3customgame",
  player: [makeSet("Nidoking", "Poison Point", ["Earthquake"])],
  opponent: [makeSet("Gengar", "Levitate", ["Splash"])],
  choosePlayer: request => moveOne(request),
  chooseOpponent: request => moveOne(request),
  expected: line => line.startsWith("|-immune|p2a: Gengar"),
});

await runUntilEvent({
  label: "Mold Breaker bypasses Levitate",
  format: "gen5customgame",
  player: [makeSet("Excadrill", "Mold Breaker", ["Earthquake"])],
  opponent: [makeSet("Gengar", "Levitate", ["Splash"])],
  choosePlayer: request => moveOne(request),
  chooseOpponent: request => moveOne(request),
  expected: line => line.startsWith("|-damage|p2a: Gengar|"),
});

await runUntilEvent({
  label: "Burn residual damage",
  player: [makeSet("Gengar", "Cursed Body", ["Will-O-Wisp"])],
  opponent: [makeSet("Magikarp", "Swift Swim", ["Splash"])],
  choosePlayer: request => moveOne(request),
  chooseOpponent: request => moveOne(request),
  expected: line => line.startsWith("|-damage|p2a: Magikarp|") && line.includes("[from] brn"),
});

let spikesMoveRequests = 0;
await runUntilEvent({
  label: "Spikes switch-in damage",
  player: [makeSet("Skarmory", "Keen Eye", ["Spikes", "Roar"])],
  opponent: [
    makeSet("Magikarp", "Swift Swim", ["Splash"]),
    makeSet("Rattata", "Run Away", ["Splash"]),
  ],
  choosePlayer: request => {
    if (request.teamPreview) return preview(request.maxTeamSize || 1);
    spikesMoveRequests++;
    return spikesMoveRequests === 1 ? "move 1" : "move 2";
  },
  chooseOpponent: request => {
    if (request.teamPreview) return preview(request.maxTeamSize || request.side?.pokemon.length || 2);
    if (request.forceSwitch?.some(Boolean)) return "switch 2";
    return "move 1";
  },
  expected: line => line.startsWith("|-damage|p2a: Rattata|") && line.includes("[from] Spikes"),
});

let toxicSpikesMoveRequests = 0;
await runUntilEvent({
  label: "Toxic Spikes inflicts poison on switch-in",
  player: [makeSet("Skarmory", "Keen Eye", ["Toxic Spikes", "Roar"])],
  opponent: [
    makeSet("Magikarp", "Swift Swim", ["Splash"]),
    makeSet("Rattata", "Run Away", ["Splash"]),
  ],
  choosePlayer: request => {
    if (request.teamPreview) return preview(request.maxTeamSize || 1);
    toxicSpikesMoveRequests++;
    return toxicSpikesMoveRequests === 1 ? "move 1" : "move 2";
  },
  chooseOpponent: request => {
    if (request.teamPreview) return preview(request.maxTeamSize || request.side?.pokemon.length || 2);
    if (request.forceSwitch?.some(Boolean)) return "switch 2";
    return "move 1";
  },
  expected: line => line.startsWith("|-status|p2a: Rattata|psn"),
});

await runUntilEvent({
  label: "Weak Armor lowers Defense and raises Speed after a physical hit",
  format: "gen7customgame",
  player: [makeSet("Rattata", "Run Away", ["Tackle", "Splash"], 1)],
  opponent: [makeSet("Skarmory", "Weak Armor", ["Splash"], 100)],
  choosePlayer: request => moveOne(request),
  chooseOpponent: request => moveOne(request),
  expected: line => line.startsWith("|-boost|p2a: Skarmory|spe|2") || line.startsWith("|-unboost|p2a: Skarmory|def|1"),
});

await runUntilEvent({
  label: "Poison Touch activates on a contact move",
  format: "gen5customgame",
  player: [makeSet("Toxicroak", "Poison Touch", ["Tackle"], 1)],
  opponent: [makeSet("Magikarp", "Swift Swim", ["Splash"], 100)],
  choosePlayer: request => moveOne(request),
  chooseOpponent: request => moveOne(request),
  expected: line => line.startsWith("|-status|p2a: Magikarp|psn") && line.includes("Poison Touch"),
});


await runUntilEvent({
  label: "Flame Body can burn a contact attacker",
  player: [makeSet("Rattata", "Run Away", ["Tackle"], 1)],
  opponent: [makeSet("Magmar", "Flame Body", ["Splash"], 100)],
  choosePlayer: request => moveOne(request),
  chooseOpponent: request => moveOne(request),
  expected: line => line.startsWith("|-status|p1a: Rattata|brn") && line.includes("Flame Body"),
});

await runUntilEvent({
  label: "Scald secondary effect can burn",
  player: [makeSet("Magikarp", "Swift Swim", ["Splash"], 100)],
  opponent: [makeSet("Vaporeon", "Water Absorb", ["Scald"], 1)],
  choosePlayer: request => moveOne(request),
  chooseOpponent: request => moveOne(request),
  expected: line => line.startsWith("|-status|p1a: Magikarp|brn") && line.includes("Scald"),
});

await runUntilEvent({
  label: "Shadow Ball secondary effect can lower Special Defense",
  player: [makeSet("Magikarp", "Swift Swim", ["Splash"], 100)],
  opponent: [makeSet("Gengar", "Cursed Body", ["Shadow Ball"], 1)],
  choosePlayer: request => moveOne(request),
  chooseOpponent: request => moveOne(request),
  expected: line => line.startsWith("|-unboost|p1a: Magikarp|spd|1") && line.includes("Shadow Ball"),
});
