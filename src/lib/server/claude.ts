import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { NextResponse } from "next/server";
import type { z } from "zod";
import type { CausalChain } from "@/lib/causal-chain";

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5";

// Reads ANTHROPIC_API_KEY from the environment.
const client = new Anthropic();

export class RefusalError extends Error {}

type Effort = "low" | "medium" | "high";

// Server tools run in a server-side loop that can pause mid-turn; resume at most this many times.
const MAX_CONTINUATIONS = 4;

/** One structured-output call. Returns the parsed object, or null if the model's output didn't match the schema. */
export async function structuredCall<Schema extends z.ZodType>(options: {
  schema: Schema;
  system: string;
  prompt: string;
  effort: Effort;
  maxTokens?: number;
}): Promise<z.infer<Schema> | null> {
  return (await researchedCall({ ...options, maxSearches: 0 })).output;
}

/**
 * A structured-output call that may search the web first. Also returns every URL that came back in a
 * search or fetch result, so cited sources can be checked against what the model actually retrieved.
 */
export async function researchedCall<Schema extends z.ZodType>(options: {
  schema: Schema;
  system: string;
  prompt: string;
  effort: Effort;
  maxTokens?: number;
  maxSearches: number;
}): Promise<{ output: z.infer<Schema> | null; retrievedUrls: Set<string> }> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: options.prompt }];
  const retrievedUrls = new Set<string>();
  for (let turn = 0; turn <= MAX_CONTINUATIONS; turn += 1) {
    const response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: options.maxTokens ?? 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: options.effort, format: betaZodOutputFormat(options.schema) },
      ...(options.maxSearches > 0 && { tools: [{ type: "web_search_20260209", name: "web_search", max_uses: options.maxSearches }] }),
      system: options.system,
      messages,
    });
    if (response.stop_reason === "refusal") throw new RefusalError();
    for (const block of response.content) {
      if (!block.type.endsWith("tool_result")) continue;
      for (const match of JSON.stringify(block).matchAll(/"url":"([^"]+)"/g)) retrievedUrls.add(normalizeUrl(match[1]));
    }
    if (response.stop_reason !== "pause_turn") return { output: response.parsed_output ?? null, retrievedUrls };
    // Send the paused turn back unchanged (search results and citations carry encrypted fields the API
    // needs); only drop the SDK's client-side parsed_output from text blocks. The API resumes from the
    // trailing server tool call.
    messages.push({
      role: "assistant",
      content: response.content.map((block) =>
        block.type === "text" ? (Object.fromEntries(Object.entries(block).filter(([key]) => key !== "parsed_output")) as typeof block) : block,
      ),
    });
  }
  return { output: null, retrievedUrls };
}

export function normalizeUrl(url: string) {
  return url.trim().replace(/#.*$/, "").replace(/\/+$/, "");
}

export const causalChainSystemPrompt = `You are a careful macro-financial causal analyst. Build a concise, conditional causal chain for the user's global-event hypothesis and financial instrument. This is scenario analysis, not a forecast or investment recommendation.

Return a structured causalChain object matching the supplied schema. Requirements:
- 1 to 5 events total: the hypothesis event followed by zero to four intermediate events. Events are real-world developments, not price moves: do not add an event describing the instrument's return or bucketing it into ranges. The chain's last link, from the last event to the instrument, is expressed through returnModel instead.
- The first event must have exactly one outcome representing the user-provided hypothesis. Each later event should have 2-4 mutually exclusive outcomes.
- Every adjacent pair of events needs one transition matrix. Matrix rows correspond in order to the target event's outcomes; columns correspond in order to the source event's outcomes. Every column must sum to 1 within rounding tolerance. Include a short, concrete English description of the causal mechanism for each transition.
- Provide a highLikelihoodPath containing one outcome per event. For each event after the initial hypothesis, that outcome must have conditional probability strictly greater than 0.75 given the previous path outcome, as shown by the corresponding matrix cell. The initial outcome probability is 1. The path should use the most plausible linked outcome sequence; probabilities must match the matrices.
- If no defensible path meets this >75% condition within the event limit, return an honest conclusion explaining that no qualifying chain exists; still return a valid chain with coherent, normalized matrices and the best-supported outcomes where possible, but do not claim it qualifies. Set the path probability to the actual probability (at or below .75) where the threshold fails.
- Keep scenarios grounded, distinguish uncertainty from facts, use no invented precise market data, and mention material caveats. Do not manufacture probabilities to force a high-likelihood path.
- Always write a non-empty conclusion of 1-3 sentences: state whether the path qualifies under the >75% condition, and if not, which step falls short and why.
- Provide a returnModel. In conditionalReturns, give one entry per outcome of the last event (and no others): expectedReturnPct is the instrument's expected return in percent over the horizon, conditional on that outcome having occurred; explanation is 1-2 sentences on why the outcome moves the instrument that way and roughly how far (the mechanism and what is or isn't already priced in), without invented precise market data. If the chain has only the hypothesis event, give one entry for its single outcome. In annualizedVolatilityPct, give a typical annualized volatility for the instrument in percent, as a round long-run figure (e.g. 30 for Brent crude, 7 for EUR/USD), not an invented current quote. In volatilityNote, say in one sentence where the figure comes from. This volatility is used as background noise around each conditional return, so do not inflate it for the event itself.
- IDs must be unique and stable within the response. Descriptions and labels should be concise.`;

export function validateChain(chain: CausalChain) {
  if (!chain.conclusion.trim()) return false;
  if (chain.transitions.length !== chain.events.length - 1) return false;
  if (chain.events[0].outcomes.length !== 1) return false;
  for (let index = 0; index < chain.transitions.length; index += 1) {
    const transition = chain.transitions[index];
    const source = chain.events[index];
    const target = chain.events[index + 1];
    if (transition.fromEventId !== source.id || transition.toEventId !== target.id) return false;
    if (transition.matrix.length !== target.outcomes.length) return false;
    if (transition.matrix.some((row) => row.length !== source.outcomes.length)) return false;
    for (let column = 0; column < source.outcomes.length; column += 1) {
      const values = transition.matrix.map((row) => row[column]);
      if (Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) > 0.001) return false;
    }
  }
  const lastOutcomes = chain.events[chain.events.length - 1].outcomes;
  const returns = chain.returnModel.conditionalReturns;
  if (returns.length !== lastOutcomes.length) return false;
  if (lastOutcomes.some((outcome) => !returns.some((entry) => entry.outcomeId === outcome.id))) return false;
  if (returns.some((entry) => !Number.isFinite(entry.expectedReturnPct) || !entry.explanation.trim())) return false;
  const volatility = chain.returnModel.annualizedVolatilityPct;
  if (!(volatility > 0 && volatility < 300)) return false;
  if (chain.highLikelihoodPath.length !== chain.events.length) return false;
  for (let index = 0; index < chain.events.length; index += 1) {
    const event = chain.events[index];
    const step = chain.highLikelihoodPath[index];
    if (step.eventId !== event.id || !event.outcomes.some((outcome) => outcome.id === step.outcomeId)) return false;
    if (index > 0) {
      const transition = chain.transitions[index - 1];
      const sourceOutcomeId = chain.highLikelihoodPath[index - 1].outcomeId;
      const sourceIndex = chain.events[index - 1].outcomes.findIndex((outcome) => outcome.id === sourceOutcomeId);
      const targetIndex = event.outcomes.findIndex((outcome) => outcome.id === step.outcomeId);
      const probability = transition.matrix[targetIndex]?.[sourceIndex];
      if (probability === undefined || Math.abs(probability - step.probability) > 0.001) return false;
    } else if (step.probability !== 1) return false;
  }
  return true;
}


/** Maps thrown errors from a route handler to a JSON error response. */
export function errorResponse(error: unknown, label: string) {
  console.error(`${label} failed:`, error);
  if (error instanceof RefusalError) {
    return NextResponse.json({ error: "Claude declined to analyze this scenario." }, { status: 422 });
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return NextResponse.json({ error: "Invalid or missing ANTHROPIC_API_KEY." }, { status: 500 });
  }
  if (error instanceof Anthropic.RateLimitError) {
    return NextResponse.json({ error: "Rate limited by the Anthropic API. Try again shortly." }, { status: 429 });
  }
  return NextResponse.json({ error: "Something went wrong talking to Claude. Please try again." }, { status: 500 });
}
