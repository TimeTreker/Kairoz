import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { issueLabel } from '../src/i18n/issues.ts';
import { ERROR_LABELS } from '../src/i18n/vocab.ts';

const src = join(dirname(fileURLToPath(import.meta.url)), '../src');

describe('bilingual error text', () => {
  test('every error code the engine and domain throw has a label', () => {
    const codes = new Set<string>();
    for (const dir of ['engine', 'domain']) {
      for (const file of readdirSync(join(src, dir)).filter((f) => f.endsWith('.ts'))) {
        const text = readFileSync(join(src, dir, file), 'utf8');
        for (const m of text.matchAll(/(?:rule|conflict)\(\s*'([A-Z_]+)'/g)) codes.add(m[1]!);
        for (const m of text.matchAll(/new DomainError\(\d+, '([A-Z_]+)'/g)) codes.add(m[1]!);
      }
    }
    assert.ok(codes.size > 100);
    assert.deepEqual([...codes].filter((c) => !ERROR_LABELS[c]), []);
  });

  test('per-item reasons get a Chinese reading and keep their subject', () => {
    const cases: [string, string][] = [
      ['SIM-902: software version unknown', 'SIM-902：整车软件版本未知'],
      ['VEH-904: a partial software update left controllers inconsistent (BMS); finish or roll back the software OTA first', 'VEH-904：软件部分升级使域控状态不一致（BMS），请先完成或回滚软件 OTA'],
      ['VEH-903: no earlier formal configuration to return to', 'VEH-903：没有可回退的上一正式配置'],
      ['VEH-903: policy set 1.0.0 does not apply to software 1.1', 'VEH-903：策略集 1.0.0 不适用于软件 1.1'],
      ['VEH-001: routes through vehicle group 制动验证组; dispatch to the group', 'VEH-001：属于车辆组“制动验证组”，请按车辆组下发'],
      ['SIM-901 has no passing test', 'SIM-901 没有通过的测试'],
      ['SIM-021 runs another image since its test; test it again', 'SIM-021 测试后已更换镜像，需重新测试'],
      ['SIM-101: runs a derived development image', 'SIM-101：运行研发派生镜像'],
      ['a simulation test must pass', '须有仿真测试通过'],
      ['chassis.brake: 制动诊断日志: gnss-edge@1 does not support format text', 'chassis.brake: 制动诊断日志：gnss-edge@1 不支持格式 text'],
      ['VEH-002: maintenance', 'VEH-002：维护中'],
      ['rollout ota_1 is a rollback; start a new rollout to resume', 'OTA ota_1 是回滚；新建 OTA 后才恢复同步'],
      ['describe uploadControl', '请说明上传控制'],
      ['ev_1: quality unknown', 'ev_1：质量未知'],
      ['simulated apply failure', '模拟的应用失败'],
      ['rolled back: 演示回滚', '已回滚：演示回滚'],
      ['ParserFailure: opaque-bin-log@1 could not be parsed', 'ParserFailure：无法按 opaque-bin-log@1 解析'],
      [
        'chassis.steering: policy chassis.steering.angle_jump has a merged capture window of 125 s (110 s before + 15 s after the trigger), over the 120 s limit',
        'chassis.steering：策略 chassis.steering.angle_jump 合并后的采集窗口为 125 秒（触发前 110 秒 + 触发后 15 秒），超过 120 秒上限',
      ],
      ['chassis.brake: policy chassis.brake.x has an invalid trigger: unexpected end of expression at 7', 'chassis.brake：策略 chassis.brake.x 的触发条件无效：表达式不完整（第 8 个字符）'],
      ['chassis.brake: policy chassis.brake.x captures no file', 'chassis.brake：策略 chassis.brake.x 没有捕获任何文件'],
    ];
    for (const [line, zh] of cases) assert.deepEqual(issueLabel(line), { zh, en: line }, line);
    assert.equal(issueLabel('something the engine never says'), undefined);
  });
});
