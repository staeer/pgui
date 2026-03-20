const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
app.use(express.json());

const UI_USER = process.env.UI_USER || 'admin';
const UI_PASS = process.env.UI_PASS || 'admin';

// Auth middleware
function requireAuth(req, res, next) {
  if (req.path === '/api/auth' || req.path === '/api/health') return next();
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Basic ')) return res.status(401).json({ error: 'Unauthorized' });
  const [user, pass] = Buffer.from(auth.slice(6), 'base64').toString().split(':');
  if (user !== UI_USER || pass !== UI_PASS) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

app.post('/api/auth', (req, res) => {
  const { user, pass } = req.body;
  if (user === UI_USER && pass === UI_PASS) res.json({ ok: true });
  else res.json({ ok: false });
});

app.use(requireAuth);
app.use(express.static(path.join(__dirname, 'public')));

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'postgres',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

app.get('/api/schemas', async (req, res) => {
  try {
    const r = await pool.query(`SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('pg_catalog','information_schema','pg_toast') ORDER BY schema_name`);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/tables', async (req, res) => {
  try {
    const schema = req.query.schema || 'public';
    const r = await pool.query(`
      SELECT table_name,
        pg_size_pretty(pg_total_relation_size(quote_ident(table_schema)||'.'||quote_ident(table_name))) as size,
        (SELECT count(*) FROM information_schema.columns WHERE table_name=t.table_name AND table_schema=t.table_schema) as col_count
      FROM information_schema.tables t
      WHERE table_schema=$1 AND table_type='BASE TABLE' ORDER BY table_name`, [schema]);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/table/:schema/:name', async (req, res) => {
  try {
    const { schema, name } = req.params;
    const limit = parseInt(req.query.limit ?? '100');
    const offset = parseInt(req.query.offset || '0');
    const sortCol = req.query.sort || null;
    const sortDir = req.query.dir === 'desc' ? 'DESC' : 'ASC';

    const colResult = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position`, [schema, name]);

    const countResult = await pool.query(`SELECT COUNT(*) FROM ${JSON.stringify(schema)}.${JSON.stringify(name)}`);

    const pkResult = await pool.query(`
      SELECT kcu.column_name FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema
      WHERE tc.constraint_type='PRIMARY KEY' AND tc.table_schema=$1 AND tc.table_name=$2`, [schema, name]);

    let orderClause = sortCol ? `ORDER BY ${JSON.stringify(sortCol)} ${sortDir}` : '';
    let dataResult = { rows: [] };
    if (limit > 0) {
      dataResult = await pool.query(`SELECT * FROM ${JSON.stringify(schema)}.${JSON.stringify(name)} ${orderClause} LIMIT $1 OFFSET $2`, [limit, offset]);
    }

    res.json({
      columns: colResult.rows,
      rows: dataResult.rows,
      total: parseInt(countResult.rows[0].count),
      primaryKeys: pkResult.rows.map(r => r.column_name)
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/sql', async (req, res) => {
  try {
    const { query } = req.body;
    const start = Date.now();
    const result = await pool.query(query);
    res.json({ rows: result.rows||[], fields: result.fields||[], rowCount: result.rowCount, duration: Date.now()-start });
  } catch(e) { res.status(400).json({ error: e.message }); }
});

app.put('/api/table/:schema/:name/row', async (req, res) => {
  try {
    const { schema, name } = req.params;
    const { where, data } = req.body;
    const setClauses = Object.keys(data).map((k,i) => `${JSON.stringify(k)}=$${i+1}`);
    const whereClauses = Object.keys(where).map((k,i) => `${JSON.stringify(k)}=$${Object.keys(data).length+i+1}`);
    await pool.query(
      `UPDATE ${JSON.stringify(schema)}.${JSON.stringify(name)} SET ${setClauses.join(',')} WHERE ${whereClauses.join(' AND ')}`,
      [...Object.values(data), ...Object.values(where)]
    );
    res.json({ success: true });
  } catch(e) { res.status(400).json({ error: e.message }); }
});

app.delete('/api/table/:schema/:name/row', async (req, res) => {
  try {
    const { schema, name } = req.params;
    const where = req.body;
    const whereClauses = Object.keys(where).map((k,i) => `${JSON.stringify(k)}=$${i+1}`);
    await pool.query(`DELETE FROM ${JSON.stringify(schema)}.${JSON.stringify(name)} WHERE ${whereClauses.join(' AND ')}`, Object.values(where));
    res.json({ success: true });
  } catch(e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/table/:schema/:name/row', async (req, res) => {
  try {
    const { schema, name } = req.params;
    const data = req.body;
    const cols = Object.keys(data).map(k => JSON.stringify(k)).join(', ');
    const vals = Object.keys(data).map((_,i) => `$${i+1}`).join(', ');
    const result = await pool.query(`INSERT INTO ${JSON.stringify(schema)}.${JSON.stringify(name)} (${cols}) VALUES (${vals}) RETURNING *`, Object.values(data));
    res.json(result.rows[0]);
  } catch(e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/table/:schema/:name', async (req, res) => {
  try {
    const { schema, name } = req.params;
    const { columns } = req.body;
    const colDefs = columns.map(c => {
      let def = `${JSON.stringify(c.name)} ${c.type}`;
      if (c.primaryKey) def += ' PRIMARY KEY';
      if (c.notNull) def += ' NOT NULL';
      return def;
    }).join(', ');
    await pool.query(`CREATE TABLE ${JSON.stringify(schema)}.${JSON.stringify(name)} (${colDefs})`);
    res.json({ success: true });
  } catch(e) { res.status(400).json({ error: e.message }); }
});

app.delete('/api/table/:schema/:name', async (req, res) => {
  try {
    const { schema, name } = req.params;
    await pool.query(`DROP TABLE ${JSON.stringify(schema)}.${JSON.stringify(name)}`);
    res.json({ success: true });
  } catch(e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/health', async (req, res) => {
  try { await pool.query('SELECT 1'); res.json({ status: 'ok' }); }
  catch(e) { res.status(500).json({ status: 'error', error: e.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`pgUI running on port ${PORT}`));
