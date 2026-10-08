export function calculateRetailVnd(
  providerCostUsd: number,
  usdVndRate: number,
  markupRate: number,
) {
  if (
    !Number.isFinite(providerCostUsd) ||
    !Number.isFinite(usdVndRate) ||
    !Number.isFinite(markupRate) ||
    providerCostUsd < 0 ||
    usdVndRate <= 0 ||
    markupRate < 0
  ) {
    throw new RangeError('Thông số giá không hợp lệ');
  }

  return Math.ceil(providerCostUsd * usdVndRate * (1 + markupRate));
}

export function estimateChatTokens(
  prompt: string,
  requestedMax: unknown,
  modelMax: unknown,
) {
  const requested = Number(requestedMax);
  const limit = Number(modelMax);
  const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 16_384;
  const maxOutputTokens = Math.max(
    1,
    Math.min(
      Number.isFinite(requested) && requested > 0 ? requested : 1024,
      safeLimit,
    ),
  );

  return {
    inputTokens: Math.max(1, Math.ceil(prompt.length / 4)),
    maxOutputTokens,
  };
}

export function isQuoteExpired(expiresAt: Date, now = Date.now()) {
  return expiresAt.getTime() <= now;
}
