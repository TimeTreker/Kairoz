import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MAX_CAPTURE_WINDOW_SECONDS, PRIORITIES } from '../../domain/config.ts';
import { FILE_TYPES, PRIVACY_LEVELS } from '../../domain/file-types.ts';
import { TRIGGER_MAX_LENGTH } from '../../domain/trigger.ts';
import { reader, writer } from '../../http/context.ts';
import type { Deps } from '../../http/context.ts';
import { expectedRevisionQuery, idParam, parse, revision } from '../../http/validation.ts';
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
