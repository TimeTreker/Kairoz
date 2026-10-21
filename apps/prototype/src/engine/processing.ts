// Processing catalog owned by DCL engineering: immutable Edge/Cloud pipeline versions and the
// default binding (template) per file type. A clean installation has none; adding a file of a
// type without a template is blocked rather than silently defaulted.

import { rule } from '../domain/errors.ts';
import { SLUG } from '../domain/ids.ts';
import { isSensitiveType, typeAlwaysRequiresReview } from '../domain/file-types.ts';
import type { FileType, Privacy } from '../domain/file-types.ts';
import { WILDCARD } from '../domain/vocabulary.ts';
import type { Ctx } from './engine.ts';
import type { State, Template } from './types.ts';

/** The catalog applies to every group and workspace, so only a platform-wide DCL grant may change it. */
const CATALOG_WIDE = { workspaceId: WILDCARD, groupId: WILDCARD } as const;

export interface PipelineInput {
  code: string;
  side: 'EDGE' | 'CLOUD';
  name: string;
  formats: string[];
  schemas?: string[];
  steps: string[];
  capability?: string;
}

/** Publishes the next immutable version of a pipeline code. */
export function createPipeline(ctx: Ctx, input: PipelineInput): string {
  ctx.allow('processing.manage', { type: 'pipeline', id: input.code, ...CATALOG_WIDE });
  if (!SLUG.test(input.code)) throw rule('INVALID_ID', `pipeline code must match ${SLUG.source}`);
  if (input.formats.length === 0 || input.steps.length === 0) throw rule('INVALID_PIPELINE', 'formats and steps are required');
  const versions = Object.values(ctx.s.pipelines).filter((p) => p.code === input.code);
  const latest = versions.sort((a, b) => b.version - a.version)[0];
  if (latest && latest.side !== input.side) throw rule('PIPELINE_SIDE_FIXED', `pipeline ${input.code} is a ${latest.side} pipeline`);
  const version = (latest?.version ?? 0) + 1;
  const id = `${input.code}@${version}`;
  ctx.s.pipelines[id] = {
    id,
    code: input.code,
    version,
    side: input.side,
    name: input.name,
    formats: [...input.formats],
    schemas: input.schemas?.length ? [...input.schemas] : ['*'],
    steps: [...input.steps],
    capability: input.capability ?? 'RawStorage',
    createdBy: ctx.user().username,
    createdAt: ctx.now,
  };
  return id;
}

export interface Binding {
  format: string;
  schema: string;
  edgePipelineId: string;
  cloudPipelineId: string;
}

/** Problems with an Edge/Cloud binding for the given format and schema; empty if compatible. */
export function bindingIssues(s: State, binding: Binding): string[] {
  const issues: string[] = [];
  for (const [id, side] of [
    [binding.edgePipelineId, 'EDGE'],
    [binding.cloudPipelineId, 'CLOUD'],
  ] as const) {
    const p = s.pipelines[id];
    if (!p) {
      issues.push(`${side} pipeline ${id} does not exist`);
      continue;
    }
    if (p.side !== side) issues.push(`${id} is not an ${side} pipeline`);
    if (!p.formats.includes(binding.format)) issues.push(`${id} does not support format ${binding.format}`);
    if (!p.schemas.includes('*') && !p.schemas.includes(binding.schema)) issues.push(`${id} does not support schema ${binding.schema}`);
  }
  return issues;
}

/** The default template for a file type: its highest version. */
export function currentTemplate(s: State, fileType: FileType): Template | undefined {
  return Object.values(s.templates)
    .filter((t) => t.fileType === fileType)
    .sort((a, b) => b.version - a.version)[0];
}

export interface TemplateInput extends Binding {
  fileType: FileType;
  requiresReview?: boolean;
  defaultPrivacy?: Privacy;
  defaultRetentionDays: number;
  capability?: string;
}

export function createTemplate(ctx: Ctx, input: TemplateInput): string {
  ctx.allow('processing.manage', { type: 'template', id: input.fileType, ...CATALOG_WIDE });
  const issues = bindingIssues(ctx.s, input);
  if (issues.length) throw rule('INCOMPATIBLE_BINDING', 'the Edge/Cloud binding is not compatible', { issues });
  if (!Number.isInteger(input.defaultRetentionDays) || input.defaultRetentionDays < 1) {
    throw rule('INVALID_TEMPLATE', 'default retention must be a positive number of days');
  }
  const version = (currentTemplate(ctx.s, input.fileType)?.version ?? 0) + 1;
  const id = `template-${input.fileType}@${version}`;
  ctx.s.templates[id] = {
    id,
    fileType: input.fileType,
    version,
    format: input.format,
    schema: input.schema,
    edgePipelineId: input.edgePipelineId,
    cloudPipelineId: input.cloudPipelineId,
    // Sensitive and unknown types always require review; that cannot be configured away.
    requiresReview: typeAlwaysRequiresReview(input.fileType) || (input.requiresReview ?? false),
    defaultPrivacy: input.defaultPrivacy ?? (isSensitiveType(input.fileType) ? 'P3' : 'P1'),
    defaultRetentionDays: input.defaultRetentionDays,
    capability: input.capability ?? 'RawStorage',
    createdBy: ctx.user().username,
    createdAt: ctx.now,
  };
  return id;
}
