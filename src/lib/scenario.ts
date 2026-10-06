import { z } from "zod";
import { storedChainSchema } from "@/lib/causal-chain";

export const scenarioSchema = z.object({
  event: z.string(),
  instrument: z.string(),
  horizon: z.string(),
  chain: storedChainSchema,
});

export type Scenario = z.infer<typeof scenarioSchema>;

// Share codes are "cm1." + base64url(deflate-raw(JSON)). They carry the whole scenario,
// so loading one needs no server round-trip. The prefix versions the format.
const PREFIX = "cm1.";

async function pipeBytes(bytes: Uint8Array, transform: CompressionStream | DecompressionStream) {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string) {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export async function encodeScenario(scenario: Scenario) {
  const json = new TextEncoder().encode(JSON.stringify(scenario));
  return PREFIX + toBase64Url(await pipeBytes(json, new CompressionStream("deflate-raw")));
}

/** Returns the decoded scenario, or null if the code is malformed. */
export async function decodeScenario(code: string): Promise<Scenario | null> {
  const trimmed = code.replace(/\s+/g, "");
  if (!trimmed.startsWith(PREFIX)) return null;
  try {
    const bytes = await pipeBytes(fromBase64Url(trimmed.slice(PREFIX.length)), new DecompressionStream("deflate-raw"));
    const parsed = scenarioSchema.safeParse(JSON.parse(new TextDecoder().decode(bytes)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export type SavedScenario = { id: string; savedAt: number; scenario: Scenario };

const STORAGE_KEY = "causal-markets:saved-scenarios";

export function loadSavedScenarios(): SavedScenario[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Parse entry by entry so one scenario from an unsupported older format doesn't hide the rest.
    const entrySchema = z.object({ id: z.string(), savedAt: z.number(), scenario: scenarioSchema });
    return parsed.flatMap((entry) => {
      const result = entrySchema.safeParse(entry);
      return result.success ? [result.data] : [];
    });
  } catch {
    return [];
  }
}

export function storeSavedScenarios(saved: SavedScenario[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    return true;
  } catch {
    return false;
  }
}
