import { createScryptPasswordHasher } from "@lovechapter/auth";

const PRODUCTION_ITERATIONS = 20;
const PRODUCTION_CONCURRENCY = 2;
const MAX_P95_MS = 750;
const BENCHMARK_PASSWORD = "lovechapter benchmark password";

export type ScryptDurationSummary = {
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
};

export type ScryptBenchmarkResult = ScryptDurationSummary & {
  samples: number;
  maxConcurrent: number;
  rssMiB: number;
};

export function summarizeDurations(
  durations: readonly number[],
): ScryptDurationSummary {
  if (
    durations.length === 0 ||
    durations.some((duration) => !Number.isFinite(duration) || duration < 0)
  ) {
    throw new Error("Benchmark durations must be finite non-negative numbers");
  }
  const sorted = durations.toSorted((left, right) => left - right);
  return {
    p50Ms: nearestRank(sorted, 0.5),
    p95Ms: nearestRank(sorted, 0.95),
    maxMs: sorted.at(-1)!,
  };
}

export function assertScryptBudget(result: {
  p95Ms: number;
  maxConcurrent: number;
}): void {
  if (result.maxConcurrent > PRODUCTION_CONCURRENCY) {
    throw new Error("scrypt benchmark must use at most 2 concurrent hashes");
  }
  if (result.p95Ms > MAX_P95_MS) {
    throw new Error(`scrypt p95 must not exceed ${MAX_P95_MS} ms`);
  }
}

export async function runProductionScryptBenchmark(): Promise<ScryptBenchmarkResult> {
  const hasher = createScryptPasswordHasher();
  await hasher.hash(BENCHMARK_PASSWORD);

  const durations = new Array<number>(PRODUCTION_ITERATIONS);
  let nextIndex = 0;
  let active = 0;
  let maxConcurrent = 0;
  const worker = async () => {
    while (nextIndex < PRODUCTION_ITERATIONS) {
      const index = nextIndex;
      nextIndex += 1;
      active += 1;
      maxConcurrent = Math.max(maxConcurrent, active);
      const startedAt = performance.now();
      try {
        await hasher.hash(BENCHMARK_PASSWORD);
        durations[index] = performance.now() - startedAt;
      } finally {
        active -= 1;
      }
    }
  };
  await Promise.all(
    Array.from({ length: PRODUCTION_CONCURRENCY }, () => worker()),
  );

  const summary = summarizeDurations(durations);
  return {
    ...summary,
    samples: durations.length,
    maxConcurrent,
    rssMiB: Math.round((process.memoryUsage().rss / 1024 / 1024) * 10) / 10,
  };
}

function nearestRank(sorted: readonly number[], percentile: number): number {
  const index = Math.max(0, Math.ceil(sorted.length * percentile) - 1);
  return sorted[index]!;
}

if (import.meta.main) {
  try {
    const result = await runProductionScryptBenchmark();
    console.info(JSON.stringify({ benchmark: "scrypt", ...result }));
    assertScryptBudget(result);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "scrypt failed");
    process.exitCode = 1;
  }
}
