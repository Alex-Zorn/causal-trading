import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, structuredCall } from "@/lib/server/claude";

export const maxDuration = 120;

const suggestionSchema = z.object({
  suggestions: z.array(z.object({ instrument: z.string(), rationale: z.string() })),
});

const suggestPrompt = `You suggest financial instruments that a hypothetical global event could plausibly move through a short, traceable causal chain. Return 2 to 4 suggestions, most direct exposure first. Each instrument is a short, unambiguous name of something tradable (e.g. "Brent crude oil futures", "USD/JPY", "S&P 500 Energy sector ETF (XLE)"). Each rationale is one sentence naming the main transmission mechanism. Prefer diverse asset classes when the links are comparably strong. Do not invent market data.`;

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    const input = z
      .object({ event: z.string().trim().min(8).max(500), horizon: z.string().trim().min(2).max(80) })
      .safeParse(body);
    if (!input.success) {
      return NextResponse.json({ error: "Describe the event first, then ask for suggestions." }, { status: 400 });
    }

    const output = await structuredCall({
      schema: suggestionSchema,
      system: suggestPrompt,
      prompt: `Global event hypothesis: ${input.data.event}\nOutcome horizon: ${input.data.horizon}`,
      effort: "low",
      maxTokens: 8000,
    });
    const suggestions = output?.suggestions.filter((item) => item.instrument.trim()).slice(0, 4) ?? [];
    if (suggestions.length === 0) {
      return NextResponse.json({ error: "Couldn’t come up with suggestions. Please try again." }, { status: 502 });
    }
    return NextResponse.json({ suggestions });
  } catch (error) {
    return errorResponse(error, "Instrument suggestion");
  }
}
