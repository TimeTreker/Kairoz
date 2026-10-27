// Collection events (采集事件) and data use (数据查询). A vehicle running a configuration fires a
// policy; the event pins the release, commit, policy and file versions in force, so later changes
// never rewrite what an old event means. Queries stay inside the reader's grants.

import { authorize } from '../domain/authz.ts';
import type { AuthzTarget } from '../domain/authz.ts';
import { captureCost, fileBytes } from '../domain/budget.ts';
import type { FileType } from '../domain/file-types.ts';
import { notFound, rule } from '../domain/errors.ts';
import { sha256Hex } from '../domain/canonical.ts';
import { newId } from '../domain/ids.ts';
import { admitCapture, afterSalesOpen } from './budget.ts';
import { isCollectionPaused } from './collection-hold.ts';
import type { Actor, Ctx } from './engine.ts';
import { releaseWorkspace } from './emergency.ts';
import type { CollectionEvent, EventFile, Quality, State, TrainingUse } from './types.ts';

/** Which business groups' policies a vehicle's applied configuration carries. */
export function capturablePolicies(s: State, resourceId: string): { groupId: string; commitId: string; policyId: string; name: string }[] {
  const r = s.resources[resourceId];
  const config = r?.appliedConfigId ? s.resolvedConfigs[r.appliedConfigId] : undefined;
  if (!config) return [];
  // Policies a development group switched off do not run on the vehicle.
  return Object.entries(config.groups).flatMap(([groupId, commitId]) =>
    Object.entries(s.commits[commitId]!.policies)
      .filter(([policyId]) => !config.disabledPolicies.includes(policyId))
      .map(([policyId, versionId]) => ({ groupId, commitId, policyId, name: s.policyVersions[versionId]!.content.name })),
  );
}

/**
 * The workspace whose dispatch put the vehicle's applied configuration there. A set that came with
 * the software (the OTA package's DCL module) was dispatched by no one: its data belongs to the
 * workspace whose vehicle group the vehicle is in, else to the one the set was integrated in.
 */
function sourceWorkspace(s: State, resourceId: string, configId: string): string | undefined {
  const deployments = Object.values(s.deployments)
    .filter((d) => d.resolvedConfigId === configId && d.targets.some((t) => t.resourceId === resourceId && t.status === 'APPLIED'))
    .sort((a, b) => b.id.localeCompare(a.id));
  if (deployments[0]) return deployments[0].workspaceId;
  const group = s.groupMembers[resourceId];
  if (group && s.vehicleGroups[group]) return s.vehicleGroups[group].workspaceId;
  const config = s.resolvedConfigs[configId];
  const release = config?.kind === 'RELEASE' ? s.releases[config.sourceId] : undefined;
  return release ? releaseWorkspace(s, release) : undefined;
}

/** Deterministic pseudo size of a personal trial capture, so repeated runs of the demo look the same. */
export function sizeOf(seed: string): number {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return 200_000 + (h % 40_000_000);
}

/**
 * The vehicle fires a policy of its applied configuration (system context: the simulator).
 * Files are the policy's captures, pinned to the versions in that configuration, sized by their
 * type's nominal rate over the capture window. A paused vehicle refuses; otherwise its budget
 * guard decides whether the capture uploads, waits, is dropped or is suppressed as a flood.
 */
export function captureEvent(
  ctx: Ctx,
  input: {
    resourceId: string;
    policyId: string;
    failParse?: boolean;
    origin?: CollectionEvent['origin'];
    /** Who asked: the trigger (default), an after-sales request, or the periodic grader. */
    source?: CollectionEvent['source'];
    requestId?: string;
    /** The workspace whose data query shows it; by default the one that put the configuration there. */
    workspaceId?: string;
    occurredAt?: string;
    quality?: Quality;
    trainingUse?: TrainingUse;
  },
): string {
  const r = ctx.s.resources[input.resourceId];
  if (!r) throw notFound('vehicle', input.resourceId);
  if (r.personal) throw rule('PERSONAL_TRIAL_ONLY', `${r.id} is a personal simulation; its captures are trials for its owner, never collection events`);
  const config = r.appliedConfigId ? ctx.s.resolvedConfigs[r.appliedConfigId] : undefined;
  if (!config) throw rule('NO_APPLIED_CONFIG', `vehicle ${r.id} runs no confirmed configuration, so nothing can fire`);
  const hit = capturablePolicies(ctx.s, r.id).find((p) => p.policyId === input.policyId);
  if (!hit) throw rule('POLICY_NOT_ON_VEHICLE', `policy ${input.policyId} is not in the configuration vehicle ${r.id} runs`);
  if (isCollectionPaused(ctx.s, r.id)) throw rule('COLLECTION_PAUSED', `collection on ${r.id} is paused`);
  const commit = ctx.s.commits[hit.commitId]!;
  const policyVersionId = commit.policies[hit.policyId]!;
  const policy = ctx.s.policyVersions[policyVersionId]!.content;
  const entries = ctx.s.manifestVersions[commit.manifestVersionId]!.entries;
  const id = newId('ev');
  const window = policy.preSeconds + policy.postSeconds;
  const files: EventFile[] = policy.captures.map((dataKey) => {
    const entry = entries.find((e) => e.dataKey === dataKey)!;
    const spec = ctx.s.fileSpecVersions[entry.fileSpecVersionId]!;
    return {
      dataKey,
      fileSpecVersionId: spec.id,
      name: spec.content.name,
      fileType: spec.content.fileType,
      format: spec.content.format,
      schema: spec.content.schema,
      edgePipelineId: spec.content.edgePipelineId,
      cloudPipelineId: spec.content.cloudPipelineId,
      retentionDays: spec.content.retentionDays,
      sizeBytes: fileBytes(spec.content.fileType, window),
      edgeStatus: 'PENDING',
      cloudStatus: 'PENDING',
      artifactUri: null,
      chunks: [],
    };
  });
  for (const f of files) {
    const count = Math.max(1, Math.ceil(f.sizeBytes / CHUNK_BYTES));
    f.chunks = Array.from({ length: count }, (_, index) => ({ index, sha256: chunkDigest(id, f.dataKey, index), received: false }));
  }
  const release = config.kind === 'RELEASE' ? ctx.s.releases[config.sourceId] : undefined;
  const at = input.occurredAt ?? ctx.now;
  const cost = captureCost(
    files.map((f) => ({ fileType: f.fileType as FileType, edgeSteps: ctx.s.pipelines[f.edgePipelineId]?.steps.length ?? 1 })),
    window,
  );
  const source = input.source ?? 'TRIGGER';
  // After-sales captures are core business: they go first, whatever the policy's own priority.
  const priority = source === 'AFTERSALES' ? 'HIGH' : policy.priority;
  const admission = admitCapture(ctx.s, r.id, hit.policyId, priority, cost, at, source);
  // Grader captures wait while after-sales work is open on the vehicle (售后优先，Grader 延迟).
  if (source === 'GRADER' && admission.status === 'UPLOADING' && afterSalesOpen(ctx.s, r.id)) {
    admission.status = 'HELD';
    admission.note = 'DEFERRED';
  }
  for (const evicted of admission.evict) {
    const e = ctx.s.events[evicted]!;
    e.status = 'DROPPED';
    e.budgetNote = 'EVICTED';
    e.failure = `BudgetExceeded: evicted for a HIGH-priority capture (${policy.name})`;
  }
  const stored = admission.status === 'UPLOADING' || admission.status === 'HELD';
  ctx.s.events[id] = {
    id,
    seq: ctx.seq(),
    origin: input.origin ?? 'MOCK_EXECUTION',
    resourceId: r.id,
    vin: r.vin,
    uvid: r.uvid,
    licensePlate: r.licensePlate,
    vehicleModelId: r.vehicleModelId,
    env: r.env,
    integrationVersion: r.integrationVersion,
    workspaceId: input.workspaceId ?? sourceWorkspace(ctx.s, r.id, config.id) ?? r.homeWorkspaceId ?? '',
    groupId: hit.groupId,
    resolvedConfigId: config.id,
    configLabel: config.label,
    releaseId: release?.id ?? null,
    commitId: commit.id,
    policyId: hit.policyId,
    policyVersionId,
    policyName: policy.name,
    trigger: policy.trigger,
    preSeconds: policy.preSeconds,
    postSeconds: policy.postSeconds,
    occurredAt: at,
    files,
    status: admission.status,
    failure: admission.status === 'SUPPRESSED' ? `TriggerFlood: ${policy.name} fired more often than its hourly limit` : admission.status === 'DROPPED' ? `BudgetExceeded: ${admission.note?.toLowerCase()}` : null,
    priority,
    source,
    requestId: input.requestId ?? null,
    cost,
    writtenAt: stored ? at : null,
    uploadAt: admission.status === 'UPLOADING' ? at : null,
    budgetNote: admission.note,
    failParse: input.failParse ?? false,
    processingAttempts: 0,
    callbacks: [],
    callbackSends: 0,
    quality: input.quality ?? 'UNKNOWN',
    trainingUse: input.trainingUse ?? 'UNCONFIRMED',
  };
  return id;
}

/** One processing step (system context): edge upload, then cloud parsing of every file. */
export function advanceEvent(ctx: Ctx, eventId: string): CollectionEvent['status'] {
  const e = ctx.s.events[eventId];
  if (!e) throw notFound('event', eventId);
  if (e.status === 'UPLOADING') {
    // The edge sends every outstanding chunk.
    for (const f of e.files) for (const c of f.chunks) receiveChunk(ctx, e.id, f.dataKey, c.index, c.sha256);
  } else if (e.status === 'PROCESSING') {
    e.processingAttempts += 1;
    if (e.failParse) {
      for (const f of e.files) if (f.cloudStatus !== 'DONE') f.cloudStatus = 'PARSER_FAILED';
      e.status = 'FAILED';
      e.failure = `ParserFailure: ${e.files[0]?.schema ?? 'schema'} could not be parsed`;
    } else {
      for (const f of e.files) {
        f.cloudStatus = 'DONE';
        f.artifactUri = `dcl://artifacts/${e.id}/${f.dataKey}`;
      }
      e.status = 'DONE';
      e.failure = null;
      deliverCallback(ctx, e.id);
    }
  }
  return e.status;
}

const CHUNK_BYTES = 8_000_000;

function chunkDigest(eventId: string, dataKey: string, index: number): string {
  return `sha256:${sha256Hex(`${eventId}/${dataKey}/${index}`)}`;
}

/**
 * One upload chunk arrives (system context: the vehicle's uploader). A resent chunk changes
 * nothing; a chunk whose checksum does not match is refused and must be sent again.
 */
export function receiveChunk(ctx: Ctx, eventId: string, dataKey: string, index: number, checksum: string): 'ACCEPTED' | 'REPLAYED' {
  const e = ctx.s.events[eventId];
  if (!e) throw notFound('event', eventId);
  const f = e.files.find((x) => x.dataKey === dataKey);
  const chunk = f?.chunks.find((c) => c.index === index);
  if (!f || !chunk) throw notFound('upload chunk', `${eventId}/${dataKey}/${index}`);
  if (e.status === 'HELD' || !carriesData(e)) throw rule('NOT_UPLOADING', `the vehicle is not uploading ${e.id}`);
  if (checksum !== chunk.sha256) throw rule('CHECKSUM_MISMATCH', `chunk ${index} of ${f.name} does not match its checksum; it was not stored`);
  if (chunk.received) return 'REPLAYED';
  chunk.received = true;
  if (f.chunks.every((c) => c.received)) f.edgeStatus = 'UPLOADED';
  if (e.status === 'UPLOADING' && e.files.every((x) => x.edgeStatus === 'UPLOADED')) e.status = 'PROCESSING';
  return 'ACCEPTED';
}

/** Notifies the business consumer that the event's artifacts are ready; repeats are deduplicated. */
export function deliverCallback(ctx: Ctx, eventId: string): 'DELIVERED' | 'DUPLICATE' {
  const e = ctx.s.events[eventId];
  if (!e) throw notFound('event', eventId);
  if (e.status !== 'DONE') throw rule('CALLBACK_TOO_EARLY', 'the event is not processed yet');
  e.callbackSends += 1;
  if (e.callbacks.length > 0) return 'DUPLICATE';
  e.callbacks.push({ deliveryId: `cb-${e.id}`, at: ctx.now });
  return 'DELIVERED';
}

/** Runs an event's processing to its end, e.g. for demo samples. */
export function processEvent(ctx: Ctx, eventId: string): CollectionEvent['status'] {
  let status = ctx.s.events[eventId]!.status;
  while (status === 'UPLOADING' || status === 'PROCESSING') status = advanceEvent(ctx, eventId);
  return status;
}

/** External quality check and usage authorization results (simulated services). */
export function assessEvent(ctx: Ctx, eventId: string, input: { quality?: Quality; trainingUse?: TrainingUse }): void {
  const e = ctx.s.events[eventId];
  if (!e) throw notFound('event', eventId);
  if (input.quality) e.quality = input.quality;
  if (input.trainingUse) e.trainingUse = input.trainingUse;
}

export function setFailParse(ctx: Ctx, eventId: string, failParse: boolean): void {
  const e = ctx.s.events[eventId];
  if (!e) throw notFound('event', eventId);
  e.failParse = failParse;
}

export function eventTarget(s: State, e: CollectionEvent): AuthzTarget & { env: CollectionEvent['env'] } {
  const ws = s.workspaces[e.workspaceId];
  const group = s.groups[e.groupId];
  // Team events are scoped to the group's domain; project and integration events to the vehicle.
  return { workspaceId: e.workspaceId, groupId: e.groupId, scope: ws?.kind === 'TEAM' && group ? group.domain : 'Vehicle', env: e.env };
}

/** DCL engineering reprocesses a failed event with the same pinned pipelines. */
export function reprocessEvent(ctx: Ctx, eventId: string): void {
  const e = ctx.s.events[eventId];
  if (!e) throw notFound('event', eventId);
  ctx.allow('event.reprocess', { type: 'event', id: e.id, ...eventTarget(ctx.s, e) });
  if (e.status !== 'FAILED') throw rule('EVENT_NOT_FAILED', 'only a failed event can be reprocessed');
  for (const f of e.files) if (f.cloudStatus === 'PARSER_FAILED') f.cloudStatus = 'PENDING';
  e.status = 'PROCESSING';
  e.failure = null;
  // The parser issue is assumed fixed on the platform side; the pinned versions stay the same.
  e.failParse = false;
}

/** Whether the platform has, or will get, the capture's data: not dropped or suppressed on the vehicle. */
export function carriesData(e: Pick<CollectionEvent, 'status'>): boolean {
  return e.status !== 'DROPPED' && e.status !== 'SUPPRESSED';
}

/** Events with data in the workspace the actor may read, newest first. */
export function visibleEvents(s: State, actor: Actor, workspaceId: string): CollectionEvent[] {
  return Object.values(s.events)
    .filter((e) => e.workspaceId === workspaceId && carriesData(e) && authorize(actor.grants, 'event.query', eventTarget(s, e)).ok)
    .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : b.seq - a.seq));
}

export interface AftersalesFilter {
  vehicle?: string;
  event?: string;
  policy?: string;
  from?: string;
  to?: string;
  status?: CollectionEvent['status'] | 'ALL';
}

const has = (value: string | null | undefined, q: string) => !!value && value.toLowerCase().includes(q.toLowerCase());

export function aftersalesQuery(s: State, actor: Actor, workspaceId: string, f: AftersalesFilter): CollectionEvent[] {
  return visibleEvents(s, actor, workspaceId).filter(
    (e) =>
      (!f.vehicle || [e.resourceId, e.vin, e.uvid, e.licensePlate].some((v) => has(v, f.vehicle!))) &&
      (!f.event || has(e.id, f.event) || has(e.policyName, f.event)) &&
      (!f.policy || has(e.policyId, f.policy) || has(e.policyName, f.policy)) &&
      (!f.from || e.occurredAt >= f.from) &&
      (!f.to || e.occurredAt <= `${f.to}T23:59:59.999Z`) &&
      (!f.status || f.status === 'ALL' || e.status === f.status),
  );
}

/** Why an event cannot be used for training; empty when it can. Unknown never counts as passed. */
export function trainingBlockers(e: CollectionEvent): string[] {
  const blockers: string[] = [];
  if (e.status !== 'DONE') blockers.push(e.status === 'FAILED' ? 'processing failed' : e.status === 'HELD' ? 'upload waiting for budget' : 'processing not finished');
  if (e.files.length === 0 || e.files.some((f) => f.cloudStatus !== 'DONE')) blockers.push('captured files incomplete');
  if (e.quality !== 'A' && e.quality !== 'B') blockers.push(e.quality === 'UNKNOWN' ? 'quality unknown' : `quality ${e.quality}`);
  if (e.trainingUse !== 'ALLOWED') blockers.push(e.trainingUse === 'UNCONFIRMED' ? 'training use not confirmed' : 'training use denied');
  return blockers;
}

/** Training records never carry vehicle identity or vehicle software. */
export interface TrainingRecord {
  eventId: string;
  vehicleModelId: string;
  env: CollectionEvent['env'];
  groupId: string;
  policyId: string;
  policyName: string;
  scenario: string;
  occurredAt: string;
  status: CollectionEvent['status'];
  quality: Quality;
  trainingUse: TrainingUse;
  fileCount: number;
  /** Where the data came from; every prototype event is a mock and says so. */
  origin: CollectionEvent['origin'];
  blockers: string[];
}

function trainingRecord(e: CollectionEvent): TrainingRecord {
  return {
    eventId: e.id,
    vehicleModelId: e.vehicleModelId,
    env: e.env,
    groupId: e.groupId,
    policyId: e.policyId,
    policyName: e.policyName,
    scenario: e.policyName,
    occurredAt: e.occurredAt,
    status: e.status,
    quality: e.quality,
    trainingUse: e.trainingUse,
    fileCount: e.files.length,
    origin: e.origin,
    blockers: trainingBlockers(e),
  };
}

export interface TrainingFilter {
  vehicleModelId?: string;
  policy?: string;
  scenario?: string;
  from?: string;
  to?: string;
  quality?: Quality | 'ALL';
  /** SELECTABLE (default): only data that can be used; ALL: everything with reasons. */
  availability?: 'SELECTABLE' | 'ALL';
}

export function trainingQuery(s: State, actor: Actor, workspaceId: string, f: TrainingFilter): TrainingRecord[] {
  return visibleEvents(s, actor, workspaceId)
    .map(trainingRecord)
    .filter(
      (t) =>
        (!f.vehicleModelId || t.vehicleModelId === f.vehicleModelId) &&
        (!f.policy || has(t.policyId, f.policy)) &&
        (!f.scenario || has(t.scenario, f.scenario)) &&
        (!f.from || t.occurredAt >= f.from) &&
        (!f.to || t.occurredAt <= `${f.to}T23:59:59.999Z`) &&
        (!f.quality || f.quality === 'ALL' || t.quality === f.quality) &&
        ((f.availability ?? 'SELECTABLE') === 'ALL' || t.blockers.length === 0),
    );
}

export interface DataManifest {
  kind: 'kairoz.data-manifest';
  version: 1;
  generatedAt: string;
  generatedBy: string;
  /** True when any item is simulated or demo data: never to be registered as real collection. */
  mock: boolean;
  items: {
    eventId: string;
    origin: CollectionEvent['origin'];
    vehicleModelId: string;
    policyId: string;
    policyVersion: number;
    scenario: string;
    occurredAt: string;
    dclVersion: string | null;
    quality: Quality;
    files: { dataKey: string; name: string; format: string; schema: string; fileSpecVersion: number; edgePipeline: string; cloudPipeline: string; artifactUri: string; sizeBytes: number }[];
  }[];
}

/** Builds the export manifest of selected training data. Every item is checked again. */
export function exportManifest(ctx: Ctx, eventIds: string[]): DataManifest {
  if (eventIds.length === 0) throw rule('NOTHING_SELECTED', 'select data to export');
  const problems: string[] = [];
  const events = eventIds.map((id) => {
    const e = ctx.s.events[id];
    if (!e) throw notFound('event', id);
    ctx.allow('event.query', { type: 'event', id: e.id, ...eventTarget(ctx.s, e) });
    for (const b of trainingBlockers(e)) problems.push(`${e.id}: ${b}`);
    return e;
  });
  if (problems.length) throw rule('NOT_SELECTABLE', 'some events cannot be used for training', { issues: problems });
  const pipeline = (id: string) => {
    const p = ctx.s.pipelines[id];
    return p ? `${p.code}@${p.version}` : id;
  };
  return {
    kind: 'kairoz.data-manifest',
    version: 1,
    generatedAt: ctx.now,
    generatedBy: ctx.user().username,
    mock: events.some((e) => e.origin.startsWith('MOCK')),
    items: events.map((e) => ({
      eventId: e.id,
      origin: e.origin,
      vehicleModelId: e.vehicleModelId,
      policyId: e.policyId,
      policyVersion: ctx.s.policyVersions[e.policyVersionId]?.version ?? 0,
      scenario: e.policyName,
      occurredAt: e.occurredAt,
      dclVersion: e.releaseId ? (ctx.s.releases[e.releaseId]?.dclVersion ?? null) : null,
      quality: e.quality,
      files: e.files.map((f) => ({
        dataKey: f.dataKey,
        name: f.name,
        format: f.format,
        schema: f.schema,
        fileSpecVersion: ctx.s.fileSpecVersions[f.fileSpecVersionId]?.version ?? 0,
        edgePipeline: pipeline(f.edgePipelineId),
        cloudPipeline: pipeline(f.cloudPipelineId),
        artifactUri: f.artifactUri!,
        sizeBytes: f.sizeBytes,
      })),
    })),
  };
}
