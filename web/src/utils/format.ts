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
