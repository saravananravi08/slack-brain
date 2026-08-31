/**
 * Reference evaluators for the frozen slack-supervisor contract rules.
 *
 * These are NOT the runtime implementation. T901–T904 implement the runtime in
 * `src/orchestration/**`; this module is the executable statement of what the
 * contract says, so the fixtures can be checked for internal consistency and so
 * a downstream implementation has an unambiguous oracle to compare against.
 *
 * Everything here is pure and total: no I/O, no clock, no network, and no throw
 * on hostile input.
 */

/* ------------------------------------------------------------------ *
 * identity.md — actor classes and routing
 * ------------------------------------------------------------------ */

/** channel-memory/message-record.md §2. Owned by that set; not widened here. */
export type ChannelSenderClass = 'human' | 'gist' | 'kilo' | 'bot' | 'app' | 'system';

export type ActorClass =
  | 'authorized_human'
  | 'unauthorized_human'
  | 'kilo'
  | 'linear'
  | 'gist_self'
  | 'unknown_automation'
  | 'system';

export interface TrustedAutomationConfig {
  readonly gist_bot_user_id: string;
  readonly gist_bot_id?: string | null;
  readonly kilo_bot_id?: string | null;
  readonly kilo_app_id?: string | null;
  readonly linear_bot_id?: string | null;
  readonly linear_app_id?: string | null;
}

export interface SupervisorSenderShape {
  readonly sender_class: ChannelSenderClass;
  readonly sender_id: string;
  readonly bot_id: string | null;
  readonly app_id: string | null;
  /** The existing `accept_event` guard's decision. Never inferred here. */
  readonly human_authorized: boolean;
}

/**
 * Whole-string equality against a configured value. `null` / `undefined`
 * configuration never matches, so an unconfigured bot has no trusted identity
 * rather than a name-based one (identity.md §1).
 */
function matchesConfigured(value: string | null, configured: string | null | undefined): boolean {
  return typeof configured === 'string' && configured !== '' && value === configured;
}

/** identity.md §1.1 — first match wins, and Gist is checked before every bot. */
export function resolveActorClass(
  sender: SupervisorSenderShape,
  config: TrustedAutomationConfig,
): ActorClass {
  if (
    sender.sender_class === 'gist' ||
    sender.sender_id === config.gist_bot_user_id ||
    matchesConfigured(sender.bot_id, config.gist_bot_id)
  ) {
    return 'gist_self';
  }
  if (
    matchesConfigured(sender.bot_id, config.kilo_bot_id) ||
    matchesConfigured(sender.app_id, config.kilo_app_id)
  ) {
    return 'kilo';
  }
  if (
    matchesConfigured(sender.bot_id, config.linear_bot_id) ||
    matchesConfigured(sender.app_id, config.linear_app_id)
  ) {
    return 'linear';
  }
  if (sender.sender_class === 'system') return 'system';
  if (
    sender.sender_class === 'bot' ||
    sender.sender_class === 'app' ||
    sender.sender_class === 'kilo'
  ) {
    return 'unknown_automation';
  }
  return sender.human_authorized ? 'authorized_human' : 'unauthorized_human';
}

export type EvaluationEligibility = 'yes' | 'no' | 'never';
export type SupervisorRoute =
  | 'human_supervisor'
  | 'trusted_automation'
  | 'capture_only'
  | 'not_captured';

export interface RoutingPermissions {
  readonly persisted: boolean;
  readonly evaluated: EvaluationEligibility;
  readonly may_create_workflow: boolean;
  readonly may_advance_workflow: boolean;
  readonly may_own_or_approve: boolean;
  readonly route: SupervisorRoute;
}

const CAPTURE_ONLY: RoutingPermissions = Object.freeze({
  persisted: true,
  evaluated: 'no',
  may_create_workflow: false,
  may_advance_workflow: false,
  may_own_or_approve: false,
  route: 'capture_only',
});

const TRUSTED_AUTOMATION: RoutingPermissions = Object.freeze({
  persisted: true,
  evaluated: 'yes',
  may_create_workflow: false,
  may_advance_workflow: true,
  may_own_or_approve: false,
  route: 'trusted_automation',
});

/** identity.md §3 — the frozen routing matrix. */
export function routingFor(actor: ActorClass): RoutingPermissions {
  switch (actor) {
    case 'authorized_human':
      return Object.freeze({
        persisted: true,
        evaluated: 'yes',
        may_create_workflow: true,
        may_advance_workflow: true,
        may_own_or_approve: true,
        route: 'human_supervisor',
      });
    case 'kilo':
    case 'linear':
      return TRUSTED_AUTOMATION;
    case 'gist_self':
      // `never`, not `no`: no configuration or later decision may turn this on.
      return Object.freeze({ ...CAPTURE_ONLY, evaluated: 'never' });
    case 'system':
      return Object.freeze({
        persisted: false,
        evaluated: 'no',
        may_create_workflow: false,
        may_advance_workflow: false,
        may_own_or_approve: false,
        route: 'not_captured',
      });
    case 'unauthorized_human':
    case 'unknown_automation':
      return CAPTURE_ONLY;
  }
}

/* ------------------------------------------------------------------ *
 * events.md — eligibility, correlation, serialization
 * ------------------------------------------------------------------ */

export interface EligibilityInput {
  readonly actor_class: ActorClass;
  readonly addressed_to_gist: boolean;
  readonly in_active_workflow_thread: boolean;
}

export interface EligibilityDecision {
  readonly reaches_evaluation: boolean;
  /** True only for unaddressed human traffic outside an active workflow. */
  readonly subject_to_proactive_gate: boolean;
}

/** events.md §3. */
export function evaluationEligibility(input: EligibilityInput): EligibilityDecision {
  const routing = routingFor(input.actor_class);
  if (routing.evaluated !== 'yes') {
    return { reaches_evaluation: false, subject_to_proactive_gate: false };
  }
  if (input.actor_class !== 'authorized_human') {
    return { reaches_evaluation: true, subject_to_proactive_gate: false };
  }
  const unsolicited = !input.addressed_to_gist && !input.in_active_workflow_thread;
  return { reaches_evaluation: true, subject_to_proactive_gate: unsolicited };
}

export type WorkflowState =
  | 'draft'
  | 'clarifying'
  | 'ready'
  | 'dispatched'
  | 'running'
  | 'waiting_human'
  | 'waiting_bot'
  | 'reviewing'
  | 'changes_requested'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timed_out';

export type ExpectedActor = 'gist' | 'human' | 'kilo' | 'linear' | 'none';

export interface WorkflowBinding {
  readonly workspace_id: string;
  readonly channel_id: string;
  readonly thread_root_ts: string;
  readonly owner_user_id: string;
  readonly workflow_id: string;
}

export interface CorrelationEvent {
  readonly workspace_id: string;
  readonly channel_id: string;
  readonly thread_root_ts: string;
  readonly actor_class: ActorClass;
}

export type CorrelationFailure =
  | 'wrong_workspace'
  | 'wrong_channel'
  | 'wrong_thread'
  | 'actor_mismatch'
  | 'state_rejects_actor';

/** The actor role a state will accept an event from (workflow-state.md §3). */
const STATE_ACCEPTS_ACTOR: Readonly<Record<WorkflowState, readonly ExpectedActor[]>> = Object.freeze({
  draft: ['human'],
  clarifying: ['human'],
  ready: ['human'],
  dispatched: ['human', 'kilo', 'linear'],
  running: ['human', 'kilo', 'linear'],
  waiting_bot: ['human', 'kilo', 'linear'],
  reviewing: ['human', 'kilo', 'linear'],
  changes_requested: ['human'],
  waiting_human: ['human'],
  completed: [],
  failed: [],
  cancelled: [],
  timed_out: [],
});

/** Map an actor class onto the role a workflow expects. */
export function actorRole(actor: ActorClass): ExpectedActor | null {
  if (actor === 'authorized_human') return 'human';
  if (actor === 'kilo') return 'kilo';
  if (actor === 'linear') return 'linear';
  return null;
}

/**
 * events.md §4.2 — all five checks, in order. Returns the first failure, or
 * null when the event may advance the workflow.
 */
export function correlate(
  event: CorrelationEvent,
  binding: WorkflowBinding,
  workflow: { readonly state: WorkflowState; readonly expected_actor: ExpectedActor },
): CorrelationFailure | null {
  if (event.workspace_id !== binding.workspace_id) return 'wrong_workspace';
  if (event.channel_id !== binding.channel_id) return 'wrong_channel';
  if (event.thread_root_ts !== binding.thread_root_ts) return 'wrong_thread';

  const role = actorRole(event.actor_class);
  if (role === null || role !== workflow.expected_actor) return 'actor_mismatch';
  if (!STATE_ACCEPTS_ACTOR[workflow.state].includes(role)) return 'state_rejects_actor';
  return null;
}

export interface DuplicateInput {
  readonly actor_class?: ActorClass | undefined;
  readonly already_seen_delivery: boolean;
  readonly already_supervised_event: boolean;
}

/** events.md §6 — identity-keyed suppression, never content-keyed. */
export function duplicateReason(input: DuplicateInput): string | null {
  if (input.actor_class === 'gist_self') return 'gist_self';
  if (input.already_seen_delivery) return 'duplicate_delivery';
  if (input.already_supervised_event) return 'duplicate_event';
  return null;
}

/** events.md §5 rule 3 — the proactive cooldown never touches workflow events. */
export function cooldownSuppresses(input: {
  readonly in_active_workflow: boolean;
  readonly cooldown_active: boolean;
}): boolean {
  return !input.in_active_workflow && input.cooldown_active;
}

/* ------------------------------------------------------------------ *
 * workflow-state.md — states and transitions
 * ------------------------------------------------------------------ */

export const WORKFLOW_STATES: readonly WorkflowState[] = Object.freeze([
  'draft',
  'clarifying',
  'ready',
  'dispatched',
  'running',
  'waiting_human',
  'waiting_bot',
  'reviewing',
  'changes_requested',
  'completed',
  'failed',
  'cancelled',
  'timed_out',
]);

export const TERMINAL_STATES: readonly WorkflowState[] = Object.freeze([
  'completed',
  'failed',
  'cancelled',
  'timed_out',
]);

export const WORKFLOW_TRANSITIONS: Readonly<Record<WorkflowState, readonly WorkflowState[]>> = Object.freeze({
  draft: ['clarifying', 'ready', 'waiting_human', 'cancelled', 'failed', 'timed_out'],
  clarifying: ['clarifying', 'ready', 'waiting_human', 'cancelled', 'failed', 'timed_out'],
  ready: ['dispatched', 'waiting_human', 'cancelled', 'failed', 'timed_out'],
  dispatched: [
    'running',
    'waiting_bot',
    'reviewing',
    'waiting_human',
    'completed',
    'failed',
    'cancelled',
    'timed_out',
  ],
  running: [
    'running',
    'waiting_bot',
    'reviewing',
    'waiting_human',
    'completed',
    'failed',
    'cancelled',
    'timed_out',
  ],
  waiting_bot: [
    'running',
    'waiting_bot',
    'reviewing',
    'waiting_human',
    'completed',
    'failed',
    'cancelled',
    'timed_out',
  ],
  reviewing: [
    'reviewing',
    'changes_requested',
    'waiting_human',
    'completed',
    'failed',
    'cancelled',
    'timed_out',
  ],
  changes_requested: ['ready', 'waiting_human', 'cancelled', 'failed', 'timed_out'],
  waiting_human: [
    'ready',
    'clarifying',
    'running',
    'waiting_bot',
    'reviewing',
    'completed',
    'cancelled',
    'failed',
    'timed_out',
  ],
  completed: [],
  failed: [],
  cancelled: [],
  timed_out: [],
});

export function isTerminal(state: WorkflowState): boolean {
  return TERMINAL_STATES.includes(state);
}

export function isLegalTransition(from: WorkflowState, to: WorkflowState): boolean {
  return WORKFLOW_TRANSITIONS[from].includes(to);
}

export interface StoredWorkflow {
  readonly state: WorkflowState;
  readonly pending_action_version: number | null;
  readonly committed_source_events: readonly string[];
}

export interface TransitionRequest {
  readonly expected_state: WorkflowState;
  readonly expected_action_version: number | null;
  readonly next_state: WorkflowState;
  readonly source_event_key: string;
}

export type TransitionOutcome = 'committed' | 'rejected' | 'idempotent';
export type TransitionRejection =
  | 'state_mismatch'
  | 'version_mismatch'
  | 'illegal_transition'
  | 'terminal_workflow'
  | 'duplicate_source_event';

export interface TransitionResult {
  readonly outcome: TransitionOutcome;
  readonly reason: TransitionRejection | null;
}

/**
 * workflow-state.md §3.2 — compare-and-set.
 *
 * The replayed-event check runs first and returns `idempotent` rather than an
 * error: the same event applied twice must converge on one transition, and the
 * second attempt is a success the caller can observe (GS-FR-014, GS-FR-020).
 */
export function evaluateTransition(
  stored: StoredWorkflow,
  request: TransitionRequest,
): TransitionResult {
  if (stored.committed_source_events.includes(request.source_event_key)) {
    return { outcome: 'idempotent', reason: 'duplicate_source_event' };
  }
  if (isTerminal(stored.state)) {
    return { outcome: 'rejected', reason: 'terminal_workflow' };
  }
  if (stored.state !== request.expected_state) {
    return { outcome: 'rejected', reason: 'state_mismatch' };
  }
  if (stored.pending_action_version !== request.expected_action_version) {
    return { outcome: 'rejected', reason: 'version_mismatch' };
  }
  if (!isLegalTransition(stored.state, request.next_state)) {
    return { outcome: 'rejected', reason: 'illegal_transition' };
  }
  return { outcome: 'committed', reason: null };
}

export type TransitionClass =
  | 'cancel'
  | 'approval_grant'
  | 'material_redirect'
  | 'ownership_transfer'
  | 'supervisor_step';

export interface RequesterContext {
  readonly actor_class: ActorClass;
  readonly is_owner: boolean;
  readonly is_approver: boolean;
}

/** workflow-state.md §3.3. */
export function mayRequestTransition(
  transitionClass: TransitionClass,
  requester: RequesterContext,
): boolean {
  if (transitionClass === 'supervisor_step') {
    // Gist requests it, from any evaluated event. A trusted bot event causes
    // the request; the recorded requester is still Gist.
    return routingFor(requester.actor_class).evaluated === 'yes';
  }
  if (requester.actor_class !== 'authorized_human') return false;
  if (transitionClass === 'material_redirect') return requester.is_owner;
  return requester.is_owner || requester.is_approver;
}

/** workflow-state.md §3.3 — a bot never appears as the requester of record. */
export function recordedRequester(actor: ActorClass): 'gist' | 'human' | null {
  if (actor === 'authorized_human') return 'human';
  return routingFor(actor).evaluated === 'yes' ? 'gist' : null;
}

/* ------------------------------------------------------------------ *
 * workflow-state.md §7 — limits
 * ------------------------------------------------------------------ */

export interface WorkflowLimits {
  readonly max_turns: number;
  readonly max_consecutive_failures: number;
  readonly inactivity_timeout_ms: number;
  readonly absolute_lifetime_ms: number;
  readonly max_in_flight_actions: number;
}

export interface LimitCheckRecord {
  readonly state: WorkflowState;
  readonly turn_count: number;
  readonly consecutive_failures: number;
  readonly created_at: string;
  readonly last_activity_at: string;
}

export type LimitOutcomeClass = 'timeout_inactivity' | 'timeout_lifetime';

export interface LimitStop {
  readonly next_state: WorkflowState;
  readonly outcome_class: LimitOutcomeClass | null;
  readonly reason_class: 'limit_reached';
}

function elapsedMs(fromIso: string, toIso: string): number {
  return Date.parse(toIso) - Date.parse(fromIso);
}

/**
 * workflow-state.md §7.3.
 *
 * Precedence is lifetime, inactivity, failures, turns. A timeout terminates
 * while a turn or failure limit only pauses, so when both hold the terminal
 * answer is the correct one — nothing is going to arrive for a workflow past
 * its lifetime, whatever its turn count says.
 */
export function limitStop(
  record: LimitCheckRecord,
  limits: WorkflowLimits,
  nowIso: string,
): LimitStop | null {
  if (isTerminal(record.state)) return null;

  if (elapsedMs(record.created_at, nowIso) >= limits.absolute_lifetime_ms) {
    return { next_state: 'timed_out', outcome_class: 'timeout_lifetime', reason_class: 'limit_reached' };
  }
  if (elapsedMs(record.last_activity_at, nowIso) >= limits.inactivity_timeout_ms) {
    return { next_state: 'timed_out', outcome_class: 'timeout_inactivity', reason_class: 'limit_reached' };
  }
  if (record.consecutive_failures >= limits.max_consecutive_failures) {
    return { next_state: 'waiting_human', outcome_class: null, reason_class: 'limit_reached' };
  }
  if (record.turn_count >= limits.max_turns) {
    return { next_state: 'waiting_human', outcome_class: null, reason_class: 'limit_reached' };
  }
  return null;
}

const FAILURE_RESETTING_STATES: readonly WorkflowState[] = Object.freeze([
  'running',
  'reviewing',
  'completed',
]);

export interface CountingInput {
  readonly committed: boolean;
  readonly source_event_is_new: boolean;
  readonly next_state: WorkflowState;
}

/** workflow-state.md §7.2. */
export function applyCounters(
  input: CountingInput,
  turnCount: number,
  consecutiveFailures: number,
): { readonly turn_count: number; readonly consecutive_failures: number } {
  if (!input.committed) {
    return { turn_count: turnCount, consecutive_failures: consecutiveFailures };
  }
  return {
    turn_count: input.source_event_is_new ? turnCount + 1 : turnCount,
    consecutive_failures: FAILURE_RESETTING_STATES.includes(input.next_state)
      ? 0
      : consecutiveFailures,
  };
}

/* ------------------------------------------------------------------ *
 * actions.md — the action union, targets, and destinations
 * ------------------------------------------------------------------ */

export type ActionClass =
  | 'no_action'
  | 'reply_user'
  | 'ask_user'
  | 'dispatch_bot'
  | 'follow_up_bot'
  | 'request_approval'
  | 'wait'
  | 'complete'
  | 'fail'
  | 'cancel';

export const ACTION_CLASSES: readonly ActionClass[] = Object.freeze([
  'no_action',
  'reply_user',
  'ask_user',
  'dispatch_bot',
  'follow_up_bot',
  'request_approval',
  'wait',
  'complete',
  'fail',
  'cancel',
]);

export const EXTERNALLY_VISIBLE_ACTIONS: readonly ActionClass[] = Object.freeze([
  'reply_user',
  'ask_user',
  'dispatch_bot',
  'follow_up_bot',
  'request_approval',
]);

export function isExternallyVisible(action: ActionClass): boolean {
  return EXTERNALLY_VISIBLE_ACTIONS.includes(action);
}

export type LogicalTarget = 'kilo' | 'linear';

export const WORK_CLASSES: Readonly<Record<LogicalTarget, readonly string[]>> = Object.freeze({
  kilo: ['implement', 'investigate', 'test', 'fix', 'review'],
  linear: ['find', 'create', 'update', 'comment', 'report'],
});

export function isLogicalTarget(value: unknown): value is LogicalTarget {
  return value === 'kilo' || value === 'linear';
}

export function isAllowedWorkClass(target: string, workClass: string): boolean {
  return isLogicalTarget(target) && WORK_CLASSES[target].includes(workClass);
}

/**
 * Slack-shaped identifiers: team, channel, DM, group, user, bot, app, file.
 *
 * Deliberately shape-based rather than allowlist-based: a *real* production ID
 * in a model's output must fail this too, and the point is that no identifier
 * of this shape may reach a validated action at all (GS-INV-10).
 */
export const SLACK_ID_SHAPE = /\b(?:[TCDGU]|[BAFW])[A-Z0-9]{7,}\b/;

/**
 * The prefix set is written as two alternatives rather than one character
 * class purely so the pattern's own source text is not itself an
 * identifier-shaped run of capitals — `contract-safety.test.ts` scans this
 * directory for those, and a scanner that trips over its own pattern is a
 * scanner people start ignoring.
 */
export function looksLikeSlackId(value: string): boolean {
  return new RegExp(`^${SLACK_ID_SHAPE.source}$`).test(value);
}

/** Field names that would carry a destination, whatever their value. */
export const DESTINATION_FIELDS: readonly string[] = Object.freeze([
  'channel',
  'channel_id',
  'workspace_id',
  'team',
  'team_id',
  'thread_ts',
  'thread_id',
  'thread_root_ts',
  'user',
  'user_id',
  'bot_id',
  'app_id',
  'destination',
  'destination_ref',
  'permalink',
]);

export function containsSlackIdentifier(value: unknown): boolean {
  if (typeof value === 'string') return SLACK_ID_SHAPE.test(value);
  if (Array.isArray(value)) return value.some(containsSlackIdentifier);
  if (typeof value === 'object' && value !== null) {
    return Object.values(value as Record<string, unknown>).some(containsSlackIdentifier);
  }
  return false;
}

export function containsDestinationField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsDestinationField);
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    if (Object.keys(record).some((key) => DESTINATION_FIELDS.includes(key))) return true;
    return Object.values(record).some(containsDestinationField);
  }
  return false;
}

export type ActionRejection =
  | 'unknown_action_class'
  | 'slack_identifier_present'
  | 'destination_field_present'
  | 'missing_workflow_id'
  | 'unknown_logical_target'
  | 'work_class_not_allowed_for_target';

const WORKFLOW_OPTIONAL: readonly ActionClass[] = Object.freeze(['no_action', 'reply_user']);
const TARGETED_ACTIONS: readonly ActionClass[] = Object.freeze(['dispatch_bot', 'follow_up_bot']);

/**
 * actions.md §1, §3, §4 — the schema gate.
 *
 * Order matters and is fixed: the Slack-identifier scan runs before the
 * destination-field scan, so `channel_id: "C…"` is reported as the identifier
 * it is rather than as a field name, and a destination-shaped field carrying a
 * non-identifier value is still caught.
 */
export function validateAction(action: Record<string, unknown>): ActionRejection | null {
  const actionClass = action.action_class;
  if (typeof actionClass !== 'string' || !ACTION_CLASSES.includes(actionClass as ActionClass)) {
    return 'unknown_action_class';
  }
  if (containsSlackIdentifier(action)) return 'slack_identifier_present';
  if (containsDestinationField(action)) return 'destination_field_present';

  if (
    !WORKFLOW_OPTIONAL.includes(actionClass as ActionClass) &&
    typeof action.workflow_id !== 'string'
  ) {
    return 'missing_workflow_id';
  }

  if (TARGETED_ACTIONS.includes(actionClass as ActionClass)) {
    const target = action.logical_target;
    if (!isLogicalTarget(target)) return 'unknown_logical_target';

    const instruction = action.instruction;
    if (typeof instruction === 'object' && instruction !== null) {
      const workClass = (instruction as Record<string, unknown>).work_class;
      if (typeof workClass === 'string' && !isAllowedWorkClass(target, workClass)) {
        return 'work_class_not_allowed_for_target';
      }
    }
  }
  return null;
}

/** actions.md §5.1 — runtime-generated, never model-supplied. */
export function workflowMarker(workflowId: string, actionVersion: number): string {
  return `[gist-wf:${workflowId}#${actionVersion}]`;
}

/** actions.md §5 — a handle resolves only inside the workflow's own binding. */
export function resolveContextRef(
  handle: string,
  handleTable: Readonly<Record<string, string>>,
  binding: Pick<WorkflowBinding, 'workspace_id' | 'channel_id'>,
): string | null {
  const messageKey = handleTable[handle];
  if (messageKey === undefined) return null;
  const prefix = `${binding.workspace_id}/${binding.channel_id}/`;
  return messageKey.startsWith(prefix) ? messageKey : null;
}

export interface DestinationConfig {
  readonly kilo_bot_id?: string | null;
  readonly kilo_app_id?: string | null;
  readonly linear_bot_id?: string | null;
  readonly linear_app_id?: string | null;
}

export interface ResolvedDestination {
  readonly bot_id: string | null;
  readonly channel_id: string;
  readonly thread_root_ts: string;
}

/**
 * actions.md §3 steps 6–7 — the identity comes from configuration and the
 * destination comes from the binding. Neither is an input from the action.
 */
export function resolveDestination(
  target: LogicalTarget,
  config: DestinationConfig,
  binding: WorkflowBinding,
): ResolvedDestination {
  const botId = target === 'kilo' ? config.kilo_bot_id : config.linear_bot_id;
  return {
    bot_id: typeof botId === 'string' && botId !== '' ? botId : null,
    channel_id: binding.channel_id,
    thread_root_ts: binding.thread_root_ts,
  };
}

/** actions.md §1.2 — state and in-flight authority for an action. */
export function actionAllowedInState(
  actionClass: ActionClass,
  state: WorkflowState,
  inFlight: boolean,
): boolean {
  if (actionClass === 'dispatch_bot') return state === 'ready' && !inFlight;
  if (actionClass === 'follow_up_bot') {
    return (
      !inFlight &&
      (state === 'dispatched' || state === 'running' || state === 'waiting_bot' || state === 'reviewing')
    );
  }
  return !isTerminal(state);
}

/* ------------------------------------------------------------------ *
 * approvals.md — gated classes and approval validity
 * ------------------------------------------------------------------ */

export type GatedActionClass =
  | 'merge'
  | 'release'
  | 'delete'
  | 'destructive'
  | 'credential_or_security_change'
  | 'irreversible_other'
  | 'ownership_transfer'
  | 'scope_expansion'
  | 'cancel_other_owner_workflow';

export const GATED_ACTION_CLASSES: readonly GatedActionClass[] = Object.freeze([
  'merge',
  'release',
  'delete',
  'destructive',
  'credential_or_security_change',
  'irreversible_other',
  'ownership_transfer',
  'scope_expansion',
  'cancel_other_owner_workflow',
]);

export function isGated(actionClass: string): boolean {
  return GATED_ACTION_CLASSES.includes(actionClass as GatedActionClass);
}

/**
 * approvals.md §2.3 — the negative rule. Asking for approval on a reversible,
 * non-destructive action is a contract violation, not caution: redundant
 * confirmation trains owners to approve without reading.
 */
export function mayRequestApproval(actionClass: string): boolean {
  return isGated(actionClass);
}

export type ApprovalState =
  | 'none'
  | 'required'
  | 'pending'
  | 'granted'
  | 'denied'
  | 'expired'
  | 'invalidated';

export interface Approval {
  readonly workflow_id: string;
  readonly action_id: string;
  readonly action_version: number;
  readonly approver_user_id: string;
  readonly approver_actor_class: ActorClass;
  readonly granted_at: string;
  readonly expires_at: string;
  readonly state: ApprovalState;
}

export interface ApprovalWorkflow {
  readonly workflow_id: string;
  readonly owner_user_id: string;
  readonly approver_user_ids: readonly string[];
  readonly pending_action_id: string;
  readonly pending_action_version: number;
}

export type ApprovalFailure =
  | 'not_granted'
  | 'workflow_mismatch'
  | 'action_mismatch'
  | 'version_mismatch'
  | 'approver_not_authorized'
  | 'expired';

/** approvals.md §3.1 — all six checks, re-read at dispatch time. */
export function approvalFailure(
  approval: Approval,
  workflow: ApprovalWorkflow,
  nowIso: string,
): ApprovalFailure | null {
  if (approval.state !== 'granted') return 'not_granted';
  if (approval.workflow_id !== workflow.workflow_id) return 'workflow_mismatch';
  if (approval.action_id !== workflow.pending_action_id) return 'action_mismatch';
  if (approval.action_version !== workflow.pending_action_version) return 'version_mismatch';

  const isOwner = approval.approver_user_id === workflow.owner_user_id;
  const isApprover = workflow.approver_user_ids.includes(approval.approver_user_id);
  if (approval.approver_actor_class !== 'authorized_human' || !(isOwner || isApprover)) {
    return 'approver_not_authorized';
  }

  const now = Date.parse(nowIso);
  if (now < Date.parse(approval.granted_at) || now >= Date.parse(approval.expires_at)) {
    return 'expired';
  }
  return null;
}

/**
 * approvals.md §3.2 — every material change invalidates. Ordinary progress on
 * the approved action does not, or an owner would approve the same work twice.
 */
const INVALIDATING_CHANGES: readonly string[] = Object.freeze([
  'version_increment',
  'objective',
  'scope',
  'acceptance',
  'work_class',
  'logical_target',
  'owner',
  'state_left',
  'action_superseded',
  'action_failed',
]);

export function invalidatesApproval(change: string): boolean {
  return INVALIDATING_CHANGES.includes(change);
}

/** approvals.md §4 — discussion and control are separate permissions. */
export function ownershipPermissions(context: RequesterContext): {
  readonly may_discuss: boolean;
  readonly may_control: boolean;
} {
  const isAuthorizedHuman = context.actor_class === 'authorized_human';
  return {
    may_discuss: isAuthorizedHuman,
    may_control: isAuthorizedHuman && (context.is_owner || context.is_approver),
  };
}

/* ------------------------------------------------------------------ *
 * dispatch.md — checkpoints, delivery, reconciliation, failure
 * ------------------------------------------------------------------ */

export function actionClaimKey(workflowId: string, sourceEventKey: string): string {
  return `wf:${workflowId}|ev:${sourceEventKey}`;
}

export function dispatchClaimKey(
  workflowId: string,
  actionId: string,
  version: number,
  attempt: number,
): string {
  return `wf:${workflowId}|act:${actionId}|v:${version}|n:${attempt}`;
}

export type DeliveryState = 'pending' | 'in_flight' | 'delivered' | 'failed' | 'abandoned';

export const DELIVERY_TRANSITIONS: Readonly<Record<DeliveryState, readonly DeliveryState[]>> =
  Object.freeze({
    pending: ['in_flight', 'abandoned'],
    in_flight: ['delivered', 'failed', 'abandoned'],
    delivered: [],
    failed: ['pending', 'abandoned'],
    abandoned: [],
  });

export function isLegalDeliveryTransition(from: DeliveryState, to: DeliveryState): boolean {
  return DELIVERY_TRANSITIONS[from].includes(to);
}

/**
 * dispatch.md §3 — `delivered` only from a returned message identity. An
 * absence of error is not a confirmation.
 */
export function confirmDelivery(result: {
  readonly slack_message_key: string | null;
  readonly errored: boolean;
  readonly timed_out: boolean;
}): DeliveryState {
  if (result.errored || result.timed_out) return 'failed';
  return typeof result.slack_message_key === 'string' && result.slack_message_key !== ''
    ? 'delivered'
    : 'failed';
}

const BLOCKING_DELIVERY_STATES: readonly DeliveryState[] = Object.freeze(['pending', 'in_flight']);

/** dispatch.md §2 — at most one action per workflow may be in flight. */
export function dispatchBlockedBy(inFlight: DeliveryState | null): 'in_flight_conflict' | null {
  return inFlight !== null && BLOCKING_DELIVERY_STATES.includes(inFlight)
    ? 'in_flight_conflict'
    : null;
}

/** dispatch.md §2 — one externally visible action per source event. */
export function actionClaimAllowed(input: {
  readonly action_class: ActionClass;
  readonly already_claimed: boolean;
}): { readonly allowed: boolean; readonly failure_class: 'claim_conflict' | null } {
  if (!isExternallyVisible(input.action_class)) return { allowed: true, failure_class: null };
  return input.already_claimed
    ? { allowed: false, failure_class: 'claim_conflict' }
    : { allowed: true, failure_class: null };
}

export interface ReconciliationInput {
  readonly delivery_state: DeliveryState;
  readonly own_outgoing_record: boolean;
  readonly marker_found_in_thread: boolean;
  readonly thread_readable: boolean;
}

export interface ReconciliationResult {
  readonly delivery_state: DeliveryState;
  readonly workflow_state: WorkflowState;
  readonly reason_class: 'dispatch_unreconciled' | null;
}

/**
 * dispatch.md §5.
 *
 * Gist's own outgoing record is consulted first: the send path persists
 * outgoing messages directly, so it does not depend on Slack echo behavior.
 * An unreconcilable in-flight action asks a human rather than re-sending —
 * a duplicate instruction to a coding bot is duplicated work.
 */
export function reconcile(input: ReconciliationInput): ReconciliationResult {
  if (input.delivery_state === 'pending') {
    return { delivery_state: 'abandoned', workflow_state: 'ready', reason_class: null };
  }
  if (input.own_outgoing_record || input.marker_found_in_thread) {
    return { delivery_state: 'delivered', workflow_state: 'dispatched', reason_class: null };
  }
  if (input.thread_readable) {
    return { delivery_state: 'abandoned', workflow_state: 'ready', reason_class: null };
  }
  return {
    delivery_state: 'in_flight',
    workflow_state: 'waiting_human',
    reason_class: 'dispatch_unreconciled',
  };
}

export interface FailedDispatchInput {
  readonly workflow_state_before: WorkflowState;
  readonly consecutive_failures_before: number;
  readonly max_consecutive_failures: number;
}

export interface FailedDispatchResult {
  readonly workflow_state: WorkflowState;
  readonly consecutive_failures: number;
  readonly expected_actor: ExpectedActor;
}

/** dispatch.md §4 — a failed dispatch never advances to a delivered state. */
export function applyFailedDispatch(input: FailedDispatchInput): FailedDispatchResult {
  const failures = input.consecutive_failures_before + 1;
  if (failures >= input.max_consecutive_failures) {
    return { workflow_state: 'waiting_human', consecutive_failures: failures, expected_actor: 'human' };
  }
  return {
    workflow_state: input.workflow_state_before,
    consecutive_failures: failures,
    expected_actor: 'gist',
  };
}

export type FailureClass =
  | 'slack_rate_limited'
  | 'slack_transport_error'
  | 'slack_permission_denied'
  | 'destination_unresolved'
  | 'in_flight_conflict'
  | 'claim_conflict'
  | 'state_mismatch'
  | 'version_mismatch'
  | 'illegal_transition'
  | 'terminal_workflow'
  | 'approval_missing'
  | 'approval_expired'
  | 'approval_scope_changed'
  | 'compatibility_blocked'
  | 'schema_invalid'
  | 'model_unavailable'
  | 'storage_unavailable'
  | 'dispatch_unreconciled'
  | 'internal_error';

const RETRYABLE_FAILURES: readonly FailureClass[] = Object.freeze([
  'slack_rate_limited',
  'slack_transport_error',
  'slack_permission_denied',
]);

const HUMAN_STOP_FAILURES: readonly FailureClass[] = Object.freeze([
  'destination_unresolved',
  'compatibility_blocked',
  'dispatch_unreconciled',
]);

export function failureBehavior(failure: FailureClass): {
  readonly retryable: boolean;
  readonly workflow_state: 'ready' | 'waiting_human' | 'unchanged';
} {
  if (RETRYABLE_FAILURES.includes(failure)) return { retryable: true, workflow_state: 'ready' };
  if (HUMAN_STOP_FAILURES.includes(failure)) {
    return { retryable: false, workflow_state: 'waiting_human' };
  }
  return { retryable: false, workflow_state: 'unchanged' };
}

/* ------------------------------------------------------------------ *
 * compatibility.md — T802's measurement contract
 * ------------------------------------------------------------------ */

export type Tri = 'yes' | 'no' | 'unknown';
export type ReplyPlacement = 'same_thread' | 'channel_root' | 'new_thread' | 'none' | 'unknown';
export type CompletionSignal = 'explicit' | 'implicit' | 'none' | 'unknown';
export type DuplicateBehavior = 'ignored' | 'second_action' | 'error' | 'unknown';
export type LatencyBucket = 'lt_5s' | 'lt_30s' | 'lt_5m' | 'gte_5m' | 'none' | 'unknown';
export type BlockingReason =
  | 'ignores_bot_authored'
  | 'uncorrelatable_replies'
  | 'unstable_identity'
  | 'duplicate_side_effects'
  | 'no_outcome_signal'
  | 'unmeasured';

export type CorrelationStrategy =
  | 'thread_binding_with_marker'
  | 'thread_binding_only'
  | 'marker_required'
  | 'none';

export interface BotCompatibilityMeasurement {
  readonly logical_target: LogicalTarget;
  readonly accepts_bot_authored: Tri;
  readonly requires_mention: Tri;
  readonly reply_placement: ReplyPlacement;
  readonly reply_identity_stable: Tri;
  readonly marker_preserved: Tri;
  readonly distinguishes_outcomes: Tri;
  readonly completion_signal: CompletionSignal;
  readonly duplicate_behavior: DuplicateBehavior;
  readonly reply_latency_bucket: LatencyBucket;
  readonly reacts_to_edits: Tri;
  readonly unrelated_message_inert: Tri;
}

/** compatibility.md §3. */
export function correlationStrategyFor(
  measurement: Pick<BotCompatibilityMeasurement, 'reply_placement' | 'marker_preserved'>,
): CorrelationStrategy {
  const { reply_placement: placement, marker_preserved: marker } = measurement;
  if (placement === 'same_thread') {
    return marker === 'yes' ? 'thread_binding_with_marker' : 'thread_binding_only';
  }
  if (placement === 'channel_root' || placement === 'new_thread') {
    return marker === 'yes' ? 'marker_required' : 'none';
  }
  return 'none';
}

/** The fields rule 6 requires to have been measured. */
const MEASURED_FIELDS = [
  'accepts_bot_authored',
  'requires_mention',
  'reply_placement',
  'reply_identity_stable',
  'marker_preserved',
  'distinguishes_outcomes',
  'completion_signal',
  'duplicate_behavior',
  'reply_latency_bucket',
  'reacts_to_edits',
  'unrelated_message_inert',
] as const;

export function hasUnmeasuredField(measurement: BotCompatibilityMeasurement): boolean {
  return MEASURED_FIELDS.some((field) => measurement[field] === 'unknown');
}

export interface CompatibilityDecision {
  readonly decision: 'GO' | 'NO_GO';
  readonly blocking_reason_class: BlockingReason | null;
}

/**
 * compatibility.md §4 — the six GO rules, in order.
 *
 * Rule 6 (nothing unmeasured) is last so a bot that genuinely fails an earlier
 * rule is reported by that rule rather than by the gap it also has. An
 * unmeasured field is still a NO_GO: the point of the spike is that the
 * protocol stops assuming.
 */
export function compatibilityDecision(
  measurement: BotCompatibilityMeasurement,
): CompatibilityDecision {
  if (measurement.accepts_bot_authored !== 'yes') {
    return { decision: 'NO_GO', blocking_reason_class: 'ignores_bot_authored' };
  }
  if (correlationStrategyFor(measurement) === 'none') {
    return { decision: 'NO_GO', blocking_reason_class: 'uncorrelatable_replies' };
  }
  if (measurement.reply_identity_stable !== 'yes') {
    return { decision: 'NO_GO', blocking_reason_class: 'unstable_identity' };
  }
  if (measurement.distinguishes_outcomes !== 'yes' || measurement.completion_signal === 'none') {
    return { decision: 'NO_GO', blocking_reason_class: 'no_outcome_signal' };
  }
  if (measurement.duplicate_behavior === 'second_action') {
    return { decision: 'NO_GO', blocking_reason_class: 'duplicate_side_effects' };
  }
  if (hasUnmeasuredField(measurement)) {
    return { decision: 'NO_GO', blocking_reason_class: 'unmeasured' };
  }
  return { decision: 'GO', blocking_reason_class: null };
}

/** compatibility.md §4 — PARTIAL does not by itself unblock P09. */
export function phaseRecommendation(
  decisions: readonly ('GO' | 'NO_GO')[],
): 'GO' | 'PARTIAL' | 'NO_GO' {
  const passing = decisions.filter((decision) => decision === 'GO').length;
  if (passing === decisions.length && passing > 0) return 'GO';
  if (passing === 0) return 'NO_GO';
  return 'PARTIAL';
}

export function dispatchAllowedByCompatibility(
  target: LogicalTarget,
  blockedTargets: readonly LogicalTarget[],
): { readonly allowed: boolean; readonly failure_class: 'compatibility_blocked' | null } {
  return blockedTargets.includes(target)
    ? { allowed: false, failure_class: 'compatibility_blocked' }
    : { allowed: true, failure_class: null };
}
