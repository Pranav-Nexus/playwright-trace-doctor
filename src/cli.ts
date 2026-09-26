#!/usr/bin/env node
import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs';
import pc from 'picocolors';
import { parseTraceArchive } from './trace/archive.js';
import { analyzeTrace } from './trace/analyzer.js';
import { findLatestTrace } from './trace/finder.js';
import { formatTerminalReport } from './formatters/terminal.js';

const program = new Command();

program
  .name('trace-doctor')
  .description('One-shot diagnostic & self-healing intelligence engine for Playwright traces')
  .version('1.0.0')
  .argument('[tracePath]', 'Path to Playwright trace.zip archive')
  .option('-l, --latest', 'Automatically discover and inspect the latest trace.zip')
  .option('-d, --dir <directory>', 'Base directory to search for traces', process.cwd())
  .option('-m, --markdown', 'Output diagnostic as clean GitHub Flavored Markdown')
  .option('-j, --json', 'Output raw JSON diagnostic object')
  .action((tracePathArg, options) => {
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
