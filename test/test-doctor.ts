import * as path from 'path';
import { parseTraceArchive } from '../src/trace/archive.js';
import { analyzeTrace } from '../src/trace/analyzer.js';

async function runTest() {
  const fixturePath = path.resolve(process.cwd(), 'test/fixtures/sample-failure.zip');
  console.log('Testing Playwright Trace Doctor against fixture:', fixturePath);

  console.log('\n--- 1. Archive Parsing ---');
  const archive = parseTraceArchive(fixturePath);
  console.log(`Actions parsed: ${archive.actions.length}`);
  console.log(`Network requests parsed: ${archive.networkRequests.length}`);
  console.log(`Console messages parsed: ${archive.consoleMessages.length}`);
  console.log(`DOM snapshots parsed: ${archive.domSnapshots.size}`);
  console.log(`Stack traces parsed: ${archive.stacksMap.size}`);

  console.log('\n--- 2. Diagnostic Analysis ---');
  const diagnostic = analyzeTrace(archive);
  console.log(`Classification:`, diagnostic.classification);
  console.log(`Failed Action:`, diagnostic.failedAction?.apiName, diagnostic.failedAction?.selector);
  console.log(`Error message:`, diagnostic.failedAction?.errorMessage);
  console.log(`Correlated Network Errors:`, diagnostic.networkErrors.length);
  console.log(`Correlated Console Errors:`, diagnostic.consoleErrors.length);
  console.log(`Recommendations:`, diagnostic.recommendations.length);

  console.log('\n--- 3. Markdown Summary Preview ---');
  console.log(diagnostic.markdownSummary);

  if (diagnostic.classification.type === 'BACKEND_API_FAILURE' || diagnostic.classification.type === 'TIMEOUT_LOCATOR_NOT_FOUND') {
    console.log('✅ Analysis passed with high-signal failure detection!');
  } else {
    console.warn('⚠️ Unexpected classification:', diagnostic.classification.type);
  }
}

runTest().catch((err) => {
  console.error('Test run error:', err);
  process.exit(1);
});
