import { List, Modal, Progress, Space, Tag, Typography } from 'antd';

const { Text } = Typography;

export type SyncProgressStatus = 'pending' | 'running' | 'success' | 'failed';

export interface SyncProgressItem {
  key: string | number;
  name: string;
  status: SyncProgressStatus;
  errorMessage?: string | null;
}

interface SyncProgressModalProps {
  open: boolean;
  title: string;
  running: boolean;
  total: number;
  completed: number;
  successCount: number;
  failedCount: number;
  currentName?: string | null;
  items: SyncProgressItem[];
  onClose: () => void;
}

function formatStatus(status: SyncProgressStatus) {
  if (status === 'running') {
    return { color: 'processing', label: '同步中' };
  }
  if (status === 'success') {
    return { color: 'success', label: '成功' };
  }
  if (status === 'failed') {
    return { color: 'error', label: '失败' };
  }
  return { color: 'default', label: '等待中' };
}

export function SyncProgressModal({
  open,
  title,
  running,
  total,
  completed,
  successCount,
  failedCount,
  currentName,
  items,
  onClose,
}: SyncProgressModalProps) {
  const percent = total ? Math.round((completed / total) * 100) : 0;
  const recentItems = items.slice(-10).reverse();

  return (
    <Modal
      title={title}
      open={open}
      onCancel={running ? undefined : onClose}
      okText="关闭"
      okButtonProps={{ disabled: running }}
      cancelButtonProps={{ style: { display: 'none' } }}
      onOk={onClose}
      destroyOnHidden
    >
      <div className="sync-progress-stack">
        <div>
          <Progress percent={percent} status={running ? 'active' : failedCount ? 'exception' : 'success'} />
          <Space size={12} wrap>
            <Text type="secondary">总数 {total}</Text>
            <Text type="secondary">已完成 {completed}</Text>
            <Text type="secondary">成功 {successCount}</Text>
            <Text type="secondary">失败 {failedCount}</Text>
          </Space>
          {currentName ? (
            <div className="sync-progress-current">
              <Text type="secondary">当前实例：</Text>
              <Text strong>{currentName}</Text>
            </div>
          ) : null}
        </div>

        <List
          className="sync-progress-list"
          size="small"
          locale={{ emptyText: '暂无同步记录' }}
          dataSource={recentItems}
          renderItem={(item) => {
            const statusMeta = formatStatus(item.status);
            return (
              <List.Item>
                <div className="sync-progress-item">
                  <Space size={8} wrap>
                    <Tag color={statusMeta.color}>{statusMeta.label}</Tag>
                    <Text strong>{item.name}</Text>
                  </Space>
                  {item.errorMessage ? <Text type="danger">{item.errorMessage}</Text> : null}
                </div>
              </List.Item>
            );
          }}
        />
      </div>
    </Modal>
  );
}
