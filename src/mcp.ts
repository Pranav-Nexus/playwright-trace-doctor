import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as path from 'path';
import * as fs from 'fs';
import { parseTraceArchive } from './trace/archive.js';
import { analyzeTrace } from './trace/analyzer.js';
import { findLatestTrace } from './trace/finder.js';

// Create Model Context Protocol Server
const server = new McpServer(
  {
    name: 'playwright-trace-doctor',
    version: '1.0.0',
  },
  {
    instructions:
      'Diagnose failed Playwright tests from trace.zip archives. Start with `triage_failure` for a full root-cause summary, failing locator, correlated 4xx/5xx network errors, console errors, and self-healing locator fixes. Use `find_latest_trace` first only if you want to locate or verify the newest trace.zip path without parsing it yet. Use `get_failed_network_calls` when you only need HTTP 4xx/5xx or aborted requests, and `suggest_locator_fixes` when you only need resilient locator alternatives for a failing or custom selector. All tools are read-only and never modify test files or traces.',
  }
);

const READ_ONLY_LOCAL_TOOL = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

function resolveOrFindTrace(tracePath?: string): string {
  if (tracePath && fs.existsSync(path.resolve(tracePath))) {
    return path.resolve(tracePath);
  }
  const found = findLatestTrace(process.cwd());
  if (!found) {
    throw new Error(
      `No Playwright trace.zip found. Please specify tracePath or run Playwright with tracing enabled.`
    );
  }
  return found;
}

// 1. One-Shot Failure Triage
server.registerTool(
  'triage_failure',
  {
    title: 'Triage Playwright Failure Trace',
    description:
      'Diagnose a Playwright failure trace.zip and return advisory fix recommendations as Markdown + JSON (classification, failedAction, networkErrors, consoleErrors, recommendations, tracePath) without modifying any files. If tracePath (local path to a .zip trace archive) is omitted, auto-discovers the newest trace under cwd; returns an error if no trace exists or the archive is unreadable. Use as the default entry point for full failure triage; prefer get_failed_network_calls or suggest_locator_fixes when you only need that single slice, or find_latest_trace to check trace existence first.',
    inputSchema: {
      tracePath: z
        .string()
        .optional()
        .describe('Absolute or relative path to a Playwright trace.zip archive (e.g. test-results/checkout/trace.zip). If omitted, automatically discovers the latest trace in the workspace.'),
    },
    annotations: READ_ONLY_LOCAL_TOOL,
  },
  async ({ tracePath }) => {
    try {
      const targetPath = resolveOrFindTrace(tracePath);
      const archive = parseTraceArchive(targetPath);
      const diagnostic = analyzeTrace(archive);

      return {
        content: [
          {
            type: 'text',
            text: diagnostic.markdownSummary,
          },
          {
            type: 'text',
            text: JSON.stringify(
              {
                classification: diagnostic.classification,
                failedAction: diagnostic.failedAction,
                networkErrors: diagnostic.networkErrors,
                consoleErrors: diagnostic.consoleErrors,
                recommendations: diagnostic.recommendations,
                tracePath: diagnostic.tracePath,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Failed to triage trace: ${err.message}`,
          },
        ],
      };
    }
  }
);

// 2. Discover Latest Failing Trace
server.registerTool(
  'find_latest_trace',
  {
    title: 'Find Latest Playwright Trace',
    description:
      'Recursively searches test-results/, playwright-report/, and project subdirectories under baseDir (defaults to cwd) for the newest Playwright trace.zip file. Returns JSON with { found, tracePath, sizeBytes, lastModified }, or { found: false, message } when no trace exists (does not throw on empty results). Use before other tools to verify a trace exists or inspect its timestamp; do not use when you already have a tracePath and want immediate triage (use triage_failure directly).',
    inputSchema: {
      baseDir: z
        .string()
        .optional()
        .describe('Absolute or relative base directory to search from (e.g. ./e2e). Defaults to the current working directory.'),
    },
    annotations: READ_ONLY_LOCAL_TOOL,
  },
  async ({ baseDir }) => {
    try {
      const found = findLatestTrace(baseDir || process.cwd());
      if (!found) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ found: false, message: 'No trace archives located.' }),
            },
          ],
        };
      }

      const stat = fs.statSync(found);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                found: true,
                tracePath: found,
                sizeBytes: stat.size,
                lastModified: stat.mtime.toISOString(),
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Error locating traces: ${err.message}` }],
      };
    }
  }
);

// 3. Surgical Correlated Network Errors
server.registerTool(
  'get_failed_network_calls',
  {
    title: 'Get Failed Network Calls',
    description:
      'Extracts all HTTP 4xx/5xx responses and aborted/failed requests across a Playwright trace.zip and returns JSON { tracePath, totalRequests, failedRequestsCount, failedRequests }. If tracePath (local .zip path) is omitted, auto-discovers the latest trace under cwd; returns an error if no trace exists. Use when debugging API/backend failures in isolation; prefer triage_failure for full root-cause, console, and locator analysis.',
    inputSchema: {
      tracePath: z
        .string()
        .optional()
        .describe('Absolute or relative path to trace.zip (e.g. test-results/checkout/trace.zip). If omitted, uses the latest trace in the workspace.'),
    },
    annotations: READ_ONLY_LOCAL_TOOL,
  },
  async ({ tracePath }) => {
    try {
      const targetPath = resolveOrFindTrace(tracePath);
      const archive = parseTraceArchive(targetPath);
      const failed = archive.networkRequests.filter((r) => r.failed || r.status >= 400);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                tracePath: targetPath,
                totalRequests: archive.networkRequests.length,
                failedRequestsCount: failed.length,
                failedRequests: failed,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to extract network calls: ${err.message}` }],
      };
    }
  }
);

// 4. Self-Healing Locator Recommendations
server.registerTool(
  'suggest_locator_fixes',
  {
    title: 'Suggest Resilient Locator Fixes',
    description:
      'Analyzes a failing Playwright selector from a trace.zip (or customSelector, e.g. "button#pay") against recorded DOM state and returns advisory JSON { failingSelector, failureClassification, recommendations } (getByRole, getByTestId, auto-await) without editing test files. Defaults to the latest trace under cwd if tracePath is omitted; returns an error if no trace exists, or undefined failingSelector with general recommendations if no action failed. Use when you only need selector replacements; prefer triage_failure for full failure diagnosis or non-selector failures.',
    inputSchema: {
      tracePath: z
        .string()
        .optional()
        .describe('Absolute or relative path to trace.zip (e.g. test-results/checkout/trace.zip). If omitted, uses the latest trace in the workspace.'),
      customSelector: z
        .string()
        .optional()
        .describe('Optional Playwright selector string (e.g. "button#submit" or "text=Pay") to report as failingSelector instead of the trace action selector.'),
    },
    annotations: READ_ONLY_LOCAL_TOOL,
  },
  async ({ tracePath, customSelector }) => {
    try {
      const targetPath = resolveOrFindTrace(tracePath);
      const archive = parseTraceArchive(targetPath);
      const diagnostic = analyzeTrace(archive);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                failingSelector: customSelector || diagnostic.failedAction?.selector,
                failureClassification: diagnostic.classification,
                recommendations: diagnostic.recommendations,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to suggest locator fixes: ${err.message}` }],
      };
    }
  }
);

// Connect via stdio transport
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('Fatal MCP Server Error:', err);
  process.exit(1);
});
