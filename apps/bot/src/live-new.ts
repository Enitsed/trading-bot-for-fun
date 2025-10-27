import { executeTradingLoop } from './trading-loop.js';
import { botLogger } from '../../../packages/shared/logger.js';

async function main(): Promise<void> {
  await botLogger.info('RSI Reversion Scalper Bot starting...', 'MAIN');

  try {
    await executeTradingLoop();
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    await botLogger.error(`Fatal error: ${message}`, 'MAIN');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal:', error instanceof Error ? error.message : error);
  process.exit(1);
});