# 🩺 Playwright Trace Doctor

> **One-Shot Diagnostic & Self-Healing Intelligence Engine for Playwright Traces**  
> *Seamlessly bridges Playwright's opaque `trace.zip` failure archives with AI Coding Assistants (MCP) & Developer Terminals (CLI).*

---

## ⚡ The Problem

When Playwright E2E tests fail in CI or locally:
1. **Binary Blindspot for AI Agents:** AI coding agents (Antigravity, Cursor, Claude Code) only see truncated terminal logs. They cannot read Playwright’s binary `trace.zip` archives, leaving them guessing blindly when trying to self-heal broken tests.
2. **Tool-Sprawl in Existing Decoders:** Existing trace MCP servers force AI agents to make 6–10 consecutive tool roundtrips (`open_trace` → `list_actions` → `get_action` → `get_network` → `get_console` → `get_dom`), blowing token limits and stalling agent execution.
3. **No Root-Cause Correlation:** Raw trace viewers dump events, but fail to correlate downstream UI locator timeouts with upstream backend API failures (e.g., an HTTP 500 error on an API route).

---

## 🚀 The Solution: Playwright Trace Doctor

`playwright-trace-doctor` provides **one-shot, token-budgeted triage and self-healing recommendations** in a single call.

```
┌────────────────────────────────┐
│   Playwright trace.zip         │
│   (Actions, DOM, Network, Log) │
└───────────────┬────────────────┘
                │
                ▼
┌────────────────────────────────┐
│  🩺 Playwright Trace Doctor    │
│  - Modern & Legacy JSONL Parser│
│  - Heuristic Root Cause Engine │
│  - Upstream 5xx/4xx Correlator │
│  - Self-Healing Fix Generator  │
└───────────────┬────────────────┘
                │
        ┌───────┴───────┐
        ▼               ▼
┌──────────────┐ ┌──────────────┐
│ Terminal CLI │ │  MCP Server  │
│  (Human PRs) │ │ (AI Agents)  │
└──────────────┘ └──────────────┘
```

### Key Differentiators vs Existing Tools

| Capability | Existing MCP Decoders | Playwright Trace Doctor |
| :--- | :--- | :--- |
| **Agent Roundtrips** | 6–10 fragmented tool calls | **1-Shot Holistic Triage** (`triage_failure`) |
| **Upstream Correlation** | Disconnected logs | **Correlates 4xx/5xx network failures to UI timeouts** |
| **Self-Healing Code** | None (only raw JSON) | **Generates resilient Playwright locator replacements** |
| **Trace Auto-Discovery** | Requires exact file path | **Auto-detects latest trace in `test-results/`** |
| **CLI Mode** | MCP-only | **Dual-mode: Rich CLI + Stdio MCP Server** |
| **Token Budgeting** | Risk of 50k+ token dumps | **Strictly pruned DOM snippets (< 1.5k tokens)** |

---

## 📦 Installation & Quick Start

### 1. Terminal CLI (Human & CI Usage)

Run directly against any Playwright trace archive:

```bash
# Direct run via npm/node
npx playwright-trace-doctor path/to/trace.zip

# Auto-discover and triage the latest failed trace in the project
npx playwright-trace-doctor --latest

# Output clean Markdown (ideal for GitHub Actions / PR comments)
npx playwright-trace-doctor --latest --markdown

# Output structured JSON
npx playwright-trace-doctor --latest --json
```

### 2. MCP Server (AI Coding Assistants)

Add to your MCP client configuration (`antigravity.json`, `.cursor/mcp.json`, or `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "trace-doctor": {
      "command": "node",
      "args": ["C:/Users/harih/Documents/Personal/Projects/Antigravity CLI/playwright-trace-doctor/dist/mcp.js"]
    }
  }
}
```

---

## 🛠️ MCP Tools Reference

### 1. `triage_failure` (Primary Tool)
Performs a one-shot root cause diagnosis on a `trace.zip` archive.
- **Inputs:** `tracePath` (optional, auto-discovers latest if omitted)
- **Outputs:**
  - Classified Failure Pattern (`BACKEND_API_FAILURE`, `TIMEOUT_LOCATOR_NOT_FOUND`, `STRICT_MODE_VIOLATION`, `POINTER_INTERCEPTED`, etc.)
  - Failed action & locator details
  - Correlated 4xx/5xx network requests and response bodies
  - Correlated console error logs
  - Ready-to-copy self-healing code snippets

### 2. `find_latest_trace`
Scans project subdirectories (`test-results/`, `playwright-report/`, `.playwright-artifacts/`) and returns the newest trace file with file metadata.

### 3. `get_failed_network_calls`
Extracts only aborted, 4xx, and 5xx HTTP requests captured during the test run.

### 4. `suggest_locator_fixes`
Analyzes a fragile CSS or XPath selector and suggests resilient Playwright locators (`getByRole`, `getByTestId`, web-first auto-await assertions).

---

## 🧪 Testing & Verification

Generate a real-world failing Playwright trace fixture (simulating an upstream 500 error and a timed-out selector) and verify end-to-end:

```bash
# 1. Generate real fixture
npm run test:fixture

# 2. Run diagnostic test
npm run test

# 3. Test CLI
npm run dev:cli -- --latest
```

---

## 📄 License
MIT © Pranav H
