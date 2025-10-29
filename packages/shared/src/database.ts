import { Sequelize, DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from 'sequelize';
import { createRequire } from 'node:module';

type DbConfig = {
  url?: string;
  host: string;
  port: number;
  user: string;
  password?: string;
  database: string;
  logging: boolean;
};

const sequelize = createSequelizeInstance(resolveDbConfig());

export { sequelize };

function resolveDbConfig(): DbConfig {
  const url = process.env.PG_URL || undefined;
  const port = Number(process.env.PG_PORT ?? '5432');
  return {
    url,
    host: process.env.PG_HOST ?? '127.0.0.1',
    port: Number.isFinite(port) ? port : 5432,
    user: process.env.PG_USER ?? 'postgres',
    password: process.env.PG_PASSWORD || undefined,
    database: process.env.PG_DATABASE ?? 'scalper',
    logging: false,
  };
}

function createSequelizeInstance(config: DbConfig): Sequelize {
  const require = createRequire(import.meta.url);
  let dialectModule: Record<string, unknown>;
  try {
    dialectModule = require('pg');
  } catch (error) {
    const originalMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Postgres driver "pg" not found. Install it in the workspace (pnpm add pg). Original: ${originalMessage}`);
  }

  if (config.url) {
    return new Sequelize(config.url, {
      dialect: 'postgres',
      logging: config.logging,
      dialectModule,
    });
  }

  return new Sequelize({
    dialect: 'postgres',
    host: config.host,
    port: config.port,
    username: config.user,
    password: config.password,
    database: config.database,
    logging: config.logging,
    dialectModule,
  });
}

let initPromise: Promise<void> | null = null;
let isInitializing = false;

/**
 * Ensures database connection is established with timeout and retry logic
 * @param timeoutMs - Connection timeout in milliseconds (default: 10000)
 * @param retries - Number of retry attempts (default: 3)
 * @throws Error if connection fails after all retries
 */
export async function ensureDbConnection(
  timeoutMs = 10000,
  retries = 3
): Promise<void> {
  // Return existing promise if already initializing or initialized
  if (initPromise) {
    return initPromise;
  }

  // Prevent race condition with atomic flag
  if (isInitializing) {
    // Wait for existing initialization to complete
    while (isInitializing) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (initPromise) {
      return initPromise;
    }
  }

  isInitializing = true;

  const attemptConnection = async (): Promise<void> => {
    return Promise.race([
      sequelize.authenticate(),
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error(`Database connection timeout after ${timeoutMs}ms`)), timeoutMs)
      ),
    ]);
  };

  const connectWithRetry = async (): Promise<void> => {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        await attemptConnection();
        return; // Success
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < retries) {
          const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
          console.warn(
            `[DB] Connection attempt ${attempt}/${retries} failed: ${lastError.message}. Retrying in ${backoffMs}ms...`
          );
          await new Promise(resolve => setTimeout(resolve, backoffMs));
        }
      }
    }

    throw new Error(
      `Database connection failed after ${retries} attempts. Last error: ${lastError?.message}`
    );
  };

  try {
    initPromise = connectWithRetry();
    await initPromise;
    console.log('[DB] Connection established successfully');
  } catch (error) {
    initPromise = null;
    throw error;
  } finally {
    isInitializing = false;
  }
}

/**
 * Synchronizes database models with error handling
 * @param options - Sequelize sync options
 * @throws Error if sync fails
 */
export async function syncModels(options?: { alter?: boolean }): Promise<void> {
  try {
    await ensureDbConnection();

    console.log(`[DB] Syncing models with options: ${JSON.stringify(options ?? {})}`);
    await sequelize.sync(options);
    console.log('[DB] Models synchronized successfully');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to sync database models: ${message}`);
  }
}

export class PriceTickModel extends Model<InferAttributes<PriceTickModel>, InferCreationAttributes<PriceTickModel>> {
  declare id: CreationOptional<number>;
  declare symbol: string;
  declare candleAt: Date;
  declare priceOpen: number;
  declare priceHigh: number;
  declare priceLow: number;
  declare priceClose: number;
  declare volume: number;
  declare signal: string;
  declare position: number | null;
  declare equity: number | null;
  declare totalPnl: number | null;
  declare totalPnlPct: number | null;
  declare event: string;
  declare runtimeCfg: Record<string, unknown>;
  declare recordedAt: CreationOptional<Date>;
}

PriceTickModel.init(
  {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
    },
    symbol: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    candleAt: {
      field: 'candle_at',
      type: DataTypes.DATE,
      allowNull: false,
    },
    priceOpen: {
      field: 'price_open',
      type: DataTypes.DECIMAL,
      allowNull: false,
    },
    priceHigh: {
      field: 'price_high',
      type: DataTypes.DECIMAL,
      allowNull: false,
    },
    priceLow: {
      field: 'price_low',
      type: DataTypes.DECIMAL,
      allowNull: false,
    },
    priceClose: {
      field: 'price_close',
      type: DataTypes.DECIMAL,
      allowNull: false,
    },
    volume: {
      type: DataTypes.DECIMAL,
      allowNull: false,
    },
    signal: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    position: {
      type: DataTypes.DECIMAL,
      allowNull: true,
    },
    equity: {
      type: DataTypes.DECIMAL,
      allowNull: true,
    },
    totalPnl: {
      field: 'total_pnl',
      type: DataTypes.DECIMAL,
      allowNull: true,
    },
    totalPnlPct: {
      field: 'total_pnl_pct',
      type: DataTypes.DECIMAL,
      allowNull: true,
    },
    event: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    runtimeCfg: {
      field: 'runtime_cfg',
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {},
    },
    recordedAt: {
      field: 'recorded_at',
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    tableName: 'price_ticks',
    timestamps: false,
  }
);

export class TradeEventModel extends Model<InferAttributes<TradeEventModel>, InferCreationAttributes<TradeEventModel>> {
  declare id: CreationOptional<number>;
  declare symbol: string;
  declare tradedAt: Date;
  declare side: 'buy' | 'sell';
  declare amount: number;
  declare price: number;
  declare event: string;
  declare position: number | null;
  declare equity: number | null;
  declare orderId: string | null;
  declare clientOrderId: string | null;
  declare metadata: Record<string, unknown> | null;
  declare recordedAt: CreationOptional<Date>;
}

TradeEventModel.init(
  {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
    },
    symbol: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    tradedAt: {
      field: 'traded_at',
      type: DataTypes.DATE,
      allowNull: false,
    },
    side: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    amount: {
      type: DataTypes.DECIMAL,
      allowNull: false,
    },
    price: {
      type: DataTypes.DECIMAL,
      allowNull: false,
    },
    event: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    position: {
      type: DataTypes.DECIMAL,
      allowNull: true,
    },
    equity: {
      type: DataTypes.DECIMAL,
      allowNull: true,
    },
    orderId: {
      field: 'order_id',
      type: DataTypes.TEXT,
      allowNull: true,
    },
    clientOrderId: {
      field: 'client_order_id',
      type: DataTypes.TEXT,
      allowNull: true,
    },
    metadata: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {},
    },
    recordedAt: {
      field: 'recorded_at',
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    tableName: 'trade_events',
    timestamps: false,
  }
);

export class SnapshotModel extends Model<InferAttributes<SnapshotModel>, InferCreationAttributes<SnapshotModel>> {
  declare id: CreationOptional<number>;
  declare snapshotTs: Date;
  declare payload: Record<string, unknown>;
  declare createdAt: CreationOptional<Date>;
}

SnapshotModel.init(
  {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
    },
    snapshotTs: {
      field: 'snapshot_ts',
      type: DataTypes.DATE,
      allowNull: false,
    },
    payload: {
      type: DataTypes.JSONB,
      allowNull: false,
    },
    createdAt: {
      field: 'created_at',
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    tableName: 'bot_snapshots',
    timestamps: false,
  }
);

export class RuntimeOverrideModel extends Model<InferAttributes<RuntimeOverrideModel>, InferCreationAttributes<RuntimeOverrideModel>> {
  declare key: string;
  declare value: number;
  declare updatedAt: CreationOptional<Date>;
}

RuntimeOverrideModel.init(
  {
    key: {
      type: DataTypes.TEXT,
      primaryKey: true,
    },
    value: {
      type: DataTypes.DECIMAL,
      allowNull: false,
    },
    updatedAt: {
      field: 'updated_at',
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    tableName: 'runtime_overrides',
    timestamps: false,
  }
);

export class ManualCommandModel extends Model<InferAttributes<ManualCommandModel>, InferCreationAttributes<ManualCommandModel>> {
  declare id: CreationOptional<string>;
  declare type: string;
  declare amount: CreationOptional<number | null>;
  declare status: CreationOptional<string>;
  declare createdAt: CreationOptional<Date>;
  declare processedAt: CreationOptional<Date | null>;
}

ManualCommandModel.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    type: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    amount: {
      type: DataTypes.DECIMAL,
      allowNull: true,
    },
    status: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: 'pending',
    },
    createdAt: {
      field: 'created_at',
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    processedAt: {
      field: 'processed_at',
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: 'manual_commands',
    timestamps: false,
  }
);
