import { z } from 'zod';
import { DomainError } from '../domain/errors.ts';

export function parse<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new DomainError(400, 'VALIDATION_FAILED', 'the request is invalid', {
      issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return result.data;
}

export const revision = z.number().int().positive();
export const name = z.string().trim().min(1).max(100);
export const idParam = z.object({ id: z.string().min(1).max(200) });
export const expectedRevisionQuery = z.object({ expectedRevision: z.coerce.number().int().positive() });
