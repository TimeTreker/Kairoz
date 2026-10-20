import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DOMAINS, GROUP_PURPOSES, SCOPES, WORKSPACE_KINDS } from '../../domain/vocabulary.ts';
import { reader, writer } from '../../http/context.ts';
import type { Deps } from '../../http/context.ts';
import { idParam, name, parse, revision } from '../../http/validation.ts';
import * as org from './service.ts';

const id = z.string().min(1).max(64);

export function orgRoutes(app: FastifyInstance, deps: Deps): void {
  app.get('/api/v1/vehicle-models', reader(deps, (ctx) => org.listVehicleModels(ctx.db)));
  app.post(
    '/api/v1/vehicle-models',
    writer(deps, (ctx, req) => org.createVehicleModel(ctx, parse(z.strictObject({ id, name }), req.body)), { status: 201 }),
  );

  app.get('/api/v1/projects', reader(deps, (ctx) => org.listProjects(ctx.db)));
  app.post(
    '/api/v1/projects',
    writer(
      deps,
      (ctx, req) => org.createProject(ctx, parse(z.strictObject({ id, name, vehicleModelId: id.optional() }), req.body)),
      { status: 201 },
    ),
  );

  app.get(
    '/api/v1/org-units',
    reader(deps, (ctx, req) =>
      org.listOrgUnits(ctx.db, parse(z.object({ kind: z.enum(['TEAM', 'PROJECT']).optional(), projectId: id.optional() }), req.query)),
    ),
  );
  app.post(
    '/api/v1/org-units',
    writer(deps, (ctx, req) => org.createOrgUnit(ctx, parse(z.strictObject({ id, name, parentId: id.optional() }), req.body)), {
      status: 201,
    }),
  );
  app.patch(
    '/api/v1/org-units/:id',
    writer(deps, (ctx, req) =>
      org.updateOrgUnit(
        ctx,
        parse(idParam, req.params).id,
        parse(z.strictObject({ expectedRevision: revision, name: name.optional(), parentId: id.nullable().optional() }), req.body),
      ),
    ),
  );

  app.get('/api/v1/groups', reader(deps, (ctx) => org.listGroups(ctx.db)));
  app.post(
    '/api/v1/groups',
    writer(
      deps,
      (ctx, req) =>
        org.createGroup(
          ctx,
          parse(
            z.strictObject({
              id,
              code: z.string().min(1).max(64),
              name,
              domain: z.enum(DOMAINS),
              purpose: z.enum(GROUP_PURPOSES),
              orgUnitId: id,
              workspaceId: id.optional(),
            }),
            req.body,
          ),
        ),
      { status: 201 },
    ),
  );

  const membership = {
    groupIds: z.array(id).max(200),
    scopes: z.array(z.enum(SCOPES)).max(SCOPES.length),
    sourceWorkspaceIds: z.array(id).max(200),
  };
  app.get('/api/v1/workspaces', reader(deps, (ctx) => org.listWorkspaces(ctx)));
  app.get('/api/v1/workspaces/:id', reader(deps, (ctx, req) => org.getWorkspace(ctx, parse(idParam, req.params).id)));
  app.post(
    '/api/v1/workspaces',
    writer(
      deps,
      (ctx, req) =>
        org.createWorkspace(
          ctx,
          parse(
            z.strictObject({
              id,
              name,
              kind: z.enum(WORKSPACE_KINDS),
              orgUnitId: id,
              vehicleModelId: id,
              groupIds: membership.groupIds.default([]),
              scopes: membership.scopes.default([]),
              sourceWorkspaceIds: membership.sourceWorkspaceIds.default([]),
            }),
            req.body,
          ),
        ),
      { status: 201 },
    ),
  );
  app.patch(
    '/api/v1/workspaces/:id',
    writer(deps, (ctx, req) =>
      org.updateWorkspace(
        ctx,
        parse(idParam, req.params).id,
        parse(
          z.strictObject({
            expectedRevision: revision,
            name: name.optional(),
            groupIds: membership.groupIds.optional(),
            scopes: membership.scopes.optional(),
            sourceWorkspaceIds: membership.sourceWorkspaceIds.optional(),
          }),
          req.body,
        ),
      ),
    ),
  );
}
