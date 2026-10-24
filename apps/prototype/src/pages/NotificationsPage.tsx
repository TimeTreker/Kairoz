// The full notification list (通知中心): the account's current items in this workspace, filtered by
// read state and category. Not an audit history: past commits and events stay on their own pages.

import { Button, Card, Segmented, Select, Space } from 'antd';
import { useState } from 'react';
import { Hint, PageHeader } from '../components/common.tsx';
import { NotificationList, useCategoryLabels, useNotifications } from '../components/notifications.tsx';
import { useI18n } from '../i18n/i18n.tsx';

export function NotificationsPage() {
  const { L } = useI18n();
  const categories = useCategoryLabels();
  const { items, unread, markRead } = useNotifications();
  const [filter, setFilter] = useState<'all' | 'unread'>('unread');
  const [category, setCategory] = useState('ALL');
  return (
    <div className="kz-page">
      <PageHeader
        title={L('通知中心', 'Notification center')}
        subtitle={L(`共 ${items.length} 项，未读 ${unread.length} 项`, `${items.length} items, ${unread.length} unread`)}
        extra={
          <Button disabled={unread.length === 0} onClick={() => markRead(unread.map((n) => n.id))}>
            {L('全部已读', 'Mark all read')}
          </Button>
        }
      />
      <Card>
        <Hint>
          {L(
            '通知来自当前账号在本工作区的授权范围内正在发生的事项；状态变化会产生新的提醒。已读只是本账号在本工作区的标记，不等于处理完成，也不改变配置、测试或回执。历史提交与事件请在各自页面追溯。',
            'Notifications are the current matters this account may see in this workspace; a change of state raises a new one. Read is only this account’s mark in this workspace: it is not done, and it changes no configuration, test or receipt. Past commits and events stay on their own pages.',
          )}
        </Hint>
        <Space wrap style={{ marginBottom: 12 }}>
          <Segmented
            value={filter}
            onChange={(v) => setFilter(v as 'all' | 'unread')}
            options={[
              { value: 'unread', label: L('未读', 'Unread') },
              { value: 'all', label: L('全部', 'All') },
            ]}
          />
          <Select
            style={{ width: 180 }}
            value={category}
            onChange={setCategory}
            options={[{ value: 'ALL', label: L('全部类别', 'All categories') }, ...Object.entries(categories).map(([value, label]) => ({ value, label }))]}
          />
        </Space>
        <NotificationList filter={filter} category={category} />
      </Card>
    </div>
  );
}
