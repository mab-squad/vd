# MCP Server Setup

This repository is configured to auto-connect the **GitHub MCP server** whenever
[Claude Code](https://code.claude.com/docs) runs in this project directory. The
configuration lives in [`.mcp.json`](./.mcp.json) (project scope), so every team
member gets the same server without any per-machine setup.

## What is configured

| Server   | Transport | Endpoint                              | Purpose                              |
| -------- | --------- | ------------------------------------- | ------------------------------------ |
| `github` | HTTP      | `https://api.githubcopilot.com/mcp/`  | Issues, pull requests, code search, releases, and other GitHub operations |

This uses GitHub's official **remote** MCP server, so there is nothing to install
locally — Claude Code connects over HTTP and authenticates with a token you
provide via an environment variable.

## Prerequisites

- Claude Code CLI (or another MCP-capable client).
- A **GitHub Personal Access Token (PAT)**. A fine-grained token scoped to the
  repositories you want to work with is recommended. Classic tokens work too
  (grant `repo`, and `read:org` if you need organization data).

## 1. Provide your token

The config reads the token from the `GITHUB_PERSONAL_ACCESS_TOKEN` environment
variable. **Never commit your token** — set it in your shell instead:

```bash
# Add to ~/.zshrc / ~/.bashrc, or export it in the current shell:
export GITHUB_PERSONAL_ACCESS_TOKEN="ghp_xxxxxxxxxxxxxxxxxxxx"
```

Claude Code expands `${GITHUB_PERSONAL_ACCESS_TOKEN}` in `.mcp.json` at launch,
so the secret is never written to the repository.

## 2. Approve the server

Project-scoped MCP servers require a one-time approval for security. Start Claude
Code in this directory and either accept the prompt or run:

```bash
claude
# then, inside the session:
/mcp
```

The `/mcp` command lists configured servers and their connection status, and lets
you (re)authenticate. Once approved, `github` should show as **connected**.

## Verifying the connection

Inside a Claude Code session run `/mcp` — the `github` server should be listed as
connected. You can then ask Claude to, for example, "list open PRs" or "search
issues mentioning X" and it will use the GitHub MCP tools.

## Alternative: run the GitHub MCP server locally (Docker)

If you prefer to run the server yourself instead of using the hosted endpoint,
replace the `github` block in `.mcp.json` with:

```json
{
  "mcpServers": {
    "github": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "GITHUB_PERSONAL_ACCESS_TOKEN",
        "ghcr.io/github/github-mcp-server"
      ],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_PERSONAL_ACCESS_TOKEN}"
      }
    }
  }
}
```

This requires Docker to be installed and running. The token is passed through
the same `GITHUB_PERSONAL_ACCESS_TOKEN` environment variable.

## Troubleshooting

- **Server shows "failed" / "disconnected":** confirm `GITHUB_PERSONAL_ACCESS_TOKEN`
  is exported in the shell that launched Claude Code (`echo $GITHUB_PERSONAL_ACCESS_TOKEN`).
- **401 / 403 responses:** the token is missing scopes or has expired — regenerate it.
- **Server not appearing at all:** make sure you launched Claude Code from this
  directory so it picks up `.mcp.json`, and that you approved the project server
  via `/mcp`.

## Adding more servers

Add entries under `mcpServers` in `.mcp.json`. See the
[Claude Code MCP documentation](https://code.claude.com/docs/en/mcp) for the full
configuration reference (stdio, HTTP, and SSE transports, env-var expansion, etc.).
