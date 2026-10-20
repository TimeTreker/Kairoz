import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { FILE_TYPES, PRIVACY_LEVELS } from '../../domain/file-types.ts';
import { reader, writer } from '../../http/context.ts';
import type { Deps } from '../../http/context.ts';
import { name, parse } from '../../http/validation.ts';
import * as processing from './service.ts';

const token = z.string().trim().min(1).max(64);

export function processingRoutes(app: FastifyInstance, deps: Deps): void {
  app.get('/api/v1/processing/pipelines', reader(deps, (ctx) => processing.listPipelines(ctx.db)));
  app.post(
    '/api/v1/processing/pipelines',
    writer(
      deps,
      (ctx, req) =>
        processing.createPipeline(
          ctx,
          parse(
            z.strictObject({
              code: z.string().min(1).max(64),
              side: z.enum(['EDGE', 'CLOUD']),
              name,
              formats: z.array(token).min(1).max(20),
              schemas: z.array(token).min(1).max(50).default(['*']),
              steps: z.array(token).min(1).max(50),
              capability: token.default('RawStorage'),
            }),
            req.body,
          ),
        ),
      { status: 201 },
    ),
  );

  app.get(
    '/api/v1/processing/templates',
    reader(deps, (ctx, req) => {
      const q = parse(z.object({ current: z.enum(['true', 'false']).default('false') }), req.query);
      return processing.listTemplates(ctx.db, { currentOnly: q.current === 'true' });
    }),
  );
  app.post(
    '/api/v1/processing/templates',
    writer(
      deps,
      (ctx, req) =>
        processing.createTemplate(
          ctx,
          parse(
            z.strictObject({
              fileType: z.enum(FILE_TYPES),
              format: token,
              schema: token,
              edgePipelineId: z.string().min(1).max(100),
              cloudPipelineId: z.string().min(1).max(100),
              requiresReview: z.boolean().optional(),
              defaultPrivacy: z.enum(PRIVACY_LEVELS).optional(),
              defaultRetentionDays: z.number().int().min(1).max(3650),
              capability: token.optional(),
            }),
            req.body,
          ),
        ),
      { status: 201 },
    ),
  );
}
