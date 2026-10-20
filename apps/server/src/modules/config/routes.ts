import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MAX_CAPTURE_WINDOW_SECONDS, PRIORITIES } from '../../domain/config.ts';
import { FILE_TYPES, PRIVACY_LEVELS } from '../../domain/file-types.ts';
import { TRIGGER_MAX_LENGTH } from '../../domain/trigger.ts';
import { reader, writer } from '../../http/context.ts';
import type { Deps } from '../../http/context.ts';
import { expectedRevisionQuery, idParam, parse, revision } from '../../http/validation.ts';
import * as intake from './intake.ts';
import * as references from './references.ts';
import * as config from './service.ts';

const fileAttributes = {
  name: z.string().trim().min(1).max(100),
  purpose: z.string().trim().min(1).max(500),
  fileType: z.enum(FILE_TYPES).optional(),
  privacy: z.enum(PRIVACY_LEVELS).optional(),
  retentionDays: z.number().int().min(1).max(3650).optional(),
  contentTags: z.array(z.string().max(40)).max(20).optional(),
  priority: z.enum(PRIORITIES).optional(),
};

const policyBody = z.strictObject({
  expectedRevision: revision,
  name: z.string().trim().min(1).max(100),
  trigger: z.string().min(1).max(TRIGGER_MAX_LENGTH),
  captures: z.array(z.string().min(1)).min(1).max(200),
  preSeconds: z.number().int().min(0).max(MAX_CAPTURE_WINDOW_SECONDS),
  postSeconds: z.number().int().min(0).max(MAX_CAPTURE_WINDOW_SECONDS),
  priority: z.enum(PRIORITIES).optional(),
});

const featureFile = z.object({ id: z.string().min(1), dataKey: z.string().min(1) });
const featurePolicy = z.object({ id: z.string().min(1), policyId: z.string().min(1).max(200) });

export function configRoutes(app: FastifyInstance, deps: Deps): void {
  app.get(
    '/api/v1/workspaces/:id/features',
    reader(deps, (ctx, req) =>
      config.listFeatures(ctx, {
        workspaceId: parse(idParam, req.params).id,
        ...parse(z.object({ groupId: z.string().optional() }), req.query),
      }),
    ),
  );
  app.post(
    '/api/v1/workspaces/:id/features',
    writer(
      deps,
      (ctx, req) =>
        config.createFeature(ctx, {
          workspaceId: parse(idParam, req.params).id,
          ...parse(
            z.strictObject({ groupId: z.string().min(1), name: z.string().min(1).max(64), description: z.string().max(1000).optional() }),
            req.body,
          ),
        }),
      { status: 201 },
    ),
  );

  app.get('/api/v1/features/:id', reader(deps, (ctx, req) => config.getFeature(ctx, parse(idParam, req.params).id)));
  app.get('/api/v1/features/:id/commits', reader(deps, (ctx, req) => config.listCommits(ctx, parse(idParam, req.params).id)));

  app.post(
    '/api/v1/features/:id/files',
    writer(deps, (ctx, req) =>
      config.addFile(
        ctx,
        parse(idParam, req.params).id,
        parse(
          z.strictObject({
            expectedRevision: revision,
            source: z.strictObject({
              unit: z.string().min(1).max(32),
              directory: z.string().min(1).max(512),
              pattern: z.string().min(1).max(128),
            }),
            ...fileAttributes,
          }),
          req.body,
        ),
      ),
    ),
  );
  app.patch(
    '/api/v1/features/:id/files/:dataKey',
    writer(deps, (ctx, req) => {
      const p = parse(featureFile, req.params);
      const body = parse(
        z.strictObject({
          expectedRevision: revision,
          ...fileAttributes,
          name: fileAttributes.name.optional(),
          purpose: fileAttributes.purpose.optional(),
        }),
        req.body,
      );
      return config.updateFile(ctx, p.id, p.dataKey, body);
    }),
  );
  app.delete(
    '/api/v1/features/:id/files/:dataKey',
    writer(deps, (ctx, req) => {
      const p = parse(featureFile, req.params);
      return config.removeFile(ctx, p.id, p.dataKey, parse(expectedRevisionQuery, req.query).expectedRevision);
    }),
  );

  app.put(
    '/api/v1/features/:id/policies/:policyId',
    writer(deps, (ctx, req) => {
      const p = parse(featurePolicy, req.params);
      return config.putPolicy(ctx, p.id, p.policyId, parse(policyBody, req.body));
    }),
  );
  app.delete(
    '/api/v1/features/:id/policies/:policyId',
    writer(deps, (ctx, req) => {
      const p = parse(featurePolicy, req.params);
      return config.removePolicy(ctx, p.id, p.policyId, parse(expectedRevisionQuery, req.query).expectedRevision);
    }),
  );

  app.post(
    '/api/v1/features/:id/submit',
    writer(deps, (ctx, req) =>
      config.submitFeature(
        ctx,
        parse(idParam, req.params).id,
        parse(z.strictObject({ expectedRevision: revision, message: z.string().max(1000).optional() }), req.body),
      ),
    ),
  );

  app.get('/api/v1/commits/:id', reader(deps, (ctx, req) => config.getCommit(ctx, parse(idParam, req.params).id)));

  app.get(
    '/api/v1/workspaces/:id/groups/:groupId/data-items',
    reader(deps, (ctx, req) => {
      const p = parse(z.object({ id: z.string().min(1), groupId: z.string().min(1) }), req.params);
      return config.listDataItems(ctx, p.id, p.groupId);
    }),
  );
  // Read-only references to other groups' files.
  app.put(
    '/api/v1/features/:id/references/:dataKey',
    writer(deps, (ctx, req) => {
      const p = parse(featureFile, req.params);
      return config.putReference(ctx, p.id, p.dataKey, parse(z.strictObject({ expectedRevision: revision }), req.body).expectedRevision);
    }),
  );
  app.delete(
    '/api/v1/features/:id/references/:dataKey',
    writer(deps, (ctx, req) => {
      const p = parse(featureFile, req.params);
      return config.removeReference(ctx, p.id, p.dataKey, parse(expectedRevisionQuery, req.query).expectedRevision);
    }),
  );
  app.get(
    '/api/v1/workspaces/:id/groups/:groupId/catalog',
    reader(deps, (ctx, req) => {
      const p = parse(z.object({ id: z.string().min(1), groupId: z.string().min(1) }), req.params);
      return references.referenceCatalog(ctx, p.id, p.groupId);
    }),
  );
  const referenceStatus = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'REVOKED']);
  app.get(
    '/api/v1/reference-requests',
    reader(deps, (ctx, req) =>
      references.listReferenceRequests(
        ctx,
        parse(z.object({ groupId: z.string().min(1), side: z.enum(['owner', 'reader']), status: referenceStatus.optional() }), req.query),
      ),
    ),
  );
  app.post(
    '/api/v1/reference-requests',
    writer(
      deps,
      (ctx, req) =>
        references.requestReference(
          ctx,
          parse(z.strictObject({ dataKey: z.string().min(1), readerGroupId: z.string().min(1), reason: z.string().max(1000) }), req.body),
        ),
      { status: 201 },
    ),
  );
  app.post(
    '/api/v1/reference-requests/:id/decision',
    writer(deps, (ctx, req) =>
      references.decideReference(
        ctx,
        parse(idParam, req.params).id,
        parse(z.strictObject({ decision: z.enum(['APPROVED', 'REJECTED']), reason: z.string().max(1000).default('') }), req.body),
      ),
    ),
  );
  app.post(
    '/api/v1/reference-requests/:id/revoke',
    writer(deps, (ctx, req) =>
      references.revokeReference(ctx, parse(idParam, req.params).id, parse(z.strictObject({ reason: z.string().max(1000) }), req.body)),
    ),
  );

  // DCL intake.
  app.get('/api/v1/intake', reader(deps, (ctx) => intake.intakeQueue(ctx)));
  const control = z.string().trim().max(500);
  app.post(
    '/api/v1/features/:id/reviews',
    writer(
      deps,
      (ctx, req) =>
        intake.reviewFile(
          ctx,
          parse(idParam, req.params).id,
          parse(
            z.strictObject({
              commitId: z.string().min(1),
              dataKey: z.string().min(1),
              decision: z.enum(['APPROVED', 'REJECTED']),
              reason: z.string().max(1000),
              controls: z
                .strictObject({
                  purposeConfirmed: z.boolean(),
                  scopeConfirmed: z.boolean(),
                  retentionConfirmed: z.boolean(),
                  accessControl: control,
                  uploadControl: control,
                  processingControl: control,
                  notes: z.string().max(1000).optional(),
                })
                .optional(),
            }),
            req.body,
          ),
        ),
      { status: 201 },
    ),
  );
  app.post(
    '/api/v1/features/:id/return',
    writer(deps, (ctx, req) =>
      intake.returnFeature(
        ctx,
        parse(idParam, req.params).id,
        parse(z.strictObject({ expectedRevision: revision, reason: z.string().max(1000) }), req.body),
      ),
    ),
  );
  const token = z.string().trim().min(1).max(100);
  app.put(
    '/api/v1/features/:id/files/:dataKey/binding',
    writer(deps, (ctx, req) => {
      const p = parse(featureFile, req.params);
      return intake.setBinding(
        ctx,
        p.id,
        p.dataKey,
        parse(
          z.strictObject({
            expectedRevision: revision,
            format: token,
            schema: token,
            edgePipelineId: token,
            cloudPipelineId: token,
            reason: z.string().max(1000),
          }),
          req.body,
        ),
      );
    }),
  );

  app.post(
    '/api/v1/data-items/:dataKey/overlap-review',
    writer(deps, (ctx, req) =>
      config.reviewOverlap(
        ctx,
        parse(z.object({ dataKey: z.string().min(1) }), req.params).dataKey,
        parse(z.strictObject({ decision: z.enum(['DISTINCT', 'DUPLICATE']), note: z.string().max(1000) }), req.body),
      ),
    ),
  );
}
