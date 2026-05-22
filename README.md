# ez-query

## What?

Proof of concept demonstrating [protoc-gen-mcp](https://github.com/andreas-04/protoc-gen-mcp): NL interface to a postgres DB driven by an MCP server generated from `.proto` definitions.

## How?

A gRPC service exposes DB operations; `protoc-gen-mcp` turns its proto definitions into an MCP server that Claude calls through a simple TUI.

## Try it out

**1. Create a `.env` file in the project root:**

```sh
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-haiku-4-5   # optional, this is the default
```

**2. Start the stack and launch the TUI:**

```sh
docker compose run --rm --build tui
```

This builds all images, starts postgres + the gRPC server + the gateway, then drops you into the interactive TUI.
