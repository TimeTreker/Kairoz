// Company directory sync (公司目录同步). The team org tree and who belongs where come from the
// company's directory (HR, LDAP/AD or a SCIM feed in production; simulated here). Sync mirrors
// departments as read-only team units and people as accounts with their unit; projects, business
// groups, workspaces, vehicle groups and explicit grants stay the platform's.

import { isFullPlatformOps } from '../domain/authz.ts';
import { SLUG, USERNAME } from '../domain/ids.ts';
import type { Ctx } from './engine.ts';
import type { CompanyDirectory, DirectorySyncEntry, OrgUnit, State } from './types.ts';

export const SYNC_LOG_LIMIT = 200;

/** A unit id for a new department: its directory id when that is a free slug, else the next free dept-n. */
function freeUnitId(s: State, extId: string): string {
  const id = extId.toLowerCase();
  if (SLUG.test(id) && !s.orgUnits[id]) return id;
  let n = 1;
  while (s.orgUnits[`dept-${n}`]) n++;
  return `dept-${n}`;
}

export function directoryUnit(s: State, extId: string): OrgUnit | undefined {
  return Object.values(s.orgUnits).find((u) => u.source === 'DIRECTORY' && u.externalId === extId);
}

/**
 * Applies a directory snapshot (system context). Departments: created, renamed, moved or archived.
 * People: new ones get an account without explicit grants; an account with the same username and
 * no directory link is linked once; a transfer moves the account and flags its explicit grants for
 * review; a leaver is disabled. Display names set in the platform are kept. Returns the changes made.
 */
export function syncDirectory(ctx: Ctx, snapshot: CompanyDirectory): number {
  const s = ctx.s;
  const entries: DirectorySyncEntry[] = [];
  const log = (kind: DirectorySyncEntry['kind'], subject: string, detail: string) => entries.push({ seq: ctx.seq(), at: ctx.now, revision: snapshot.revision, kind, subject, detail });

  // Departments, parents before children.
  const byExt = new Map(snapshot.departments.map((d) => [d.extId, d]));
  const depth = (extId: string | null): number => {
    let n = 0;
    for (let p = extId; p && byExt.has(p) && n < 64; p = byExt.get(p)!.parentExtId) n++;
    return n;
  };
  for (const d of [...snapshot.departments].sort((a, b) => depth(a.parentExtId) - depth(b.parentExtId))) {
    const unit = directoryUnit(s, d.extId);
    if (d.status === 'REMOVED') {
      if (unit && unit.status === 'ACTIVE') {
        unit.status = 'ARCHIVED';
        log('UNIT_ARCHIVED', unit.id, unit.name);
      }
      continue;
    }
    const parentId = d.parentExtId ? (directoryUnit(s, d.parentExtId)?.id ?? null) : null;
    if (!unit) {
      const id = freeUnitId(s, d.extId);
      s.orgUnits[id] = { id, kind: 'TEAM', projectId: null, parentId, name: d.name, status: 'ACTIVE', source: 'DIRECTORY', externalId: d.extId };
      log('UNIT_CREATED', id, d.name);
      continue;
    }
    if (unit.name !== d.name) {
      log('UNIT_RENAMED', unit.id, `${unit.name} → ${d.name}`);
      unit.name = d.name;
    }
    if (unit.parentId !== parentId) {
      log('UNIT_MOVED', unit.id, `${unit.parentId ?? '—'} → ${parentId ?? '—'}`);
      unit.parentId = parentId;
    }
  }

  // People.
  for (const p of snapshot.people) {
    const to = directoryUnit(s, p.deptExtId)?.id ?? null;
    let account = Object.values(s.accounts).find((a) => a.employeeId === p.employeeId);
    if (!account) {
      if (p.status === 'LEFT') continue;
      const same = s.accounts[p.username];
      if (same && same.employeeId === null && same.createdBy !== 'system') {
        same.employeeId = p.employeeId;
        same.orgUnitId = to;
        log('ACCOUNT_LINKED', same.username, to ?? '—');
        continue;
      }
      if (same || !USERNAME.test(p.username)) {
        log('ACCOUNT_SKIPPED', p.username, same ? 'username taken by another account' : 'not a valid username');
        continue;
      }
      s.accounts[p.username] = {
        username: p.username,
        displayName: p.displayName,
        status: 'ACTIVE',
        grants: [],
        orgUnitId: to,
        employeeId: p.employeeId,
        grantReview: null,
        createdBy: 'directory',
        createdAt: ctx.now,
      };
      log('ACCOUNT_CREATED', p.username, to ?? '—');
      continue;
    }
    if (p.status === 'LEFT') {
      if (account.status !== 'ACTIVE') continue;
      const lastAdmin =
        account.grants.some((g) => isFullPlatformOps(g)) &&
        !Object.values(s.accounts).some((a) => a.username !== account!.username && a.status === 'ACTIVE' && a.grants.some((g) => isFullPlatformOps(g)));
      if (lastAdmin) {
        log('ACCOUNT_SKIPPED', account.username, 'the last platform administrator stays active');
        continue;
      }
      account.status = 'DISABLED';
      log('ACCOUNT_DISABLED', account.username, account.orgUnitId ?? '—');
      continue;
    }
    if (account.status === 'DISABLED') {
      account.status = 'ACTIVE';
      if (account.grants.length) account.grantReview = { fromUnitId: account.orgUnitId, toUnitId: to, since: ctx.now };
      log('ACCOUNT_REACTIVATED', account.username, to ?? '—');
    }
    if (account.orgUnitId !== to) {
      // Grants that come from org rules follow the unit; explicit ones wait for a review.
      if (account.grants.length) account.grantReview = { fromUnitId: account.grantReview?.fromUnitId ?? account.orgUnitId, toUnitId: to, since: ctx.now };
      log('ACCOUNT_MOVED', account.username, `${account.orgUnitId ?? '—'} → ${to ?? '—'}`);
      account.orgUnitId = to;
    }
  }

  s.directorySync = { revision: snapshot.revision, syncedAt: ctx.now, log: [...entries.reverse(), ...s.directorySync.log].slice(0, SYNC_LOG_LIMIT) };
  return entries.length;
}
