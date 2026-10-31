import { Sequelize } from 'sequelize';
import { config } from '../config/env';
import { logger } from '../config/logger';
import { initModels, type Models } from './models';

function createSequelize(): Sequelize {
  const db = config.database;
  const common = {
    dialect: db.dialect,
    logging: db.logging ? (sql: string) => logger.debug({ sql }, 'sequelize') : false,
    define: {
      underscored: true,
      timestamps: true,
    },
    pool: db.dialect === 'postgres' ? { min: 0, max: db.poolMax, acquire: 30_000, idle: 10_000 } : undefined,
  } as const;

  if (db.dialect === 'sqlite') {
    return new Sequelize({
      ...common,
      dialect: 'sqlite',
      storage: db.storage ?? ':memory:',
    });
  }

  const dialectOptions = db.ssl ? { ssl: { require: true, rejectUnauthorized: true } } : {};

  if (db.url) {
    return new Sequelize(db.url, {
      ...common,
      dialect: 'postgres',
      dialectOptions,
    });
  }

  return new Sequelize(db.name, db.username, db.password, {
    ...common,
    dialect: 'postgres',
    host: db.host,
    port: db.port,
    dialectOptions,
  });
}

export const sequelize = createSequelize();

export const models: Models = initModels(sequelize);

export const {
  Organization,
  User,
  Membership,
  CustomRole,
  ManagerRoleOverride,
  Invitation,
  Session,
  DesktopAgent,
  TimeSession,
  Break,
  ApplicationActivity,
  OrganizationTrackingSettings,
  ApplicationClassification,
  ActivityIdleInterval,
  AgentSyncEvent,
  ScreenshotPolicy,
  ScreenshotPolicyAcknowledgement,
  ScreenshotRequest,
  Screenshot,
  AuditEvent,
  ScreenLiveSession,
  ScreenLiveViewer,
  PlatformAuditEvent,
  AttendanceCorrectionRequest,
  AttendanceEvidence,
  AttendanceCheckIn,
  AttendanceLocationSample,
  AttendanceLocationTracking,
  LeaveType,
  LeavePolicy,
  LeaveHoliday,
  OrganizationHolidaySettings,
  LeaveBalance,
  LeaveRequest,
  LeaveLedgerEntry,
  PasswordResetToken,
} = models;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Establish the database connection with bounded retries. Called during
 * startup; migrations are a separate, explicit step (`npm run db:migrate`).
 */
export async function connectDatabase(attempts = 3): Promise<void> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await sequelize.authenticate();
      logger.info({ attempt, dialect: sequelize.getDialect() }, 'database connection established');
      return;
    } catch (error) {
      lastError = error;
      logger.warn({ attempt, attempts, err: error }, 'database connection attempt failed');
      if (attempt < attempts) await sleep(Math.min(1_000 * attempt, 5_000));
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Unable to connect to the database');
}

export async function disconnectDatabase(): Promise<void> {
  await sequelize.close();
  logger.info('database connection closed');
}

export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    await sequelize.query('SELECT 1');
    return true;
  } catch (error) {
    logger.error({ err: error }, 'database health check failed');
    return false;
  }
}
