/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Shared configuration for Sequelize CLI. CommonJS is required because
 * sequelize-cli loads this file directly with Node.
 */
require('dotenv').config();

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

const useSsl = parseBoolean(process.env.DB_SSL);

function buildPostgresConfig({ url, database, username, password, host, port }) {
  const options = {
    dialect: 'postgres',
    logging: false,
    define: {
      underscored: true,
      timestamps: true,
    },
    dialectOptions: useSsl ? { ssl: { require: true, rejectUnauthorized: true } } : {},
    pool: { min: 0, max: 10, acquire: 30000, idle: 10000 },
  };

  if (url) {
    return { ...options, url };
  }

  return { ...options, database, username, password, host, port };
}

const shared = {
  url: process.env.DATABASE_URL || null,
  database: process.env.DB_NAME || 'temponest_dev',
  username: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
};

module.exports = {
  development: buildPostgresConfig(shared),
  test: process.env.TEST_DATABASE_URL
    ? buildPostgresConfig({ url: process.env.TEST_DATABASE_URL })
    : {
        dialect: 'sqlite',
        storage: ':memory:',
        logging: false,
        define: { underscored: true, timestamps: true },
      },
  production: buildPostgresConfig(shared),
};
