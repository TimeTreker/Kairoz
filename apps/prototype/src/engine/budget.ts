// Collection budgets and the vehicle's budget guard (资源预算 / 运行保护). DCL engineering sets one
// budget per vehicle model and may override it for a single vehicle. The agent (the simulator)
// admits each capture against the vehicle's rolling hour: a flood is suppressed, captures over
// the CPU or storage budget or a full buffer are dropped, and captures over the upload budget
// wait. HIGH-priority captures, the core business, are collected even over budget. At merge,
// DCL checks every policy's cost against the model budget (资源保护) before confirming.

import { budgetIssues, captureCost, DEFAULT_BUDGET, mayThrottle, neverFits, ZERO_COST } from '../domain/budget.ts';
import type { Budget, BudgetDimension, CaptureCost } from '../domain/budget.ts';
import type { GroupConfig, Priority } from '../domain/config.ts';
import { notFound, rule } from '../domain/errors.ts';
import { WILDCARD } from '../domain/vocabulary.ts';
import type { FileType } from '../domain/file-types.ts';
import { nowOf } from './clock.ts';
import type { Ctx } from './engine.ts';
import { resolveFiles } from './snapshots.ts';
import type { BudgetNote, CollectionEvent, MergePlan, State } from './types.ts';

const HOUR_MS = 3_600_000;

export type BudgetSource = 'VEHICLE' | 'MODEL' | 'DEFAULT';

/** The model's budget, or the default until DCL sets one. */
export function modelBudget(s: State, vehicleModelId: string): { budget: Budget; source: BudgetSource } {
  const b = s.collectionBudgets.models[vehicleModelId];
  return b ? { budget: b, source: 'MODEL' } : { budget: DEFAULT_BUDGET, source: 'DEFAULT' };
}

/** A vehicle's budget: its own override, else its model's. */
export function budgetOf(s: State, resourceId: string): { budget: Budget; source: BudgetSource } {
  const own = s.collectionBudgets.vehicles[resourceId];
  if (own) return { budget: own, source: 'VEHICLE' };
  const r = s.resources[resourceId];
  return r ? modelBudget(s, r.vehicleModelId) : { budget: DEFAULT_BUDGET, source: 'DEFAULT' };
}

function checked(input: Budget): Budget {
  const issues = budgetIssues(input);
  if (issues.length) throw rule('INVALID_BUDGET', 'every budget value must be a positive number (the trigger limit a whole one)', { issues });
  return {
    cpuSecondsPerHour: input.cpuSecondsPerHour,
    memoryMb: input.memoryMb,
    ioMbPerHour: input.ioMbPerHour,
    networkMbPerHour: input.networkMbPerHour,
    triggersPerPolicyPerHour: input.triggersPerPolicyPerHour,
  };
}

/** DCL engineering sets a vehicle model's collection budget. */
export function setModelBudget(ctx: Ctx, vehicleModelId: string, input: Budget): void {
  ctx.allow('budget.manage', { type: 'collectionBudget', id: vehicleModelId, workspaceId: WILDCARD });
  if (!ctx.s.vehicleModels[vehicleModelId]) throw notFound('vehicle model', vehicleModelId);
  ctx.s.collectionBudgets.models[vehicleModelId] = checked(input);
}

/** DCL engineering gives one vehicle (a bench, a test car) its own budget, or clears it with null. */
export function setVehicleBudget(ctx: Ctx, resourceId: string, input: Budget | null): void {
  ctx.allow('budget.manage', { type: 'collectionBudget', id: resourceId, workspaceId: WILDCARD });
  if (!ctx.s.resources[resourceId]) throw notFound('vehicle', resourceId);
  if (input === null) {
    if (!ctx.s.collectionBudgets.vehicles[resourceId]) throw rule('NO_VEHICLE_BUDGET', `${resourceId} has no budget of its own`);
    delete ctx.s.collectionBudgets.vehicles[resourceId];
    return;
  }
  ctx.s.collectionBudgets.vehicles[resourceId] = checked(input);
}

export interface BudgetUsage {
  /** The rolling hour, as ISO times. */
  from: string;
  to: string;
  cpuSec: number;
  ioMb: number;
  networkMb: number;
  /** Captures on the vehicle now: waiting or uploading. */
  bufferMb: number;
  /** Triggers per policy in the hour, suppressed ones not counted. */
  triggers: Record<string, number>;
  held: number;
  dropped: number;
  suppressed: number;
}

const cost = (e: CollectionEvent): CaptureCost => e.cost ?? ZERO_COST;
const round = (n: number) => Math.round(n * 100) / 100;

/** What a vehicle spent on collection in the hour up to `at` (the platform clock by default). */
export function usageOf(s: State, resourceId: string, at: string = nowOf(s)): BudgetUsage {
  const to = Date.parse(at);
  const from = to - HOUR_MS;
  const inHour = (iso: string | null) => !!iso && Date.parse(iso) > from && Date.parse(iso) <= to;
  const u: BudgetUsage = { from: new Date(from).toISOString(), to: at, cpuSec: 0, ioMb: 0, networkMb: 0, bufferMb: 0, triggers: {}, held: 0, dropped: 0, suppressed: 0 };
  for (const e of Object.values(s.events)) {
    if (e.resourceId !== resourceId) continue;
    const c = cost(e);
    if (inHour(e.writtenAt)) {
      u.cpuSec += c.cpuSec;
      u.ioMb += c.ioMb;
    }
    if (inHour(e.uploadAt)) u.networkMb += c.networkMb;
    if (e.status === 'HELD' || e.status === 'UPLOADING') u.bufferMb += c.memoryMb;
    if (e.status === 'HELD') u.held += 1;
    if (inHour(e.occurredAt)) {
      if (e.status === 'SUPPRESSED') u.suppressed += 1;
      else u.triggers[e.policyId] = (u.triggers[e.policyId] ?? 0) + 1;
      if (e.status === 'DROPPED') u.dropped += 1;
    }
  }
  u.cpuSec = round(u.cpuSec);
  u.ioMb = round(u.ioMb);
  u.networkMb = round(u.networkMb);
  u.bufferMb = round(u.bufferMb);
  return u;
}

/** What one capture of `config`'s policy costs: its files over the window, each through its edge steps. */
export function policyCost(s: State, config: GroupConfig, policyId: string): CaptureCost {
  const policy = config.policies[policyId];
  if (!policy) return ZERO_COST;
  const files = resolveFiles(s, config);
  return captureCost(
    policy.captures.map((k) => files[k]).filter((f): f is NonNullable<typeof f> => !!f).map((f) => ({ fileType: f.fileType as FileType, edgeSteps: s.pipelines[f.edgePipelineId]?.steps.length ?? 1 })),
    policy.preSeconds + policy.postSeconds,
  );
}

export interface Admission {
  status: 'UPLOADING' | 'HELD' | 'DROPPED' | 'SUPPRESSED';
  note: BudgetNote | null;
  /** Waiting captures dropped to make room for a HIGH one. */
  evict: string[];
}

const RANK: Record<Priority, number> = { HIGH: 0, NORMAL: 1, LOW: 2 };

/**
 * The agent's decision on a new capture, against the vehicle's rolling hour at `at`. HIGH
 * captures are never dropped or held for budget: they make room by evicting waiting captures,
 * lowest priority and newest first, and are flagged when they still run over.
 */
export function admitCapture(s: State, resourceId: string, policyId: string, priority: Priority, c: CaptureCost, at: string): Admission {
  const { budget: b } = budgetOf(s, resourceId);
  const u = usageOf(s, resourceId, at);
  if ((u.triggers[policyId] ?? 0) >= b.triggersPerPolicyPerHour) return { status: 'SUPPRESSED', note: 'FLOOD', evict: [] };
  const overCpu = u.cpuSec + c.cpuSec > b.cpuSecondsPerHour;
  const overIo = u.ioMb + c.ioMb > b.ioMbPerHour;
  const overBuffer = u.bufferMb + c.memoryMb > b.memoryMb;
  const overNetwork = u.networkMb + c.networkMb > b.networkMbPerHour;
  if (priority !== 'HIGH') {
    if (overCpu) return { status: 'DROPPED', note: 'CPU', evict: [] };
    if (overIo) return { status: 'DROPPED', note: 'IO', evict: [] };
    if (overBuffer) return { status: 'DROPPED', note: 'MEMORY', evict: [] };
    // Waiting only helps a capture that fits an hour's upload; a bigger one would wait forever.
    if (c.networkMb > b.networkMbPerHour) return { status: 'DROPPED', note: 'NETWORK', evict: [] };
    return { status: overNetwork ? 'HELD' : 'UPLOADING', note: null, evict: [] };
  }
  const evict: string[] = [];
  let buffer = u.bufferMb;
  if (buffer + c.memoryMb > b.memoryMb) {
    const waiting = Object.values(s.events)
      .filter((e) => e.resourceId === resourceId && e.status === 'HELD' && e.priority !== 'HIGH')
      .sort((x, y) => RANK[y.priority] - RANK[x.priority] || y.occurredAt.localeCompare(x.occurredAt) || y.seq - x.seq);
    for (const e of waiting) {
      if (buffer + c.memoryMb <= b.memoryMb) break;
      evict.push(e.id);
      buffer -= cost(e).memoryMb;
    }
  }
  const over = overCpu || overIo || overNetwork || buffer + c.memoryMb > b.memoryMb;
  return { status: 'UPLOADING', note: over ? 'OVER_BUDGET_HIGH' : null, evict };
}

/**
 * The agent uploads waiting captures as the upload budget allows: HIGH first, then NORMAL, then
 * LOW, oldest first within each, and never past one that does not fit yet (system context). A
 * capture that no longer fits an hour's upload at all (the budget was lowered) is dropped, so it
 * never blocks the ones behind it.
 */
export function releaseHeld(ctx: Ctx, resourceId: string): number {
  const at = nowOf(ctx.s);
  const { budget: b } = budgetOf(ctx.s, resourceId);
  let network = usageOf(ctx.s, resourceId, at).networkMb;
  const waiting = Object.values(ctx.s.events)
    .filter((e) => e.resourceId === resourceId && e.status === 'HELD')
    .sort((x, y) => RANK[x.priority] - RANK[y.priority] || x.occurredAt.localeCompare(y.occurredAt) || x.seq - y.seq);
  let released = 0;
  for (const e of waiting) {
    if (cost(e).networkMb > b.networkMbPerHour) {
      e.status = 'DROPPED';
      e.budgetNote = 'NETWORK';
      e.failure = 'BudgetExceeded: network';
      continue;
    }
    if (network + cost(e).networkMb > b.networkMbPerHour) break;
    e.status = 'UPLOADING';
    e.uploadAt = at;
    network += cost(e).networkMb;
    released += 1;
  }
  return released;
}

export type PolicyBudgetStatus = 'OK' | 'MAY_THROTTLE' | 'NEVER_FITS';

export interface PolicyBudgetCheck {
  groupId: string;
  policyId: string;
  name: string;
  priority: Priority;
  windowSeconds: number;
  cost: CaptureCost;
  status: PolicyBudgetStatus;
  /** NEVER_FITS: dimensions one capture exceeds; MAY_THROTTLE: dimensions an hour of triggers exceeds. */
  dimensions: BudgetDimension[];
}

/**
 * Resource protection (资源保护) of a merge: every policy of the merged groups against the
 * vehicle model's budget. A capture that exceeds a budget on its own can never be collected.
 */
export function resourceCheck(s: State, plan: Pick<MergePlan, 'vehicleModelId' | 'merged'>): { budget: Budget; source: BudgetSource; policies: PolicyBudgetCheck[] } {
  const { budget, source } = modelBudget(s, plan.vehicleModelId);
  const policies: PolicyBudgetCheck[] = [];
  for (const [groupId, config] of Object.entries(plan.merged)) {
    for (const [policyId, p] of Object.entries(config.policies).sort(([a], [b]) => a.localeCompare(b))) {
      const c = policyCost(s, config, policyId);
      const never = neverFits(c, budget);
      const throttle = mayThrottle(c, budget);
      const status: PolicyBudgetStatus = never.length ? 'NEVER_FITS' : throttle.length ? 'MAY_THROTTLE' : 'OK';
      policies.push({ groupId, policyId, name: p.name, priority: p.priority, windowSeconds: p.preSeconds + p.postSeconds, cost: c, status, dimensions: never.length ? never : throttle });
    }
  }
  return { budget, source, policies };
}

/** The resource-protection problems that block DCL's confirmation, as problem lines. */
export function resourceBlockers(s: State, plan: Pick<MergePlan, 'vehicleModelId' | 'merged'>): string[] {
  const { budget, policies } = resourceCheck(s, plan);
  return policies
    .filter((p) => p.status === 'NEVER_FITS')
    .map((p) => `${s.groups[p.groupId]?.code ?? p.groupId}: policy ${p.policyId}: one capture exceeds the ${plan.vehicleModelId} budget (${p.dimensions.map((d) => dimensionText(d, p.cost, budget)).join(', ')})`);
}

function dimensionText(d: BudgetDimension, c: CaptureCost, b: Budget): string {
  switch (d) {
    case 'cpu':
      return `CPU ${c.cpuSec} s > ${b.cpuSecondsPerHour} s per hour`;
    case 'memory':
      return `memory ${c.memoryMb} MB > ${b.memoryMb} MB`;
    case 'io':
      return `storage ${c.ioMb} MB > ${b.ioMbPerHour} MB per hour`;
    case 'network':
      return `upload ${c.networkMb} MB > ${b.networkMbPerHour} MB per hour`;
  }
}
