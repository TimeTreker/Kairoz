// The simulated company directory (公司目录, prototype only): stands in for HR, LDAP/AD or a SCIM
// feed. It runs in the system context and owns its own data; the platform learns about it only by
// syncing a snapshot (`syncDirectory`).

import { conflict, notFound, rule } from '../domain/errors.ts';
import { syncDirectory } from './directory.ts';
import type { Ctx } from './engine.ts';
import type { CompanyDirectory, DirectoryDepartment, DirectoryPerson } from './types.ts';

function directory(ctx: Ctx): CompanyDirectory {
  if (!ctx.s.directory) throw rule('DIRECTORY_NOT_CONNECTED', 'this installation has no company directory');
  return ctx.s.directory;
}

function department(dir: CompanyDirectory, extId: string): DirectoryDepartment {
  const d = dir.departments.find((x) => x.extId === extId && x.status === 'ACTIVE');
  if (!d) throw notFound('department', extId);
  return d;
}

function person(dir: CompanyDirectory, employeeId: string): DirectoryPerson {
  const p = dir.people.find((x) => x.employeeId === employeeId);
  if (!p) throw notFound('person', employeeId);
  return p;
}

/** Connects a directory with its departments and people (revision 1). */
export function connectDirectory(ctx: Ctx, input: { departments: Omit<DirectoryDepartment, 'status'>[]; people: Omit<DirectoryPerson, 'status'>[] }): void {
  ctx.s.directory = {
    revision: 1,
    departments: input.departments.map((d) => ({ ...d, status: 'ACTIVE' })),
    people: input.people.map((p) => ({ ...p, status: 'ACTIVE' })),
  };
}

export function hirePerson(ctx: Ctx, input: { username: string; displayName: string; deptExtId: string }): string {
  const dir = directory(ctx);
  department(dir, input.deptExtId);
  if (!input.username.trim() || !input.displayName.trim()) throw rule('NAME_REQUIRED', 'give a username and a name');
  if (dir.people.some((p) => p.username === input.username.trim())) throw conflict('DIRECTORY_USERNAME_TAKEN', `${input.username} is already in the directory`);
  const employeeId = `E${String(1001 + dir.people.length)}`;
  dir.people.push({ employeeId, username: input.username.trim(), displayName: input.displayName.trim(), deptExtId: input.deptExtId, status: 'ACTIVE' });
  dir.revision += 1;
  return employeeId;
}

export function transferPerson(ctx: Ctx, employeeId: string, deptExtId: string): void {
  const dir = directory(ctx);
  department(dir, deptExtId);
  const p = person(dir, employeeId);
  if (p.status !== 'ACTIVE') throw rule('PERSON_LEFT', `${p.displayName} has left`);
  if (p.deptExtId === deptExtId) throw rule('SAME_DEPARTMENT', `${p.displayName} is already there`);
  p.deptExtId = deptExtId;
  dir.revision += 1;
}

export function personLeaves(ctx: Ctx, employeeId: string): void {
  const dir = directory(ctx);
  const p = person(dir, employeeId);
  if (p.status !== 'ACTIVE') throw rule('PERSON_LEFT', `${p.displayName} has already left`);
  p.status = 'LEFT';
  dir.revision += 1;
}

export function addDepartment(ctx: Ctx, input: { name: string; parentExtId: string }): string {
  const dir = directory(ctx);
  department(dir, input.parentExtId);
  if (!input.name.trim()) throw rule('NAME_REQUIRED', 'name the department');
  const extId = `D${101 + dir.departments.length}`;
  dir.departments.push({ extId, name: input.name.trim(), parentExtId: input.parentExtId, status: 'ACTIVE' });
  dir.revision += 1;
  return extId;
}

export function renameDepartment(ctx: Ctx, extId: string, name: string): void {
  const dir = directory(ctx);
  const d = department(dir, extId);
  if (!name.trim()) throw rule('NAME_REQUIRED', 'name the department');
  d.name = name.trim();
  dir.revision += 1;
}

/** Merges a department into another: its people and subdepartments move, then it is removed. */
export function mergeDepartment(ctx: Ctx, extId: string, intoExtId: string): void {
  const dir = directory(ctx);
  const d = department(dir, extId);
  const into = department(dir, intoExtId);
  if (d.extId === into.extId) throw rule('SAME_DEPARTMENT', 'choose another department');
  for (let p: string | null = into.extId; p; p = dir.departments.find((x) => x.extId === p)?.parentExtId ?? null) {
    if (p === d.extId) throw rule('ORG_CYCLE', 'a department cannot merge into one of its own subdepartments');
  }
  for (const p of dir.people) if (p.deptExtId === d.extId) p.deptExtId = into.extId;
  for (const c of dir.departments) if (c.parentExtId === d.extId && c.status === 'ACTIVE') c.parentExtId = into.extId;
  d.status = 'REMOVED';
  dir.revision += 1;
}

/** Sends the current directory to the platform when it changed since the last sync. */
export function syncIfChanged(ctx: Ctx): number {
  const dir = ctx.s.directory;
  if (!dir || dir.revision === ctx.s.directorySync.revision) return 0;
  return syncDirectory(ctx, JSON.parse(JSON.stringify(dir)) as CompanyDirectory);
}
