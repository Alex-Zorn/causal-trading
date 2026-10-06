import type { ReturnModel, StoredChain } from "@/lib/causal-chain";

// ---- Path selection ----

/** Index of the largest value in column `column` of a transition matrix. */
function mostLikelyRow(matrix: number[][], column: number) {
  let best = 0;
  for (let row = 1; row < matrix.length; row += 1) {
    if ((matrix[row][column] ?? 0) > (matrix[best][column] ?? 0)) best = row;
  }
  return best;
}

function outcomeIndex(chain: StoredChain, eventIndex: number, outcomeId: string) {
  return chain.events[eventIndex].outcomes.findIndex((outcome) => outcome.id === outcomeId);
}

/** Re-picks the most likely outcome for every event after `fromIndex`, given the selections up to it. */
function fillDownstream(chain: StoredChain, ids: string[], fromIndex: number) {
  const next = ids.slice(0, fromIndex + 1);
  for (let index = fromIndex + 1; index < chain.events.length; index += 1) {
    const sourceColumn = outcomeIndex(chain, index - 1, next[index - 1]);
    const row = mostLikelyRow(chain.transitions[index - 1].matrix, sourceColumn);
    next.push(chain.events[index].outcomes[row].id);
  }
  return next;
}

/** One selected outcome id per event, starting from the model's high-likelihood path. */
export function defaultSelection(chain: StoredChain) {
  return chain.highLikelihoodPath.map((step) => step.outcomeId);
}

export function selectOutcome(chain: StoredChain, ids: string[], eventIndex: number, outcomeId: string) {
  const next = [...ids];
  next[eventIndex] = outcomeId;
  return fillDownstream(chain, next, eventIndex);
}

/** P(outcome at eventIndex | selected outcome at eventIndex - 1). */
export function conditionalProbability(chain: StoredChain, ids: string[], eventIndex: number, outcomeId: string) {
  if (eventIndex === 0) return 1;
  const row = outcomeIndex(chain, eventIndex, outcomeId);
  const column = outcomeIndex(chain, eventIndex - 1, ids[eventIndex - 1]);
  return chain.transitions[eventIndex - 1].matrix[row]?.[column] ?? 0;
}

/** Probability of the whole selected path: the product of its conditional probabilities. */
export function scenarioProbability(chain: StoredChain, ids: string[]) {
  return ids.reduce((product, id, index) => product * conditionalProbability(chain, ids, index, id), 1);
}

/** Expected return and its rationale, given an outcome of the last event. */
export function conditionalReturn(returnModel: ReturnModel, outcomeId: string) {
  return returnModel.conditionalReturns.find((entry) => entry.outcomeId === outcomeId);
}

// ---- Terminal distribution ----

/** Unconditional probability of each outcome of the last event: M_n · … · M_1 · [1]. */
export function finalOutcomeProbabilities(chain: StoredChain) {
  let probabilities = [1];
  for (const transition of chain.transitions) {
    probabilities = transition.matrix.map((row) => row.reduce((sum, cell, column) => sum + cell * (probabilities[column] ?? 0), 0));
  }
  return probabilities;
}

/** Converts a horizon like "3 months" or "1 week" to years; defaults to one month. */
export function horizonYears(horizon: string) {
  const match = horizon.match(/(\d+(?:\.\d+)?)\s*(day|week|month|quarter|year)/i);
  if (!match) return 1 / 12;
  const perYear = { day: 365, week: 52, month: 12, quarter: 4, year: 1 }[match[2].toLowerCase() as "day"];
  return Number(match[1]) / perYear;
}

// Abramowitz & Stegun 7.1.26; absolute error < 1.5e-7.
function erf(x: number) {
  const sign = Math.sign(x);
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return sign * (1 - poly * Math.exp(-x * x));
}

const normalPdf = (x: number, mean: number, sd: number) => Math.exp(-0.5 * ((x - mean) / sd) ** 2) / (sd * Math.sqrt(2 * Math.PI));
const normalCdf = (x: number, mean: number, sd: number) => 0.5 * (1 + erf((x - mean) / (sd * Math.SQRT2)));

export type Component = { outcomeId: string; label: string; weight: number; mean: number };
export type Bin = { from: number | null; to: number | null; probability: number; cumulative: number };

export type TerminalDistribution = {
  components: Component[];
  /** Background noise: standard deviation of returns over the horizon, in percent. */
  noiseSd: number;
  annualizedVolatilityPct: number;
  mean: number;
  sd: number;
  probabilityOfGain: number;
  percentiles: { p5: number; p50: number; p95: number };
  pdf: (x: number) => number;
  cdf: (x: number) => number;
  bins: Bin[];
  binStep: number;
};

/** A "nice" step (1, 2, 2.5 or 5 × 10^k) close to `rough`. */
export function niceStep(rough: number) {
  const power = 10 ** Math.floor(Math.log10(rough));
  const scaled = rough / power;
  const factor = scaled < 1.5 ? 1 : scaled < 2.25 ? 2 : scaled < 3.5 ? 2.5 : scaled < 7.5 ? 5 : 10;
  return factor * power;
}

/**
 * Mixture of normals: each outcome of the last event contributes N(its conditional expected return, σ√T)
 * weighted by its unconditional probability, where σ is the instrument's annualized volatility and T the
 * horizon in years.
 */
export function terminalDistribution(chain: StoredChain, horizon: string): TerminalDistribution {
  const { returnModel } = chain;
  const lastEvent = chain.events[chain.events.length - 1];
  const weights = finalOutcomeProbabilities(chain);
  const components = lastEvent.outcomes.map((outcome, index) => ({
    outcomeId: outcome.id,
    label: outcome.label,
    weight: weights[index] ?? 0,
    mean: conditionalReturn(returnModel, outcome.id)?.expectedReturnPct ?? 0,
  }));
  const noiseSd = returnModel.annualizedVolatilityPct * Math.sqrt(horizonYears(horizon));

  const pdf = (x: number) => components.reduce((sum, c) => sum + c.weight * normalPdf(x, c.mean, noiseSd), 0);
  const cdf = (x: number) => components.reduce((sum, c) => sum + c.weight * normalCdf(x, c.mean, noiseSd), 0);
  const mean = components.reduce((sum, c) => sum + c.weight * c.mean, 0);
  const secondMoment = components.reduce((sum, c) => sum + c.weight * (noiseSd ** 2 + c.mean ** 2), 0);
  const sd = Math.sqrt(Math.max(secondMoment - mean ** 2, 0));

  const quantile = (p: number) => {
    let low = mean - 10 * sd;
    let high = mean + 10 * sd;
    for (let step = 0; step < 60; step += 1) {
      const mid = (low + high) / 2;
      if (cdf(mid) < p) low = mid;
      else high = mid;
    }
    return (low + high) / 2;
  };

  // Bins span roughly the 1st–99th percentile; the two ends are open tails.
  const p1 = quantile(0.01);
  const p99 = quantile(0.99);
  const binStep = niceStep((p99 - p1) / 8);
  const edges: number[] = [];
  for (let edge = Math.floor(p1 / binStep) * binStep; edge <= Math.ceil(p99 / binStep) * binStep + binStep / 2; edge += binStep) {
    edges.push(Math.round(edge / binStep) * binStep);
  }
  const bins: Bin[] = [];
  const pushBin = (from: number | null, to: number | null) => {
    const upper = to === null ? 1 : cdf(to);
    const lower = from === null ? 0 : cdf(from);
    bins.push({ from, to, probability: Math.max(upper - lower, 0), cumulative: upper });
  };
  pushBin(null, edges[0]);
  for (let index = 0; index < edges.length - 1; index += 1) pushBin(edges[index], edges[index + 1]);
  pushBin(edges[edges.length - 1], null);

  return {
    components,
    noiseSd,
    annualizedVolatilityPct: returnModel.annualizedVolatilityPct,
    mean,
    sd,
    probabilityOfGain: 1 - cdf(0),
    percentiles: { p5: quantile(0.05), p50: quantile(0.5), p95: quantile(0.95) },
    pdf,
    cdf,
    bins,
    binStep,
  };
}

export function formatReturn(value: number, digits = 1) {
  const rounded = Number(value.toFixed(digits));
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(digits)}%`;
}

export function formatProbability(value: number) {
  if (value > 0 && value < 0.001) return "<0.1%";
  return `${(value * 100).toFixed(value < 0.1 ? 1 : 0)}%`;
}
