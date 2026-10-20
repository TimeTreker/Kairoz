// Processing catalog owned by DCL engineering: immutable Edge/Cloud pipeline versions and the
// default binding (template) per file type. A clean installation has none; adding a file of a
// type without a template is blocked rather than silently defaulted.

import type { Db } from '../../db/pool.ts';
import { many, one } from '../../db/pool.ts';
import { rule } from '../../domain/errors.ts';
import { SLUG } from '../../domain/ids.ts';
import { isSensitiveType, typeAlwaysRequiresReview } from '../../domain/file-types.ts';
import type { FileType, Privacy } from '../../domain/file-types.ts';
import { WILDCARD } from '../../domain/vocabulary.ts';
import type { WriteCtx } from '../../http/context.ts';

export type Side = 'EDGE' | 'CLOUD';

/** The catalog applies to every group and workspace, so only a platform-wide DCL grant may change it. */
const CATALOG_WIDE = { workspaceId: WILDCARD, groupId: WILDCARD } as const;

interface PipelineRow {
  id: string;
  code: string;
  version: number;
  side: Side;
  name: string;
  formats: string[];
  schemas: string[];
  steps: string[];
  capability: string;
  created_by: string;
  created_at: Date;
}

const pipelineView = (r: PipelineRow) => ({
  id: r.id,
  code: r.code,
  version: r.version,
  side: r.side,
  name: r.name,
  formats: r.formats,
  schemas: r.schemas,
  steps: r.steps,
  capability: r.capability,
  createdBy: r.created_by,
  createdAt: r.created_at.toISOString(),
});

export async function listPipelines(db: Db) {
  return (await many<PipelineRow>(db, 'SELECT * FROM processing_pipelines ORDER BY code, version')).map(pipelineView);
}

export interface PipelineInput {
  code: string;
  side: Side;
  name: string;
  formats: string[];
  schemas: string[];
  steps: string[];
  capability: string;
}

/** Publishes the next immutable version of a pipeline code. */
export async function createPipeline(ctx: WriteCtx, input: PipelineInput) {
  ctx.allow('processing.manage', { type: 'pipeline', id: input.code, ...CATALOG_WIDE });
  if (!SLUG.test(input.code)) throw rule('INVALID_ID', `pipeline code must match ${SLUG.source}`);
  // Serialize version numbering per code.
  await ctx.db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`kairoz.pipeline.${input.code}`]);
  const latest = await one<{ version: number; side: Side }>(
    ctx.db,
    'SELECT version, side FROM processing_pipelines WHERE code = $1 ORDER BY version DESC LIMIT 1',
    [input.code],
  );
  if (latest && latest.side !== input.side) {
    throw rule('PIPELINE_SIDE_FIXED', `pipeline ${input.code} is a ${latest.side} pipeline`);
  }
  const version = (latest?.version ?? 0) + 1;
  const row = await one<PipelineRow>(
    ctx.db,
    `INSERT INTO processing_pipelines (id, code, version, side, name, formats, schemas, steps, capability, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [
      `${input.code}@${version}`,
      input.code,
      version,
      input.side,
      input.name,
      input.formats,
      input.schemas,
      input.steps,
      input.capability,
      ctx.actor.username,
    ],
  );
  return pipelineView(row!);
}

export interface Binding {
  format: string;
  schema: string;
  edgePipelineId: string;
  cloudPipelineId: string;
}

/** Problems with an Edge/Cloud binding for the given format and schema; empty if compatible. */
export async function bindingIssues(db: Db, binding: Binding): Promise<string[]> {
  const issues: string[] = [];
  for (const [id, side] of [
    [binding.edgePipelineId, 'EDGE'],
    [binding.cloudPipelineId, 'CLOUD'],
  ] as const) {
    const p = await one<PipelineRow>(db, 'SELECT * FROM processing_pipelines WHERE id = $1', [id]);
    if (!p) {
      issues.push(`${side} pipeline ${id} does not exist`);
      continue;
    }
    if (p.side !== side) issues.push(`${id} is not an ${side} pipeline`);
    if (!p.formats.includes(binding.format)) issues.push(`${id} does not support format ${binding.format}`);
    if (!p.schemas.includes('*') && !p.schemas.includes(binding.schema)) {
      issues.push(`${id} does not support schema ${binding.schema}`);
    }
  }
  return issues;
}

interface TemplateRow {
  id: string;
  file_type: FileType;
  version: number;
  format: string;
  schema: string;
  edge_pipeline_id: string;
  cloud_pipeline_id: string;
  requires_review: boolean;
  default_privacy: Privacy;
  default_retention_days: number;
  capability: string;
  created_by: string;
  created_at: Date;
}

export interface TemplateView {
  id: string;
  fileType: FileType;
  version: number;
  format: string;
  schema: string;
  edgePipelineId: string;
  cloudPipelineId: string;
  requiresReview: boolean;
  defaultPrivacy: Privacy;
  defaultRetentionDays: number;
  capability: string;
  createdBy: string;
  createdAt: string;
}

const templateView = (r: TemplateRow): TemplateView => ({
  id: r.id,
  fileType: r.file_type,
  version: r.version,
  format: r.format,
  schema: r.schema,
  edgePipelineId: r.edge_pipeline_id,
  cloudPipelineId: r.cloud_pipeline_id,
  requiresReview: r.requires_review,
  defaultPrivacy: r.default_privacy,
  defaultRetentionDays: r.default_retention_days,
  capability: r.capability,
  createdBy: r.created_by,
  createdAt: r.created_at.toISOString(),
});

export async function listTemplates(db: Db, options: { currentOnly: boolean }) {
  const rows = await many<TemplateRow>(
    db,
    options.currentOnly
      ? 'SELECT DISTINCT ON (file_type) * FROM processing_templates ORDER BY file_type, version DESC'
      : 'SELECT * FROM processing_templates ORDER BY file_type, version',
  );
  return rows.map(templateView);
}

/** The default template for a file type: its highest version. */
export async function currentTemplate(db: Db, fileType: FileType): Promise<TemplateView | undefined> {
  const row = await one<TemplateRow>(
    db,
    'SELECT * FROM processing_templates WHERE file_type = $1 ORDER BY version DESC LIMIT 1',
    [fileType],
  );
  return row ? templateView(row) : undefined;
}

export interface TemplateInput extends Binding {
  fileType: FileType;
  requiresReview?: boolean;
  defaultPrivacy?: Privacy;
  defaultRetentionDays: number;
  capability?: string;
}

export async function createTemplate(ctx: WriteCtx, input: TemplateInput): Promise<TemplateView> {
  ctx.allow('processing.manage', { type: 'template', id: input.fileType, ...CATALOG_WIDE });
  const issues = await bindingIssues(ctx.db, input);
  if (issues.length) throw rule('INCOMPATIBLE_BINDING', 'the Edge/Cloud binding is not compatible', { issues });
  await ctx.db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`kairoz.template.${input.fileType}`]);
  const latest = await currentTemplate(ctx.db, input.fileType);
  const version = (latest?.version ?? 0) + 1;
  // Sensitive and unknown types always require review; that cannot be configured away.
  const requiresReview = typeAlwaysRequiresReview(input.fileType) || (input.requiresReview ?? false);
  const row = await one<TemplateRow>(
    ctx.db,
    `INSERT INTO processing_templates
       (id, file_type, version, format, schema, edge_pipeline_id, cloud_pipeline_id, requires_review,
        default_privacy, default_retention_days, capability, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
    [
      `template-${input.fileType}@${version}`,
      input.fileType,
      version,
      input.format,
      input.schema,
      input.edgePipelineId,
      input.cloudPipelineId,
      requiresReview,
      input.defaultPrivacy ?? (isSensitiveType(input.fileType) ? 'P3' : 'P1'),
      input.defaultRetentionDays,
      input.capability ?? 'RawStorage',
      ctx.actor.username,
    ],
  );
  return templateView(row!);
}
