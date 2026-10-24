// Runs the acceptance scripts scene by scene and writes the record: docs/acceptance/results.json
// and RESULTS.md. Every scene runs fresh; nothing is copied from an earlier report.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCENE_NOTES } from '../src/acceptance/notes.ts';
import { NEGATIVE_CASES, SCRIPTS } from '../src/acceptance/scripts.ts';
import type { State } from '../src/engine/types.ts';
import * as clientReport from './client-report.ts';
import * as dataUsage from './data-usage.ts';
import * as domainIntegration from './domain-integration.ts';
import * as firstOta from './first-ota.ts';
import * as negative from './negative.ts';
import * as orgDirectory from './org-directory.ts';
import * as personalSim from './personal-sim.ts';
import * as simSoftware from './sim-software.ts';
import * as softwareChange from './software-change.ts';
import * as notifications from './notifications.ts';
import * as policySets from './policy-sets.ts';
import * as startup from './startup.ts';
import { GapError, NotApplicableError, World } from './world.ts';
import type { SceneSpec } from './world.ts';

type Status = 'PASS' | 'FAIL' | 'GAP' | 'BLOCKED' | 'NOT_APPLICABLE' | 'NOT_WRITTEN';

interface Row {
  id: string;
  title: string;
  actor: string;
  status: Status;
  detail: string | null;
  adaptation: string | null;
  notes: string[];
}

function play(world: World, spec: SceneSpec): Pick<Row, 'status' | 'detail' | 'notes'> {
  try {
    spec.run(world);
    return { status: 'PASS', detail: null, notes: world.notes.splice(0) };
  } catch (e) {
    const notes = world.notes.splice(0);
    if (e instanceof GapError) return { status: 'GAP', detail: `未实现：${e.message}`, notes };
    if (e instanceof NotApplicableError) return { status: 'NOT_APPLICABLE', detail: e.message, notes };
    return { status: 'FAIL', detail: e instanceof Error ? e.message.split('\n')[0]! : String(e), notes };
  }
}

const suites = [
  { id: 'startup', mod: startup },
  { id: 'first-ota', mod: firstOta },
  { id: 'data-usage', mod: dataUsage },
  { id: 'client-report', mod: clientReport },
  { id: 'domain-integration', mod: domainIntegration },
  { id: 'policy-sets', mod: policySets },
  { id: 'org-directory', mod: orgDirectory },
  { id: 'personal-simulation', mod: personalSim },
  { id: 'sim-software', mod: simSoftware },
  { id: 'software-change', mod: softwareChange },
  { id: 'notifications', mod: notifications },
] as const;

const report: { script: string; name: string; rows: Row[] }[] = [];

for (const { id, mod } of suites) {
  const script = SCRIPTS.find((s) => s.id === id)!;
  const world = new World(mod.start());
  const after = new Map<string, { state: State; ref: Record<string, string> }>();
  const status = new Map<string, Status>();
  const rows: Row[] = [];
  for (const scene of script.scenes) {
    const spec = mod.scenes[scene.id];
    const base = { id: scene.id, title: scene.title, actor: scene.actor, adaptation: SCENE_NOTES[`${id}/${scene.id}`] ?? null };
    let result: Pick<Row, 'status' | 'detail' | 'notes'>;
    const missing = (spec?.needs ?? []).filter((n) => status.get(n) !== 'PASS');
    const forkFrom = spec?.forkAfter ? after.get(spec.forkAfter) : undefined;
    if (!spec) result = { status: 'NOT_WRITTEN', detail: '没有对应的验收实现', notes: [] };
    else if (missing.length) result = { status: 'BLOCKED', detail: `前置幕未通过：${missing.join('、')}`, notes: [] };
    else if (spec.forkAfter && (!forkFrom || !['PASS', 'GAP'].includes(status.get(spec.forkAfter)!))) {
      result = { status: 'BLOCKED', detail: `支线起点 ${spec.forkAfter} 未完成`, notes: [] };
    } else result = play(forkFrom ? new World(forkFrom.state, forkFrom.ref) : world, spec);
    status.set(scene.id, result.status);
    if (!spec?.forkAfter) after.set(scene.id, { state: world.s, ref: { ...world.ref } });
    rows.push({ ...base, ...result });
  }
  report.push({ script: id, name: script.name, rows });
}

const negativeRows: Row[] = NEGATIVE_CASES.map((c) => {
  const spec = negative.cases[c.id];
  const base = { id: c.id, title: `${c.action} → ${c.expected}`, actor: c.role, adaptation: SCENE_NOTES[`negative/${c.id}`] ?? null };
  if (!spec) return { ...base, status: 'NOT_WRITTEN' as Status, detail: '没有对应的验收实现', notes: [] };
  return { ...base, ...play(new World(negative.start()), spec) };
});
report.push({ script: 'negative', name: '反向用例 T-N01–T-N24', rows: negativeRows });

// ---------------------------------------------------------------------------

const all = report.flatMap((r) => r.rows);
const count = (s: Status) => all.filter((r) => r.status === s).length;
const counts = Object.fromEntries((['PASS', 'FAIL', 'GAP', 'BLOCKED', 'NOT_APPLICABLE', 'NOT_WRITTEN'] as Status[]).map((s) => [s, count(s)]));

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../../../docs/acceptance');
mkdirSync(out, { recursive: true });
const runAt = new Date().toISOString();
writeFileSync(resolve(out, 'results.json'), `${JSON.stringify({ runAt, layer: 'engine', counts, scripts: report }, null, 2)}\n`);

const md: string[] = [
  '# 验收结果（引擎层逐幕回放）',
  '',
  `运行时间：${runAt}。由 \`npm run acceptance\` 生成；每次重新执行，不沿用历史结果。`,
  '',
  '状态：PASS 通过；FAIL 失败；GAP 设计要求尚未实现；BLOCKED 前置幕未通过；NOT_APPLICABLE 浏览器原型不适用（如服务端部署）。',
  '',
  `合计：${Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(' · ')}`,
  '',
];
for (const r of report) {
  md.push(`## ${r.name}`, '', '| 幕 | 执行人 | 状态 | 说明 |', '|---|---|---|---|');
  for (const row of r.rows) {
    const detail = [row.detail, row.adaptation ? `适配：${row.adaptation}` : null].filter(Boolean).join('<br>').replaceAll('|', '\\|');
    md.push(`| ${row.id} ${row.title.replaceAll('|', '\\|')} | ${row.actor} | ${row.status} | ${detail} |`);
  }
  md.push('');
}
writeFileSync(resolve(out, 'RESULTS.md'), md.join('\n'));

for (const r of report) {
  console.log(`\n== ${r.name}`);
  for (const row of r.rows) console.log(`${row.status.padEnd(14)} ${row.id.padEnd(6)} ${row.detail ?? ''}`);
}
console.log('\n', counts);
if (count('FAIL') + count('GAP') + count('BLOCKED') + count('NOT_WRITTEN') > 0) process.exitCode = 1;
