import dayjs from 'dayjs';

export function formatDateTime(value?: string | null): string {
  if (!value) {
    return '-';
  }
  return dayjs(value).format('YYYY-MM-DD HH:mm:ss');
}

export function formatNumber(value?: number | null): string {
  if (value === null || value === undefined) {
    return '-';
  }
  return new Intl.NumberFormat('zh-CN').format(value);
}

export function formatMoney(value?: number | null): string {
  if (value === null || value === undefined) {
    return '-';
  }

  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatBillingMode(value?: string | null): string {
  return value === 'postpaid' ? '后付费' : '预付费';
}

export function getBillingModeTagColor(value?: string | null): string {
  return value === 'postpaid' ? 'blue' : 'orange';
}

export function formatProgramType(value?: string | null): string {
  switch (value) {
    case 'rixapi':
      return 'RixAPI';
    case 'shellapi':
      return 'ShellAPI';
    default:
      return 'NewAPI';
  }
}
