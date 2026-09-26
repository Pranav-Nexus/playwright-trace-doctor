export type FailureType =
  | 'TIMEOUT_LOCATOR_NOT_FOUND'
  | 'TIMEOUT_LOCATOR_NOT_VISIBLE'
  | 'STRICT_MODE_VIOLATION'
  | 'POINTER_INTERCEPTED'
  | 'BACKEND_API_FAILURE'
  | 'ASSERTION_FAILED'
  | 'UNKNOWN_ERROR';

export interface ActionError {
  message: string;
  name?: string;
  stack?: string;
}

export interface TraceAction {
  callId: string;
  apiName: string;
  class?: string;
  method?: string;
  params?: Record<string, any>;
  selector?: string;
  startTime: number;
  endTime: number;
  duration?: number;
  error?: ActionError;
  log?: string[];
  beforeSnapshot?: string;
  afterSnapshot?: string;
  stepId?: string;
  title?: string;
  point?: { x: number; y: number };
}

export interface TraceNetworkRequest {
  url: string;
  method: string;
  status: number;
  statusText?: string;
  timestamp: number;
  duration?: number;
  failed?: boolean;
  failureReason?: string;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  responseBodySnippet?: string;
}

export interface TraceConsoleMessage {
  type: 'log' | 'info' | 'warn' | 'error';
  text: string;
  timestamp: number;
  location?: { file: string; line: number; column: number };
}

export interface FailureClassification {
  type: FailureType;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  explanation: string;
  rootCause: string;
}

export interface DomContext {
  failingSelector?: string;
  targetElementSnippet?: string;
  nearbyElementsHtml?: string;
  snapshotName?: string;
}

export interface LocatorRecommendation {
  type: 'ROLE' | 'TEST_ID' | 'TEXT' | 'LABEL' | 'WAIT_CONDITION' | 'ASSERTION';
  recommendedCode: string;
  rationale: string;
  priority: 1 | 2 | 3;
}

export interface TriageDiagnostic {
  testName?: string;
  tracePath: string;
  durationMs: number;
  failedAction?: {
    apiName: string;
    selector?: string;
    errorMessage: string;
    callStack?: string;
    logSteps: string[];
    callId: string;
  };
  classification: FailureClassification;
  domContext?: DomContext;
  networkErrors: TraceNetworkRequest[];
  consoleErrors: TraceConsoleMessage[];
  recommendations: LocatorRecommendation[];
  markdownSummary: string;
}
