// DCL intake rules. A sensitive file is approved for specific content: the fields that decide
// what is collected and how it is handled, plus the policies that capture it. Changing any of
// them produces new signatures, so an earlier approval no longer applies.

import { digestOf } from './canonical.ts';
import type { FileSpecContent, PolicyContent } from './config.ts';

/** File fields an approval covers. Display name and priority are deliberately excluded. */
const APPROVAL_FILE_FIELDS = [
  'source',
  'fileType',
  'purpose',
  'privacy',
  'retentionDays',
  'contentTags',
  'templateId',
  'format',
  'schema',
  'edgePipelineId',
  'cloudPipelineId',
] as const satisfies readonly (keyof FileSpecContent)[];

export function fileApprovalSignature(spec: FileSpecContent): string {
  return digestOf(Object.fromEntries(APPROVAL_FILE_FIELDS.map((f) => [f, spec[f]])));
}

/** Trigger, window and co-captured files of every policy that captures `dataKey`. */
export function policyApprovalSignature(policies: Record<string, PolicyContent>, dataKey: string): string {
  const capturing = Object.entries(policies)
    .filter(([, p]) => p.captures.includes(dataKey))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([id, p]) => [id, { trigger: p.trigger, captures: p.captures, preSeconds: p.preSeconds, postSeconds: p.postSeconds }]);
  return digestOf(capturing);
}

/** What DCL confirms when approving: purpose, collection scope, retention, access, upload, processing. */
export interface ReviewControls {
  purposeConfirmed: boolean;
  scopeConfirmed: boolean;
  retentionConfirmed: boolean;
  accessControl: string;
  uploadControl: string;
  processingControl: string;
  notes?: string;
}

export function approvalControlIssues(controls: ReviewControls | undefined): string[] {
  if (!controls) return ['controls are required to approve'];
  const issues: string[] = [];
  if (!controls.purposeConfirmed) issues.push('confirm the collection purpose');
  if (!controls.scopeConfirmed) issues.push('confirm the collection scope');
  if (!controls.retentionConfirmed) issues.push('confirm the retention period');
  for (const field of ['accessControl', 'uploadControl', 'processingControl'] as const) {
    if (controls[field].trim().length === 0) issues.push(`describe ${field}`);
  }
  return issues;
}

export type ReviewStatus = 'APPROVED' | 'REJECTED' | 'PENDING';
