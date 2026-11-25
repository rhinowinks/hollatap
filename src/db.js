const fs = require('fs');
const path = require('path');
const knex = require('knex');
const knexConfig = require('../knexfile');
const config = require('./config');

if (!config.databaseUrl) {
  fs.mkdirSync(path.dirname(path.resolve(config.sqliteFile)), { recursive: true });
}

const db = knex(knexConfig);

async function migrate() {
  await db.migrate.latest();
}

module.exports = { db, migrate };
