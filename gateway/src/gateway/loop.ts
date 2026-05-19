import Anthropic from "@anthropic-ai/sdk";
import { tools } from "../tools/index";
import { dispatchToolCall } from "../dispatcher/index";
import { buildSystemPrompt, TenantConfig } from "./prompt";

const anthropic = new Anthropic();

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-4-5";
const MAX_ITERATIONS = 10;

type Message = Anthropic.Messages.MessageParam;
type ToolUseBlock = Anthropic.Messages.ToolUseBlock;

export async function runAgentLoop(
  userMessage: string,
  history: Message[],
  tenant?: TenantConfig
): Promise<{ reply: string; toolCallNames: string[] }> {
  // Append the new user message to the shared history array so subsequent
  // calls to this function automatically see the full conversation context.
  history.push({ role: "user", content: userMessage });

  const allToolCallNames: string[] = [];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: buildSystemPrompt(tenant),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: tools as any,
      messages: history,
    });

    // Always push the assistant turn into history before branching.
    history.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "end_turn") {
      const text =
        response.content.find(
          (b): b is Anthropic.Messages.TextBlock => b.type === "text"
        )?.text ?? "";
      return { reply: text, toolCallNames: allToolCallNames };
    }

    if (response.stop_reason === "tool_use") {
      const toolUseBlocks = response.content.filter(
        (b): b is ToolUseBlock => b.type === "tool_use"
      );

      for (const block of toolUseBlocks) {
        allToolCallNames.push(block.name);
      }

      const toolResults = await Promise.all(
        toolUseBlocks.map(async (block) => ({
          type: "tool_result" as const,
          tool_use_id: block.id,
          content: JSON.stringify(
            await dispatchToolCall(
              block.name,
              block.input as Record<string, unknown>
            )
          ),
        }))
      );

      history.push({ role: "user", content: toolResults });
    }
  }

  return {
    reply: "I was unable to complete that request within the allowed number of steps.",
    toolCallNames: allToolCallNames,
  };
}
