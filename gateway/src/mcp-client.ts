/**
 * Minimal MCP streamable-HTTP client.
 *
 * Connects to the generated Go MCP server (protoc-gen-mcp) and exposes
 * listTools / callTool so the agent loop can use them without any manually
 * maintained tool definitions.
 *
 * MCP_URL defaults to http://localhost:8080 — the port the Go server binds
 * when MCP_ADDR is unset.
 */

const MCP_URL = (process.env.MCP_URL ?? "http://localhost:8080").replace(/\/$/, "");
const MCP_TIMEOUT_MS = Number(process.env.MCP_TIMEOUT_MS ?? 30_000);

// ── Types ──────────────────────────────────────────────────────────────────────

interface McpTool {
  name: string;
  description?: string;
  inputSchema: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
    [key: string]: unknown;
  };
}

/** Anthropic SDK tool shape — input_schema instead of inputSchema. */
export interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: {
    type: string;
    properties?: Record<string, unknown>;
    [key: string]: unknown;
  };
}

// ── Module state ───────────────────────────────────────────────────────────────

let _sessionId: string | undefined;
let _initPromise: Promise<void> | undefined;
let _cachedTools: AnthropicTool[] | undefined;
let _reqId = 10;

function nextId(): number {
  return _reqId++;
}

// ── HTTP helper ────────────────────────────────────────────────────────────────

class StaleSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaleSessionError";
  }
}

async function rawPost(method: string, params: unknown, id?: number): Promise<unknown> {
  const body: Record<string, unknown> = { jsonrpc: "2.0", method, params };
  if (id !== undefined) body.id = id;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (_sessionId) headers["Mcp-Session-Id"] = _sessionId;

  let res: Response;
  try {
    res = await fetch(MCP_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(MCP_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new Error(`MCP request timed out after ${MCP_TIMEOUT_MS}ms (method=${method})`);
    }
    throw err;
  }

  // Capture session ID if the server provides one.
  const sid = res.headers.get("Mcp-Session-Id");
  if (sid && !_sessionId) _sessionId = sid;

  // Server rejected our cached session (typical after a restart). Surface a
  // distinct error so the caller can re-initialise and retry once.
  if (res.status === 404 && _sessionId) {
    throw new StaleSessionError(`MCP session ${_sessionId} no longer recognised`);
  }

  // Notifications return 202 Accepted with no body.
  if (res.status === 202) return null;

  const contentType = res.headers.get("Content-Type") ?? "";
  let text: string;

  if (contentType.includes("text/event-stream")) {
    // For SSE, take the first data: event which carries the JSON-RPC response.
    const raw = await res.text();
    const dataLine = raw.split("\n").find((l) => l.startsWith("data:"));
    text = dataLine ? dataLine.slice(5).trim() : "{}";
  } else {
    text = await res.text();
  }

  if (!text.trim()) return null;

  const json = JSON.parse(text);
  if ("error" in json) {
    // Some servers return JSON-RPC errors for stale sessions rather than 404.
    const msg = JSON.stringify(json.error);
    if (_sessionId && /session/i.test(msg)) {
      throw new StaleSessionError(`MCP session ${_sessionId} rejected: ${msg}`);
    }
    throw new Error(`MCP error: ${msg}`);
  }
  return json.result;
}

// post wraps rawPost with one-shot session recovery: if the cached session is
// stale (server restarted), drop it and re-initialise once before retrying.
async function post(method: string, params: unknown, id?: number): Promise<unknown> {
  try {
    return await rawPost(method, params, id);
  } catch (err) {
    if (!(err instanceof StaleSessionError)) throw err;
    _sessionId = undefined;
    _initPromise = undefined;
    await ensureSession();
    return rawPost(method, params, id);
  }
}

// ── Session init ───────────────────────────────────────────────────────────────

async function _initialize(): Promise<void> {
  await post(
    "initialize",
    {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "otto-gateway", version: "1.0.0" },
    },
    nextId(),
  );
  // Notification — no response expected.
  await post("notifications/initialized", {});
}

async function ensureSession(): Promise<void> {
  if (_sessionId) return;
  // Serialise concurrent callers so we only initialise once. If the in-flight
  // attempt fails, clear the cached promise so the next caller gets a fresh
  // initialize rather than awaiting the same rejection forever.
  if (!_initPromise) {
    _initPromise = _initialize().catch((err) => {
      _initPromise = undefined;
      throw err;
    });
  }
  await _initPromise;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Fetch the tool list from the MCP server, converted to Anthropic SDK format.
 * Cached after the first successful call.
 */
export async function listTools(): Promise<AnthropicTool[]> {
  if (_cachedTools) return _cachedTools;
  await ensureSession();
  const result = (await post("tools/list", {}, nextId())) as { tools: McpTool[] };
  _cachedTools = (result.tools ?? []).map(({ name, description, inputSchema }) => ({
    name,
    description,
    input_schema: inputSchema,
  }));
  return _cachedTools;
}

/**
 * Call a named MCP tool with the given arguments.
 * Returns the concatenated text content of the tool result.
 */
export async function callTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  await ensureSession();
  const result = (await post("tools/call", { name, arguments: args }, nextId())) as {
    content: Array<{ type: string; text?: string }>;
  };
  return (result?.content ?? []).map((c) => c.text ?? "").join("\n");
}
