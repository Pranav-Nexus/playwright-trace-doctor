import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as path from 'path';
import * as fs from 'fs';
import { parseTraceArchive } from './trace/archive.js';
import { analyzeTrace } from './trace/analyzer.js';
import { findLatestTrace } from './trace/finder.js';

// Create Model Context Protocol Server
const server = new McpServer({
  name: 'playwright-trace-doctor',
  version: '1.0.0',
});

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
server.tool(
  'triage_failure',
  'One-shot diagnostic & self-healing triage of a Playwright failure trace. Extracts failing locator, stack trace, classified root cause, correlated network 4xx/5xx requests, console errors, and resilient self-healing fix code. Automatically finds latest trace if tracePath is omitted.',
  {
    tracePath: z
      .string()
      .optional()
      .describe('Absolute or relative path to Playwright trace.zip archive. If omitted, automatically discovers latest trace in workspace.'),
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
server.tool(
  'find_latest_trace',
  'Searches test-results/, playwright-report/, and project directories for the newest Playwright trace.zip file.',
  {
    baseDir: z
      .string()
      .optional()
      .describe('Base directory to search from. Defaults to current working directory.'),
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
server.tool(
  'get_failed_network_calls',
  'Inspects Playwright trace and extracts HTTP 4xx/5xx errors or aborted requests that occurred during the test.',
  {
    tracePath: z
      .string()
      .optional()
      .describe('Path to trace.zip. If omitted, uses latest trace.'),
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
server.tool(
  'suggest_locator_fixes',
  'Analyzes a failing Playwright selector and captures resilient locator alternatives (getByRole, getByTestId, auto-await) based on the DOM state.',
  {
    tracePath: z
      .string()
      .optional()
      .describe('Path to trace.zip. If omitted, uses latest trace.'),
    customSelector: z
      .string()
      .optional()
      .describe('Optional custom selector to evaluate if different from the failing trace action.'),
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
