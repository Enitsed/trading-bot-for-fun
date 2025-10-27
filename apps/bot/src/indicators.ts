// RSI(Relative Strength Index)를 계산해 각 위치별 RSI 값을 반환
export function rsi(values: number[], period = 14): number[] {
  if (values.length < period + 1) return Array(values.length).fill(Number.NaN); // 초기값 부족 시 NaN 채움
  const out = Array(values.length).fill(Number.NaN); // 결과 배열
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1];
    if (change >= 0) gains += change; else losses -= change;
  }
  let avgGain = gains / period; // 초기 평균 상승폭
  let avgLoss = losses / period; // 초기 평균 하락폭
  out[period] = 100 - 100 / (1 + (avgGain / (avgLoss || 1e-12)));
  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    avgGain = (avgGain * (period - 1) + gain) / period; // Wilder 이동평균 업데이트
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const rs = avgGain / (avgLoss || 1e-12); // 상대 강도
    out[i] = 100 - 100 / (1 + rs);
  }
  return out;
}
