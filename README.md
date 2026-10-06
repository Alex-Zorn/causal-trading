# Causal Markets

Explore how hypothetical global events could ripple through financial markets. Enter an event, choose an instrument and horizon, then inspect an AI-generated causal chain with conditional outcome matrices, plain-language mechanisms, and a high-likelihood path when one exists.

## Run locally

1. Install dependencies with `npm install`.
2. Create `.env.local` with your Anthropic API key: `ANTHROPIC_API_KEY=sk-ant-...`. Optionally set `ANTHROPIC_MODEL` to override the default model.
3. Start the development server with `npm run dev` and open http://localhost:3000.

The app calls the Anthropic API directly with the official SDK, using Claude Opus 5.5 by default. The API prompt instructs the model to cap chains at five events, normalize transition-matrix columns, give an expected return (with an explanation) conditional on each outcome of the last event, verify the >75% conditional-path threshold, and explicitly report when no qualifying chain exists. Results are scenario analysis, not investment advice.
