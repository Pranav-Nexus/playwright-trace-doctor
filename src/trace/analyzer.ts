import {
  ParsedTraceArchive,
} from './archive.js';
import {
  TriageDiagnostic,
  FailureClassification,
  FailureType,
  TraceAction,
  TraceNetworkRequest,
  TraceConsoleMessage,
  LocatorRecommendation,
  DomContext,
} from '../types.js';

/**
 * Diagnostic Engine for Playwright traces.
 * Analyzes action timelines, network waterfalls, console logs, and DOM snapshots
 * to synthesize a one-shot root cause and resilient fix recommendations.
 */
export function analyzeTrace(archive: ParsedTraceArchive): TriageDiagnostic {
  const { actions, networkRequests, consoleMessages, domSnapshots, stacksMap, tracePath } = archive;

  // 1. Locate the failing action (prefer last action with an explicit error)
  const failedAction = findFailingAction(actions);

  // 2. Correlate network errors (status >= 400 or failed requests)
  const networkErrors = filterCorrelatedNetworkErrors(networkRequests, failedAction);

  // 3. Correlate console errors
  const consoleErrors = filterCorrelatedConsoleErrors(consoleMessages, failedAction);

  // 4. Classify the failure mode using heuristics
  const classification = classifyFailure(failedAction, networkErrors, consoleErrors);

  // 5. Extract DOM context for failing selector
  const domContext = extractDomContext(archive, failedAction);

  // 6. Generate resilient locator and code fix recommendations
  const recommendations = generateRecommendations(failedAction, classification, domContext, networkErrors);

  // 7. Calculate test duration
  const startTimes = actions.map((a) => a.startTime).filter((t) => t > 0);
  const endTimes = actions.map((a) => a.endTime).filter((t) => t > 0);
  const minTime = startTimes.length > 0 ? Math.min(...startTimes) : 0;
  const maxTime = endTimes.length > 0 ? Math.max(...endTimes) : 0;
  const durationMs = maxTime > minTime ? maxTime - minTime : 0;

  // 8. Synthesize token-optimized markdown summary
  const markdownSummary = buildMarkdownSummary({
    tracePath,
    durationMs,
    failedAction,
    classification,
    networkErrors,
    consoleErrors,
    recommendations,
    domContext,
  });

  return {
    testName: failedAction?.title || failedAction?.params?.title || 'Playwright Test',
    tracePath,
    durationMs,
    failedAction: failedAction
      ? {
          apiName: failedAction.apiName,
          selector: failedAction.selector,
          errorMessage: failedAction.error?.message || 'Action failed',
          callStack: failedAction.error?.stack || (failedAction.callId ? stacksMap.get(failedAction.callId) : undefined),
          logSteps: failedAction.log || [],
          callId: failedAction.callId,
        }
      : undefined,
    classification,
    domContext,
    networkErrors,
    consoleErrors,
    recommendations,
    markdownSummary,
  };
}

function findFailingAction(actions: TraceAction[]): TraceAction | undefined {
  const actionsWithError = actions.filter((a) => !!a.error);
  if (actionsWithError.length > 0) {
    return actionsWithError[actionsWithError.length - 1];
  }
  // Fallback: look for action with error in logs or timeout
  for (let i = actions.length - 1; i >= 0; i--) {
    const act = actions[i];
    const logText = (act.log || []).join(' ');
    if (logText.includes('error') || logText.includes('Timeout') || logText.includes('failed')) {
      return act;
    }
  }
  return actions[actions.length - 1];
}

function filterCorrelatedNetworkErrors(
  requests: TraceNetworkRequest[],
  failedAction?: TraceAction
): TraceNetworkRequest[] {
  const failed = requests.filter((r) => r.failed || r.status >= 400);
  if (!failedAction) return failed.slice(-5);

  const actionTime = failedAction.startTime || failedAction.endTime;
  if (!actionTime) return failed.slice(-5);

  const windowStart = actionTime - 15000;
  const windowEnd = (failedAction.endTime || actionTime) + 2000;

  const relevant = failed.filter(
    (r) => r.timestamp === 0 || (r.timestamp >= windowStart && r.timestamp <= windowEnd)
  );

  return (relevant.length > 0 ? relevant : failed).slice(-5);
}

function filterCorrelatedConsoleErrors(
  messages: TraceConsoleMessage[],
  failedAction?: TraceAction
): TraceConsoleMessage[] {
  return messages.filter((m) => m.type === 'error').slice(-5);
}

function classifyFailure(
  action?: TraceAction,
  networkErrors: TraceNetworkRequest[] = [],
  consoleErrors: TraceConsoleMessage[] = []
): FailureClassification {
  if (!action || !action.error) {
    if (networkErrors.length > 0) {
      return {
        type: 'BACKEND_API_FAILURE',
        confidence: 'HIGH',
        explanation: `Test failed with ${networkErrors.length} correlated 4xx/5xx HTTP error(s).`,
        rootCause: `Endpoint ${networkErrors[0].url} returned HTTP ${networkErrors[0].status}`,
      };
    }
    return {
      type: 'UNKNOWN_ERROR',
      confidence: 'LOW',
      explanation: 'No explicit error record identified in action list.',
      rootCause: 'Action stream terminated without explicit error payload.',
    };
  }

  const errMsg = action.error.message || '';
  const logStr = (action.log || []).join('\n');
  const apiName = action.apiName || '';

  // 1. Strict mode violation
  if (
    errMsg.includes('strict mode violation') ||
    errMsg.includes('resolved to 2 elements') ||
    errMsg.includes('resolved to multiple elements')
  ) {
    return {
      type: 'STRICT_MODE_VIOLATION',
      confidence: 'HIGH',
      explanation: 'Locator resolved to multiple matching DOM elements in strict mode.',
      rootCause: `Playwright requires single-element resolution. Selector "${action.selector}" is ambiguous.`,
    };
  }

  // 2. Pointer / Click intercepted
  if (
    errMsg.includes('intercepts pointer events') ||
    errMsg.includes('is not clickable') ||
    errMsg.includes('obscured by') ||
    logStr.includes('intercepts pointer events')
  ) {
    return {
      type: 'POINTER_INTERCEPTED',
      confidence: 'HIGH',
      explanation: 'The target element is covered or obscured by an overlay, modal backdrop, or sticky header.',
      rootCause: 'Element was found in the DOM but pointer dispatch was blocked by an overlapping element.',
    };
  }

  // 3. Backend API Failure correlation (takes precedence if 5xx crashed the flow)
  const has5xx = networkErrors.some((n) => n.status >= 500);
  if (has5xx) {
    const badReq = networkErrors.find((n) => n.status >= 500)!;
    return {
      type: 'BACKEND_API_FAILURE',
      confidence: 'HIGH',
      explanation: `Test failed downstream of a backend API failure (HTTP ${badReq.status} on ${badReq.url}).`,
      rootCause: `Backend service responded with HTTP ${badReq.status}: ${badReq.responseBodySnippet || badReq.statusText || 'Internal Server Error'}.`,
    };
  }

  // 4. Assertion failure (explicit expect checks)
  if (
    apiName.startsWith('expect') ||
    errMsg.includes('expect(') ||
    errMsg.includes('Expected:') ||
    errMsg.includes('Expected pattern:') ||
    errMsg.includes('Expected substring:') ||
    (errMsg.includes('waiting for expect('))
  ) {
    return {
      type: 'ASSERTION_FAILED',
      confidence: 'HIGH',
      explanation: 'Playwright assertion expectation mismatch.',
      rootCause: errMsg.split('\n')[0] || 'Assertion condition failed.',
    };
  }

  // 5. Timeout - locator not found / visible
  if (errMsg.includes('Timeout') || errMsg.includes('timed out') || logStr.includes('Timeout')) {
    if (errMsg.includes('waiting for') && (errMsg.includes('visible') || errMsg.includes('to be visible'))) {
      return {
        type: 'TIMEOUT_LOCATOR_NOT_VISIBLE',
        confidence: 'HIGH',
        explanation: `Locator "${action.selector}" was found in DOM but failed to become visible within timeout limit.`,
        rootCause: 'Element has display:none, visibility:hidden, zero opacity, or is off-screen.',
      };
    }
    return {
      type: 'TIMEOUT_LOCATOR_NOT_FOUND',
      confidence: 'HIGH',
      explanation: `Timed out waiting for locator "${action.selector}". The element never appeared in the DOM.`,
      rootCause: `The element locator does not match any current DOM nodes, or the page state did not render in time.`,
    };
  }

  return {
    type: 'UNKNOWN_ERROR',
    confidence: 'MEDIUM',
    explanation: 'Unclassified error encountered during action execution.',
    rootCause: errMsg.split('\n')[0] || 'Unknown error occurred.',
  };
}

function extractDomContext(archive: ParsedTraceArchive, action?: TraceAction): DomContext | undefined {
  if (!archive.domSnapshots || archive.domSnapshots.size === 0) return undefined;

  const selector = action?.selector;
  let snapshotHtml: string | undefined;

  if (action?.callId && archive.domSnapshots.has(action.callId)) {
    snapshotHtml = archive.domSnapshots.get(action.callId);
  } else if (action?.beforeSnapshot && archive.domSnapshots.has(action.beforeSnapshot)) {
    snapshotHtml = archive.domSnapshots.get(action.beforeSnapshot);
  } else {
    const keys = Array.from(archive.domSnapshots.keys());
    if (keys.length > 0) {
      snapshotHtml = archive.domSnapshots.get(keys[keys.length - 1]);
    }
  }

  if (!snapshotHtml) return undefined;

  const cleanHtml = pruneHtmlForTokens(snapshotHtml);

  return {
    failingSelector: selector,
    targetElementSnippet: selector ? findSnippetMatchingSelector(cleanHtml, selector) : undefined,
    nearbyElementsHtml: cleanHtml.slice(0, 1500),
  };
}

function pruneHtmlForTokens(rawHtml: string): string {
  return rawHtml
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '<svg>[icon]</svg>')
    .replace(/\s+/g, ' ')
    .trim();
}

function findSnippetMatchingSelector(html: string, selector: string): string | undefined {
  const idMatch = selector.match(/#([a-zA-Z0-9_-]+)/);
  if (idMatch) {
    const id = idMatch[1];
    const regex = new RegExp(`(<[^>]*id=["']${id}["'][^>]*>[^<]*<\\/[^>]+>|<[^>]*id=["']${id}["'][^>]*\\/?>)`, 'i');
    const match = html.match(regex);
    if (match) return match[0];
  }

  const textMatch = selector.match(/text=(['"]?)(.*?)\1/);
  if (textMatch) {
    const text = textMatch[2];
    const idx = html.indexOf(text);
    if (idx !== -1) {
      return html.slice(Math.max(0, idx - 100), Math.min(html.length, idx + 150));
    }
  }

  return undefined;
}

function generateRecommendations(
  action?: TraceAction,
  classification?: FailureClassification,
  domContext?: DomContext,
  networkErrors: TraceNetworkRequest[] = []
): LocatorRecommendation[] {
  const recs: LocatorRecommendation[] = [];
  const selector = action?.selector || '';

  // 1. Backend API 500 Failure
  if (classification?.type === 'BACKEND_API_FAILURE' && networkErrors.length > 0) {
    const endpoint = networkErrors[0].url;
    recs.push({
      type: 'WAIT_CONDITION',
      priority: 1,
      recommendedCode: `// Downstream Backend Failure: Verify ${endpoint} or mock response in test:\nawait page.route('${endpoint}', async route => {\n  await route.fulfill({ status: 200, json: { status: 'success' } });\n});`,
      rationale: `The failure originated from an HTTP ${networkErrors[0].status} on ${endpoint}, not broken test UI logic.`,
    });
  }

  // 2. Strict Mode Violations
  if (classification?.type === 'STRICT_MODE_VIOLATION') {
    recs.push({
      type: 'ROLE',
      priority: 1,
      recommendedCode: `page.locator('${selector}').first() // Or scope by parent container`,
      rationale: 'Playwright strict mode requires unambiguous resolution. Use .first() or narrow the parent locator.',
    });
    recs.push({
      type: 'TEST_ID',
      priority: 2,
      recommendedCode: `page.getByTestId('unique-target-id')`,
      rationale: 'Add a distinct data-testid attribute to differentiate between identical UI elements.',
    });
  }

  // 3. Pointer Intercepted
  if (classification?.type === 'POINTER_INTERCEPTED') {
    recs.push({
      type: 'WAIT_CONDITION',
      priority: 1,
      recommendedCode: `await expect(page.locator('.modal-backdrop, .loading-overlay, .spinner')).toBeHidden();\nawait page.locator('${selector}').click();`,
      rationale: 'Wait for overlapping modal backdrop, drawer, or loading overlay to detach before clicking.',
    });
    recs.push({
      type: 'ACTION',
      priority: 2,
      recommendedCode: `await page.locator('${selector}').click({ force: true });`,
      rationale: 'Bypasses Playwright actionability checks if element is intentionally overlaid.',
    } as any);
  }

  // 4. Assertion Mismatch
  if (classification?.type === 'ASSERTION_FAILED') {
    recs.push({
      type: 'ASSERTION',
      priority: 1,
      recommendedCode: `// Use web-first polling assertion with custom timeout:\nawait expect(page.locator('${selector || '#target'}')).toHaveText(/expected_pattern/i, { timeout: 5000 });`,
      rationale: 'Web-first assertions automatically retry until condition is met or timeout expires.',
    });
    recs.push({
      type: 'WAIT_CONDITION',
      priority: 2,
      recommendedCode: `// If asserting against async state transitions, poll explicitly:\nawait expect.poll(async () => {\n  return await page.locator('${selector || '#target'}').textContent();\n}, { message: 'Timed out waiting for state change', timeout: 5000 }).toBe('Expected');`,
      rationale: 'expect.poll safely re-queries custom async getters until the expected value stabilizes.',
    });
  }

  // 5. Timeout Locator Not Found / Not Visible
  if (
    classification?.type === 'TIMEOUT_LOCATOR_NOT_FOUND' ||
    classification?.type === 'TIMEOUT_LOCATOR_NOT_VISIBLE'
  ) {
    if (selector.includes('button') || selector.includes('btn')) {
      recs.push({
        type: 'ROLE',
        priority: 1,
        recommendedCode: `await page.getByRole('button', { name: /confirm|submit|pay/i }).click();`,
        rationale: 'Replace brittle CSS/ID locators with accessible role locators resilient to markup changes.',
      });
    }

    recs.push({
      type: 'TEST_ID',
      priority: 2,
      recommendedCode: `await page.getByTestId('checkout-submit-btn').click();`,
      rationale: 'Use explicit data-testid attributes which survive styling and redesign refactors.',
    });

    recs.push({
      type: 'WAIT_CONDITION',
      priority: 3,
      recommendedCode: `await expect(page.locator('${selector}')).toBeVisible({ timeout: 10000 });`,
      rationale: 'Use web-first auto-await assertions with extended timeout for slow asynchronous render operations.',
    });
  }

  return recs;
}

function buildMarkdownSummary(data: {
  tracePath: string;
  durationMs: number;
  failedAction?: TraceAction;
  classification: FailureClassification;
  networkErrors: TraceNetworkRequest[];
  consoleErrors: TraceConsoleMessage[];
  recommendations: LocatorRecommendation[];
  domContext?: DomContext;
}): string {
  const { failedAction, classification, networkErrors, consoleErrors, recommendations } = data;

  let md = `## 🩺 Playwright Trace Doctor Diagnostic\n\n`;
  md += `**Classification:** \`${classification.type}\` (${classification.confidence} confidence)\n`;
  md += `**Root Cause:** ${classification.rootCause}\n\n`;

  if (failedAction) {
    md += `### 💥 Failed Step\n`;
    md += `- **Action:** \`${failedAction.apiName}\`\n`;
    if (failedAction.selector) {
      md += `- **Failing Locator:** \`${failedAction.selector}\`\n`;
    }
    md += `- **Error:** \`${failedAction.error?.message?.split('\n')[0] || 'Action failed'}\`\n\n`;
  }

  if (networkErrors.length > 0) {
    md += `### 🌐 Correlated Network Failures (${networkErrors.length})\n`;
    for (const net of networkErrors) {
      md += `- **HTTP ${net.status}** \`${net.method} ${net.url}\` ${net.failureReason ? `(${net.failureReason})` : ''}\n`;
      if (net.responseBodySnippet) {
        md += `  > \`${net.responseBodySnippet.slice(0, 150)}\`\n`;
      }
    }
    md += `\n`;
  }

  if (consoleErrors.length > 0) {
    md += `### ⚠️ Correlated Console Errors\n`;
    for (const c of consoleErrors) {
      md += `- \`${c.text.slice(0, 150)}\`\n`;
    }
    md += `\n`;
  }

  if (recommendations.length > 0) {
    md += `### 🛠️ Self-Healing Fix Recommendations\n`;
    for (const rec of recommendations) {
      md += `**[${rec.type}]** ${rec.rationale}\n`;
      md += `\`\`\`typescript\n${rec.recommendedCode}\n\`\`\`\n`;
    }
  }

  return md;
}
