import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import config from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Run database migrations.
 * Reads SQL files from the migrations directory and executes them in order.
 */
async function migrate() {
  const pool = new pg.Pool({
    host: config.pg.host,
    port: config.pg.port,
    user: config.pg.user,
    password: config.pg.password,
    database: config.pg.database,
  });

  const migrationsDir = path.join(__dirname, 'migrations');

  try {
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      console.log(`Running migration: ${file}`);
      await pool.query(sql);
      console.log(`  ✓ ${file} applied`);
    }

    console.log('All migrations completed successfully.');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
