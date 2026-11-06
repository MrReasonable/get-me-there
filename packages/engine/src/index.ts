// Barrel for @gmt/engine (plan contract "Engine"); the alert runner, templates and EmailNotifier are WP11's.
export { type AlertRunnerDeps, type AlertRunResult, runAlerts } from './alerts/runner.js';
export {
  appRowLink,
  type DigestRenderInput,
  type ItemMarks,
  NO_MARKS,
  renderBody,
  renderSubject,
  routeLine,
} from './alerts/templates.js';
export { noAlerts } from './alertsStep.js';
export { capKindOf } from './context.js';
export { createEngine } from './engine.js';
export { confirmationOf } from './estimate.js';
export {
  type DatePairAsk,
  type FlightReadMark,
  type FlightReadStart,
  type FlightReadUnavailable,
  flightReadUnavailable,
} from './flightRead.js';
export { fxHttpLimits } from './fx/limits.js';
export { type LineKey, lineKey } from './lines.js';
export {
  EmailNotifier,
  type EmailNotifierOptions,
  type MailMessage,
  type MailTransport,
  SMTP_TIMEOUTS,
  type SmtpConfig,
  type SmtpTransportOptions,
  smtpTransportOptions,
  type TransportFactory,
} from './notifiers/email.js';
export { buildNotifiers } from './notifiers/index.js';
export { LogNotifier } from './notifiers/log.js';
export { renderOperatorMessage } from './notifiers/operatorTemplates.js';
export {
  type BrowserWindowSetting,
  loadsBrowserPages,
  resumeLeavesBrowserCells,
} from './scheduler/browserWindow.js';
export { parseCron } from './scheduler/parseCron.js';
export { windowSetting } from './stages/browserGate.js';
export { FLIGHT_LIST_PROVIDER } from './stages/flightLists.js';
export { REUSE_TOLERANCE, refreshHoursOf } from './stages/reuse.js';
export {
  type Confirmation,
  type ConfirmationContext,
  confirmationNeeded,
  SOFT_CONFIRM_CALL_SHARE,
  type SoftConfirmWhy,
} from './start.js';
export type {
  AlertsPass,
  AlertsStepHook,
  BudgetFit,
  ChildCapPreview,
  CoverageCheckRequest,
  CoverageCheckResponse,
  Engine,
  EngineDeps,
  EngineOptions,
  Estimate,
  EstimateAsk,
  RankedDatePair,
  RankedDatePairsReader,
  SchedulerJob,
  StartOptions,
  StartResult,
  VerifyCellOptions,
} from './types.js';
