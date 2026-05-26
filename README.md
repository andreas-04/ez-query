# ez-query

## What?

This is a proof of concept demonstrating [protoc-gen-mcp](https://github.com/andreas-04/protoc-gen-mcp), a tool for generating MCP servers that registers your gRPC services as tools for agents. 

This repo contains implementation of a `.proto` derived gRPC API and MCP server for workforce management (employee scheduling, job scheduling, and payroll management.) With a thin wrapper for an agentic dispatching loop which is driven by natural language over a TUI interface. 

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
