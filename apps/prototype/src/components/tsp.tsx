// TSP in the console: a car's T-Box and hardware configuration, as TSP holds them.

import { Space, Tag, Typography } from 'antd';
import type { HardwareItem } from '../engine/types.ts';

/** A car's T-Box and hardware configuration, compact. */
export function HardwareTags({ tboxId, hardware }: { tboxId?: string; hardware: HardwareItem[] }) {
  return (
    <Space size={2} wrap>
      {tboxId && <Typography.Text type="secondary">{tboxId}</Typography.Text>}
      {hardware.map((h) => (
        <Tag key={h.item} style={{ marginInlineEnd: 0 }}>{`${h.item} ${h.value}`}</Tag>
      ))}
    </Space>
  );
}
