import * as fs from 'fs';
import * as path from 'path';

/**
 * Searches directories for the newest trace.zip or .zip trace file.
 * Common search locations:
 * - test-results/
 * - playwright-report/
 * - .playwright-artifacts/
 * - Current directory
 */
export function findLatestTrace(baseDir: string = process.cwd()): string | undefined {
  const candidateDirs = [
    path.join(baseDir, 'test-results'),
    path.join(baseDir, 'playwright-report'),
    path.join(baseDir, '.playwright-artifacts'),
    path.join(baseDir, 'test', 'fixtures'),
    baseDir,
  ];

  let newestFile: { path: string; mtime: number } | undefined;

  for (const dir of candidateDirs) {
    if (!fs.existsSync(dir)) continue;

    try {
      const found = scanForTraceZips(dir, 3); // Max depth 3
      for (const f of found) {
        const stat = fs.statSync(f);
        if (!newestFile || stat.mtimeMs > newestFile.mtime) {
          newestFile = { path: f, mtime: stat.mtimeMs };
        }
      }
    } catch {
      // Ignore permission or traversal errors
    }
  }

  return newestFile?.path;
}

function scanForTraceZips(dir: string, depth: number): string[] {
  if (depth <= 0) return [];
  const results: string[] = [];

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') {
          continue;
        }
        results.push(...scanForTraceZips(fullPath, depth - 1));
      } else if (entry.isFile()) {
        if (entry.name.endsWith('.zip') && (entry.name.includes('trace') || entry.name.includes('sample'))) {
          results.push(fullPath);
        }
      }
    }
  } catch {
    // Ignore read errors
  }

  return results;
}
