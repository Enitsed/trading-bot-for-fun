/**
 * Compute the Relative Strength Index (RSI) for a price series.
 */
export function rsi(values: number[], period = 14): number[] {
  if (values.length < period + 1) {
    return Array(values.length).fill(Number.NaN);
  }
  const out = Array(values.length).fill(Number.NaN);
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1];
    if (change >= 0) gains += change;
    else losses -= change;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  out[period] = 100 - 100 / (1 + avgGain / (avgLoss || 1e-12));
  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const rs = avgGain / (avgLoss || 1e-12);
    out[i] = 100 - 100 / (1 + rs);
  }
  return out;
}
