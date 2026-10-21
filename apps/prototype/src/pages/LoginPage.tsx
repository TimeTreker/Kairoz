import { UserOutlined } from '@ant-design/icons';
import { Avatar, Card, Col, Flex, Row, Segmented, Space, Tag, Typography } from 'antd';
import { PrototypeMenu } from '../app/PrototypeMenu.tsx';
import { setSession, useEngineState } from '../app/store.ts';
import { useI18n } from '../i18n/i18n.tsx';
import { ROLE_GOALS, ROLE_LABELS } from '../i18n/vocab.ts';
import { ROLES } from '../domain/vocabulary.ts';

/** Prototype sign-in: pick a person. Roles come from that account's grants. */
export function LoginPage() {
  const state = useEngineState();
  const { L, B, lang, setLang } = useI18n();
  const accounts = Object.values(state.accounts).filter((a) => a.status === 'ACTIVE');
  return (
    <div style={{ minHeight: '100%', background: '#f4f6fa' }}>
      <div style={{ maxWidth: 1240, margin: '0 auto', padding: '40px 24px' }}>
        <Flex justify="space-between" align="center" wrap gap={12}>
          <div>
            <Typography.Text type="secondary" style={{ letterSpacing: 1 }}>
              KAIROZ · {L('数据采集平台原型', 'DATA ACQUISITION PLATFORM PROTOTYPE')}
            </Typography.Text>
            <Typography.Title level={2} style={{ margin: '4px 0' }}>
              {L('选择账号进入工作台', 'Choose an account to enter')}
            </Typography.Title>
            <Typography.Text type="secondary">
              {L('原型不校验密码；权限完全按账号的授权判定。', 'The prototype skips passwords; permissions follow the account’s grants.')}
            </Typography.Text>
          </div>
          <Space>
            <Segmented value={lang} onChange={(v) => setLang(v as 'zh' | 'en')} options={[{ label: '中文', value: 'zh' }, { label: 'English', value: 'en' }]} />
            <PrototypeMenu />
          </Space>
        </Flex>
        <Row gutter={[24, 24]} style={{ marginTop: 28 }}>
          <Col xs={24} lg={16}>
            <Card title={L('人员账号', 'People')} extra={<Typography.Text type="secondary">{accounts.length}</Typography.Text>}>
              <Row gutter={[12, 12]}>
                {accounts.map((a) => (
                  <Col xs={24} sm={12} xl={8} key={a.username}>
                    <Card hoverable size="small" onClick={() => setSession({ username: a.username, workspaceId: null })}>
                      <Flex gap={12} align="flex-start">
                        <Avatar icon={<UserOutlined />} style={{ background: '#e8efff', color: '#2865e8', flex: 'none' }} />
                        <div style={{ minWidth: 0 }}>
                          <Typography.Text strong>{a.displayName}</Typography.Text>
                          <div>
                            <Typography.Text type="secondary" className="kz-mono">
                              {a.username}
                            </Typography.Text>
                          </div>
                          <div style={{ marginTop: 6 }}>
                            {[...new Set(a.grants.map((g) => g.role))].map((r) => (
                              <Tag key={r} style={{ marginBottom: 4 }}>
                                {B(ROLE_LABELS[r])}
                                {a.grants.some((g) => g.role === r && g.dispatchOnly) ? L('（仅下发）', ' (dispatch only)') : ''}
                              </Tag>
                            ))}
                          </div>
                        </div>
                      </Flex>
                    </Card>
                  </Col>
                ))}
              </Row>
            </Card>
          </Col>
          <Col xs={24} lg={8}>
            <Card title={L('九类角色', 'Nine roles')}>
              <Space orientation="vertical" size={12}>
                {ROLES.map((r) => (
                  <div key={r}>
                    <Typography.Text strong>{B(ROLE_LABELS[r])}</Typography.Text>
                    <div>
                      <Typography.Text type="secondary">{B(ROLE_GOALS[r])}</Typography.Text>
                    </div>
                  </div>
                ))}
              </Space>
            </Card>
          </Col>
        </Row>
      </div>
    </div>
  );
}
