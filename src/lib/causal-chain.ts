import { z } from "zod";

const eventSchema = z.object({
  id: z.string(),
  title: z.string(),
  outcomes: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        description: z.string(),
      }),
    )
    .min(1)
    .max(4),
});

const transitionSchema = z.object({
  fromEventId: z.string(),
  toEventId: z.string(),
  description: z.string(),
  matrix: z.array(z.array(z.number().min(0).max(1))),
});

const pathStepSchema = z.object({
  eventId: z.string(),
  outcomeId: z.string(),
  probability: z.number().min(0).max(1),
});

/** The last causal link: the instrument's expected return conditioned on each outcome of the last event. */
export const returnModelSchema = z.object({
  conditionalReturns: z.array(
    z.object({
      outcomeId: z.string(),
      expectedReturnPct: z.number(),
      explanation: z.string(),
    }),
  ),
  annualizedVolatilityPct: z.number(),
  volatilityNote: z.string(),
});

export const causalChainSchema = z.object({
  events: z.array(eventSchema).min(1).max(5),
  transitions: z.array(transitionSchema),
  highLikelihoodPath: z.array(pathStepSchema),
  conclusion: z.string(),
  returnModel: returnModelSchema,
});

// Earlier chains ended in a "market outcome" event whose outcomes were return buckets, reached by a
// deterministic final transition, with one expected return per bucket.
const legacyChainSchema = z.object({
  events: z.array(eventSchema).min(2).max(6),
  transitions: z.array(transitionSchema),
  highLikelihoodPath: z.array(pathStepSchema),
  conclusion: z.string(),
  marketModel: z.object({
    outcomeReturns: z.array(z.object({ outcomeId: z.string(), expectedReturnPct: z.number() })),
    annualizedVolatilityPct: z.number(),
    volatilityNote: z.string(),
  }),
});

/** Drops the bucket event; each source outcome takes the return and description of the bucket it mapped to. */
function migrateLegacyChain(legacy: z.infer<typeof legacyChainSchema>): CausalChain {
  const bucketEvent = legacy.events[legacy.events.length - 1];
  const finalTransition = legacy.transitions[legacy.transitions.length - 1];
  const sourceEvent = legacy.events[legacy.events.length - 2];
  return {
    events: legacy.events.slice(0, -1),
    transitions: legacy.transitions.slice(0, -1),
    highLikelihoodPath: legacy.highLikelihoodPath.slice(0, -1),
    conclusion: legacy.conclusion,
    returnModel: {
      conditionalReturns: sourceEvent.outcomes.map((outcome, column) => {
        const row = finalTransition.matrix.findIndex((cells) => cells[column] === 1);
        const bucket = bucketEvent.outcomes[row];
        const entry = legacy.marketModel.outcomeReturns.find((item) => item.outcomeId === bucket?.id);
        return {
          outcomeId: outcome.id,
          expectedReturnPct: entry?.expectedReturnPct ?? 0,
          explanation: [finalTransition.description, bucket ? `${bucket.label}: ${bucket.description}` : ""].filter(Boolean).join(" "),
        };
      }),
      annualizedVolatilityPct: legacy.marketModel.annualizedVolatilityPct,
      volatilityNote: legacy.marketModel.volatilityNote,
    },
  };
}

/** The result of auditing one link. Kept on the link so it travels with saves, shares and undo. */
export const auditRecordSchema = z.object({
  adjusted: z.boolean(),
  assessment: z.string(),
  sources: z.array(z.object({ title: z.string(), url: z.string() })),
  changeSummary: z.string(),
  /** Values before the audit changed them: the matrix for a transition, returns (in conditionalReturns order) for the return link. */
  previousMatrix: z.array(z.array(z.number())).optional(),
  previousReturnsPct: z.array(z.number()).optional(),
});

const auditedChainSchema = causalChainSchema.extend({
  transitions: z.array(transitionSchema.extend({ audit: auditRecordSchema.optional() })),
  returnModel: returnModelSchema.extend({ audit: auditRecordSchema.optional() }),
});

// Saved and shared scenarios may hold the legacy shape; they load as current chains.
export const storedChainSchema = z.union([auditedChainSchema, legacyChainSchema.transform(migrateLegacyChain)]);

export type CausalChain = z.infer<typeof causalChainSchema>;
export type StoredChain = z.infer<typeof auditedChainSchema>;
export type ReturnModel = z.infer<typeof returnModelSchema>;
export type AuditRecord = z.infer<typeof auditRecordSchema>;
