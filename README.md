# ez-query

## What?

Proof of concept for using NL to interface with a postgress DB using the Claude API

## How?

Defining custom claude tools for interfacing with a gRPC service and a simple TUI.

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
