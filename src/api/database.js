import { config } from 'dotenv';
import { createPool } from 'mysql2/promise';

config({ path: '.env.local' });

const pool = createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  database: process.env.DB_DATABASE || 'iv_lab',
  user: process.env.DB_USER || 'iv_lab',
  password: process.env.DB_PASSWORD || '',
  max: 20
});

export const query = async (text, params) => {
  const [result] = await pool.query(text, params);
  const rows = Array.isArray(result) ? result : [];
  return {
    rows,
    rowCount: rows.length,
    insertId: Array.isArray(result) ? null : result.insertId
  };
};

export const getClient = async () => pool.getConnection();

export default pool;
