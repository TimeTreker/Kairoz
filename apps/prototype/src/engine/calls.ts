// Integration calls (集成征集): release management of a whole-vehicle integration version, the way
// vehicle software is integrated, with DCL policy versions as the deliverables. Integration opens
// a call for a target version; each module (a leaf business group, or a domain integration
// workspace that integrates several groups first) submits its version or says nothing changed;
// once the list is complete, integration merges the submissions, DCL confirms the processing set
// and the frozen candidate is the round's test integration version (测试集成版本). A failed round
// sends modules back; the passing round is published by configuration release as a policy set
// listed for the target version. Every merge, processing, test and release gate is the existing one.

import { conflict, notFound, rule } from '../domain/errors.ts';
import { newId } from '../domain/ids.ts';
import type { Domain, Scope } from '../domain/vocabulary.ts';
import { todayOf } from './clock.ts';
import type { Ctx } from './engine.ts';
import { softwareKey } from './fleet.ts';
import { closeCandidate, collectibleSubsystems, defaultScope, isCollectible, isMergeWorkspace, previewMerge, verifiedSources } from './integration.ts';
import { getWorkspace } from './org.ts';
import { releaseWorkspace } from './emergency.ts';
import { compareVersions, setInEffect } from './release.ts';
import type { Candidate, CallModule, CallModuleEvent, DclModule, IntegrationCall, MergePlan, State } from './types.ts';

const VERSION = /^[0-9]+(\.[0-9]+){0,3}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function getCall(s: State, id: string): IntegrationCall {
  const c = s.integrationCalls[id];
  if (!c) throw notFound('integration call', id);
  return c;
}

/** Calls of a vehicle model, newest first. */
export function callsOf(s: State, vehicleModelId: string): IntegrationCall[] {
  return Object.values(s.integrationCalls)
    .filter((c) => c.vehicleModelId === vehicleModelId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

/** Calls a workspace runs, takes part in as a module, or answers with a domain call. */
export function callsFor(s: State, workspaceId: string): IntegrationCall[] {
  const ws = s.workspaces[workspaceId];
  if (!ws) return [];
  return callsOf(s, ws.vehicleModelId).filter((c) => c.workspaceId === workspaceId || c.modules.some((m) => m.workspaceId === workspaceId));
}

/**
 * The modules a call in this workspace collects by default: each business group of a team
 * workspace it takes as source (a leaf), and each domain an integration workspace among its
 * sources integrates (an upper node). A domain call collects the groups of its domain.
 */
export function defaultModules(s: State, workspaceId: string, scope: Scope): Omit<CallModule, 'status' | 'history'>[] {
  const ws = s.workspaces[workspaceId];
  if (!ws) return [];
  const out = new Map<string, Omit<CallModule, 'status' | 'history'>>();
  const blank = { featureId: null, commitId: null, subsystemReleaseId: null, by: null, at: null, note: null, remindedAt: null };
  for (const id of ws.sourceWorkspaceIds) {
    const src = s.workspaces[id];
    if (!src || src.status !== 'ACTIVE' || src.vehicleModelId !== ws.vehicleModelId) continue;
    if (src.kind === 'TEAM') {
      for (const groupId of src.groupIds) {
        const g = s.groups[groupId];
        if (!g || g.status !== 'ACTIVE' || (scope !== 'Vehicle' && g.domain !== scope)) continue;
        if (!out.has(groupId)) out.set(groupId, { key: groupId, kind: 'GROUP', groupId, domain: null, workspaceId: src.id, ...blank });
      }
    } else if (scope === 'Vehicle') {
      for (const d of src.scopes.filter((x) => x !== 'Vehicle')) {
        const key = `domain:${d}`;
        if (!out.has(key)) out.set(key, { key, kind: 'DOMAIN', groupId: null, domain: d as Domain, workspaceId: src.id, ...blank });
      }
    }
  }
  return [...out.values()];
}

/** The module's name for messages: the group code, or the domain. */
export function moduleName(s: State, m: Pick<CallModule, 'kind' | 'groupId' | 'domain'>): string {
  return m.kind === 'GROUP' ? (s.groups[m.groupId!]?.code ?? m.groupId!) : m.domain!;
}

/** The round still running: previewed or frozen, not cancelled, released or lost to another preview. */
export function openRound(s: State, call: IntegrationCall) {
  const r = call.rounds.at(-1);
  if (!r || r.outcome !== 'OPEN') return null;
  if (!r.candidateId && s.mergePlans[r.planId]?.status === 'SUPERSEDED') return null;
  if (r.candidateId && s.candidates[r.candidateId]?.status === 'CANCELLED') return null;
  return r;
}

/** Whether a submitted module's version changed since: a Feature with a newer commit, a replaced subsystem release. */
export function isStale(s: State, m: CallModule): boolean {
  if (m.status !== 'SUBMITTED') return false;
  if (m.featureId) {
    const f = s.features[m.featureId];
    return !f || !isCollectible(s, f) || f.headCommitId !== m.commitId;
  }
  return !!m.subsystemReleaseId && s.subsystemReleases[m.subsystemReleaseId]?.status !== 'ACTIVE';
}

/** Why a call's submissions cannot be merged yet; empty when the list is complete and current. */
export function callProblems(s: State, call: IntegrationCall): string[] {
  const problems: string[] = [];
  for (const m of call.modules) {
    const name = moduleName(s, m);
    if (m.status === 'WAITING') problems.push(`${name}: not submitted`);
    if (m.status === 'RETURNED') problems.push(`${name}: returned, waiting for a new submission`);
    if (isStale(s, m)) problems.push(`${name}: its submission changed since; submit it again`);
  }
  if (problems.length === 0 && !call.modules.some((m) => m.status === 'SUBMITTED')) problems.push('no module changed anything');
  return problems;
}

export type CallPhase = 'COLLECTING' | 'COMPLETE' | 'MERGING' | 'TESTING' | 'PASSED' | 'RELEASED' | 'CANCELLED' | 'NO_CHANGE';

/** Where a call stands, from its modules and its current round. */
export function callPhase(s: State, call: IntegrationCall): CallPhase {
  if (call.status !== 'OPEN') return call.status;
  const round = openRound(s, call);
  if (round?.candidateId) return s.candidates[round.candidateId]?.status === 'VERIFIED' ? 'PASSED' : 'TESTING';
  if (round) return 'MERGING';
  return callProblems(s, call).length === 0 ? 'COMPLETE' : 'COLLECTING';
}

/** The name of a round's test integration version, e.g. "X89 1.2-T2" or "X89 1.2 ADC-T1". */
export function roundLabel(s: State, call: IntegrationCall, planId: string): string {
  const frozen = call.rounds.filter((r) => r.candidateId).length;
  const index = call.rounds.findIndex((r) => r.planId === planId);
  const n = index >= 0 && call.rounds[index]!.candidateId ? call.rounds.slice(0, index + 1).filter((r) => r.candidateId).length : frozen + 1;
  return `${call.vehicleModelId} ${call.targetVersion}${call.scope === 'Vehicle' ? '' : ` ${call.scope}`}-T${n}`;
}

function allowManage(ctx: Ctx, call: Pick<IntegrationCall, 'id' | 'workspaceId' | 'scope'>): void {
  ctx.allow('call.manage', { type: 'call', id: call.id, workspaceId: call.workspaceId, scope: call.scope });
}

function assertOpen(call: IntegrationCall): void {
  if (call.status !== 'OPEN') throw rule('CALL_CLOSED', `the call for ${call.targetVersion} is closed`);
}

function event(ctx: Ctx, kind: CallModuleEvent['kind'], note: string | null, x: Partial<Pick<CallModuleEvent, 'featureId' | 'commitId' | 'subsystemReleaseId'>> = {}): CallModuleEvent {
  return { kind, by: ctx.user().username, at: ctx.now, note, featureId: x.featureId ?? null, commitId: x.commitId ?? null, subsystemReleaseId: x.subsystemReleaseId ?? null };
}

/**
 * Opens a call for a target whole-vehicle integration version (or, in a domain integration
 * workspace, a domain call answering a whole-vehicle call). A target the model has not recorded
 * yet is planned: its manifest is copied from the base version until the software is released.
 */
export function openCall(
  ctx: Ctx,
  input: { workspaceId: string; targetVersion?: string; title?: string; baseVersion?: string | null; dueDate?: string | null; parentCallId?: string | null; exclude?: string[]; scope?: Scope },
): string {
  const ws = getWorkspace(ctx.s, input.workspaceId);
  const scope = input.scope ?? defaultScope(ws);
  const id = newId('ic');
  allowManage(ctx, { id, workspaceId: ws.id, scope });
  if (!isMergeWorkspace(ctx.s, ws.id)) throw rule('NOT_A_MERGE_WORKSPACE', 'calls run where merges run: a project workspace, or an integration workspace with team sources');
  if (!ws.scopes.includes(scope)) throw rule('SCOPE_OUTSIDE_WORKSPACE', `this workspace integrates ${ws.scopes.join(', ')}, not ${scope}`);
  let parent: IntegrationCall | null = null;
  if (scope !== 'Vehicle') {
    if (!input.parentCallId) throw rule('PARENT_CALL_REQUIRED', 'a domain call answers a whole-vehicle call');
    parent = getCall(ctx.s, input.parentCallId);
    assertOpen(parent);
    if (!parent.modules.some((m) => m.kind === 'DOMAIN' && m.domain === scope && m.workspaceId === ws.id)) throw rule('NOT_A_CALL_MODULE', `the call for ${parent.targetVersion} does not collect ${scope} from this workspace`);
    const child = Object.values(ctx.s.integrationCalls).find((c) => c.parentCallId === parent!.id && c.scope === scope && c.status === 'OPEN');
    if (child) throw conflict('CALL_EXISTS', `the ${scope} call for ${parent.targetVersion} is already open`);
  } else if (input.parentCallId) {
    throw rule('PARENT_CALL_REQUIRED', 'only a domain call answers another call');
  }
  const target = (parent?.targetVersion ?? input.targetVersion ?? '').trim();
  if (!VERSION.test(target)) throw rule('INVALID_VERSION', 'versions look like 1.2 or 1.2.3');
  const dueDate = input.dueDate?.trim() || null;
  if (dueDate && (!DATE.test(dueDate) || dueDate < todayOf(ctx.s))) throw rule('INVALID_DUE_DATE', 'the due date is a day from today on, YYYY-MM-DD');
  if (scope === 'Vehicle') {
    const open = Object.values(ctx.s.integrationCalls).find((c) => c.vehicleModelId === ws.vehicleModelId && c.scope === 'Vehicle' && c.status === 'OPEN' && c.targetVersion === target);
    if (open) throw conflict('CALL_EXISTS', `a call for ${ws.vehicleModelId} ${target} is already open`);
    if (Object.values(ctx.s.releases).some((r) => r.vehicleModelId === ws.vehicleModelId && r.vehicleIntegrationVersions.includes(target))) {
      throw rule('VERSION_RELEASED', `${ws.vehicleModelId} ${target} already has a policy set published for it`);
    }
  }
  const exclude = new Set(input.exclude ?? []);
  const modules: CallModule[] = defaultModules(ctx.s, ws.id, scope).map((m) =>
    exclude.has(m.key) ? { ...m, status: 'EXCLUDED', by: ctx.user().username, at: ctx.now, note: null, history: [event(ctx, 'EXCLUDED', null)] } : { ...m, status: 'WAITING', history: [] },
  );
  if (!modules.some((m) => m.status === 'WAITING')) throw rule('NO_MODULES', 'a call needs at least one module taking part');

  let baseVersion: string | null = null;
  if (scope === 'Vehicle') {
    const key = softwareKey(ws.vehicleModelId, target);
    const recorded = Object.values(ctx.s.softwareVersions)
      .filter((v) => v.vehicleModelId === ws.vehicleModelId && v.status === 'RECORDED')
      .sort((a, b) => compareVersions(b.version, a.version));
    const existing = ctx.s.softwareVersions[key];
    if (!existing) {
      const base = input.baseVersion ? recorded.find((v) => v.version === input.baseVersion) : recorded[0];
      if (input.baseVersion && !base) throw rule('UNKNOWN_SOFTWARE_VERSION', `${ws.vehicleModelId} ${input.baseVersion} is not a recorded software version`);
      baseVersion = base?.version ?? null;
      const manifest = base?.manifest ? { signals: [...base.manifest.signals], sources: base.manifest.sources.map((x) => ({ ...x })) } : null;
      ctx.s.softwareVersions[key] = { vehicleModelId: ws.vehicleModelId, version: target, source: '', manifest, status: 'PLANNED', callId: id, dclModule: null, recordedBy: ctx.user().username, createdAt: ctx.now };
    } else if (existing.status === 'PLANNED') {
      existing.callId = id; // a planned version left by a closed call is taken over
    }
  }
  ctx.s.integrationCalls[id] = {
    id,
    vehicleModelId: ws.vehicleModelId,
    workspaceId: ws.id,
    scope,
    parentCallId: parent?.id ?? null,
    targetVersion: target,
    title: input.title?.trim() || `${ws.vehicleModelId} ${target}${scope === 'Vehicle' ? '' : ` · ${scope}`}`,
    baseVersion,
    dueDate,
    modules,
    rounds: [],
    status: 'OPEN',
    releaseId: null,
    subsystemReleaseId: null,
    note: null,
    createdBy: ctx.user().username,
    createdAt: ctx.now,
    closedBy: null,
    closedAt: null,
  };
  return id;
}

function getModule(call: IntegrationCall, key: string): CallModule {
  const m = call.modules.find((x) => x.key === key);
  if (!m) throw rule('NOT_A_CALL_MODULE', `${key} is not a module of the call for ${call.targetVersion}`);
  return m;
}

function setSubmission(ctx: Ctx, m: CallModule, x: { featureId?: string; commitId?: string; subsystemReleaseId?: string } | null, note: string | null): void {
  m.status = x ? 'SUBMITTED' : 'NO_CHANGE';
  m.featureId = x?.featureId ?? null;
  m.commitId = x?.commitId ?? null;
  m.subsystemReleaseId = x?.subsystemReleaseId ?? null;
  m.by = ctx.user().username;
  m.at = ctx.now;
  m.note = note;
  m.history.push(event(ctx, x ? 'SUBMITTED' : 'NO_CHANGE', note, x ?? {}));
}

/**
 * A leaf group's developers submit the group's version: one of its Verified Features (the
 * commit it was verified at), or no change, keeping the group as the target set has it.
 */
export function submitGroup(ctx: Ctx, callId: string, groupId: string, input: { featureId?: string | null; note?: string }): void {
  const call = ctx.s.integrationCalls[callId];
  if (!call) throw notFound('integration call', callId);
  const m = getModule(call, groupId);
  if (m.kind !== 'GROUP') throw rule('NOT_A_CALL_MODULE', `${groupId} is not a group module`);
  ctx.allow('call.submitGroup', { type: 'call', id: call.id, workspaceId: m.workspaceId, groupId });
  assertOpen(call);
  if (m.status === 'EXCLUDED') throw rule('MODULE_EXCLUDED', `${moduleName(ctx.s, m)} does not take part in this call`);
  const note = input.note?.trim() || null;
  if (!input.featureId) return setSubmission(ctx, m, null, note);
  const f = ctx.s.features[input.featureId];
  if (!f) throw notFound('feature', input.featureId);
  if (f.groupId !== groupId) throw rule('SOURCE_NOT_ALLOWED', `${f.name} belongs to another group`);
  if (!verifiedSources(ctx.s, call.workspaceId, call.scope).some((x) => x.id === f.id)) throw rule('FEATURE_NOT_COLLECTIBLE', `${f.name} is not a Verified Feature this call can collect`);
  setSubmission(ctx, m, { featureId: f.id, commitId: f.headCommitId! }, note);
}

/**
 * A domain's admin or configuration integration submits the domain's version: its active
 * subsystem release, or no change. A domain call's release is submitted by itself.
 */
export function submitDomain(ctx: Ctx, callId: string, domain: Domain, input: { subsystemReleaseId?: string | null; note?: string }): void {
  const call = ctx.s.integrationCalls[callId];
  if (!call) throw notFound('integration call', callId);
  const m = getModule(call, `domain:${domain}`);
  ctx.allow('call.submitDomain', { type: 'call', id: call.id, workspaceId: m.workspaceId, scope: domain });
  assertOpen(call);
  if (m.status === 'EXCLUDED') throw rule('MODULE_EXCLUDED', `${domain} does not take part in this call`);
  const note = input.note?.trim() || null;
  if (!input.subsystemReleaseId) return setSubmission(ctx, m, null, note);
  const r = ctx.s.subsystemReleases[input.subsystemReleaseId];
  if (!r) throw notFound('subsystem release', input.subsystemReleaseId);
  if (r.workspaceId !== m.workspaceId || r.domain !== domain || !collectibleSubsystems(ctx.s, call.workspaceId).some((x) => x.id === r.id)) {
    throw rule('SOURCE_NOT_ALLOWED', `${r.label} is not an active ${domain} subsystem release of this workspace`);
  }
  setSubmission(ctx, m, { subsystemReleaseId: r.id }, note);
}

/** Reminds modules that have not answered (催办); each reminder raises a new notification. */
export function remindModules(ctx: Ctx, callId: string, keys?: string[]): number {
  const call = getCall(ctx.s, callId);
  allowManage(ctx, call);
  assertOpen(call);
  const draft = ctx.s.integrationCalls[call.id]!;
  const waiting = draft.modules.filter((m) => (m.status === 'WAITING' || m.status === 'RETURNED') && (!keys || keys.includes(m.key)));
  if (waiting.length === 0) throw rule('NOTHING_TO_REMIND', 'every module has answered');
  for (const m of waiting) {
    m.remindedAt = ctx.now;
    m.history.push(event(ctx, 'REMINDED', null));
  }
  return waiting.length;
}

/** Closes the running round: its preview is set aside, its test integration version cancelled. */
function closeRound(ctx: Ctx, call: IntegrationCall, reason: string): void {
  const round = openRound(ctx.s, call);
  const draft = ctx.s.integrationCalls[call.id]!;
  const last = draft.rounds.at(-1);
  if (last && last.outcome === 'OPEN') {
    last.outcome = 'CANCELLED';
    last.reason = reason;
    last.closedBy = ctx.user().username;
    last.closedAt = ctx.now;
  }
  if (!round) return;
  if (round.candidateId) {
    const c = ctx.s.candidates[round.candidateId]!;
    if (['CANDIDATE', 'TESTING', 'VERIFIED'].includes(c.status)) closeCandidate(ctx, c);
  } else {
    const plan = ctx.s.mergePlans[round.planId];
    if (plan && ['READY', 'CONFLICT', 'BLOCKED'].includes(plan.status)) plan.status = 'SUPERSEDED';
  }
}

/**
 * Sends modules back (退回), with a reason: they submit again. A running round is closed, its
 * test integration version cancelled; the next round merges the new submissions.
 */
export function returnModules(ctx: Ctx, callId: string, keys: string[], reason: string): void {
  const call = getCall(ctx.s, callId);
  allowManage(ctx, call);
  assertOpen(call);
  const why = reason.trim();
  if (!why) throw rule('REASON_REQUIRED', 'say what the modules must change');
  if (keys.length === 0) throw rule('NO_MODULES', 'choose the modules to send back');
  const draft = ctx.s.integrationCalls[call.id]!;
  const modules = keys.map((k) => getModule(draft, k));
  for (const m of modules) if (m.status !== 'SUBMITTED' && m.status !== 'NO_CHANGE') throw rule('NOTHING_SUBMITTED', `${moduleName(ctx.s, m)} has nothing submitted to send back`);
  closeRound(ctx, call, why);
  for (const m of modules) {
    m.status = 'RETURNED';
    m.featureId = null;
    m.commitId = null;
    m.subsystemReleaseId = null;
    m.by = ctx.user().username;
    m.at = ctx.now;
    m.note = why;
    m.history.push(event(ctx, 'RETURNED', why));
  }
}

/** Leaves a module out of this call (不参加), with a reason; the target set keeps its version. */
export function excludeModule(ctx: Ctx, callId: string, key: string, reason: string): void {
  const call = getCall(ctx.s, callId);
  allowManage(ctx, call);
  assertOpen(call);
  const why = reason.trim();
  if (!why) throw rule('REASON_REQUIRED', 'say why the module does not take part');
  const m = getModule(ctx.s.integrationCalls[call.id]!, key);
  if (m.status === 'EXCLUDED') throw rule('MODULE_EXCLUDED', `${moduleName(ctx.s, m)} already does not take part`);
  if (call.modules.filter((x) => x.status !== 'EXCLUDED').length === 1) throw rule('NO_MODULES', 'a call needs at least one module taking part');
  m.status = 'EXCLUDED';
  m.featureId = null;
  m.commitId = null;
  m.subsystemReleaseId = null;
  m.by = ctx.user().username;
  m.at = ctx.now;
  m.note = why;
  m.history.push(event(ctx, 'EXCLUDED', why));
}

/** Changes the target version before any round was frozen (test evidence is bound to it after). */
export function retargetCall(ctx: Ctx, callId: string, version: string): void {
  const call = getCall(ctx.s, callId);
  allowManage(ctx, call);
  assertOpen(call);
  if (call.scope !== 'Vehicle') throw rule('PARENT_CALL_REQUIRED', 'a domain call follows its whole-vehicle call’s target');
  if (call.rounds.some((r) => r.candidateId)) throw rule('TARGET_FIXED', 'a round was frozen for this target; its tests are bound to it');
  const target = version.trim();
  if (!VERSION.test(target)) throw rule('INVALID_VERSION', 'versions look like 1.2 or 1.2.3');
  if (target === call.targetVersion) return;
  if (Object.values(ctx.s.integrationCalls).some((c) => c.id !== call.id && c.vehicleModelId === call.vehicleModelId && c.scope === 'Vehicle' && c.status === 'OPEN' && c.targetVersion === target)) {
    throw conflict('CALL_EXISTS', `a call for ${call.vehicleModelId} ${target} is already open`);
  }
  const oldKey = softwareKey(call.vehicleModelId, call.targetVersion);
  const old = ctx.s.softwareVersions[oldKey];
  const newKey = softwareKey(call.vehicleModelId, target);
  if (!ctx.s.softwareVersions[newKey]) {
    ctx.s.softwareVersions[newKey] = old && old.status === 'PLANNED' && old.callId === call.id
      ? { ...old, version: target, manifest: old.manifest ? { signals: [...old.manifest.signals], sources: old.manifest.sources.map((x) => ({ ...x })) } : null, createdAt: ctx.now }
      : { vehicleModelId: call.vehicleModelId, version: target, source: '', manifest: null, status: 'PLANNED', callId: call.id, dclModule: null, recordedBy: ctx.user().username, createdAt: ctx.now };
  }
  // A planned version nothing runs yet goes with its call; one already in use stays planned.
  const used = Object.values(ctx.s.resources).some((r) => r.vehicleModelId === call.vehicleModelId && r.integrationVersion === call.targetVersion)
    || Object.values(ctx.s.images).some((i) => i.vehicleModelId === call.vehicleModelId && i.integrationVersion === call.targetVersion);
  if (old && old.status === 'PLANNED' && old.callId === call.id && !used) delete ctx.s.softwareVersions[oldKey];
  for (const child of Object.values(ctx.s.integrationCalls)) if (child.parentCallId === call.id && child.status === 'OPEN') child.targetVersion = target;
  const draft = ctx.s.integrationCalls[call.id]!;
  if (draft.title === `${call.vehicleModelId} ${call.targetVersion}`) draft.title = `${call.vehicleModelId} ${target}`;
  draft.targetVersion = target;
}

/** Cancels a call (and its open domain calls); its running round closes. A planned target stays planned. */
export function cancelCall(ctx: Ctx, callId: string, reason: string): void {
  const call = getCall(ctx.s, callId);
  allowManage(ctx, call);
  assertOpen(call);
  const why = reason.trim();
  if (!why) throw rule('REASON_REQUIRED', 'give a reason');
  for (const c of [call, ...Object.values(ctx.s.integrationCalls).filter((x) => x.parentCallId === call.id && x.status === 'OPEN')]) {
    closeRound(ctx, c, why);
    const draft = ctx.s.integrationCalls[c.id]!;
    draft.status = 'CANCELLED';
    draft.note = why;
    draft.closedBy = ctx.user().username;
    draft.closedAt = ctx.now;
  }
}

/**
 * Closes a call in which every module said nothing changed (本次无变更). A domain call answers its
 * whole-vehicle call with no change; a whole-vehicle target keeps its current set, confirmed for
 * the software by an applicability check once it is released.
 */
export function closeUnchanged(ctx: Ctx, callId: string, note?: string): void {
  const call = getCall(ctx.s, callId);
  allowManage(ctx, call);
  assertOpen(call);
  const open = call.modules.filter((m) => m.status === 'WAITING' || m.status === 'RETURNED' || m.status === 'SUBMITTED');
  if (open.length) throw rule('CALL_CHANGED', 'some modules submitted changes or have not answered', { issues: open.map((m) => moduleName(ctx.s, m)) });
  const draft = ctx.s.integrationCalls[call.id]!;
  draft.status = 'NO_CHANGE';
  draft.note = note?.trim() || null;
  draft.closedBy = ctx.user().username;
  draft.closedAt = ctx.now;
  if (call.parentCallId) answerParent(ctx, call, null);
}

/** A domain call's result goes up to its whole-vehicle call's module for the domain. */
function answerParent(ctx: Ctx, call: IntegrationCall, subsystemReleaseId: string | null): void {
  const parent = ctx.s.integrationCalls[call.parentCallId!];
  if (!parent || parent.status !== 'OPEN') return;
  const m = parent.modules.find((x) => x.kind === 'DOMAIN' && x.domain === call.scope && x.workspaceId === call.workspaceId);
  if (!m || m.status === 'EXCLUDED') return;
  setSubmission(ctx, m, subsystemReleaseId ? { subsystemReleaseId } : null, `${call.title}`);
}

/**
 * Merges a complete call's submissions (one round): a merge preview of the submitted Features and
 * subsystem releases onto the mainline head, through the existing merge rules. A round still being
 * previewed is replaced; a frozen one must be closed first.
 */
export function previewCall(ctx: Ctx, callId: string): string {
  const call = getCall(ctx.s, callId);
  assertOpen(call);
  const round = openRound(ctx.s, call);
  if (round?.candidateId) throw rule('CALL_ROUND_OPEN', 'this call’s test integration version is still open; send modules back or cancel it first');
  const problems = callProblems(ctx.s, call);
  if (problems.length) throw rule('CALL_INCOMPLETE', 'the call’s modules are not all submitted and current', { issues: problems });
  const featureIds = call.modules.filter((m) => m.status === 'SUBMITTED' && m.featureId).map((m) => m.featureId!);
  const subsystemReleaseIds = call.modules.filter((m) => m.status === 'SUBMITTED' && m.subsystemReleaseId).map((m) => m.subsystemReleaseId!);
  const planId = previewMerge(ctx, { workspaceId: call.workspaceId, featureIds, ...(call.scope === 'Vehicle' ? { subsystemReleaseIds } : {}), scope: call.scope });
  const draft = ctx.s.integrationCalls[call.id]!;
  const last = draft.rounds.at(-1);
  if (last && last.outcome === 'OPEN') {
    last.outcome = 'CANCELLED';
    last.reason = 'previewed again';
    last.closedBy = ctx.user().username;
    last.closedAt = ctx.now;
  }
  ctx.s.mergePlans[planId]!.callId = call.id;
  draft.rounds.push({ planId, candidateId: null, outcome: 'OPEN', reason: null, by: ctx.user().username, at: ctx.now, closedBy: null, closedAt: null });
  return planId;
}

// ---------------------------------------------------------------------------
// Hooks the integration and release operations call for a plan or candidate of a call
// ---------------------------------------------------------------------------

/** Freezing a call's preview: it must be the call's current round; the candidate is the round's test integration version. */
export function callRoundProblem(s: State, plan: MergePlan): string | null {
  if (!plan.callId) return null;
  const call = s.integrationCalls[plan.callId];
  if (!call || call.status !== 'OPEN') return 'the call of this preview is closed';
  const round = openRound(s, call);
  if (!round || round.planId !== plan.id) return 'this preview is no longer the call’s current round';
  return null;
}

export function onRoundFrozen(ctx: Ctx, plan: MergePlan, candidateId: string): void {
  const round = ctx.s.integrationCalls[plan.callId!]!.rounds.find((r) => r.planId === plan.id)!;
  round.candidateId = candidateId;
}

export function onCandidateClosed(ctx: Ctx, c: Candidate, reason: string | null): void {
  if (!c.callId) return;
  const round = ctx.s.integrationCalls[c.callId]?.rounds.find((r) => r.candidateId === c.id);
  if (round && round.outcome === 'OPEN') {
    round.outcome = 'CANCELLED';
    round.reason = reason;
    round.closedBy = ctx.user().username;
    round.closedAt = ctx.now;
  }
}

/** Why a release may not list these versions: planned versions belong to their call's release only. */
export function plannedVersionProblems(s: State, c: Candidate, versions: string[]): { code: string; message: string; issues: string[] } | null {
  const call = c.callId ? s.integrationCalls[c.callId] : undefined;
  if (call && !versions.includes(call.targetVersion)) {
    return { code: 'CALL_TARGET_MISSING', message: `this test integration version is for ${call.vehicleModelId} ${call.targetVersion}; list it`, issues: [`${call.vehicleModelId} ${call.targetVersion}`] };
  }
  const planned = versions.filter((v) => s.softwareVersions[softwareKey(c.vehicleModelId, v)]?.status === 'PLANNED' && v !== call?.targetVersion);
  if (planned.length) return { code: 'VERSION_PLANNED', message: 'planned versions are listed only by their own call’s release', issues: planned.map((v) => `${c.vehicleModelId} ${v}`) };
  return null;
}

/**
 * Publishing a call's passing round: the planned target becomes a recorded version produced by the
 * call, the call is released with the new set listed for it (the set ↔ version relation), and the
 * set is exported as the DCL configuration module of the version's vehicle OTA package.
 */
export function onCallReleased(ctx: Ctx, c: Candidate, releaseId: string): void {
  if (!c.callId) return;
  const call = ctx.s.integrationCalls[c.callId]!;
  const sv = ctx.s.softwareVersions[softwareKey(call.vehicleModelId, call.targetVersion)];
  if (sv && sv.status === 'PLANNED') {
    sv.status = 'RECORDED';
    sv.callId = call.id;
    sv.source = `integration call ${call.title}`;
    sv.recordedBy = ctx.user().username;
    sv.createdAt = ctx.now;
  }
  if (sv) sv.dclModule = moduleOf(ctx, releaseId);
  closeReleased(ctx, call, c.id);
  call.releaseId = releaseId;
}

/** A domain call's passing round published as a subsystem release goes up to the whole-vehicle call. */
export function onSubsystemPublished(ctx: Ctx, c: Candidate, subsystemReleaseId: string): void {
  if (!c.callId) return;
  const call = ctx.s.integrationCalls[c.callId]!;
  closeReleased(ctx, call, c.id);
  call.subsystemReleaseId = subsystemReleaseId;
  if (call.parentCallId) answerParent(ctx, call, subsystemReleaseId);
}

/** The DCL configuration module of a published set, exported now. */
export function moduleOf(ctx: Ctx, releaseId: string): DclModule {
  const r = ctx.s.releases[releaseId]!;
  return { releaseId, resolvedConfigId: r.resolvedConfigId, digest: ctx.s.resolvedConfigs[r.resolvedConfigId]?.digest ?? '', exportedBy: ctx.user().username, exportedAt: ctx.now };
}

/**
 * Configuration release exports the set in effect for a recorded software version as the DCL
 * configuration module of its vehicle OTA package: for a version recorded from outside, or again
 * after a patch, so vehicles flashed from then on start on the newest set.
 */
export function exportDclModule(ctx: Ctx, input: { vehicleModelId: string; version: string }): DclModule {
  const sv = ctx.s.softwareVersions[softwareKey(input.vehicleModelId, input.version)];
  if (!sv) throw notFound('software version', input.version);
  const set = setInEffect(ctx.s, input.vehicleModelId, input.version);
  const workspaceId = (set && releaseWorkspace(ctx.s, set)) ?? Object.values(ctx.s.workspaces).find((w) => w.kind === 'PROJECT' && w.vehicleModelId === input.vehicleModelId && w.scopes.includes('Vehicle'))?.id ?? '*';
  ctx.allow('release.promote', { type: 'softwareVersion', id: input.version, workspaceId, scope: 'Vehicle' });
  if (sv.status === 'PLANNED') throw rule('VERSION_PLANNED', `${input.vehicleModelId} ${input.version} is planned; its module comes with its call’s release`);
  if (!set) throw rule('NO_SET_FOR_VERSION', `no policy set applies to ${input.vehicleModelId} ${input.version}`);
  if (sv.dclModule?.releaseId === set.id) throw rule('MODULE_CURRENT', `the module already carries policy set ${set.dclVersion}`);
  const draft = ctx.s.softwareVersions[softwareKey(input.vehicleModelId, input.version)]!;
  draft.dclModule = moduleOf(ctx, set.id);
  return { ...draft.dclModule };
}

function closeReleased(ctx: Ctx, call: IntegrationCall, candidateId: string): void {
  const round = call.rounds.find((r) => r.candidateId === candidateId);
  if (round) {
    round.outcome = 'RELEASED';
    round.closedBy = ctx.user().username;
    round.closedAt = ctx.now;
  }
  call.status = 'RELEASED';
  call.closedBy = ctx.user().username;
  call.closedAt = ctx.now;
}

/** Calls whose module this workspace answers and has not yet: the to-dos of its submitters. */
export function waitingModules(s: State, workspaceId: string): { call: IntegrationCall; module: CallModule }[] {
  const out: { call: IntegrationCall; module: CallModule }[] = [];
  for (const call of Object.values(s.integrationCalls)) {
    if (call.status !== 'OPEN') continue;
    for (const m of call.modules) if (m.workspaceId === workspaceId && (m.status === 'WAITING' || m.status === 'RETURNED')) out.push({ call, module: m });
  }
  return out.sort((a, b) => a.call.createdAt.localeCompare(b.call.createdAt));
}

/** Whether a call is past its due date on the platform clock with modules still missing. */
export function isOverdueCall(s: State, call: IntegrationCall): boolean {
  return !!call.dueDate && call.status === 'OPEN' && call.dueDate < todayOf(s) && call.modules.some((m) => m.status === 'WAITING' || m.status === 'RETURNED');
}
