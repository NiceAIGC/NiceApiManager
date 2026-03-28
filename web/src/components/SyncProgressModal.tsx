import { Alert, Button, Descriptions, Modal, Progress, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';

const { Text } = Typography;

export type SyncProgressStatus = 'pending' | 'running' | 'success' | 'failed';

export interface SyncProgressItem {
  key: string | number;
  name: string;
  status: SyncProgressStatus;
  errorMessage?: string | null;
  detail?: string | null;
  durationMs?: number | null;
}

interface SyncProgressModalProps {
  open: boolean;
  title: string;
  running: boolean;
  total: number;
  completed: number;
  successCount: number;
  failedCount: number;
  activeNames?: string[];
  items: SyncProgressItem[];
  onClose: () => void;
  onRetryFailed?: (items: SyncProgressItem[]) => void;
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

function formatDuration(durationMs?: number | null) {
  if (durationMs == null) {
    return '-';
  }
  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }
  return `${(durationMs / 1000).toFixed(durationMs >= 10_000 ? 0 : 1)} s`;
}

export function SyncProgressModal({
  open,
  title,
  running,
  total,
  completed,
  successCount,
  failedCount,
  activeNames = [],
  items,
  onClose,
  onRetryFailed,
}: SyncProgressModalProps) {
  const percent = total ? Math.round((completed / total) * 100) : 0;
  const failedItems = items.filter((item) => item.status === 'failed');
  const columns: ColumnsType<SyncProgressItem> = [
    {
      title: '实例',
      dataIndex: 'name',
      key: 'name',
      width: 180,
      render: (value: string) => <Text strong>{value}</Text>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (value: SyncProgressStatus) => {
        const statusMeta = formatStatus(value);
        return <Tag color={statusMeta.color}>{statusMeta.label}</Tag>;
      },
    },
    {
      title: '耗时',
      dataIndex: 'durationMs',
      key: 'durationMs',
      width: 90,
      render: (value?: number | null) => formatDuration(value),
    },
    {
      title: '说明',
      dataIndex: 'detail',
      key: 'detail',
      render: (_: string | null | undefined, item) =>
        item.errorMessage ? <Text type="danger">{item.errorMessage}</Text> : <Text type="secondary">{item.detail || '-'}</Text>,
    },
  ];

  return (
    <Modal
      title={title}
      open={open}
      onCancel={running ? undefined : onClose}
      footer={[
        !running && failedItems.length && onRetryFailed ? (
          <Button key="retry-failed" onClick={() => onRetryFailed(failedItems)}>
            重试失败实例（{failedItems.length}）
          </Button>
        ) : null,
        <Button key="close" type="primary" onClick={onClose} disabled={running}>
          关闭
        </Button>,
      ]}
      destroyOnHidden
      width={920}
    >
      <div className="sync-progress-stack">
        <div>
          <Progress percent={percent} status={running ? 'active' : failedCount ? 'exception' : 'success'} />
          <Descriptions
            size="small"
            column={4}
            items={[
              { key: 'total', label: '总数', children: total },
              { key: 'completed', label: '已完成', children: completed },
              { key: 'success', label: '成功', children: successCount },
              { key: 'failed', label: '失败', children: failedCount },
            ]}
          />
          <Alert
            type={running ? 'info' : failedCount ? 'warning' : 'success'}
            showIcon
            message={
              running
                ? `正在同步 ${activeNames.length} 个实例`
                : failedCount
                  ? `同步结束，失败 ${failedCount} 个`
                  : '全部实例同步完成'
            }
            description={
              activeNames.length ? (
                <Space size={[8, 8]} wrap>
                  {activeNames.map((name) => (
                    <Tag key={name} color="processing">
                      {name}
                    </Tag>
                  ))}
                </Space>
              ) : '详情见下方逐项结果表。'
            }
          />
        </div>

        <Table
          size="small"
          rowKey="key"
          pagination={false}
          columns={columns}
          dataSource={items}
          locale={{ emptyText: '暂无同步记录' }}
          scroll={{ y: 360 }}
        />
      </div>
    </Modal>
  );
}
