/**
 * src/config/database.js
 *
 * DATABASE CONFIGURATION — Ready for PostgreSQL.
 *
 * HOW TO ACTIVATE:
 *   Option A (raw pg Pool):
 *     npm install pg
 *     Uncomment block A below, comment out the null export.
 *
 *   Option B (Sequelize ORM):
 *     npm install sequelize pg pg-hstore
 *     Uncomment block B below.
 *
 *   Option C (Prisma):
 *     npm install prisma @prisma/client
 *     Run: npx prisma init
 *     Prisma manages its own client — delete this file and import from @prisma/client.
 *
 * After connecting, call db.connect() (raw pg) or sequelize.authenticate()
 * from server.js BEFORE httpServer.listen() so the app boots only when the DB is ready.
 */

// ── Option A: Raw pg Pool ─────────────────────────────────────────────────────
import { Pool } from 'pg';
import { DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD } from './env.js';

const db = new Pool({
  host:     DB_HOST,
  port:     DB_PORT,
  database: DB_NAME,
  user:     DB_USER,
  password: String(DB_PASSWORD ?? ''),
});
export default db;

// ── Option B: Sequelize ───────────────────────────────────────────────────────
// const { Sequelize } = require('sequelize');
// const sequelize = new Sequelize(
//   process.env.DB_NAME,
//   process.env.DB_USER,
//   process.env.DB_PASSWORD,
//   { host: process.env.DB_HOST, dialect: 'postgres', logging: false }
// );
// export default sequelize;
