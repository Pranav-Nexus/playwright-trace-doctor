import AdmZip from 'adm-zip';
import * as path from 'path';
import * as fs from 'fs';
import {
  TraceAction,
  TraceNetworkRequest,
  TraceConsoleMessage,
  ActionError,
} from '../types.js';

export interface ParsedTraceArchive {
  tracePath: string;
  actions: TraceAction[];
  networkRequests: TraceNetworkRequest[];
  consoleMessages: TraceConsoleMessage[];
  domSnapshots: Map<string, string>;
  stacksMap: Map<string, string>;
}

/**
 * Reads and parses an authentic Playwright trace.zip archive in memory.
 * Seamlessly supports both Modern Playwright (1.50+ / 1.63+ before/after stream)
 * and legacy action event schemas.
 */
export function parseTraceArchive(traceFilePath: string): ParsedTraceArchive {
  const resolvedPath = path.resolve(traceFilePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Trace file not found: ${resolvedPath}`);
  }

  const zip = new AdmZip(resolvedPath);
  const zipEntries = zip.getEntries();

  // Temporary action mapping to link 'before', 'after', and 'log' records by callId
  const actionMap = new Map<string, TraceAction>();
  const networkRequests: TraceNetworkRequest[] = [];
  const consoleMessages: TraceConsoleMessage[] = [];
  const domSnapshots = new Map<string, string>();
  const stacksMap = new Map<string, string>();

  for (const entry of zipEntries) {
    const entryName = entry.entryName;

    // 1. Parse .stacks files (maps callId to stack trace)
    if (entryName.endsWith('.stacks')) {
      try {
        const text = entry.getData().toString('utf8');
        const parsed = JSON.parse(text);
        if (parsed.stacks && Array.isArray(parsed.stacks) && parsed.files) {
          const files: string[] = parsed.files;
          for (const item of parsed.stacks) {
            const callId = `call@${item[0]}`;
            const frames = item[1];
            if (Array.isArray(frames)) {
              const formattedStack = frames
                .map((f: any) => {
                  const file = files[f[0]] || 'unknown';
                  const line = f[1];
                  const col = f[2];
                  const fn = f[3] || 'anonymous';
                  return `    at ${fn} (${file}:${line}:${col})`;
                })
                .join('\n');
              stacksMap.set(callId, formattedStack);
            }
          }
        }
      } catch {
        // Silently skip malformed stack metadata
      }
    }

    // 2. Parse .trace JSONL files
    if (entryName.endsWith('.trace')) {
      const text = entry.getData().toString('utf8');
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);

      for (const line of lines) {
        try {
          const item = JSON.parse(line);

          // Modern Playwright: 'before' action start
          if (item.type === 'before') {
            const callId = item.callId || `call-${actionMap.size}`;
            const existing: TraceAction = actionMap.get(callId) || {
              callId,
              apiName: item.method || item.apiName || 'unknown',
              class: item.class,
              method: item.method,
              params: item.params || {},
              selector: item.params?.selector || item.params?.locator,
              startTime: item.startTime ?? 0,
              endTime: 0,
              log: [],
            };
            existing.startTime = item.startTime ?? existing.startTime;
            existing.apiName = item.method || existing.apiName;
            existing.selector = item.params?.selector || item.params?.locator || existing.selector;
            existing.params = { ...existing.params, ...item.params };
            existing.class = item.class || existing.class;
            actionMap.set(callId, existing);
          }

          // Modern Playwright: 'after' action finish
          if (item.type === 'after') {
            const callId = item.callId || `call-${actionMap.size}`;
            const existing: TraceAction = actionMap.get(callId) || {
              callId,
              apiName: item.method || 'action',
              startTime: 0,
              endTime: item.endTime ?? 0,
              log: [],
            };
            existing.endTime = item.endTime ?? existing.endTime;
            if (existing.startTime && existing.endTime) {
              existing.duration = Math.max(0, existing.endTime - existing.startTime);
            }
            if (item.error) {
              existing.error = {
                message: item.error.message || String(item.error),
                name: item.error.name,
                stack: item.error.stack,
              };
            }
            if (Array.isArray(item.log)) {
              existing.log = [...(existing.log || []), ...item.log];
            }
            existing.beforeSnapshot = item.beforeSnapshot || existing.beforeSnapshot;
            existing.afterSnapshot = item.afterSnapshot || existing.afterSnapshot;
            actionMap.set(callId, existing);
          }

          // Modern Playwright: action step logs
          if (item.type === 'log') {
            const callId = item.callId;
            if (callId && item.message) {
              const act = actionMap.get(callId);
              if (act) {
                act.log = act.log || [];
                act.log.push(item.message);
              }
            }
          }

          // Legacy Playwright: monolithic 'action' record
          if (item.type === 'action') {
            const callId = item.callId || `action-${actionMap.size}`;
            const action: TraceAction = {
              callId,
              apiName: item.apiName || item.method || 'unknown',
              class: item.class,
              method: item.method,
              params: item.params || {},
              selector: item.params?.selector || item.params?.locator,
              startTime: item.startTime ?? 0,
              endTime: item.endTime ?? 0,
              duration:
                item.endTime && item.startTime
                  ? Math.max(0, item.endTime - item.startTime)
                  : undefined,
              error: item.error
                ? {
                    message: item.error.message || String(item.error),
                    name: item.error.name,
                    stack: item.error.stack,
                  }
                : undefined,
              log: Array.isArray(item.log) ? item.log : [],
              beforeSnapshot: item.beforeSnapshot,
              afterSnapshot: item.afterSnapshot,
            };
            actionMap.set(callId, action);
          }

          // Console messages
          if (item.type === 'console') {
            consoleMessages.push({
              type: item.messageType === 'error' ? 'error' : item.messageType === 'warning' ? 'warn' : 'log',
              text: item.text || (item.args && item.args.map((a: any) => a.preview || a.value).join(' ')) || '',
              timestamp: item.time || Date.now(),
              location: item.location
                ? {
                    file: item.location.url || '',
                    line: item.location.lineNumber ?? 0,
                    column: item.location.columnNumber ?? 0,
                  }
                : undefined,
            });
          }

          // Page errors
          if (item.type === 'event' && (item.method === 'pageError' || item.method === 'console')) {
            const params = item.params || {};
            if (item.method === 'pageError') {
              const err = params.error;
              consoleMessages.push({
                type: 'error',
                text: typeof err === 'string' ? err : err?.message || JSON.stringify(err),
                timestamp: item.time || Date.now(),
              });
            } else if (item.method === 'console') {
              consoleMessages.push({
                type: params.type || 'log',
                text: params.text || '',
                timestamp: item.time || Date.now(),
                location: params.location,
              });
            }
          }

          // Frame snapshot records
          if (item.type === 'frame-snapshot' && item.snapshot) {
            const s = item.snapshot;
            const callId = s.callId || s.snapshotName || `snapshot-${domSnapshots.size}`;
            if (s.html) {
              domSnapshots.set(callId, typeof s.html === 'string' ? s.html : JSON.stringify(s.html));
            }
          }
        } catch {
          // Skip invalid lines
        }
      }
    }

    // 3. Parse .network JSONL files
    if (entryName.endsWith('.network')) {
      const text = entry.getData().toString('utf8');
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);

      for (const line of lines) {
        try {
          const item = JSON.parse(line);
          if (item.type === 'resource-snapshot' && item.snapshot) {
            const s = item.snapshot;
            const req = s.request || {};
            const res = s.response || {};
            networkRequests.push({
              url: req.url || 'unknown',
              method: req.method || 'GET',
              status: res.status || 0,
              statusText: res.statusText,
              timestamp: s.timestamp || item.time || 0,
              duration: s.duration,
              failed: res.status >= 400 || !!s.failure,
              failureReason: s.failure?.errorText,
              responseBodySnippet: s.response?.content?.text?.slice(0, 500),
            });
          } else if (item.url) {
            networkRequests.push({
              url: item.url,
              method: item.method || 'GET',
              status: item.status || 0,
              statusText: item.statusText,
              timestamp: item.timestamp || 0,
              failed: item.status >= 400,
            });
          }
        } catch {
          // Skip invalid line
        }
      }
    }

    // 4. Capture any standalone HTML snapshots
    if (entryName.endsWith('.html')) {
      try {
        const text = entry.getData().toString('utf8');
        domSnapshots.set(entryName, text);
      } catch {
        // Skip binary snapshot attachments
      }
    }
  }

  const actions = Array.from(actionMap.values());
  // Sort actions chronologically
  actions.sort((a, b) => a.startTime - b.startTime);

  return {
    tracePath: resolvedPath,
    actions,
    networkRequests,
    consoleMessages,
    domSnapshots,
    stacksMap,
  };
}
