// Collection budget (采集预算, 资源保护): what one capture costs a vehicle, and what a vehicle may
// spend on collection in an hour. Data rates are nominal per file type; real CPU and memory
// figures need a bench, so the prototype checks the rules, never the numbers.

import type { FileType } from './file-types.ts';

export interface Budget {
  /** Edge processing (compress, encrypt, desensitize …) per rolling hour. */
  cpuSecondsPerHour: number;
  /** Captures kept on the vehicle until they are uploaded (the buffer). */
  memoryMb: number;
  /** Captures written to vehicle storage per rolling hour. */
  ioMbPerHour: number;
  /** Captures uploaded per rolling hour. */
  networkMbPerHour: number;
  /** Triggers of one policy per rolling hour; more is a flood and is suppressed. */
  triggersPerPolicyPerHour: number;
}

export const BUDGET_FIELDS = ['cpuSecondsPerHour', 'memoryMb', 'ioMbPerHour', 'networkMbPerHour', 'triggersPerPolicyPerHour'] as const;

/** What a vehicle model gets until DCL engineering sets its budget. */
export const DEFAULT_BUDGET: Budget = { cpuSecondsPerHour: 300, memoryMb: 512, ioMbPerHour: 2000, networkMbPerHour: 1000, triggersPerPolicyPerHour: 30 };

export interface CaptureCost {
  cpuSec: number;
  memoryMb: number;
  ioMb: number;
  networkMb: number;
}

export type BudgetDimension = 'cpu' | 'memory' | 'io' | 'network';

/** Nominal data rate of each file type while a capture window is open, in KB/s. */
export const FILE_RATE_KBPS: Record<FileType, number> = {
  text_log: 20,
  bin_log: 200,
  can_log: 150,
  camera_image: 400,
  camera_video: 2500,
  pointcloud: 6000,
  gnss: 5,
  unknown: 500,
};

/** Edge CPU seconds per MB for each processing step. */
const CPU_SEC_PER_MB_STEP = 0.05;

const round = (n: number) => Math.round(n * 100) / 100;

/** Bytes one file of `type` takes for a capture window of `seconds`. */
export function fileBytes(type: FileType, seconds: number): number {
  return Math.round(FILE_RATE_KBPS[type] * 1000 * seconds);
}

/** The cost of one capture: its files over the window, each processed by its edge steps. */
export function captureCost(files: { fileType: FileType; edgeSteps: number }[], seconds: number): CaptureCost {
  let mb = 0;
  let cpu = 0;
  for (const f of files) {
    const fileMb = fileBytes(f.fileType, seconds) / 1_000_000;
    mb += fileMb;
    cpu += fileMb * Math.max(1, f.edgeSteps) * CPU_SEC_PER_MB_STEP;
  }
  return { cpuSec: round(cpu), memoryMb: round(mb), ioMb: round(mb), networkMb: round(mb) };
}

export const ZERO_COST: CaptureCost = { cpuSec: 0, memoryMb: 0, ioMb: 0, networkMb: 0 };

/** Dimensions a single capture exceeds on its own: under this budget it can never be collected. */
export function neverFits(cost: CaptureCost, b: Budget): BudgetDimension[] {
  const out: BudgetDimension[] = [];
  if (cost.cpuSec > b.cpuSecondsPerHour) out.push('cpu');
  if (cost.memoryMb > b.memoryMb) out.push('memory');
  if (cost.ioMb > b.ioMbPerHour) out.push('io');
  if (cost.networkMb > b.networkMbPerHour) out.push('network');
  return out;
}

/** Dimensions where a full hour of triggers (up to the flood limit) exceeds the budget: captures may wait or be dropped. */
export function mayThrottle(cost: CaptureCost, b: Budget): BudgetDimension[] {
  const n = b.triggersPerPolicyPerHour;
  const out: BudgetDimension[] = [];
  if (cost.cpuSec * n > b.cpuSecondsPerHour) out.push('cpu');
  if (cost.ioMb * n > b.ioMbPerHour) out.push('io');
  if (cost.networkMb * n > b.networkMbPerHour) out.push('network');
  return out;
}

/** Problems with a budget someone wants to set; empty when it is valid. */
export function budgetIssues(b: Partial<Budget>): string[] {
  const issues: string[] = [];
  for (const k of BUDGET_FIELDS) {
    const v = b[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) issues.push(`${k} must be a positive number`);
    else if (k === 'triggersPerPolicyPerHour' && !Number.isInteger(v)) issues.push(`${k} must be a whole number`);
  }
  return issues;
}
