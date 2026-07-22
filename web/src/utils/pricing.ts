export const INPUT_USD_PER_MILLION_AT_RATIO_ONE = 2;

export function inputUsdPerMillion(modelRatio: number): number {
  return modelRatio * INPUT_USD_PER_MILLION_AT_RATIO_ONE;
}

export function outputUsdPerMillion(modelRatio: number, completionRatio: number): number {
  return inputUsdPerMillion(modelRatio) * completionRatio;
}

export function cacheUsdPerMillion(modelRatio: number, cacheRatio?: number | null): number | null {
  if (cacheRatio === null || cacheRatio === undefined) {
    return null;
  }
  return inputUsdPerMillion(modelRatio) * cacheRatio;
}
