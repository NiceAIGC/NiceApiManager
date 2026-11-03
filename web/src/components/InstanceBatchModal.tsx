import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { getErrorMessage } from '../api/client';
import { testInstanceProxy } from '../api/instances';
import {
  AppModal,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DescriptionList,
  MultiSelect,
  NumberField,
  SelectField,
  StarRating,
  SwitchField,
  TextField,
} from './ui';
import { notify } from '../lib/toast';
import type { BatchInstanceUpdatePayload, Instance, InstanceCreatePayload, ProxyConnectivityTestResponse } from '../types/api';
import { formatNumber, formatProgramType } from '../utils/format';
import { normalizeBaseUrl, normalizeInstancePayload } from '../utils/instance';

interface BatchItem extends InstanceCreatePayload {
  id?: number;
}

interface InstanceBatchModalProps {
  open: boolean;
  loading: boolean;
  mode: 'create' | 'edit';
  initialItems?: Instance[];
  defaultSyncIntervalMinutes?: number;
  defaultProxyMode?: InstanceCreatePayload['proxy_mode'];
  tagOptions?: Array<{ label: string; value: string }>;
  notificationChannelOptions?: Array<{ label: string; value: string }>;
  notificationChannelGroupOptions?: Array<{ label: string; value: string }>;
  onCancel: () => void;
  onSubmit: (items: Array<InstanceCreatePayload | BatchInstanceUpdatePayload>) => void;
}

const PROGRAM_OPTIONS = [
  { value: 'auto', label: '自动识别' },
  { value: 'newapi', label: 'NewAPI' },
  { value: 'rixapi', label: 'RixAPI' },
  { value: 'shellapi', label: 'ShellAPI' },
  { value: 'sub2api', label: 'Sub2API' },
];
const PROXY_OPTIONS = [
  { value: 'direct', label: '本地直连' },
  { value: 'global', label: '公用 SOCKS5' },
  { value: 'custom', label: '自定义 SOCKS5' },
];
const BILLING_OPTIONS = [
  { value: 'prepaid', label: '预付费' },
  { value: 'postpaid', label: '后付费' },
];

function buildEmptyItem(defaultProxyMode: InstanceCreatePayload['proxy_mode'], syncInterval: number): BatchItem {
  return {
    name: '',
    remark: '',
    base_url: 'https://',
    program_type: 'auto',
    username: '',
    password: '',
    remote_user_id: undefined,
    access_token: '',
    proxy_mode: defaultProxyMode,
    socks5_proxy_url: '',
    enabled: true,
    balance_alert_enabled: false,
    balance_alert_threshold: undefined,
    notification_channel_ids: [],
    notification_channel_group_ids: [],
    notify_rate_changes: true,
    notify_announcements: true,
    billing_mode: 'prepaid',
    quota_per_unit: undefined,
    priority: 3,
    sync_interval_minutes: syncInterval,
    tags: [],
  };
}

export function InstanceBatchModal({
  open,
  loading,
  mode,
  initialItems,
  defaultSyncIntervalMinutes = 120,
  defaultProxyMode = 'direct',
  tagOptions = [],
  notificationChannelOptions = [],
  notificationChannelGroupOptions = [],
  onCancel,
  onSubmit,
}: InstanceBatchModalProps) {
  const [items, setItems] = useState<BatchItem[]>([]);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [testingIndex, setTestingIndex] = useState<number | null>(null);
  const [proxyResult, setProxyResult] = useState<ProxyConnectivityTestResponse | null>(null);

  useEffect(() => {
    if (!open) {
      setItems([]);
      setErrors({});
      return;
    }
    if (mode === 'edit') {
      setItems(
        (initialItems ?? []).map((item) => ({
          ...item,
          password: '',
          access_token: '',
        }) as unknown as BatchItem),
      );
    } else {
      setItems([buildEmptyItem(defaultProxyMode, defaultSyncIntervalMinutes)]);
    }
    setErrors({});
  }, [defaultProxyMode, defaultSyncIntervalMinutes, initialItems, mode, open]);

  const patch = (index: number, changes: Partial<BatchItem>) => {
    setItems((current) => current.map((item, currentIndex) => (currentIndex === index ? { ...item, ...changes } : item)));
  };

  const handleTestProxy = async (index: number) => {
    const item = items[index];
    if (!item) return;
    try {
      setTestingIndex(index);
      const result = await testInstanceProxy({
        base_url: normalizeBaseUrl(item.base_url),
        proxy_mode: item.proxy_mode,
        socks5_proxy_url: item.socks5_proxy_url,
      });
      setProxyResult(result);
    } catch (error) {
      notify.error(getErrorMessage(error));
    } finally {
      setTestingIndex(null);
    }
  };

  const submit = () => {
    const nextErrors: Record<number, string> = {};
    items.forEach((item, index) => {
      if (!item.name.trim()) nextErrors[index] = '请填写实例名称';
      else if (!item.base_url.trim()) nextErrors[index] = '请填写 Base URL';
    });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      notify.warning('请先补全必填项');
      return;
    }
    onSubmit(items.map((item) => normalizeInstancePayload(item)));
  };

  return (
    <>
      <AppModal
        open={open}
        onOpenChange={(value) => { if (!value) onCancel(); }}
        title={mode === 'create' ? '批量新增实例' : '批量编辑实例'}
        description="每张卡片对应一个实例，字段彼此独立。"
        size="xl"
        footer={
          <>
            <Button variant="outline" onClick={onCancel}>取消</Button>
            <Button isPending={loading} onClick={submit}>
              {mode === 'create' ? `批量保存（${items.length}）` : `批量更新（${items.length}）`}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {items.map((item, index) => (
            <Card key={item.id ?? `new-${index}`} className="gap-3 py-3">
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle className="text-sm">
                  {mode === 'create' ? `实例 ${index + 1}` : `实例 #${item.id} · ${item.name || '未命名'}`}
                </CardTitle>
                {mode === 'create' && items.length > 1 ? (
                  <Button variant="ghost" size="icon-sm" aria-label="删除本行" onClick={() => setItems((current) => current.filter((_, i) => i !== index))}>
                    <Trash2 className="size-4" />
                  </Button>
                ) : null}
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <TextField label="实例名称" required error={errors[index]} inputProps={{ placeholder: '例如：主站', value: item.name, onChange: (event) => patch(index, { name: event.target.value }) }} />
                <TextField label="备注" inputProps={{ placeholder: '例如：主力 / 备用', maxLength: 255, value: item.remark ?? '', onChange: (event) => patch(index, { remark: event.target.value }) }} />
                <TextField label="Base URL" required inputProps={{ placeholder: 'https://example.com', value: item.base_url, onChange: (event) => patch(index, { base_url: event.target.value }) }} />
                <SelectField label="程序类型" value={item.program_type} onValueChange={(value) => patch(index, { program_type: value as BatchItem['program_type'] })} options={PROGRAM_OPTIONS} />
                <TextField label="用户名 / 邮箱" inputProps={{ placeholder: '远端站点用户名或邮箱', value: item.username ?? '', onChange: (event) => patch(index, { username: event.target.value }) }} />
                <TextField label={mode === 'edit' ? '密码（留空不变）' : '密码'} inputProps={{ type: 'password', placeholder: mode === 'edit' ? '留空则保持现有密码' : '远端站点密码', value: item.password ?? '', onChange: (event) => patch(index, { password: event.target.value }) }} />
                <SwitchField label="启用状态" checked={item.enabled} onCheckedChange={(value) => patch(index, { enabled: value })} />
                <NumberField label="同步周期（分钟）" value={item.sync_interval_minutes} onValueChange={(value) => patch(index, { sync_interval_minutes: value })} min={5} max={10080} />
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium leading-none">优先级</span>
                  <StarRating value={item.priority} onChange={(value) => patch(index, { priority: value || 3 })} />
                </div>
                <SelectField label="代理方式" value={item.proxy_mode} onValueChange={(value) => patch(index, { proxy_mode: value as BatchItem['proxy_mode'] })} options={PROXY_OPTIONS} />
                {item.proxy_mode === 'custom' ? (
                  <TextField label="自定义 SOCKS5" inputProps={{ placeholder: '用户名:密码@主机:端口', value: item.socks5_proxy_url ?? '', onChange: (event) => patch(index, { socks5_proxy_url: event.target.value }) }} />
                ) : null}
                <div className="flex items-end gap-2">
                  <Button variant="secondary" size="sm" isPending={testingIndex === index} onClick={() => void handleTestProxy(index)}>
                    测试代理
                  </Button>
                  <span className="text-xs text-muted-foreground">请求远端 /api/status</span>
                </div>
                <SelectField label="计费方式" value={item.billing_mode} onValueChange={(value) => patch(index, { billing_mode: value as BatchItem['billing_mode'] })} options={BILLING_OPTIONS} />
                <NumberField label="余额倍率" description="留空用远端识别值" value={item.quota_per_unit ?? undefined} onValueChange={(value) => patch(index, { quota_per_unit: value })} min={0.000001} step={0.000001} />
                <SwitchField label="余额告警" checked={item.balance_alert_enabled} onCheckedChange={(value) => patch(index, { balance_alert_enabled: value })} />
                {item.balance_alert_enabled ? (
                  <>
                    <NumberField label="余额告警阈值" description="留空使用全局默认值" value={item.balance_alert_threshold ?? undefined} onValueChange={(value) => patch(index, { balance_alert_threshold: value })} min={0.01} />
                    <MultiSelect label="告警渠道" description="留空走默认渠道" options={notificationChannelOptions} value={item.notification_channel_ids} onChange={(value) => patch(index, { notification_channel_ids: value })} placeholder="默认通知渠道" />
                    <MultiSelect label="渠道分组" description="按分组批量投递" options={notificationChannelGroupOptions} value={item.notification_channel_group_ids} onChange={(value) => patch(index, { notification_channel_group_ids: value })} placeholder="不选分组" />
                  </>
                ) : null}
                <SwitchField label="倍率变更推送" description="关闭后只记录不推送" checked={item.notify_rate_changes} onCheckedChange={(value) => patch(index, { notify_rate_changes: value })} />
                <SwitchField label="上游公告推送" description="关闭后只入库不推送" checked={item.notify_announcements} onCheckedChange={(value) => patch(index, { notify_announcements: value })} />
                <Collapsible className="md:col-span-2">
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="w-fit">
                      更多设置
                      <ChevronDown className="size-4" />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="grid grid-cols-1 gap-4 pt-2 md:grid-cols-2">
                    <TextField label="远端用户 ID" inputProps={{ placeholder: '使用访问密钥时填写', value: item.remote_user_id ?? '', onChange: (event) => patch(index, { remote_user_id: event.target.value ? Number(event.target.value) : undefined }) }} />
                    <TextField label="访问密钥（Token）" inputProps={{ type: 'password', placeholder: '使用 Token 认证时填写', value: item.access_token ?? '', onChange: (event) => patch(index, { access_token: event.target.value }) }} />
                    <MultiSelect label="标签" options={tagOptions} value={item.tags} onChange={(value) => patch(index, { tags: value })} placeholder="选择或输入标签" description="可选已有标签" />
                  </CollapsibleContent>
                </Collapsible>
              </CardContent>
            </Card>
          ))}
          {mode === 'create' ? (
            <Button variant="secondary" className="w-fit" onClick={() => setItems((current) => [...current, buildEmptyItem(defaultProxyMode, defaultSyncIntervalMinutes)])}>
              <Plus className="size-4" />
              再添加一行
            </Button>
          ) : null}
        </div>
      </AppModal>

      <AppModal
        open={proxyResult !== null}
        onOpenChange={(value) => { if (!value) setProxyResult(null); }}
        title="代理测试成功"
        size="sm"
        footer={<Button onClick={() => setProxyResult(null)}>知道了</Button>}
      >
        {proxyResult ? (
          <DescriptionList
            columns={1}
            items={[
              { label: '目标地址', value: proxyResult.base_url },
              { label: '代理方式', value: proxyResult.proxy_mode === 'custom' ? '自定义 SOCKS5' : proxyResult.proxy_mode === 'global' ? '公用 SOCKS5' : '本地直连' },
              { label: '实际代理', value: proxyResult.resolved_proxy_url || '本地直连' },
              { label: '识别程序', value: formatProgramType(proxyResult.detected_program_type) },
              { label: '兑换比', value: formatNumber(proxyResult.quota_per_unit) },
            ]}
          />
        ) : null}
      </AppModal>
    </>
  );
}
