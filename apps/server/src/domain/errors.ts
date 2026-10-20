// Errors carry a stable machine-readable `code`; clients localize by code.

export class DomainError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'DomainError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** A business rule rejected the request. */
export function rule(code: string, message: string, details?: unknown): DomainError {
  return new DomainError(422, code, message, details);
}

export function notFound(entity: string, id: string): DomainError {
  return new DomainError(404, 'NOT_FOUND', `${entity} not found: ${id}`, { entity, id });
}

export function conflict(code: string, message: string, details?: unknown): DomainError {
  return new DomainError(409, code, message, details);
}

export function revisionConflict(entity: string, id: string, current: number): DomainError {
  return new DomainError(
    409,
    'REVISION_CONFLICT',
    `${entity} ${id} was changed by someone else; reload and retry`,
    { entity, id, currentRevision: current },
  );
}

export function unauthenticated(message = 'Authentication required'): DomainError {
  return new DomainError(401, 'UNAUTHENTICATED', message);
}

export class ForbiddenError extends DomainError {
  readonly action: string;
  readonly reason: string;
  readonly target: Record<string, unknown>;

  constructor(action: string, reason: string, target: Record<string, unknown>) {
    super(403, 'FORBIDDEN', `Not authorized for ${action}: ${reason}`, { action, reason, target });
    this.name = 'ForbiddenError';
    this.action = action;
    this.reason = reason;
    this.target = target;
  }
}
