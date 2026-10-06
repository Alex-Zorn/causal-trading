import { NextResponse } from "next/server";
import { z } from "zod";
import { causalChainSchema } from "@/lib/causal-chain";
import {
  causalChainSystemPrompt,
  errorResponse,
  structuredCall,
  validateChain,
} from "@/lib/server/claude";

export const maxDuration = 300;

const instrumentCheckSchema = z.object({
  isInstrument: z.boolean(),
  interpretedAs: z.string(),
  explanation: z.string(),
});

const instrumentCheckPrompt = `You check whether a user's text names a tradable financial instrument: a security, index, futures contract, currency pair, commodity price, rate, ETF, cryptocurrency, or similar asset with an observable market price. Be generous with shorthand and tickers ("oil", "SPX", "10y treasuries", "NVDA", "cable").

If it is one, set isInstrument true and put a short, unambiguous canonical name in interpretedAs (e.g. "oil" -> "Brent crude oil futures", "SPX" -> "S&P 500 index"). If it is ambiguous, pick the most common interpretation.
If it is not (gibberish, a company with no listed security, an economic concept that is not traded, a non-financial thing), set isInstrument false, leave interpretedAs empty, and give a one-sentence explanation the user can act on.`;

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    const inputSchema = z.object({
      event: z.string().trim().min(8).max(500),
      instrument: z.string().trim().min(1).max(120),
      horizon: z.string().trim().min(2).max(80),
    });
    const input = inputSchema.safeParse(body);
    if (!input.success) {
      return NextResponse.json({ error: "Enter an event, an instrument, and a time horizon." }, { status: 400 });
    }

    // Cheap check first: stop before the long analysis if the instrument text isn't tradable.
    const check = await structuredCall({
      schema: instrumentCheckSchema,
      system: instrumentCheckPrompt,
      prompt: `Instrument text: ${input.data.instrument}`,
      effort: "low",
      maxTokens: 4000,
    });
    if (!check) {
      return NextResponse.json({ error: "Could not interpret the instrument. Please try again." }, { status: 502 });
    }
    if (!check.isInstrument || !check.interpretedAs.trim()) {
      return NextResponse.json(
        { error: `“${input.data.instrument}” doesn’t look like a financial instrument. ${check.explanation}`.trim() },
        { status: 422 },
      );
    }
    const instrument = check.interpretedAs.trim();

    const chain = await structuredCall({
      schema: causalChainSchema,
      system: causalChainSystemPrompt,
      prompt: `Global event hypothesis: ${input.data.event}\nFinancial instrument: ${instrument}\nOutcome horizon: ${input.data.horizon}\n\nAnalyze how the hypothetical event could affect the instrument.`,
      effort: "high",
    });
    if (!chain || !validateChain(chain)) {
      return NextResponse.json({ error: "The model did not return a causal chain. Please try again." }, { status: 502 });
    }
    return NextResponse.json({ instrument, chain });
  } catch (error) {
    return errorResponse(error, "Causal chain generation");
  }
}
