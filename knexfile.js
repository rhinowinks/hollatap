const path = require('path');
const config = require('./src/config');

const common = {
  migrations: { directory: path.join(__dirname, 'src/migrations') },
};

module.exports = config.databaseUrl
  ? {
      ...common,
      client: 'pg',
      connection: {
        connectionString: config.databaseUrl,
        ssl: config.databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false },
      },
      pool: { min: 0, max: 10 },
    }
  : {
      ...common,
      client: 'better-sqlite3',
      connection: { filename: path.resolve(config.sqliteFile) },
      useNullAsDefault: true,
    };
