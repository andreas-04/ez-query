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

async function post(method: string, params: unknown, id?: number): Promise<unknown> {
  const body: Record<string, unknown> = { jsonrpc: "2.0", method, params };
  if (id !== undefined) body.id = id;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (_sessionId) headers["Mcp-Session-Id"] = _sessionId;

  const res = await fetch(MCP_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  // Capture session ID if the server provides one.
  const sid = res.headers.get("Mcp-Session-Id");
  if (sid && !_sessionId) _sessionId = sid;

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
    throw new Error(`MCP error: ${JSON.stringify(json.error)}`);
  }
  return json.result;
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
