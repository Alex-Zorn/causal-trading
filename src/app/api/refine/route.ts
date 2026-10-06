import { NextResponse } from "next/server";
import { z } from "zod";
import { causalChainSchema, storedChainSchema } from "@/lib/causal-chain";
import { causalChainSystemPrompt, errorResponse, structuredCall, validateChain } from "@/lib/server/claude";

export const maxDuration = 300;

const refineOutputSchema = z.object({
  chain: causalChainSchema,
  changeSummary: z.string(),
});

const refineInstructions = `You are revising an existing causal chain in response to the user's feedback. Apply the feedback faithfully and change as little else as possible. When a probability changes, rebalance the other cells in that matrix column so it still sums to 1, and update the highLikelihoodPath and conclusion so they stay consistent with the matrices (the path may change if the most plausible sequence changes). Keep existing IDs where events and outcomes are unchanged. If the feedback asks for something that would break the rules above, apply the closest valid version and say so. In changeSummary, state in 1-2 sentences what you changed.`;

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    const inputSchema = z.object({
      event: z.string().trim().min(1).max(500),
      instrument: z.string().trim().min(1).max(120),
      horizon: z.string().trim().min(1).max(80),
      chain: storedChainSchema,
      feedback: z.string().trim().min(3).max(1000),
    });
    const input = inputSchema.safeParse(body);
    if (!input.success) {
      return NextResponse.json({ error: "Describe the change you’d like to make." }, { status: 400 });
    }

    const output = await structuredCall({
      schema: refineOutputSchema,
      system: `${causalChainSystemPrompt}\n\n${refineInstructions}`,
      prompt: `Global event hypothesis: ${input.data.event}\nFinancial instrument: ${input.data.instrument}\nOutcome horizon: ${input.data.horizon}\n\nCurrent causal chain (JSON):\n${JSON.stringify(input.data.chain)}\n\nUser feedback:\n${input.data.feedback}`,
      effort: "low",
    });
    if (!output || !validateChain(output.chain)) {
      return NextResponse.json({ error: "The model did not return a valid revised chain. Please try again." }, { status: 502 });
    }
    return NextResponse.json(output);
  } catch (error) {
    return errorResponse(error, "Chain refinement");
  }
}
