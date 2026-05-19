/**
 * Otto — simple readline chat TUI
 *
 * Sends messages to the gateway /chat endpoint and displays responses.
 * Zero extra dependencies: uses only built-in Node.js modules.
 *
 * Usage:
 *   cd gateway && npm run tui
 *   GATEWAY_URL=http://localhost:3000 npm run tui
 */

import "./env"; // must be first — loads .env before anything else
import { createInterface } from "node:readline/promises";
import { randomUUID } from "node:crypto";
import { stdin, stdout } from "node:process";

// ─── Config ───────────────────────────────────────────────────────────────────

const GATEWAY_URL = (process.env.GATEWAY_URL ?? "http://localhost:3000").replace(/\/$/, "");
const SESSION_ID = randomUUID();

// ─── ANSI helpers ─────────────────────────────────────────────────────────────

const R      = "\x1b[0m";
const BOLD   = "\x1b[1m";
const DIM    = "\x1b[2m";
const GREEN  = "\x1b[32m";
const CYAN   = "\x1b[36m";
const RED    = "\x1b[31m";
const YELLOW = "\x1b[33m";

// Erase the current terminal line (used to wipe the "thinking…" indicator).
const CLEAR_LINE = "\r\x1b[K";

// ─── Gateway client ───────────────────────────────────────────────────────────

interface ChatResponse {
  reply: string;
  tool_calls: string[];
}

async function chat(message: string): Promise<ChatResponse> {
  const url = `${GATEWAY_URL}/chat`;
  const body = JSON.stringify({ message, session_id: SESSION_ID });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  const json: any = await res.json().catch(() => null);

  if (!res.ok) {
    const reason = json?.error ?? `HTTP ${res.status}`;
    throw new Error(reason);
  }

  return {
    reply: String(json?.reply ?? ""),
    tool_calls: Array.isArray(json?.tool_calls) ? json.tool_calls : [],
  };
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout, terminal: true });

  // Banner
  console.log();
  console.log(`  ${BOLD}${GREEN}otto${R}${BOLD} workforce assistant${R}`);
  console.log(`  ${DIM}session  ${SESSION_ID}${R}`);
  console.log(`  ${DIM}gateway  ${GATEWAY_URL}${R}`);
  console.log(`  ${DIM}type a message, or ${YELLOW}exit${R}${DIM} to quit${R}`);
  console.log();

  while (true) {
    let input: string;

    try {
      input = (await rl.question(`${BOLD}You › ${R}`)).trim();
    } catch {
      // Ctrl+D / EOF
      break;
    }

    if (!input) continue;
    if (input === "exit" || input === "quit") break;

    // Show a "thinking" indicator on the same line while awaiting the response.
    stdout.write(`${DIM}thinking…${R}`);

    let response: ChatResponse;
    try {
      response = await chat(input);
    } catch (err) {
      stdout.write(CLEAR_LINE);
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`\n${RED}${BOLD}Error:${R} ${msg}\n`);
      continue;
    }

    stdout.write(CLEAR_LINE);

    if (response.tool_calls.length > 0) {
      console.log(`${DIM}[tools: ${response.tool_calls.join(", ")}]${R}`);
    }

    console.log(`\n${CYAN}${BOLD}Otto › ${R}${response.reply}\n`);
  }

  console.log(`\n${DIM}goodbye!${R}\n`);
  rl.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
