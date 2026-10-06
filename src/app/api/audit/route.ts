import { NextResponse } from "next/server";
import { z } from "zod";
import { storedChainSchema, type AuditRecord, type StoredChain } from "@/lib/causal-chain";
import { conditionalProbability, selectOutcome } from "@/lib/distribution";
import { errorResponse, normalizeUrl, researchedCall, validateChain } from "@/lib/server/claude";

export const maxDuration = 300;

const MAX_SEARCHES = 5;

const findingsShape = {
  assessment: z.string(),
  sources: z.array(z.object({ title: z.string(), url: z.string() })),
  adjusted: z.boolean(),
  changeSummary: z.string(),
};

const transitionAuditSchema = z.object({
  ...findingsShape,
  matrix: z.array(z.array(z.number().min(0).max(1))),
  description: z.string(),
  conclusion: z.string(),
});

const returnAuditSchema = z.object({
  ...findingsShape,
  conditionalReturns: z.array(z.object({ outcomeId: z.string(), expectedReturnPct: z.number(), explanation: z.string() })),
});

const auditSystemPrompt = `You are a skeptical macro-financial reviewer auditing one link of a causal chain that another analyst built for scenario analysis (not a forecast or investment recommendation). Investigate whether the link holds up, more deeply than the original analysis did.

How to work:
- Use web search to test the link against evidence: historical precedents and how they played out, research or official analysis of the mechanism, and the typical size of past market reactions. Prefer primary and reputable sources (central banks, statistical agencies, international organizations, academic work, established financial press). Up to ${MAX_SEARCHES} searches; stop early if the evidence is clear.
- Judge the link on its merits. Leave values unchanged when they are defensible, and change them only as far as the evidence supports. Do not shift numbers just to show that you did something.

What to return:
- assessment: 2-4 short paragraphs of plain text separated by blank lines, no markdown. Say what the link claims, the evidence for and against it (naming the sources you rely on), the main uncertainties, and your verdict on the current values.
- sources: the pages you actually retrieved and relied on, with their exact URLs from the search results. Never invent or guess a URL. Return an empty list if the search found nothing useful.
- adjusted: true only if you changed any value.
- changeSummary: 1-2 sentences on what you changed and why, or why you left everything as it was.`;

const transitionInstructions = `This link is a transition between two events. Return the full revised matrix in matrix, with the same dimensions and order as the current one: rows are the target event's outcomes, columns the source event's outcomes, and every column sums to 1. If you make no change, return the current matrix exactly. In description, write the causal mechanism in 2-3 sentences, refined by what you found. Do not change the events or outcomes themselves.
In conclusion, rewrite the chain's 1-3 sentence conclusion so it stays true under your matrix. After the audit, the high-likelihood path keeps its outcomes up to this link's source event, then follows the most likely outcome at each later step. The path qualifies only if every step after the hypothesis has conditional probability strictly above 0.75; if it doesn't, say which step falls short and why.`;

const returnInstructions = `This link is the last one: the instrument's expected return over the horizon, conditional on each outcome of the last event. You may not change any probability in the chain. You may revise each outcome's expectedReturnPct, and you should improve its explanation (2-3 sentences: the mechanism, roughly how far the move goes, and what is or isn't already priced in), using no invented precise market data. Return one entry for each outcome of the last event, using the same outcomeIds.`;

function linkPrompt(chain: StoredChain, link: number) {
  if (link < chain.transitions.length) {
    const source = chain.events[link];
    const target = chain.events[link + 1];
    return `Link to audit: the transition from event "${source.title}" to event "${target.title}".
Source outcomes (matrix columns, in order): ${source.outcomes.map((outcome) => `${outcome.id} "${outcome.label}"`).join("; ")}
Target outcomes (matrix rows, in order): ${target.outcomes.map((outcome) => `${outcome.id} "${outcome.label}"`).join("; ")}
Current matrix: ${JSON.stringify(chain.transitions[link].matrix)}
Current mechanism: ${chain.transitions[link].description}`;
  }
  const last = chain.events[chain.events.length - 1];
  return `Link to audit: the last link, from the outcomes of event "${last.title}" to the instrument's expected return.
Current conditional returns: ${JSON.stringify(chain.returnModel.conditionalReturns)}`;
}

/** Keeps only sources whose URL came back in a search result, dropping duplicates. */
function verifiedSources(sources: AuditRecord["sources"], retrievedUrls: Set<string>) {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const url = normalizeUrl(source.url);
    if (!/^https?:\/\//i.test(url) || !retrievedUrls.has(url) || seen.has(url)) return false;
    seen.add(url);
    return true;
  });
}

function applyTransitionAudit(chain: StoredChain, link: number, output: z.infer<typeof transitionAuditSchema>, sources: AuditRecord["sources"]) {
  const transition = chain.transitions[link];
  const { matrix } = output;
  if (matrix.length !== transition.matrix.length || matrix.some((row) => row.length !== transition.matrix[0].length)) return null;
  const columns = transition.matrix[0].length;
  for (let column = 0; column < columns; column += 1) {
    if (Math.abs(matrix.reduce((sum, row) => sum + row[column], 0) - 1) > 0.01) return null;
  }
  // Remove rounding drift so every column sums to exactly 1.
  const normalized = matrix.map((row) => row.map((cell, column) => cell / matrix.reduce((sum, other) => sum + other[column], 0)));
  const changed = normalized.some((row, r) => row.some((cell, c) => Math.abs(cell - transition.matrix[r][c]) > 0.0005));

  const audit: AuditRecord = {
    adjusted: changed,
    assessment: output.assessment,
    sources,
    changeSummary: output.changeSummary,
    ...(changed && { previousMatrix: transition.matrix }),
  };
  const transitions = chain.transitions.map((item, index) => (index === link ? { ...item, matrix: changed ? normalized : item.matrix, description: output.description, audit } : item));
  let next: StoredChain = { ...chain, transitions };
  if (changed) {
    const pathIds = chain.highLikelihoodPath.map((step) => step.outcomeId);
    const ids = selectOutcome(next, pathIds, link, pathIds[link]);
    next = {
      ...next,
      conclusion: output.conclusion,
      highLikelihoodPath: ids.map((outcomeId, index) => ({
        eventId: next.events[index].id,
        outcomeId,
        probability: conditionalProbability(next, ids, index, outcomeId),
      })),
    };
  }
  return next;
}

function applyReturnAudit(chain: StoredChain, output: z.infer<typeof returnAuditSchema>, sources: AuditRecord["sources"]) {
  const current = chain.returnModel.conditionalReturns;
  if (output.conditionalReturns.length !== current.length) return null;
  const revised = current.map((entry) => output.conditionalReturns.find((item) => item.outcomeId === entry.outcomeId));
  if (revised.some((entry) => !entry || !Number.isFinite(entry.expectedReturnPct) || !entry.explanation.trim())) return null;
  const conditionalReturns = revised.map((entry) => entry!);
  const changed = conditionalReturns.some((entry, index) => Math.abs(entry.expectedReturnPct - current[index].expectedReturnPct) > 0.005);
  const audit: AuditRecord = {
    adjusted: changed,
    assessment: output.assessment,
    sources,
    changeSummary: output.changeSummary,
    ...(changed && { previousReturnsPct: current.map((entry) => entry.expectedReturnPct) }),
  };
  return { ...chain, returnModel: { ...chain.returnModel, conditionalReturns, audit } };
}

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    const inputSchema = z.object({
      event: z.string().trim().min(1).max(500),
      instrument: z.string().trim().min(1).max(120),
      horizon: z.string().trim().min(1).max(80),
      chain: storedChainSchema,
      link: z.number().int().min(0),
    });
    const input = inputSchema.safeParse(body);
    if (!input.success || input.data.link > input.data.chain.transitions.length) {
      return NextResponse.json({ error: "Choose a connection to audit." }, { status: 400 });
    }
    const { chain, link } = input.data;
    const isReturnLink = link === chain.transitions.length;
    const prompt = `Global event hypothesis: ${input.data.event}\nFinancial instrument: ${input.data.instrument}\nOutcome horizon: ${input.data.horizon}\n\nFull causal chain (JSON):\n${JSON.stringify(chain, (key, value) => (key === "audit" ? undefined : value))}\n\n${linkPrompt(chain, link)}`;

    let next: StoredChain | null;
    if (isReturnLink) {
      const { output, retrievedUrls } = await researchedCall({
        schema: returnAuditSchema,
        system: `${auditSystemPrompt}\n\n${returnInstructions}`,
        prompt,
        effort: "high",
        maxSearches: MAX_SEARCHES,
      });
      next = output && applyReturnAudit(chain, output, verifiedSources(output.sources, retrievedUrls));
    } else {
      const { output, retrievedUrls } = await researchedCall({
        schema: transitionAuditSchema,
        system: `${auditSystemPrompt}\n\n${transitionInstructions}`,
        prompt,
        effort: "high",
        maxSearches: MAX_SEARCHES,
      });
      next = output && applyTransitionAudit(chain, link, output, verifiedSources(output.sources, retrievedUrls));
    }
    if (!next || !validateChain(next)) {
      return NextResponse.json({ error: "The audit did not return a usable result. Please try again." }, { status: 502 });
    }
    return NextResponse.json({ chain: next });
  } catch (error) {
    return errorResponse(error, "Connection audit");
  }
}
