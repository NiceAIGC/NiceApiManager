import { useEffect, useState } from 'react';

import {
  AppModal,
  Button,
  Field,
  MultiSelect,
  NumberField,
  SegmentedControl,
  StarRating,
} from './ui';
import { notify } from '../lib/toast';
import type { BatchInstanceBulkUpdatePayload } from '../types/api';

type TriState = 'keep' | 'on' | 'off';
type ThresholdMode = 'keep' | 'default' | 'custom';
type ReplaceMode = 'keep' | 'replace';

const TRI_OPTIONS = [
  { value: 'keep', label: '不修改' },
  { value: 'on', label: '开启' },
  { value: 'off', label: '关闭' },
];
const THRESHOLD_OPTIONS = [
  { value: 'keep', label: '不修改' },
  { value: 'default', label: '全局默认' },
  { value: 'custom', label: '自定义' },
];
const REPLACE_OPTIONS = [
  { value: 'keep', label: '不修改' },
  { value: 'replace', label: '覆盖' },
];

interface InstanceBulkActionModalProps {
  open: boolean;
  loading: boolean;
  instanceIds: number[];
  defaultSyncIntervalMinutes?: number;
  tagOptions?: Array<{ label: string; value: string }>;
  notificationChannelOptions?: Array<{ label: string; value: string }>;
  notificationChannelGroupOptions?: Array<{ label: string; value: string }>;
  onCancel: () => void;
  onSubmit: (payload: BatchInstanceBulkUpdatePayload) => void;
}

/** 把统一修改一次性应用到所有选中实例。 */
export function InstanceBulkActionModal({
  open,
  loading,
  instanceIds,
  defaultSyncIntervalMinutes = 120,
  tagOptions = [],
  notificationChannelOptions = [],
  notificationChannelGroupOptions = [],
  onCancel,
  onSubmit,
}: InstanceBulkActionModalProps) {
  const [enabled, setEnabled] = useState<TriState>('keep');
  const [balanceAlert, setBalanceAlert] = useState<TriState>('keep');
  const [rateChanges, setRateChanges] = useState<TriState>('keep');
  const [announcements, setAnnouncements] = useState<TriState>('keep');
  const [healthAlert, setHealthAlert] = useState<TriState>('keep');
  const [thresholdMode, setThresholdMode] = useState<ThresholdMode>('keep');
  const [threshold, setThreshold] = useState(10);
  const [channelMode, setChannelMode] = useState<ReplaceMode>('keep');
  const [channelIds, setChannelIds] = useState<string[]>([]);
  const [channelGroupMode, setChannelGroupMode] = useState<ReplaceMode>('keep');
  const [channelGroupIds, setChannelGroupIds] = useState<string[]>([]);
  const [priorityMode, setPriorityMode] = useState<'keep' | 'set'>('keep');
  const [priority, setPriority] = useState(3);
  const [intervalMode, setIntervalMode] = useState<'keep' | 'set'>('keep');
  const [syncInterval, setSyncInterval] = useState(defaultSyncIntervalMinutes);
  const [tagsMode, setTagsMode] = useState<ReplaceMode>('keep');
  const [tags, setTags] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setEnabled('keep');
    setBalanceAlert('keep');
    setRateChanges('keep');
    setAnnouncements('keep');
    setHealthAlert('keep');
    setThresholdMode('keep');
    setThreshold(10);
    setChannelMode('keep');
    setChannelIds([]);
    setChannelGroupMode('keep');
    setChannelGroupIds([]);
    setPriorityMode('keep');
    setPriority(3);
    setIntervalMode('keep');
    setSyncInterval(defaultSyncIntervalMinutes);
    setTagsMode('keep');
    setTags([]);
  }, [defaultSyncIntervalMinutes, open]);

  const applyNotificationPreset = (next: TriState) => {
    setBalanceAlert(next);
    setRateChanges(next);
    setAnnouncements(next);
    setHealthAlert(next);
  };

  const submit = () => {
    const payload: BatchInstanceBulkUpdatePayload = { ids: instanceIds };

    if (enabled !== 'keep') payload.enabled = enabled === 'on';
    if (balanceAlert !== 'keep') payload.balance_alert_enabled = balanceAlert === 'on';
    if (rateChanges !== 'keep') payload.notify_rate_changes = rateChanges === 'on';
    if (announcements !== 'keep') payload.notify_announcements = announcements === 'on';
    if (healthAlert !== 'keep') payload.health_alert_enabled = healthAlert === 'on';
    if (thresholdMode === 'default') payload.balance_alert_threshold = null;
    if (thresholdMode === 'custom') {
      if (!Number.isFinite(threshold) || threshold <= 0) {
        notify.warning('请填写大于 0 的余额告警阈值');
        return;
      }
      payload.balance_alert_threshold = threshold;
    }
    if (channelMode === 'replace') payload.notification_channel_ids = channelIds;
    if (channelGroupMode === 'replace') payload.notification_channel_group_ids = channelGroupIds;
    if (priorityMode === 'set') payload.priority = priority;
    if (intervalMode === 'set') payload.sync_interval_minutes = syncInterval;
    if (tagsMode === 'replace') payload.tags = tags;

    if (Object.keys(payload).length === 1) {
      notify.warning('请至少选择一项要批量修改的内容');
      return;
    }
    onSubmit(payload);
  };

  return (
    <AppModal
      open={open}
      onOpenChange={(value) => { if (!value) onCancel(); }}
      title={`批量操作 ${instanceIds.length} 个实例`}
      description="选中的修改会以相同值覆盖到每个实例；标为「不修改」的字段保持原值。"
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onCancel}>取消</Button>
          <Button isPending={loading} onClick={submit}>应用到 {instanceIds.length} 个实例</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/40 px-3 py-2">
          <span className="text-sm text-muted-foreground">通知快捷操作</span>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => applyNotificationPreset('on')}>全部开启通知</Button>
            <Button variant="secondary" size="sm" onClick={() => applyNotificationPreset('off')}>全部关闭通知</Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-2">
          <Field label="启用状态" description="停用后调度器不再同步该实例">
            <SegmentedControl size="sm" options={TRI_OPTIONS} value={enabled} onChange={(value) => setEnabled(value as TriState)} />
          </Field>
          <Field label="优先级">
            {priorityMode === 'keep' ? (
              <SegmentedControl size="sm" options={REPLACE_OPTIONS.map((item) => ({ value: item.value, label: item.value === 'keep' ? '不修改' : '设置' }))} value={priorityMode} onChange={(value) => setPriorityMode(value as 'keep' | 'set')} />
            ) : (
              <div className="flex items-center gap-2">
                <StarRating value={priority} onChange={(value) => setPriority(value || 3)} />
                <Button variant="ghost" size="sm" onClick={() => setPriorityMode('keep')}>不修改</Button>
              </div>
            )}
          </Field>
          <Field label="余额告警">
            <SegmentedControl size="sm" options={TRI_OPTIONS} value={balanceAlert} onChange={(value) => setBalanceAlert(value as TriState)} />
          </Field>
          <Field label="余额告警阈值" description="全局默认会清除实例自定义阈值">
            <div className="flex flex-col gap-2">
              <SegmentedControl size="sm" options={THRESHOLD_OPTIONS} value={thresholdMode} onChange={(value) => setThresholdMode(value as ThresholdMode)} />
              {thresholdMode === 'custom' ? (
                <NumberField value={threshold} min={0.01} step={0.01} onValueChange={setThreshold} placeholder="例如 10" />
              ) : null}
            </div>
          </Field>
          <Field label="倍率变更推送" description="关闭后仍记录，只是不推送">
            <SegmentedControl size="sm" options={TRI_OPTIONS} value={rateChanges} onChange={(value) => setRateChanges(value as TriState)} />
          </Field>
          <Field label="上游公告推送" description="关闭后仍入库，只是不推送">
            <SegmentedControl size="sm" options={TRI_OPTIONS} value={announcements} onChange={(value) => setAnnouncements(value as TriState)} />
          </Field>
          <Field label="连接失败告警" description="默认关闭，显式开启才通知">
            <SegmentedControl size="sm" options={TRI_OPTIONS} value={healthAlert} onChange={(value) => setHealthAlert(value as TriState)} />
          </Field>
          <Field label="同步周期（分钟）">
            <div className="flex items-center gap-2">
              <SegmentedControl size="sm" options={REPLACE_OPTIONS.map((item) => ({ value: item.value, label: item.value === 'keep' ? '不修改' : '设置' }))} value={intervalMode} onChange={(value) => setIntervalMode(value as 'keep' | 'set')} />
              {intervalMode === 'set' ? (
                <NumberField className="w-32" value={syncInterval} min={5} max={10080} onValueChange={setSyncInterval} />
              ) : null}
            </div>
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <SegmentedControl size="sm" options={REPLACE_OPTIONS} value={channelMode} onChange={(value) => setChannelMode(value as ReplaceMode)} />
            <MultiSelect
              label="通知渠道"
              description={channelMode === 'replace' ? '不选表示清空，走默认通知渠道' : '保持各实例现有渠道'}
              options={notificationChannelOptions}
              value={channelIds}
              onChange={setChannelIds}
              disabled={channelMode === 'keep'}
              placeholder="默认通知渠道"
            />
          </div>
          <div className="flex flex-col gap-2">
            <SegmentedControl size="sm" options={REPLACE_OPTIONS} value={channelGroupMode} onChange={(value) => setChannelGroupMode(value as ReplaceMode)} />
            <MultiSelect
              label="告警渠道分组"
              description={channelGroupMode === 'replace' ? '不选表示清空分组' : '保持各实例现有分组'}
              options={notificationChannelGroupOptions}
              value={channelGroupIds}
              onChange={setChannelGroupIds}
              disabled={channelGroupMode === 'keep'}
              placeholder="不选分组"
            />
          </div>
          <div className="flex flex-col gap-2 md:col-span-2">
            <SegmentedControl size="sm" options={REPLACE_OPTIONS} value={tagsMode} onChange={(value) => setTagsMode(value as ReplaceMode)} />
            <MultiSelect
              label="标签"
              description={tagsMode === 'replace' ? '会用所选标签覆盖每个实例的全部标签' : '保持各实例现有标签'}
              options={tagOptions}
              value={tags}
              onChange={setTags}
              disabled={tagsMode === 'keep'}
              placeholder="选择标签"
            />
          </div>
        </div>
      </div>
    </AppModal>
  );
}
