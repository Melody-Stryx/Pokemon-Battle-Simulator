import { BattleStreams, RandomPlayerAI, TeamValidator, Teams } from "@pkmn/sim";

export type BenchmarkOpponent = {
  id: string;
  name: string;
  author?: string;
  sets: Record<string, unknown>[];
};

export type BenchmarkResult = {
  opponentId: string;
  opponentName: string;
  wins: number;
  losses: number;
  ties: number;
  games: number;
};

export type BenchmarkProgress = {
  completed: number;
  total: number;
  wins: number;
  losses: number;
  ties: number;
  currentOpponent: string;
  results: BenchmarkResult[];
};

type SampleTeam = { name?: string; author?: string; data?: Record<string, unknown>[] };

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

async function playOneBattle(format: string, playerSets: Record<string, unknown>[], opponentSets: Record<string, unknown>[]): Promise<"win" | "loss" | "tie"> {
  const streams = BattleStreams.getPlayerStreams(new BattleStreams.BattleStream());
  const p1 = new RandomPlayerAI(streams.p1);
  const p2 = new RandomPlayerAI(streams.p2);
  void p1.start();
  void p2.start();
  const finished = (async () => {
    for await (const chunk of streams.omniscient) {
      const output = String(chunk);
      const win = output.match(/\\|win\\|([^\\n]+)/);
      if (win) return win[1].trim() === "Benchmark Player" ? "win" as const : "loss" as const;
      if (output.includes("|tie")) return "tie" as const;
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
    return await Promise.race([finished, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function runExhaustiveBenchmark(args: {
  format: string;
  playerSets: Record<string, unknown>[];
  opponents: BenchmarkOpponent[];
  repetitions: number;
  onProgress: (progress: BenchmarkProgress) => void;
  shouldCancel: () => boolean;
}): Promise<BenchmarkProgress> {
  const results: BenchmarkResult[] = [];
  let wins = 0, losses = 0, ties = 0, completed = 0;
  const total = args.opponents.length * args.repetitions;
  for (const opponent of args.opponents) {
    const result: BenchmarkResult = { opponentId: opponent.id, opponentName: opponent.name, wins: 0, losses: 0, ties: 0, games: 0 };
    for (let repetition = 0; repetition < args.repetitions; repetition++) {
      if (args.shouldCancel()) return { completed, total, wins, losses, ties, currentOpponent: opponent.name, results };
      const outcome = await playOneBattle(args.format, args.playerSets, opponent.sets);
      result[outcome === "win" ? "wins" : outcome === "loss" ? "losses" : "ties"]++;
      result.games++;
      if (outcome === "win") wins++;
      else if (outcome === "loss") losses++;
      else ties++;
      completed++;
      args.onProgress({ completed, total, wins, losses, ties, currentOpponent: opponent.name, results: [...results, { ...result }] });
    }
    results.push(result);
  }
  return { completed, total, wins, losses, ties, currentOpponent: "", results };
}
