import {
  calculateRetailVnd,
  estimateChatTokens,
  isQuoteExpired,
} from './pricing-calculator';

describe('pricing calculator', () => {
  it('applies the configured markup and rounds up to a whole VND', () => {
    expect(calculateRetailVnd(0.01, 25_000, 0.2)).toBe(300);
    expect(calculateRetailVnd(0.00001, 25_000, 0.2)).toBe(1);
  });

  it('rejects invalid FX or markup inputs', () => {
    expect(() => calculateRetailVnd(1, 0, 0.2)).toThrow(RangeError);
    expect(() => calculateRetailVnd(1, 25_000, -0.1)).toThrow(RangeError);
  });

  it('caps chat output tokens to the model limit', () => {
    expect(estimateChatTokens('12345678', 50_000, 4096)).toEqual({
      inputTokens: 2,
      maxOutputTokens: 4096,
    });
  });

  it('expires quotes at the exact expiry time', () => {
    const expiry = new Date('2026-10-07T00:00:00.000Z');
    expect(isQuoteExpired(expiry, expiry.getTime() - 1)).toBe(false);
    expect(isQuoteExpired(expiry, expiry.getTime())).toBe(true);
  });
});
