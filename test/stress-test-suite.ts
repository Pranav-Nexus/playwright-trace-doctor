import { chromium } from 'playwright';
import { expect } from 'playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { parseTraceArchive } from '../src/trace/archive.js';
import { analyzeTrace } from '../src/trace/analyzer.js';
import { TriageDiagnostic, FailureType } from '../src/types.js';

interface TestCaseConfig {
  id: string;
  name: string;
  expectedFailureType: FailureType;
  execute: (page: any) => Promise<void>;
}

const STRESS_DIR = path.resolve(process.cwd(), 'test/fixtures/stress');

async function runStressTestSuite() {
  if (!fs.existsSync(STRESS_DIR)) {
    fs.mkdirSync(STRESS_DIR, { recursive: true });
  }

  const testCases: TestCaseConfig[] = [
    // 1. Strict Mode Violation
    {
      id: 'strict-mode',
      name: 'Strict Mode Violation (Multiple Elements)',
      expectedFailureType: 'STRICT_MODE_VIOLATION',
      execute: async (page) => {
        await page.setContent(`
          <div>
            <button class="submit-btn" id="btn-1">Submit Order</button>
            <button class="submit-btn" id="btn-2">Submit Order</button>
          </div>
        `);
        // Intentional violation: locator('button.submit-btn') matches 2 elements
        await page.locator('button.submit-btn').click({ timeout: 2000 });
      },
    },

    // 2. Pointer Events Intercepted
    {
      id: 'pointer-intercept',
      name: 'Pointer Events Intercepted (Modal Overlay)',
      expectedFailureType: 'POINTER_INTERCEPTED',
      execute: async (page) => {
        await page.setContent(`
          <div style="position:relative; width: 100vw; height: 100vh;">
            <button id="checkout-btn" style="position:absolute; top:50px; left:50px;">Complete Purchase</button>
            <div id="loading-overlay" style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:9999;">
              <p style="color:white; padding:20px;">Processing previous request...</p>
            </div>
          </div>
        `);
        // Click button that is covered by modal overlay
        await page.click('#checkout-btn', { timeout: 2500 });
      },
    },

    // 3. Locator Timeout (Non-Existent Element)
    {
      id: 'locator-timeout',
      name: 'Locator Timeout (Element Missing in DOM)',
      expectedFailureType: 'TIMEOUT_LOCATOR_NOT_FOUND',
      execute: async (page) => {
        await page.setContent(`
          <form id="settings-form">
            <input type="text" name="username" value="pranav" />
          </form>
        `);
        await page.click('button#save-preferences', { timeout: 2000 });
      },
    },

    // 4. Backend API Failure (Correlated 500)
    {
      id: 'backend-500',
      name: 'Backend API 500 Failure with Downstream Timeout',
      expectedFailureType: 'BACKEND_API_FAILURE',
      execute: async (page) => {
        await page.route('https://api.portal.internal/orders/confirm', async (route) => {
          await route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Database connection pool exhausted', code: 'DB_ERR_500' }),
          });
        });

        await page.setContent(`
          <button id="confirm-btn">Confirm Transaction</button>
          <div id="status-container"></div>
          <script>
            document.getElementById('confirm-btn').addEventListener('click', async () => {
              try {
                const res = await fetch('https://api.portal.internal/orders/confirm', { method: 'POST' });
                if (!res.ok) console.error("API responded with status " + res.status);
              } catch (e) {
                console.error("Fetch failed: " + e.message);
              }
            });
          </script>
        `);

        // Click and trigger network failure
        await page.click('#confirm-btn');
        await page.waitForTimeout(500);

        // Then attempt to wait for confirmation badge that never renders
        await page.waitForSelector('.success-badge', { timeout: 2000 });
      },
    },

    // 5. Assertion Failure (Playwright expect assertion mismatch)
    {
      id: 'assertion-failure',
      name: 'Assertion Mismatch Failure (expect.toHaveText)',
      expectedFailureType: 'ASSERTION_FAILED',
      execute: async (page) => {
        await page.setContent(`
          <div id="account-status">Account Suspended</div>
        `);
        // Real Playwright web-first assertion mismatch
        await expect(page.locator('#account-status')).toHaveText('Account Active', { timeout: 1500 });
      },
    },
  ];

  console.log(`\n============================================================`);
  console.log(`🧪 RUNNING PLAYWRIGHT TRACE DOCTOR STRESS BENCHMARK (5 SUITES)`);
  console.log(`============================================================\n`);

  const browser = await chromium.launch({ headless: true });
  const results: {
    id: string;
    name: string;
    expected: FailureType;
    actual: FailureType;
    passed: boolean;
    parseTimeMs: number;
    analysisTimeMs: number;
    recommendationsCount: number;
    diagnostic: TriageDiagnostic;
  }[] = [];

  for (const tc of testCases) {
    const tracePath = path.join(STRESS_DIR, `${tc.id}.zip`);
    if (fs.existsSync(tracePath)) fs.unlinkSync(tracePath);

    const context = await browser.newContext();
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    const page = await context.newPage();

    let threw = false;
    try {
      await tc.execute(page);
    } catch (e) {
      threw = true;
    }

    await context.tracing.stop({ path: tracePath });
    await context.close();

    // Now test playwright-trace-doctor against this trace
    const t0 = performance.now();
    const archive = parseTraceArchive(tracePath);
    const t1 = performance.now();
    const diagnostic = analyzeTrace(archive);
    const t2 = performance.now();

    const parseTimeMs = +(t1 - t0).toFixed(2);
    const analysisTimeMs = +(t2 - t1).toFixed(2);
    const passed = diagnostic.classification.type === tc.expectedFailureType;

    results.push({
      id: tc.id,
      name: tc.name,
      expected: tc.expectedFailureType,
      actual: diagnostic.classification.type,
      passed,
      parseTimeMs,
      analysisTimeMs,
      recommendationsCount: diagnostic.recommendations.length,
      diagnostic,
    });

    const statusIcon = passed ? '✅' : '❌';
    console.log(`${statusIcon} Suite [${tc.id}]: ${tc.name}`);
    console.log(`   Expected: ${tc.expectedFailureType} | Detected: ${diagnostic.classification.type}`);
    console.log(`   Perf: Parse ${parseTimeMs}ms, Analysis ${analysisTimeMs}ms (Total: ${(parseTimeMs + analysisTimeMs).toFixed(2)}ms)`);
    console.log(`   Fixes Suggested: ${diagnostic.recommendations.length}`);
    if (!passed) {
      console.log(`   Diagnostic explanation: ${diagnostic.classification.explanation}`);
    }
    console.log(`------------------------------------------------------------`);
  }

  await browser.close();

  const totalPassed = results.filter((r) => r.passed).length;
  console.log(`\n============================================================`);
  console.log(`📊 STRESS TEST SUMMARY: ${totalPassed}/${results.length} PASSED (100% Target)`);
  console.log(`============================================================\n`);

  // Write full stress test report to JSON
  const reportPath = path.resolve(process.cwd(), 'test/stress-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
  console.log(`Stress report saved to: ${reportPath}`);

  return { results, totalPassed, total: results.length };
}

runStressTestSuite().catch((err) => {
  console.error('Stress test suite crashed:', err);
  process.exit(1);
});
