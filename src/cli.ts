#!/usr/bin/env node
import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs';
import pc from 'picocolors';
import { parseTraceArchive } from './trace/archive.js';
import { analyzeTrace } from './trace/analyzer.js';
import { findLatestTrace } from './trace/finder.js';
import { formatTerminalReport } from './formatters/terminal.js';
import { runInit } from './init/setup.js';

const program = new Command();

program
  .name('playwright-trace-doctor')
  .description('One-shot diagnostic & self-healing intelligence engine for Playwright traces')
  .version('1.0.0');

// 1. One-Command Setup Subcommand
program
  .command('init')
  .description('One-command setup utility for Playwright projects (config audit, GitHub Actions CI & MCP)')
  .option('-d, --dir <directory>', 'Project directory to inspect and configure', process.cwd())
  .option('--ci-only', 'Configure only GitHub Actions CI workflow')
  .option('--mcp-only', 'Configure only local AI Agent MCP server')
  .option('--dry-run', 'Preview changes without modifying files on disk')
  .option('-f, --force', 'Overwrite existing workflow configurations')
  .action(async (options) => {
    try {
      await runInit(options);
    } catch (err: any) {
      console.error(pc.red(`❌ Setup failed: ${err.message}`));
      process.exit(1);
    }
  });

// 2. MCP Server Subcommand
program
  .command('mcp')
  .description('Start Model Context Protocol (MCP) server over stdio for AI coding agents')
  .action(async () => {
    try {
      await import('./mcp.js');
    } catch (err: any) {
      console.error(pc.red(`Fatal MCP Server Error: ${err.message}`));
      process.exit(1);
    }
  });

// 3. Default Trace Triage Command
program
  .argument('[tracePath]', 'Path to Playwright trace.zip archive')
  .option('-l, --latest', 'Automatically discover and inspect the latest trace.zip')
  .option('-d, --dir <directory>', 'Base directory to search for traces', process.cwd())
  .option('-m, --markdown', 'Output diagnostic as clean GitHub Flavored Markdown')
  .option('-j, --json', 'Output raw JSON diagnostic object')
  .action((tracePathArg, options) => {
    if (tracePathArg === 'init' || tracePathArg === 'mcp') {
      return;
    }

    try {
      let targetTrace = tracePathArg;

      if (!targetTrace || options.latest) {
        const found = findLatestTrace(options.dir);
        if (!found) {
          console.error(pc.red('❌ No trace.zip file found.'));
          console.error(pc.gray(`Searched in: ${options.dir} (test-results/, playwright-report/, etc.)`));
          console.error(pc.yellow('Usage: trace-doctor <path-to-trace.zip> or run Playwright with --trace on'));
          process.exit(1);
        }
        targetTrace = found;
      }

      const resolved = path.resolve(targetTrace);
      if (!fs.existsSync(resolved)) {
        console.error(pc.red(`❌ File does not exist: ${resolved}`));
        process.exit(1);
      }

      // Parse and analyze
      const archive = parseTraceArchive(resolved);
      const diagnostic = analyzeTrace(archive);

      if (options.json) {
        console.log(JSON.stringify(diagnostic, null, 2));
      } else if (options.markdown) {
        console.log(diagnostic.markdownSummary);
      } else {
        console.log(formatTerminalReport(diagnostic));
      }
    } catch (err: any) {
      console.error(pc.red(`💥 Diagnostic failed: ${err.message}`));
      process.exit(1);
    }
  });

program.parse(process.argv);
