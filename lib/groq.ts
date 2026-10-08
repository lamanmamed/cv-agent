export const GROQ_MODEL = "openai/gpt-oss-20b";

export class GroqError extends Error {
  code: string;
  status: number;
  retryAfter?: number;
  constructor(message: string, code: string, status = 502, retryAfter?: number) {
    super(message);
    this.name = "GroqError";
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

function providerError(status: number, body: unknown, retryHeader: string | null) {
  const error = (body as {error?: {code?: unknown; message?: unknown}} | null)?.error;
  const detail = `${typeof error?.code === "string" ? error.code : ""} ${typeof error?.message === "string" ? error.message : ""}`;
  // Classify provider diagnostics, but never echo raw bodies: they can contain prompts or credentials.
  if (status === 401) return new GroqError("Groq rejected the API key. Reconnect it in AI settings.", "GROQ_AUTH", 401);
  if (status === 403 || /model.*(?:permission|access|not.found)|model_not_found/i.test(detail)) return new GroqError("This Groq project cannot use the CV review model. Enable GPT-OSS 20B in Groq model permissions.", "GROQ_MODEL_ACCESS", 403);
  if (status === 413 || /(?:request|context).*(?:too.large|length)|reduce.*(?:tokens|message)/i.test(detail)) return new GroqError("The review exceeds this Groq project's token limit. Use shorter job or project sources and try again.", "GROQ_INPUT_LIMIT", 413);
  if (status === 429) {
    const seconds = retryHeader?.trim() ? Number(retryHeader) : NaN;
    const retryAfter = Number.isFinite(seconds) && seconds > 0 && seconds <= 86400 ? Math.ceil(seconds) : undefined;
    const quota = /quota|billing|spend|per.day|\bTPD\b|\bRPD\b/i.test(detail);
    return new GroqError(quota ? "Groq's daily quota or spending limit is reached. Check Groq usage and wait for the limit to reset." : `Groq's rate limit is reached.${retryAfter ? ` Try again in ${retryAfter} seconds.` : " Wait a minute before trying again."}`, quota ? "GROQ_QUOTA" : "GROQ_RATE_LIMIT", 429, retryAfter);
  }
  if (status === 400 || status === 422) return new GroqError(/json|schema|response_format/i.test(detail) ? "Groq rejected the structured review format. Reconnect AI to test the current configuration." : "Groq rejected the review request. Reconnect AI to test the current configuration.", "GROQ_REQUEST_REJECTED");
  return new GroqError(`Groq is unavailable (HTTP ${status}). Try again later.`, "GROQ_UNAVAILABLE", 503);
}

export async function groqJSON(key: string, options: {
  messages: {role: "system" | "user"; content: string}[];
  schema: object;
  maxCompletionTokens: number;
  timeoutMs?: number;
}): Promise<unknown> {
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {Authorization: `Bearer ${key}`, "Content-Type": "application/json"},
      body: JSON.stringify({model: GROQ_MODEL, reasoning_effort: "low", temperature: 0.2,
        max_completion_tokens: options.maxCompletionTokens, messages: options.messages,
        response_format: {type: "json_schema", json_schema: {name: "cv_review", strict: true, schema: options.schema}}}),
      signal: AbortSignal.timeout(options.timeoutMs ?? 45000),
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) throw providerError(response.status, body, response.headers.get("retry-after"));
    const choice = (body as {choices?: {finish_reason?: string; message?: {content?: unknown; refusal?: unknown}}[]} | null)?.choices?.[0];
    if (choice?.finish_reason === "length") throw new GroqError("The AI review reached its output limit. Try a shorter review.", "GROQ_OUTPUT_TRUNCATED");
    if (choice?.message?.refusal || choice?.finish_reason === "content_filter") throw new GroqError("Groq declined this review. Check the source text before trying again.", "GROQ_REFUSAL");
    const content = choice?.message?.content;
    if (typeof content !== "string" || !content.trim()) throw new GroqError("Groq returned no review text. Try again.", "GROQ_EMPTY_RESPONSE");
    try { return JSON.parse(content); }
    catch { throw new GroqError("Groq returned an unreadable review. Try again.", "GROQ_INVALID_JSON"); }
  } catch (error) {
    if (error instanceof GroqError) throw error;
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) throw new GroqError("Groq took too long to respond. Try again.", "GROQ_TIMEOUT", 504);
    throw new GroqError("The server could not reach Groq. Try again later.", "GROQ_NETWORK", 503);
  }
}
