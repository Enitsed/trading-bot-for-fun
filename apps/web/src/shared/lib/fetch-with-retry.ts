// shared/lib/fetch-with-retry.ts
// API 호출 실패시 exponential backoff와 함께 재시도하는 유틸리티 함수

type FetchWithRetryOptions = {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  shouldRetry?: (error: Error, attempt: number) => boolean;
};

const DEFAULT_OPTIONS: Required<FetchWithRetryOptions> = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  shouldRetry: (error: Error) => {
    // 네트워크 에러나 5xx 에러만 재시도
    return error.message.includes('fetch') || error.message.includes('network');
  },
};

/**
 * exponential backoff로 재시도하는 fetch wrapper
 * @param url - 요청 URL
 * @param init - fetch init options
 * @param options - 재시도 설정
 */
export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  options: FetchWithRetryOptions = {}
): Promise<Response> {
  const config = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      const response = await fetch(url, init);

      // 5xx 에러는 재시도 대상
      if (response.status >= 500 && response.status < 600) {
        throw new Error(`Server error: ${response.status}`);
      }

      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // 마지막 시도였거나 재시도 불가능한 에러면 즉시 throw
      if (attempt === config.maxRetries || !config.shouldRetry(lastError, attempt)) {
        throw lastError;
      }

      // exponential backoff delay 계산
      const delay = Math.min(
        config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt),
        config.maxDelayMs
      );

      // 다음 재시도까지 대기
      await sleep(delay);
    }
  }

  // 여기까지 오면 모든 재시도 실패
  throw lastError || new Error('All retries failed');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * JSON API 호출을 위한 편의 함수 (재시도 포함)
 */
export async function fetchJsonWithRetry<T = unknown>(
  url: string,
  init?: RequestInit,
  retryOptions?: FetchWithRetryOptions
): Promise<T> {
  const response = await fetchWithRetry(url, init, retryOptions);

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody?.error || `HTTP ${response.status}: ${response.statusText}`);
  }

  return response.json();
}
