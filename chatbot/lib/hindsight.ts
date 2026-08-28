/**
 * Thin client over the Hindsight REST API.
 *
 * Phase 1 focuses on `recallMemories()` for the dual-layer verification pattern.
 * `retainMemories()` is included for completeness and will be used by the
 * interview agent in later phases.
 *
 * Configuration (env vars):
 *   HINDSIGHT_API_URL   — default http://localhost:8888
 *   HINDSIGHT_BANK_ID   — default "zhangwei" (Phase 1 demo bank)
 */

const HINDSIGHT_API_URL =
  process.env.HINDSIGHT_API_URL ?? "http://localhost:8888";
const HINDSIGHT_BANK_ID = process.env.HINDSIGHT_BANK_ID ?? "zhangwei";

export type FactType = "world" | "experience" | "observation";
export type Budget = "low" | "mid" | "high";

export interface RecallResult {
  id: string;
  text: string;
  type: FactType;
  context: string | null;
  metadata: Record<string, string> | null;
  tags: string[] | null;
  entities: string[] | null;
  occurred_start: string | null;
  occurred_end: string | null;
  mentioned_at: string | null;
  document_id: string | null;
  chunk_id: string | null;
  source_fact_ids: string[] | null;
  scores: {
    final: number;
    reranker: number | null;
    semantic: number | null;
    keyword: number | null;
  } | null;
}

export interface RecallResponse {
  results: RecallResult[];
  source_facts?: Record<string, RecallResult>;
  source_facts_truncated?: boolean;
}

export interface RecallOptions {
  budget?: Budget;
  maxTokens?: number;
  types?: FactType[];
  preferObservations?: boolean;
  includeEntities?: boolean;
  queryTimestamp?: string;
}

export interface RetainItem {
  content: string;
  context?: string | null;
  timestamp?: string | null;
  metadata?: Record<string, string> | null;
}

export interface RetainResponse {
  success: boolean;
  bank_id: string;
  items_count: number;
  async: boolean;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
}

export class HindsightError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HindsightError";
  }
}

async function request<T>(path: string, body: unknown): Promise<T> {
  const url = `${HINDSIGHT_API_URL}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new HindsightError(
      0,
      `Hindsight unreachable at ${HINDSIGHT_API_URL}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new HindsightError(res.status, `Hindsight ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

/**
 * Synchronously recall memories for a query. This is the hot path for the
 * main agent — called on every user message to inject relevant facts into
 * the system prompt before the LLM answers.
 */
export async function recallMemories(
  query: string,
  options: RecallOptions = {},
): Promise<RecallResponse> {
  return request<RecallResponse>(
    `/v1/default/banks/${HINDSIGHT_BANK_ID}/memories/recall`,
    {
      query,
      types: options.types ?? ["observation", "world"],
      prefer_observations: options.preferObservations ?? true,
      budget: options.budget ?? "mid",
      max_tokens: options.maxTokens ?? 2048,
      include: {
        // Hindsight API expects an object { max_tokens: N } when enabling
        // entity inclusion, not a boolean. See Hindsight OpenAPI schema for
        // IncludeOptions.entities.
        entities:
          options.includeEntities !== false ? { max_tokens: 500 } : false,
      },
      ...(options.queryTimestamp
        ? { query_timestamp: options.queryTimestamp }
        : {}),
    },
  );
}

/**
 * Retain memories into the bank. The Hindsight worker will extract facts,
 * compute embeddings, and persist asynchronously. Phase 1 does not call this;
 * it's exposed for Phase 2+ interview agent use.
 */
export async function retainMemories(
  items: RetainItem[],
): Promise<RetainResponse> {
  return request<RetainResponse>(
    `/v1/default/banks/${HINDSIGHT_BANK_ID}/memories`,
    { items },
  );
}

/**
 * Health check. Returns true if Hindsight is reachable and reports healthy.
 * Useful for the UI to show connection status.
 */
export async function isHindsightHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${HINDSIGHT_API_URL}/health`);
    if (!res.ok) return false;
    const data = (await res.json()) as { status?: string };
    return data.status === "healthy";
  } catch {
    return false;
  }
}
