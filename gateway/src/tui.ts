/**
 * Otto — chat TUI
 *
 * Talk to Claude with the Go MCP server's tools wired in.  Claude decides
 * which tools to call; the TUI shows tool activity and prints the reply.
 *
 * Commands:
 *   <anything>            Chat with the agent
 *   /tool <name> [json]   Call a tool directly (debug)
 *   help                  List available tools
 *   reset                 Clear conversation history
 *   exit / quit           Quit
 */

import "./env"; // must be first — loads .env before anything else
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import Anthropic from "@anthropic-ai/sdk";
import { listTools, callTool, type AnthropicTool } from "./mcp-client";
import { chat, newHistory } from "./agent";

// ─── ANSI helpers ─────────────────────────────────────────────────────────────

const R      = "\x1b[0m";
const BOLD   = "\x1b[1m";
const DIM    = "\x1b[2m";
const GREEN  = "\x1b[32m";
const CYAN   = "\x1b[36m";
const RED    = "\x1b[31m";
const YELLOW = "\x1b[33m";

const CLEAR_LINE = "\r\x1b[K";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function printTools(tools: AnthropicTool[]): void {
  console.log(`\n  ${BOLD}Available tools${R} (${tools.length})\n`);
  for (const t of tools) {
    const desc = t.description?.split("\n")[0] ?? "";
    console.log(`  ${CYAN}${t.name}${R}`);
    if (desc) console.log(`    ${DIM}${desc}${R}`);
  }
  console.log();
}

function parseToolCommand(raw: string): { toolName: string; args: Record<string, unknown> } {
  // raw is "/tool <name> [json]" — strip the prefix first.
  const body = raw.slice("/tool".length).trim();
  const space = body.indexOf(" ");
  const toolName = space === -1 ? body : body.slice(0, space).trim();
  const rest     = space === -1 ? "" : body.slice(space + 1).trim();

  if (!toolName) throw new Error("usage: /tool <name> [json-args]");

  let args: Record<string, unknown> = {};
  if (rest) {
    const parsed = JSON.parse(rest);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("args must be a JSON object");
    }
    args = parsed;
  }
  return { toolName, args };
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const MCP_URL = (process.env.MCP_URL ?? "http://localhost:8080");
  const MODEL   = process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5";

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(`${RED}${BOLD}ANTHROPIC_API_KEY is not set.${R} Add it to .env and try again.\n`);
    process.exit(1);
  }

  // Banner
  console.log();
  console.log(`  ${BOLD}${GREEN}otto${R}${BOLD} chat${R}`);
  console.log(`  ${DIM}server  ${MCP_URL}${R}`);
  console.log(`  ${DIM}model   ${MODEL}${R}`);
  console.log(`  ${DIM}type ${YELLOW}help${R}${DIM} for tools, ${YELLOW}reset${R}${DIM} to clear history, ${YELLOW}exit${R}${DIM} to quit${R}`);
  console.log();

  // Eagerly load tools so the first call is fast.
  stdout.write(`${DIM}connecting…${R}`);
  let tools: AnthropicTool[];
  try {
    tools = await listTools();
    stdout.write(CLEAR_LINE);
  } catch (err) {
    stdout.write(CLEAR_LINE);
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${RED}${BOLD}Failed to connect to MCP server:${R} ${msg}`);
    console.error(`${DIM}Is the server running at ${MCP_URL}?${R}\n`);
    process.exit(1);
  }

  console.log(`${DIM}Connected — ${tools.length} tools available.${R}\n`);

  const toolNames = new Set(tools.map((t) => t.name));
  const anthropic = new Anthropic();
  let history = newHistory();

  // Mirror stdin's TTY-ness so piped/heredoc input behaves like script input
  // (one line per prompt) instead of being bundled by readline's terminal mode.
  const rl = createInterface({ input: stdin, output: stdout, terminal: stdin.isTTY });

  while (true) {
    let raw: string;
    try {
      raw = (await rl.question(`${BOLD}› ${R}`)).trim();
    } catch {
      break; // Ctrl+D / EOF
    }

    if (!raw) continue;
    if (raw === "exit" || raw === "quit") break;

    if (raw === "help") {
      printTools(tools);
      continue;
    }

    if (raw === "reset") {
      history = newHistory();
      console.log(`${DIM}conversation cleared${R}\n`);
      continue;
    }

    if (raw === "/tool" || raw.startsWith("/tool ")) {
      let parsed: { toolName: string; args: Record<string, unknown> };
      try {
        parsed = parseToolCommand(raw);
      } catch (err) {
        console.log(`\n${RED}${err instanceof Error ? err.message : err}${R}\n`);
        continue;
      }
      if (!toolNames.has(parsed.toolName)) {
        console.log(`\n${RED}Unknown tool:${R} ${parsed.toolName}\n`);
        continue;
      }
      stdout.write(`${DIM}calling ${parsed.toolName}…${R}`);
      try {
        const result = await callTool(parsed.toolName, parsed.args);
        stdout.write(CLEAR_LINE);
        try {
          console.log(`\n${JSON.stringify(JSON.parse(result), null, 2)}\n`);
        } catch {
          console.log(`\n${result}\n`);
        }
      } catch (err) {
        stdout.write(CLEAR_LINE);
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`\n${RED}${BOLD}Error:${R} ${msg}\n`);
      }
      continue;
    }

    // Chat path.
    stdout.write(`${DIM}thinking…${R}`);
    try {
      const { reply } = await chat(anthropic, tools, history, raw, (name) => {
        stdout.write(`${CLEAR_LINE}${DIM}→ ${name}${R}\n${DIM}thinking…${R}`);
      });
      stdout.write(CLEAR_LINE);
      console.log(`\n${reply}\n`);
    } catch (err) {
      stdout.write(CLEAR_LINE);
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`\n${RED}${BOLD}Error:${R} ${msg}\n`);
    }
  }

  console.log(`\n${DIM}goodbye!${R}\n`);
  rl.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
