import { NextResponse } from 'next/server';
import { ensureDbConnection, fetchLatestSnapshot } from '@scalper/shared';

export const dynamic = 'force-dynamic';

type HealthStatus = 'healthy' | 'unhealthy' | 'degraded';

type HealthResponse = {
  status: HealthStatus;
  timestamp: number;
  checks: {
    database: 'connected' | 'disconnected' | 'error';
    telemetry: 'available' | 'stale' | 'unavailable';
  };
  lastSnapshot?: {
    recordedAt: string;
    ageMs: number;
  } | null;
  error?: string;
};

const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5분

export async function GET() {
  const checks: HealthResponse['checks'] = {
    database: 'disconnected',
    telemetry: 'unavailable',
  };

  let lastSnapshot: HealthResponse['lastSnapshot'] = null;
  let overallStatus: HealthStatus = 'healthy';
  let errorMessage: string | undefined;

  // 데이터베이스 연결 체크
  try {
    await ensureDbConnection();
    checks.database = 'connected';
  } catch (error) {
    checks.database = 'error';
    overallStatus = 'unhealthy';
    errorMessage = error instanceof Error ? error.message : 'Database connection failed';
  }

  // 텔레메트리 체크 (데이터베이스가 연결된 경우만)
  if (checks.database === 'connected') {
    try {
      const snapshot = await fetchLatestSnapshot();
      if (snapshot && snapshot.timestamp) {
        const now = Date.now();
        const ageMs = now - snapshot.timestamp;

        lastSnapshot = {
          recordedAt: new Date(snapshot.timestamp).toISOString(),
          ageMs,
        };

        if (ageMs < STALE_THRESHOLD_MS) {
          checks.telemetry = 'available';
        } else {
          checks.telemetry = 'stale';
          overallStatus = 'degraded';
        }
      } else {
        checks.telemetry = 'unavailable';
        overallStatus = 'degraded';
      }
    } catch (error) {
      checks.telemetry = 'unavailable';
      overallStatus = 'degraded';
      console.error('[health] telemetry check failed', error);
    }
  }

  const response: HealthResponse = {
    status: overallStatus,
    timestamp: Date.now(),
    checks,
    lastSnapshot,
  };

  if (errorMessage) {
    response.error = errorMessage;
  }

  const httpStatus = overallStatus === 'healthy' ? 200 : overallStatus === 'degraded' ? 200 : 503;

  return NextResponse.json(response, { status: httpStatus });
}
