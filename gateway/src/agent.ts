/**
 * Chat agent loop — sends user messages to Claude with MCP tools wired in,
 * resolves tool_use blocks against the MCP server, and loops until end_turn.
 */

import Anthropic from "@anthropic-ai/sdk";
import { callTool, type AnthropicTool } from "./mcp-client";

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5";
const MAX_ITERATIONS = 10;
const MAX_TOKENS = 8192;

function systemPrompt(): string {
  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  return `You are otto, an assistant for a workforce management backend (employees, jobs, schedules, payroll).
Today's date is ${today}.

Use the available MCP tools to fulfill the user's request. Guidelines:
- When the user refers to an employee by name, look them up before calling tools that need an employee_id.
- If a lookup is ambiguous, ask the user to clarify before proceeding.
- Never invent data. If a tool returns nothing, say so clearly.
- Format money readably (e.g. "USD 1,500.00", not raw cents) and dates in human-readable form unless asked for ISO.
- Keep responses concise — summarise rather than dumping raw JSON.
- Confirm before any create/update/assign action; read-only calls don't need confirmation.`;
}

export type Message = Anthropic.Messages.MessageParam;

export function newHistory(): Message[] {
  return [];
}

export interface ChatResult {
  reply: string;
  toolCalls: string[];
}

export async function chat(
  client: Anthropic,
  tools: AnthropicTool[],
  history: Message[],
  userMessage: string,
  onToolCall?: (name: string) => void,
): Promise<ChatResult> {
  // Snapshot history length so any failure (API error, tool exception, or
  // hitting MAX_ITERATIONS mid-tool-loop) can roll the turn back. Without
  // this, history can be left ending in an unanswered user/tool_result turn,
  // which causes the next chat call to fail Anthropic's role-alternation
  // requirement.
  const snapshot = history.length;
  const toolCalls: string[] = [];

  try {
    history.push({ role: "user", content: userMessage });

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: [
          {
            type: "text",
            text: systemPrompt(),
            cache_control: { type: "ephemeral" },
          },
        ],
        tools: tools as Anthropic.Messages.Tool[],
        messages: history,
      });

      history.push({ role: "assistant", content: response.content });

      if (response.stop_reason === "tool_use") {
        const toolUseBlocks = response.content.filter(
          (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
        );

        const results = await Promise.all(
          toolUseBlocks.map(async (block) => {
            toolCalls.push(block.name);
            onToolCall?.(block.name);
            try {
              const output = await callTool(
                block.name,
                block.input as Record<string, unknown>,
              );
              return {
                type: "tool_result" as const,
                tool_use_id: block.id,
                content: output || "(empty result)",
              };
            } catch (err) {
              return {
                type: "tool_result" as const,
                tool_use_id: block.id,
                content: `Error: ${err instanceof Error ? err.message : String(err)}`,
                is_error: true,
              };
            }
          }),
        );

        history.push({ role: "user", content: results });
        continue;
      }

      const text = response.content
        .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");

      return { reply: text, toolCalls };
    }

    // Ran out of iterations while the model was still calling tools.
    // Drop the partial turn so the next user message starts cleanly.
    history.length = snapshot;
    return {
      reply: "I was unable to complete that request within the allowed number of steps.",
      toolCalls,
    };
  } catch (err) {
    history.length = snapshot;
    throw err;
  }
}
