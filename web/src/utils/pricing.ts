// Price formatting helpers for normalized pricing data.
//
// All monetary fields coming from the backend are already normalized:
// - price_input / price_output / price_cache_* : USD per 1M tokens
// - price_per_request : USD per request
// The legacy ratio-only math (ratio × $2) is kept only for the optional
// ratio display of NewAPI rows.

export function formatPricePerMillion(value?: number | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '-';
  }
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 2 : abs >= 1 ? 4 : abs >= 0.001 ? 6 : 8;
  return `$${value.toFixed(digits)}/1M`;
}

export function formatPricePerRequest(value?: number | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '-';
  }
  return `$${value < 0.01 ? value.toFixed(6) : value.toFixed(3)}/次`;
}

export function formatRatio(value?: number | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '-';
  }
  return `${Number.parseFloat(value.toFixed(8))}x`;
}

export function formatHourWindow(from: number, to: number): string {
  return `${String(from).padStart(2, '0')}:00–${String(to).padStart(2, '0')}:00`;
}

export function formatClock(value?: string | null): string {
  if (!value) {
    return '-';
  }
  return value.replace(/^(\d{2}:\d{2}):\d{2}$/, '$1');
}

export interface TierPriceSource {
  input_price?: number | null;
  output_price?: number | null;
  cache_read_price?: number | null;
  cache_write_price?: number | null;
  cache_write_1h_price?: number | null;
  per_request_price?: number | null;
  fixed_price?: number | null;
  prices?: Record<string, number>;
}

/** Read one price dimension from either sub2api-style explicit tier fields or parsed new-api `prices`. */
export function tierPrice(tier: TierPriceSource, key: 'input' | 'output' | 'cache_read' | 'cache_write' | 'cache_write_1h'): number | null {
  const explicitMap: Record<typeof key, number | null | undefined> = {
    input: tier.input_price,
    output: tier.output_price,
    cache_read: tier.cache_read_price,
    cache_write: tier.cache_write_price,
    cache_write_1h: tier.cache_write_1h_price,
  };
  const explicit = explicitMap[key];
  if (explicit !== null && explicit !== undefined) {
    return explicit;
  }
  const parsed = tier.prices?.[key];
  return parsed === undefined ? null : parsed;
}

export function tierFixedPrice(tier: TierPriceSource): number | null {
  if (tier.fixed_price !== null && tier.fixed_price !== undefined) {
    return tier.fixed_price;
  }
  if (tier.per_request_price !== null && tier.per_request_price !== undefined) {
    return tier.per_request_price;
  }
  return null;
}
