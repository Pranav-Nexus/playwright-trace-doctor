import pc from 'picocolors';
import { TriageDiagnostic } from '../types.js';

export function formatTerminalReport(diagnostic: TriageDiagnostic): string {
  const lines: string[] = [];
  const border = pc.gray('─'.repeat(70));

  lines.push('');
  lines.push(pc.bold(pc.cyan('🩺 PLAYWRIGHT TRACE DOCTOR')) + pc.gray(' │ Diagnostic & Self-Healing Report'));
  lines.push(border);

  // File & Duration
  lines.push(`${pc.bold('Trace File:')} ${pc.white(diagnostic.tracePath)}`);
  if (diagnostic.durationMs > 0) {
    lines.push(`${pc.bold('Duration:')}   ${pc.yellow((diagnostic.durationMs / 1000).toFixed(2) + 's')}`);
  }
  lines.push('');

  // Classification
  const typeColor =
    diagnostic.classification.type === 'BACKEND_API_FAILURE'
      ? pc.magenta
      : diagnostic.classification.type === 'STRICT_MODE_VIOLATION'
      ? pc.yellow
      : pc.red;

  lines.push(
    `${pc.bold('Classification:')} ${typeColor(pc.bold(diagnostic.classification.type))} ` +
      pc.gray(`[Confidence: ${diagnostic.classification.confidence}]`)
  );
  lines.push(`${pc.bold('Root Cause:')}     ${pc.white(diagnostic.classification.rootCause)}`);
  lines.push(border);

  // Failed Step
  if (diagnostic.failedAction) {
    lines.push(pc.bold(pc.red('💥 Failed Step:')));
    lines.push(`  ${pc.gray('Action:')}   ${pc.cyan(diagnostic.failedAction.apiName)}`);
    if (diagnostic.failedAction.selector) {
      lines.push(`  ${pc.gray('Locator:')}  ${pc.yellow(diagnostic.failedAction.selector)}`);
    }
    lines.push(`  ${pc.gray('Error:')}    ${pc.red(diagnostic.failedAction.errorMessage)}`);
    if (diagnostic.failedAction.callStack) {
      const topStack = diagnostic.failedAction.callStack.split('\n').slice(0, 3).join('\n  ');
      lines.push(`  ${pc.gray('Stack:')}\n  ${pc.gray(topStack)}`);
    }
    lines.push('');
  }

  // Network Failures
  if (diagnostic.networkErrors.length > 0) {
    lines.push(pc.bold(pc.magenta(`🌐 Correlated Network Failures (${diagnostic.networkErrors.length}):`)));
    for (const net of diagnostic.networkErrors) {
      const statusColor = net.status >= 500 ? pc.red : pc.yellow;
      lines.push(`  ${statusColor(`[HTTP ${net.status}]`)} ${pc.bold(net.method)} ${pc.white(net.url)}`);
      if (net.responseBodySnippet) {
        lines.push(`    ${pc.gray('Body:')} ${pc.italic(net.responseBodySnippet.slice(0, 100))}`);
      }
    }
    lines.push('');
  }

  // Console Errors
  if (diagnostic.consoleErrors.length > 0) {
    lines.push(pc.bold(pc.yellow(`⚠️ Console Errors (${diagnostic.consoleErrors.length}):`)));
    for (const c of diagnostic.consoleErrors) {
      lines.push(`  ${pc.gray('•')} ${pc.red(c.text.slice(0, 120))}`);
    }
    lines.push('');
  }

  // Recommendations
  if (diagnostic.recommendations.length > 0) {
    lines.push(pc.bold(pc.green('🛠️ Self-Healing Fix Recommendations:')));
    for (let i = 0; i < diagnostic.recommendations.length; i++) {
      const rec = diagnostic.recommendations[i];
      lines.push(`  ${pc.bold(pc.green(`[${rec.type}]`))} ${pc.white(rec.rationale)}`);
      const codeLines = rec.recommendedCode.split('\n');
      for (const cl of codeLines) {
        lines.push(`    ${pc.cyan(cl)}`);
      }
      lines.push('');
    }
  }

  lines.push(border);
  return lines.join('\n');
}
