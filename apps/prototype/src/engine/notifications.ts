// Notification center (通知中心): the account's current items in one workspace, derived from what
// its grants there let it see. An item's id names the role, the object and its state, so a change
// of state raises a new item. Read marks belong to the account and workspace; reading changes no
// task, test, configuration or receipt, and items are not an audit history.

import { authorize } from '../domain/authz.ts';
import type { Role } from '../domain/vocabulary.ts';
import { blockedProductionVehicles } from './applicability.ts';
import { callPhase, callProblems, callsFor, isOverdueCall, moduleName, waitingModules } from './calls.ts';
import { usageOf } from './budget.ts';
import { DAY_MS, nowOf } from './clock.ts';
import { mismatchesFor } from './delivery.ts';
import type { Actor, Ctx } from './engine.ts';
import { emergencyStopsOf } from './emergency.ts';
import { carriesData } from './events.ts';
import { isOverdue, softwareKey, workspaceVehicles } from './fleet.ts';
import { workspaceAccess } from './identity.ts';
import { intakeQueue } from './intake.ts';
import { isConfirmed, isMergeWorkspace, verifiedSources } from './integration.ts';
import { borrowedBy, lentBy, loansToAgree, loansToApprove, managedLoans } from './loans.ts';
import { orphanedOrgObjects } from './org.ts';
import { otaRollouts } from './ota.ts';
import { workingNameState } from './plm-sync.ts';
import { deploymentNumber, planNumber } from './labels.ts';
import { referenceRequestsFor } from './references.ts';
import { assessSoftwareChange, softwareChangesFor, unrecordedReports } from './software-change.ts';
import { partVersion } from './types.ts';
import type { SoftwareVersion, State } from './types.ts';
import { deploymentsOf, testRequestsOf } from './validation.ts';

export type NotificationKind =
  | 'FEATURE_RETURNED'
  | 'FEATURE_STAGE'
  | 'REFERENCE_REQUEST'
  | 'SOFTWARE_CHANGE'
  | 'FEATURE_TO_TEST'
  | 'DISPATCH_FAILED'
  | 'TEST_REQUEST_DECIDED'
  | 'TEST_REQUEST_PENDING'
  | 'VEHICLE_MAINTENANCE'
  | 'INTAKE_REVIEW'
  | 'OVERLAP_REVIEW'
  | 'PROCESSING_CONFIRM'
  | 'FEATURE_COLLECTIBLE'
  | 'MERGE_BLOCKED'
  | 'CANDIDATE_TO_TEST'
  | 'CHECK_TO_TEST'
  | 'CANDIDATE_TO_RELEASE'
  | 'CHECK_TO_CONFIRM'
  | 'EMERGENCY_STOP'
  | 'ROLLOUT_PAUSED'
  | 'PRODUCTION_BLOCKED'
  | 'DCL_PART_TO_DELIVER'
  | 'PLM_PART_UNKNOWN'
  | 'UNRECORDED_SOFTWARE'
  | 'GROUP_MISMATCH'
  | 'SOFTWARE_UPDATE'
  | 'LOAN_TO_AGREE'
  | 'LOAN_TO_APPROVE'
  | 'EXTENSION_TO_APPROVE'
  | 'LOAN_DECIDED'
  | 'LOAN_OVERDUE'
  | 'LOAN_ENDED'
  | 'LOAN_RECALLED'
  | 'VEHICLE_ENV_CHANGED'
  | 'GRANT_REVIEW'
  | 'ORPHANED_UNIT'
  | 'BUDGET_DROPS'
  | 'COLLECTION_PAUSED'
  | 'AFTERSALES_READY'
  | 'CALL_SUBMIT'
  | 'CALL_RETURNED'
  | 'CALL_COMPLETE'
  | 'CALL_WAITING';

export interface Notification {
  /** Role, kind, object and state: stable while nothing changes, new when the state does. */
  id: string;
  role: Role;
  kind: NotificationKind;
  severity: 'INFO' | 'WARNING';
  /** What it is about: a Feature, vehicle, candidate, check, policy or account. */
  subject: string;
  /** A state code or short data (a stage, an outcome, a reason) the page renders. */
  detail: string | null;
  /** The route that opens the object. */
  link: string;
  at: string | null;
}

/** Read marks kept per account and workspace; the oldest are dropped beyond this. */
export const READ_LIMIT = 1000;

/** Answers (a decision, a returned car, a finished update) stay this long on the platform clock. */
export const ANSWER_DAYS = 14;

/** The account's current notifications in a workspace: warnings first, then newest first. */
/** PLM versions whose DCL part carries a configuration no policy set of the model has. */
function unknownParts(s: State, vehicleModelId: string): SoftwareVersion[] {
  return Object.values(s.softwareVersions).filter((v) => v.vehicleModelId === vehicleModelId && v.status === 'RECORDED' && v.dclPart && !v.dclModule);
}

export function notificationsFor(s: State, actor: Actor, workspaceId: string): Notification[] {
  const ws = s.workspaces[workspaceId];
  const roles = workspaceAccess(s, actor).find((a) => a.workspaceId === workspaceId)?.roles ?? [];
  if (!ws || roles.length === 0) return [];
  const items: Notification[] = [];
  const seen = new Set<string>();
  // One item per object and state, under the first role that sees it.
  const add = (role: Role, kind: NotificationKind, key: unknown[], n: Omit<Notification, 'id' | 'role' | 'kind'>) => {
    const object = JSON.stringify([kind, ...key]);
    if (seen.has(object)) return;
    seen.add(object);
    items.push({ id: JSON.stringify([role, kind, ...key]), role, kind, ...n });
  };
  const has = (role: Role) => roles.includes(role);
  const now = Date.parse(nowOf(s));
  const fresh = (at: string | null) => !at || now - Date.parse(at) <= ANSWER_DAYS * DAY_MS;
  const features = Object.values(s.features).filter((f) => f.workspaceId === workspaceId);

  if (has('BUSINESS_DEV')) {
    // A DCL technical change is DCL's own: its feedback goes to DCL, not to the group's developers.
    for (const f of features.filter((x) => x.kind === 'BUSINESS')) {
      if (!authorize(actor.grants, 'feature.edit', { workspaceId, groupId: f.groupId }).ok) continue;
      const feedback = s.feedback.filter((x) => x.featureId === f.id && x.commitId === f.headCommitId).at(-1);
      if (f.stage === 'DRAFT' && feedback) {
        add('BUSINESS_DEV', 'FEATURE_RETURNED', [f.id, f.headCommitId, feedback.id], { severity: 'WARNING', subject: f.name, detail: feedback.reason, link: `features/${f.id}/feedback`, at: feedback.createdAt });
      } else if (['SUBMITTED', 'DCL_READY', 'TESTING', 'VERIFIED', 'INTEGRATED'].includes(f.stage)) {
        add('BUSINESS_DEV', 'FEATURE_STAGE', [f.id, f.headCommitId, f.stage], { severity: 'INFO', subject: f.name, detail: f.stage, link: `features/${f.id}`, at: f.updatedAt });
      }
    }
    for (const groupId of ws.groupIds) {
      if (!authorize(actor.grants, 'reference.decide', { groupId }).ok) continue;
      for (const r of referenceRequestsFor(s, actor, groupId, 'owner').filter((x) => x.status === 'PENDING')) {
        add('BUSINESS_DEV', 'REFERENCE_REQUEST', [r.id, r.status], { severity: 'INFO', subject: s.groups[r.readerGroupId]?.code ?? r.readerGroupId, detail: r.dataKey, link: 'data/requests', at: r.createdAt });
      }
    }
  }
  for (const role of ['BUSINESS_DEV', 'BUSINESS_TEST'] as const) {
    if (!has(role)) continue;
    for (const c of softwareChangesFor(s, actor, workspaceId)) {
      const outcome = assessSoftwareChange(s, c.id).outcome;
      add(role, 'SOFTWARE_CHANGE', [c.id, outcome], { severity: outcome === 'NONE' ? 'INFO' : 'WARNING', subject: c.resourceId, detail: `${c.fromVersion ?? '—'} → ${c.toVersion} · ${outcome}`, link: 'workbench', at: c.at });
    }
    for (const f of mismatchesFor(s, actor, workspaceId)) {
      add(role, 'GROUP_MISMATCH', [f.resourceId, f.follow.since, f.check.outcome], { severity: 'WARNING', subject: f.resourceId, detail: `${s.vehicleGroups[f.vehicleGroupId]?.name ?? f.vehicleGroupId} · ${f.check.outcome}`, link: 'fleet/groups', at: f.follow.since });
    }
  }
  // The answer to an account's own software update request.
  const updater = (['BUSINESS_DEV', 'BUSINESS_TEST', 'WORKSPACE_ADMIN', 'VEHICLE_RESOURCE'] as const).find(has);
  if (updater) {
    for (const q of Object.values(s.vehicleSoftwareRequests).filter((x) => x.workspaceId === workspaceId && x.requestedBy === actor.username && (x.status === 'APPLIED' || x.status === 'FAILED') && fresh(x.answeredAt))) {
      add(updater, 'SOFTWARE_UPDATE', [q.id, q.status], { severity: q.status === 'FAILED' ? 'WARNING' : 'INFO', subject: q.resourceId, detail: `${q.toVersion} · ${q.status}`, link: 'fleet/workspace', at: q.answeredAt });
    }
  }
  if (has('BUSINESS_TEST')) {
    for (const f of features) {
      // Team testing happens on development vehicles.
      if (!['DCL_READY', 'TESTING'].includes(f.stage) || !authorize(actor.grants, 'feature.dispatch', { workspaceId, groupId: f.groupId, env: 'development' }).ok) continue;
      add('BUSINESS_TEST', 'FEATURE_TO_TEST', [f.id, f.headCommitId, f.stage], { severity: 'INFO', subject: f.name, detail: f.stage, link: `features/${f.id}/validation`, at: f.updatedAt });
    }
    for (const r of testRequestsOf(s, workspaceId).filter((x) => x.requestedBy === actor.username && (x.status === 'APPROVED' || x.status === 'REJECTED') && fresh(x.decidedAt))) {
      add('BUSINESS_TEST', 'TEST_REQUEST_DECIDED', [r.id, r.status], { severity: r.status === 'REJECTED' ? 'WARNING' : 'INFO', subject: s.features[r.featureId]?.name ?? r.featureId, detail: r.status, link: `features/${r.featureId}/validation`, at: r.decidedAt });
    }
  }
  for (const role of ['BUSINESS_DEV', 'BUSINESS_TEST'] as const) {
    if (!has(role)) continue;
    for (const f of features) {
      for (const d of deploymentsOf(s, f.id).filter((x) => x.kind === 'FEATURE')) {
        const failed = d.targets.filter((t) => t.status === 'FAILED');
        if (!failed.length) continue;
        const target = { workspaceId, groupId: f.groupId, env: d.env };
        if (!authorize(actor.grants, role === 'BUSINESS_DEV' ? 'feature.edit' : 'feature.dispatch', role === 'BUSINESS_DEV' ? { workspaceId, groupId: f.groupId } : target).ok) continue;
        add(role, 'DISPATCH_FAILED', [d.id, failed.map((t) => [t.resourceId, t.attempt])], { severity: 'WARNING', subject: f.name, detail: failed.map((t) => t.resourceId).join(', '), link: `features/${f.id}/validation`, at: d.updatedAt });
      }
    }
  }
  if (has('WORKSPACE_ADMIN')) {
    for (const r of testRequestsOf(s, workspaceId).filter((x) => x.status === 'PENDING')) {
      add('WORKSPACE_ADMIN', 'TEST_REQUEST_PENDING', [r.id, r.status], { severity: 'WARNING', subject: s.features[r.featureId]?.name ?? r.featureId, detail: s.accounts[r.requestedBy]?.displayName ?? r.requestedBy, link: 'fleet/groups', at: r.requestedAt });
    }
  }
  if (has('WORKSPACE_ADMIN')) {
    for (const l of loansToAgree(s, actor, workspaceId)) {
      add('WORKSPACE_ADMIN', 'LOAN_TO_AGREE', [l.id, l.status], { severity: 'WARNING', subject: l.resourceId, detail: s.workspaces[l.workspaceId]?.name ?? l.workspaceId, link: 'fleet/loans', at: l.requestedAt });
    }
    const r0 = (id: string) => s.resources[id]!;
    const mine = borrowedBy(s, workspaceId).filter((l) => authorize(actor.grants, 'loan.request', { workspaceId, scope: r0(l.resourceId).pool, env: r0(l.resourceId).env }).ok);
    for (const l of mine) {
      // The latest answer: an extension decided after the loan, else the loan's own decision.
      const ext = l.extensions.filter((x) => x.status !== 'PENDING').at(-1);
      if (l.status === 'APPROVED' || l.status === 'REJECTED') {
        const extended = l.status === 'APPROVED' && !!ext;
        const detail = extended ? `EXTENSION_${ext!.status}` : l.status;
        const at = extended ? ext!.decidedAt : l.decidedAt;
        if (fresh(at)) add('WORKSPACE_ADMIN', 'LOAN_DECIDED', [l.id, detail, at], { severity: detail.endsWith('REJECTED') ? 'WARNING' : 'INFO', subject: l.resourceId, detail, link: 'fleet/loans', at });
      }
      if (isOverdue(s, l)) add('WORKSPACE_ADMIN', 'LOAN_OVERDUE', [l.id, l.dueDate], { severity: 'WARNING', subject: l.resourceId, detail: l.dueDate, link: 'fleet/loans', at: null });
      if (l.status === 'RECALLED' && fresh(l.endedAt)) add('WORKSPACE_ADMIN', 'LOAN_RECALLED', [l.id, l.status], { severity: 'WARNING', subject: l.resourceId, detail: l.endNote, link: 'fleet/loans', at: l.endedAt });
    }
    for (const l of lentBy(s, workspaceId).filter((x) => (x.status === 'RETURNED' || x.status === 'RECALLED') && fresh(x.endedAt))) {
      if (!authorize(actor.grants, 'loan.lend', { workspaceId, scope: r0(l.resourceId).pool, env: r0(l.resourceId).env }).ok) continue;
      add('WORKSPACE_ADMIN', 'LOAN_ENDED', [l.id, l.status], { severity: 'INFO', subject: l.resourceId, detail: `${l.status} · ${l.softwareAtStart ?? '—'} → ${l.softwareAtEnd ?? '—'}`, link: 'fleet/workspace', at: l.endedAt });
    }
  }
  if (has('VEHICLE_RESOURCE')) {
    for (const l of loansToApprove(s, actor)) {
      add('VEHICLE_RESOURCE', 'LOAN_TO_APPROVE', [l.id, l.status], { severity: 'WARNING', subject: l.resourceId, detail: s.workspaces[l.workspaceId]?.name ?? l.workspaceId, link: 'fleet/loans', at: l.requestedAt });
    }
    for (const l of managedLoans(s, actor).filter((x) => x.status === 'APPROVED')) {
      const ext = l.extensions.find((x) => x.status === 'PENDING');
      if (ext) add('VEHICLE_RESOURCE', 'EXTENSION_TO_APPROVE', [l.id, ext.requestedAt], { severity: 'WARNING', subject: l.resourceId, detail: ext.dueDate, link: 'fleet/loans', at: ext.requestedAt });
      if (isOverdue(s, l)) add('VEHICLE_RESOURCE', 'LOAN_OVERDUE', [l.id, l.dueDate], { severity: 'WARNING', subject: l.resourceId, detail: l.dueDate, link: 'fleet/loans', at: null });
    }
  }
  for (const role of ['WORKSPACE_ADMIN', 'VEHICLE_RESOURCE'] as const) {
    if (!has(role)) continue;
    for (const r of workspaceVehicles(s, workspaceId).filter((x) => x.status === 'MAINTENANCE')) {
      add(role, 'VEHICLE_MAINTENANCE', [r.id, r.status, r.updatedAt], { severity: 'WARNING', subject: r.id, detail: null, link: 'fleet/workspace', at: r.updatedAt });
    }
  }
  // A vehicle the workspace uses moved to another environment: it may no longer fit its use here.
  if (has('WORKSPACE_ADMIN')) {
    const mine = new Set(s.workspaceResources[workspaceId] ?? []);
    for (const c of s.environmentChanges.filter((x) => mine.has(x.resourceId) && fresh(x.at))) {
      add('WORKSPACE_ADMIN', 'VEHICLE_ENV_CHANGED', [c.id], { severity: 'INFO', subject: c.resourceId, detail: `${c.from} → ${c.to}`, link: 'fleet/workspace', at: c.at });
    }
  }
  if (has('DCL_ENGINEER')) {
    for (const f of features.filter((x) => x.kind === 'TECHNICAL' && x.stage === 'DRAFT')) {
      const feedback = s.feedback.filter((x) => x.featureId === f.id && x.commitId === f.headCommitId).at(-1);
      if (feedback) add('DCL_ENGINEER', 'FEATURE_RETURNED', [f.id, f.headCommitId, feedback.id], { severity: 'WARNING', subject: f.name, detail: feedback.reason, link: `features/${f.id}/feedback`, at: feedback.createdAt });
    }
    const q = intakeQueue(s, actor);
    for (const { feature: f } of q.features.filter((x) => x.feature.workspaceId === workspaceId)) {
      add('DCL_ENGINEER', 'INTAKE_REVIEW', [f.id, f.headCommitId], { severity: 'INFO', subject: f.name, detail: s.groups[f.groupId]?.code ?? f.groupId, link: 'intake', at: f.updatedAt });
    }
    for (const { item } of q.overlaps) {
      add('DCL_ENGINEER', 'OVERLAP_REVIEW', [item.dataKey, item.status], { severity: 'INFO', subject: item.dataCode, detail: s.groups[item.ownerGroupId]?.code ?? item.ownerGroupId, link: 'intake', at: item.createdAt });
    }
    for (const p of Object.values(s.mergePlans).filter((x) => x.workspaceId === workspaceId && x.status === 'READY' && !isConfirmed(s, x))) {
      add('DCL_ENGINEER', 'PROCESSING_CONFIRM', [p.id, p.digest], { severity: 'INFO', subject: `#${planNumber(s, p)}`, detail: null, link: 'integration/merge', at: p.createdAt });
    }
    for (const x of emergencyStopsOf(s, ws.vehicleModelId).filter((x) => x.requestedBy === actor.username && x.status !== 'REQUESTED' && fresh(x.decidedAt))) {
      add('DCL_ENGINEER', 'EMERGENCY_STOP', [x.id, x.status], { severity: 'INFO', subject: x.policyId, detail: x.status, link: 'release', at: x.decidedAt });
    }
    // A released call's configuration waits for DCL to merge it into the DCL software and deliver it to PLM.
    for (const v of Object.values(s.softwareVersions).filter((x) => workingNameState(x) === 'TO_DELIVER' && x.callId && s.integrationCalls[x.callId]?.workspaceId === workspaceId)) {
      add('DCL_ENGINEER', 'DCL_PART_TO_DELIVER', [v.version, v.dclModule!.releaseId], { severity: 'WARNING', subject: `${v.vehicleModelId} ${v.version}`, detail: s.releases[v.dclModule!.releaseId]?.dclVersion ?? null, link: 'release/applicability', at: v.dclModule!.exportedAt });
    }
    if (ws.scopes.includes('Vehicle')) {
      for (const v of unknownParts(s, ws.vehicleModelId)) {
        add('DCL_ENGINEER', 'PLM_PART_UNKNOWN', [v.version, v.dclPart!.digest], { severity: 'WARNING', subject: `${v.vehicleModelId} ${v.version}`, detail: partVersion(v.dclPart!), link: 'release/applicability', at: v.createdAt });
      }
    }
  }
  // Resource protection: captures a vehicle of the workspace dropped or suppressed this hour.
  if (has('DCL_ENGINEER')) {
    for (const r of workspaceVehicles(s, workspaceId)) {
      const u = usageOf(s, r.id);
      if (u.dropped + u.suppressed === 0) continue;
      const last = Object.values(s.events).filter((e) => e.resourceId === r.id && !carriesData(e)).sort((a, b) => b.seq - a.seq)[0];
      add('DCL_ENGINEER', 'BUDGET_DROPS', [r.id, last?.id ?? null], { severity: 'WARNING', subject: r.id, detail: `${u.dropped}/${u.suppressed}`, link: 'processing/budget', at: last?.occurredAt ?? null });
    }
  }
  // The answer to the account's own after-sales request: its data is ready, or the vehicle could not take it.
  const asker = (['BUSINESS_DEV', 'BUSINESS_TEST', 'DCL_ENGINEER'] as const).find(has);
  if (asker) {
    for (const q of Object.values(s.captureRequests).filter((x) => x.workspaceId === workspaceId && x.requestedBy === actor.username && fresh(x.answeredAt))) {
      const e = q.eventId ? s.events[q.eventId] : undefined;
      if (q.status === 'CAPTURED' && e?.status === 'DONE') add(asker, 'AFTERSALES_READY', [q.id, 'DONE'], { severity: 'INFO', subject: q.resourceId, detail: `DONE · ${e.policyName}`, link: 'query', at: q.answeredAt });
      // Not delivered: the platform cancelled it (the vehicle could not take it), or the capture was dropped or failed.
      else if ((q.status === 'CANCELLED' && q.cancelledBy === null) || (e && (!carriesData(e) || e.status === 'FAILED'))) {
        add(asker, 'AFTERSALES_READY', [q.id, 'NONE'], { severity: 'WARNING', subject: q.resourceId, detail: `NONE · ${q.policyId}${q.note ? ` · ${q.note}` : ''}`, link: 'query', at: q.answeredAt });
      }
    }
  }
  // A vehicle the workspace works with had its collection paused (紧急停采).
  const holdRole = (['BUSINESS_DEV', 'BUSINESS_TEST', 'WORKSPACE_ADMIN', 'CONFIG_RELEASE'] as const).find(has);
  if (holdRole) {
    for (const r of workspaceVehicles(s, workspaceId)) {
      const h = s.collectionHolds[r.id];
      if (!h || h.state === 'ACTIVE') continue;
      const last = h.history.at(-1)!;
      add(holdRole, 'COLLECTION_PAUSED', [r.id, h.history.length, h.state], { severity: 'WARNING', subject: r.id, detail: `${h.state} · ${last.reason}`, link: 'fleet/workspace', at: last.at });
    }
  }
  // Integration calls (集成征集): the module's submitters are asked, the call's admin and integration follow it.
  for (const { call, module: m } of waitingModules(s, workspaceId)) {
    const allowed = m.kind === 'GROUP'
      ? has('BUSINESS_DEV') && authorize(actor.grants, 'call.submitGroup', { workspaceId, groupId: m.groupId! }).ok && 'BUSINESS_DEV'
      : (['CONFIG_INTEGRATOR', 'WORKSPACE_ADMIN'] as const).find((r) => has(r) && authorize(actor.grants, 'call.submitDomain', { workspaceId, scope: m.domain! }).ok);
    if (!allowed) continue;
    const returned = m.status === 'RETURNED';
    add(allowed, returned ? 'CALL_RETURNED' : 'CALL_SUBMIT', [call.id, m.key, m.status, m.at, m.remindedAt], {
      severity: returned || isOverdueCall(s, call) ? 'WARNING' : 'INFO',
      subject: call.title,
      detail: returned ? m.note : moduleName(s, m),
      link: `versions/calls/${call.id}`,
      at: m.remindedAt ?? m.at ?? call.createdAt,
    });
  }
  for (const call of callsFor(s, workspaceId).filter((c) => c.workspaceId === workspaceId && c.status === 'OPEN')) {
    const phase = callPhase(s, call);
    if (phase === 'COMPLETE' && has('CONFIG_INTEGRATOR')) {
      add('CONFIG_INTEGRATOR', 'CALL_COMPLETE', [call.id, call.rounds.length], { severity: 'INFO', subject: call.title, detail: null, link: `versions/calls/${call.id}`, at: call.modules.map((m) => m.at ?? '').sort().at(-1) || call.createdAt });
    }
    const manager = (['WORKSPACE_ADMIN', 'CONFIG_INTEGRATOR'] as const).find(has);
    if (phase === 'COLLECTING' && manager) {
      const missing = call.modules.filter((m) => m.status === 'WAITING' || m.status === 'RETURNED').map((m) => moduleName(s, m));
      if (missing.length || callProblems(s, call).length) {
        add(manager, 'CALL_WAITING', [call.id, missing.join(','), isOverdueCall(s, call)], { severity: isOverdueCall(s, call) ? 'WARNING' : 'INFO', subject: call.title, detail: missing.join(', ') || null, link: `versions/calls/${call.id}`, at: call.createdAt });
      }
    }
  }
  if (has('CONFIG_INTEGRATOR') && isMergeWorkspace(s, workspaceId)) {
    for (const f of verifiedSources(s, workspaceId)) {
      add('CONFIG_INTEGRATOR', 'FEATURE_COLLECTIBLE', [f.id, f.verifiedCommitId], { severity: 'INFO', subject: f.name, detail: s.groups[f.groupId]?.code ?? f.groupId, link: 'integration/merge', at: f.updatedAt });
    }
    for (const p of Object.values(s.mergePlans).filter((x) => x.workspaceId === workspaceId && (x.status === 'CONFLICT' || x.status === 'BLOCKED'))) {
      add('CONFIG_INTEGRATOR', 'MERGE_BLOCKED', [p.id, p.status, p.digest], { severity: 'WARNING', subject: `#${planNumber(s, p)}`, detail: p.status, link: 'integration/merge', at: p.createdAt });
    }
  }
  if (has('INTEGRATION_TEST')) {
    for (const c of Object.values(s.candidates).filter((x) => x.testWorkspaceId === workspaceId && (x.status === 'CANDIDATE' || x.status === 'TESTING'))) {
      add('INTEGRATION_TEST', 'CANDIDATE_TO_TEST', [c.id, c.status], { severity: 'INFO', subject: c.label, detail: c.status, link: `integration/${c.id}`, at: c.createdAt });
    }
    for (const c of Object.values(s.applicabilityChecks).filter((x) => x.testWorkspaceId === workspaceId && (x.status === 'OPEN' || x.status === 'TESTING'))) {
      add('INTEGRATION_TEST', 'CHECK_TO_TEST', [c.id, c.status], { severity: 'INFO', subject: `${c.vehicleModelId} ${c.version}`, detail: s.releases[c.releaseId]?.dclVersion ?? null, link: 'integration/applicability', at: c.openedAt });
    }
  }
  if (has('CONFIG_RELEASE')) {
    const wholeVehicle = ws.scopes.includes('Vehicle');
    for (const c of Object.values(s.candidates).filter((x) => x.status === 'VERIFIED' && (wholeVehicle ? x.vehicleModelId === ws.vehicleModelId && x.scope === 'Vehicle' : x.workspaceId === workspaceId))) {
      add('CONFIG_RELEASE', 'CANDIDATE_TO_RELEASE', [c.id, c.status], { severity: 'INFO', subject: c.label, detail: null, link: wholeVehicle ? 'release' : `integration/${c.id}`, at: c.verifiedAt });
    }
    if (wholeVehicle) {
      for (const c of Object.values(s.applicabilityChecks).filter((x) => x.vehicleModelId === ws.vehicleModelId && x.status === 'VERIFIED')) {
        add('CONFIG_RELEASE', 'CHECK_TO_CONFIRM', [c.id, c.status], { severity: 'INFO', subject: `${c.vehicleModelId} ${c.version}`, detail: s.releases[c.releaseId]?.dclVersion ?? null, link: 'release/applicability', at: c.verifiedAt });
      }
      for (const x of emergencyStopsOf(s, ws.vehicleModelId).filter((x) => x.status === 'REQUESTED' && x.requestedBy !== actor.username)) {
        add('CONFIG_RELEASE', 'EMERGENCY_STOP', [x.id, x.status], { severity: 'WARNING', subject: x.policyId, detail: x.status, link: 'release', at: x.requestedAt });
      }
      for (const d of otaRollouts(s).filter((x) => s.workspaces[x.workspaceId]?.vehicleModelId === ws.vehicleModelId && x.status === 'PAUSED')) {
        add('CONFIG_RELEASE', 'ROLLOUT_PAUSED', [d.id, d.status, d.pauseReason ?? null], { severity: 'WARNING', subject: `${s.releases[d.subjectId]?.dclVersion ?? ''} · #${deploymentNumber(s, d)}`, detail: d.pauseReason ?? null, link: 'release/ota', at: d.updatedAt });
      }
      for (const r of blockedProductionVehicles(s, ws.vehicleModelId)) {
        add('CONFIG_RELEASE', 'PRODUCTION_BLOCKED', [r.id, r.integrationVersion], { severity: 'WARNING', subject: r.id, detail: r.integrationVersion, link: 'release/applicability', at: r.updatedAt });
      }
      for (const v of unknownParts(s, ws.vehicleModelId)) {
        add('CONFIG_RELEASE', 'PLM_PART_UNKNOWN', [v.version, v.dclPart!.digest], { severity: 'WARNING', subject: `${v.vehicleModelId} ${v.version}`, detail: partVersion(v.dclPart!), link: 'release/applicability', at: v.createdAt });
      }
    }
  }
  if (has('VEHICLE_RESOURCE')) {
    for (const c of unrecordedReports(s, actor)) {
      // A production vehicle reporting a working name waits for PLM; once PLM published it, the
      // vehicle runs a pre-release build of what is now another number.
      const planned = s.softwareVersions[softwareKey(s.resources[c.resourceId]!.vehicleModelId, c.toVersion)];
      if (planned?.status === 'PLANNED' && !planned.linkedTo && s.resources[c.resourceId]!.env === 'production') continue;
      add('VEHICLE_RESOURCE', 'UNRECORDED_SOFTWARE', [c.id, c.status], { severity: 'WARNING', subject: c.resourceId, detail: planned?.linkedTo ? `${c.toVersion} → ${planned.linkedTo}` : c.toVersion, link: 'fleet/registry', at: c.at });
    }
  }
  if (has('PLATFORM_OPS') && authorize(actor.grants, 'account.manage', {}).ok) {
    for (const a of Object.values(s.accounts).filter((x) => x.grantReview && x.status === 'ACTIVE')) {
      add('PLATFORM_OPS', 'GRANT_REVIEW', [a.username, a.grantReview!.since], { severity: 'WARNING', subject: a.displayName, detail: a.username, link: 'accounts', at: a.grantReview!.since });
    }
    const orphans = orphanedOrgObjects(s);
    for (const id of orphans.workspaces) add('PLATFORM_OPS', 'ORPHANED_UNIT', ['workspace', id], { severity: 'WARNING', subject: s.workspaces[id]?.name ?? id, detail: 'WORKSPACE', link: 'org', at: null });
    for (const id of orphans.groups) add('PLATFORM_OPS', 'ORPHANED_UNIT', ['group', id], { severity: 'WARNING', subject: s.groups[id]?.name ?? id, detail: 'GROUP', link: 'org', at: null });
  }

  return items.sort((a, b) => (a.severity === b.severity ? (b.at ?? '').localeCompare(a.at ?? '') : a.severity === 'WARNING' ? -1 : 1));
}

/** What the account marked read in a workspace. */
/** Unread items per workspace the account can use (warnings counted apart), the current one included. */
export function unreadByWorkspace(s: State, actor: Actor): { workspaceId: string; unread: number; warnings: number }[] {
  return workspaceAccess(s, actor).map(({ workspaceId }) => {
    const read = readIds(s, actor.username, workspaceId);
    const items = notificationsFor(s, actor, workspaceId).filter((n) => !read.has(n.id));
    return { workspaceId, unread: items.length, warnings: items.filter((n) => n.severity === 'WARNING').length };
  });
}

const KIND_ORDER = { PROJECT: 0, TEAM: 1, INTEGRATION: 2 } as const;

/**
 * Where an account starts when it signs in: the workspace with the most unread warnings, then the
 * most unread items; with as much to do, the one most of its grants name, then a project workspace
 * before a team one before an integration one (where configuration is collected, written, then tested).
 */
export function landingWorkspace(s: State, actor: Actor): string | null {
  const counts = unreadByWorkspace(s, actor);
  const kind = (id: string) => KIND_ORDER[s.workspaces[id]!.kind];
  // Roles granted for the workspace by name: a domain integrator's own integration workspace
  // before the teams it also administers.
  const named = (id: string) => actor.grants.filter((g) => g.workspaces.includes(id)).length;
  const best = [...counts].sort(
    (a, b) => b.warnings - a.warnings || b.unread - a.unread || named(b.workspaceId) - named(a.workspaceId) || kind(a.workspaceId) - kind(b.workspaceId) || a.workspaceId.localeCompare(b.workspaceId),
  )[0];
  return best?.workspaceId ?? null;
}

export function readIds(s: State, username: string, workspaceId: string): Set<string> {
  return new Set(s.notificationReads[username]?.[workspaceId] ?? []);
}

/**
 * The signed-in account marks notifications read in a workspace. This is the account's own
 * inbox state: it needs no grant, is not audited, and changes no task, test or configuration.
 */
export function markNotificationsRead(ctx: Ctx, workspaceId: string, ids: string[]): number {
  const username = ctx.user().username;
  const mine = (ctx.s.notificationReads[username] ??= {});
  const marked = new Set(mine[workspaceId] ?? []);
  const before = marked.size;
  for (const id of ids) marked.add(id);
  mine[workspaceId] = [...marked].slice(-READ_LIMIT);
  return marked.size - before;
}
