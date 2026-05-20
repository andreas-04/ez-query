import "../env"; // must be first — loads .env before any other module initialises
import express, { Request, Response } from "express";
import cors from "cors";
import { runAgentLoop } from "./loop";
import type { TenantConfig } from "./prompt";
import type Anthropic from "@anthropic-ai/sdk";
import { authMiddleware } from "../middleware/auth";

const app = express();

const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "http://localhost:3001")
  .split(",")
  .map((o) => o.trim());

app.use(
  cors({
    origin: (origin, cb) => {
      // Allow requests with no origin (e.g. server-to-server, curl)
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error(`CORS: origin ${origin} not allowed`));
    },
    allowedHeaders: ["Content-Type", "Authorization"],
    methods: ["POST"],
  }),
);

app.use(express.json());

// In-memory session store: session_id → conversation history.
// History is intentionally not persisted — the gateway is stateless across restarts.
const sessions = new Map<string, Anthropic.Messages.MessageParam[]>();

app.post("/chat", authMiddleware, async (req: Request, res: Response) => {
  const tenantId = res.locals.tenantId as string;
  const { message, session_id, tenant } = req.body as {
    message: unknown;
    session_id: unknown;
    tenant?: TenantConfig;
  };

  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "message must be a non-empty string" });
  }
  if (!session_id || typeof session_id !== "string") {
    return res.status(400).json({ error: "session_id must be a non-empty string" });
  }

  if (!sessions.has(session_id)) {
    sessions.set(session_id, []);
  }
  const history = sessions.get(session_id)!;

  try {
    const { reply, toolCallNames } = await runAgentLoop(message, history, tenantId, tenant);
    return res.json({ reply, tool_calls: toolCallNames });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    return res.status(500).json({ error: msg });
  }
});

const PORT = parseInt(process.env.PORT ?? "3000", 10);
app.listen(PORT, () => {
  console.log(`otto gateway listening on http://localhost:${PORT}`);
  console.log(`  GRPC_BASE_URL: ${process.env.GRPC_BASE_URL ?? "http://localhost:50051"}`);
  console.log(`  model: ${process.env.ANTHROPIC_MODEL ?? "claude-opus-4-5"}`);
});

export default app;
