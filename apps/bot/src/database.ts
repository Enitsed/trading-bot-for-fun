import { Sequelize, DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';
import { CFG } from './config.js';

const connectionOptions = CFG.pgUrl
  ? { url: CFG.pgUrl }
  : {
      database: CFG.pgDatabase,
      username: CFG.pgUser,
      password: CFG.pgPassword || undefined,
      host: CFG.pgHost,
      port: CFG.pgPort,
    };

export const sequelize = CFG.pgUrl
  ? new Sequelize(connectionOptions.url!, {
      dialect: 'postgres',
      logging: false,
    })
  : new Sequelize({
      dialect: 'postgres',
      database: connectionOptions.database,
      username: connectionOptions.username,
      password: connectionOptions.password,
      host: connectionOptions.host,
      port: connectionOptions.port,
      logging: false,
    });

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
