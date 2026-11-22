import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query, getClient } from './src/api/database.js';

const app = express();
const PORT = process.env.PORT || 3001;
const SESSION_TTL_DAYS = 7;

const summaryCache = { value: null };
const dashboardCache = { value: null };

function invalidateAggregates() {
  summaryCache.value = null;
  dashboardCache.value = null;
}

app.use(express.json({ limit: '50mb' }));

async function findSession(token) {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const result = await query(
    `SELECT s.token_hash AS token_hash, s.expires_at AS expires_at, u.id AS user_id, u.email AS user_email
     FROM iv_lab_sessions s
     JOIN iv_lab_users u ON u.id = s.user_id
     WHERE s.token_hash = ?`,
    [tokenHash]
  );
  const row = result.rows[0];
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await query('DELETE FROM iv_lab_sessions WHERE token_hash = ?', [tokenHash]);
    return null;
  }
  const adminResult = await query('SELECT user_id FROM iv_lab_admins WHERE user_id = ?', [row.user_id]);
  return {
    userId: row.user_id,
    user: { id: String(row.user_id), email: row.user_email },
    isAdmin: adminResult.rows.length > 0
  };
}

function bearerToken(req) {
  const header = req.headers.authorization ?? '';
  const [scheme, token] = header.split(' ');
  if (String(scheme ?? '').toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

async function requireAuth(req, res, next) {
  const token = bearerToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Token admin tidak tersedia.' });
  }
  const session = await findSession(token);
  if (!session) {
    return res.status(401).json({ error: 'Sesi admin tidak valid atau sudah kadaluarsa.' });
  }
  req.session = session;
  req.token = token;
  next();
}

function publicUser(session) {
  if (!session?.user) return null;
  return { id: session.user.id, email: session.user.email ?? null };
}

async function issueSession(userId, res, email) {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  await query('INSERT INTO iv_lab_sessions (token_hash, user_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? DAY))', [
    tokenHash,
    userId,
    SESSION_TTL_DAYS
  ]);
  res.json({ token, user: { id: String(userId), email: email ?? null } });
}

app.get('/api/health', async (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/auth/register', async (req, res) => {
  const { email, password, isAdmin } = req.body ?? {};
  const normalizedEmail = String(email ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return res.status(400).json({ error: 'Format email tidak valid.' });
  }
  if (typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'Kata sandi minimal 6 karakter.' });
  }
  const existing = await query('SELECT id FROM iv_lab_users WHERE email = ?', [normalizedEmail]);
  if (existing.rows.length) {
    return res.status(409).json({ error: 'Email sudah terdaftar.' });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const result = await query('INSERT INTO iv_lab_users (email, password_hash) VALUES (?, ?)', [normalizedEmail, passwordHash]);
  const userId = result.insertId;
  if (isAdmin) {
    await query('INSERT INTO iv_lab_admins (user_id) VALUES (?)', [userId]);
  }
  await issueSession(userId, res, normalizedEmail);
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  const normalizedEmail = String(email ?? '').trim().toLowerCase();
  if (!normalizedEmail || !password) {
    return res.status(400).json({ error: 'Email dan kata sandi wajib diisi.' });
  }
  const userResult = await query('SELECT id, email, password_hash FROM iv_lab_users WHERE email = ?', [normalizedEmail]);
  const user = userResult.rows[0];
  if (!user || !(await bcrypt.compare(String(password), user.password_hash))) {
    return res.status(401).json({ error: 'Email atau kata sandi salah.' });
  }
  const adminResult = await query('SELECT user_id FROM iv_lab_admins WHERE user_id = ?', [user.id]);
  const isAdmin = adminResult.rows.length > 0;
  if (!isAdmin) {
    return res.status(403).json({ error: 'Akun ini belum didaftarkan sebagai admin.' });
  }
  await issueSession(user.id, res, user.email);
});

app.post('/api/auth/logout', requireAuth, async (req, res) => {
  await query('DELETE FROM iv_lab_sessions WHERE token_hash = ?', [crypto.createHash('sha256').update(req.token).digest('hex')]);
  res.json({ ok: true });
});

app.get('/api/auth/session', async (req, res) => {
  const token = bearerToken(req);
  let session = null;
  if (token) session = await findSession(token);
  res.json({ admin: Boolean(session?.isAdmin), user: publicUser(session) });
});

app.post('/api/auth/reauth', requireAuth, async (req, res) => {
  const { password } = req.body ?? {};
  const userResult = await query('SELECT id, password_hash FROM iv_lab_users WHERE id = ?', [req.session.userId]);
  const user = userResult.rows[0];
  if (!user || !(await bcrypt.compare(String(password ?? ''), user.password_hash))) {
    return res.status(401).json({ error: 'Verifikasi kata sandi gagal.' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  await query('DELETE FROM iv_lab_sessions WHERE token_hash = ?', [crypto.createHash('sha256').update(req.token).digest('hex')]);
  await query('INSERT INTO iv_lab_sessions (token_hash, user_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? DAY))', [
    tokenHash,
    req.session.userId,
    SESSION_TTL_DAYS
  ]);
  res.json({ token });
});

const POSITIVE_RESULTS = new Set(['positif', 'positive', 'positip', 'seropositif', 'seropositive', 'seropositip']);
const SEROPOSITIVE_RESULTS = new Set(['seropositif', 'seropositive', 'seropositip']);
const NEGATIVE_RESULTS = new Set(['negatif', 'negative', 'negatip', 'seronegatif', 'seronegative', 'seronegatip']);

function normalizeResult(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z]/g, '');
}

function computeSummary(records) {
  let total = 0;
  let positive = 0;
  let seropositive = 0;
  const provinces = new Set();
  for (const record of records) {
    total += 1;
    provinces.add(record.province);
    const result = normalizeResult(record.interpretasi_hasil);
    if (POSITIVE_RESULTS.has(result)) positive += 1;
    if (SEROPOSITIVE_RESULTS.has(result)) seropositive += 1;
  }
  return {
    total,
    positive,
    seropositive,
    province_count: provinces.size
  };
}

function computeDashboard(records) {
  const samples = records.map((row) => {
    const date = row.registration_date instanceof Date ? row.registration_date : new Date(row.registration_date);
    const validDate = !Number.isNaN(date.getTime());
    const year = validDate ? date.getFullYear() : null;
    const month = validDate ? String(date.getMonth() + 1).padStart(2, '0') : null;
    const day = validDate ? String(date.getDate()).padStart(2, '0') : null;
    return {
      year,
      month,
      day,
      province: String(row.province ?? '').trim() || '(kosong)',
      regency: String(row.kabupaten ?? '').trim(),
      district: String(row.kecamatan ?? '').trim(),
      target: String(row.nama_uji ?? '').trim() || '(tanpa nama uji)',
      method: String(row.metode_uji ?? '').trim() || '(kosong)',
      sampleId: [row.no_registrasi, row.kode_sampel, row.id].map((value) => String(value ?? '').trim()).filter(Boolean).join('|'),
      positive: POSITIVE_RESULTS.has(normalizeResult(row.interpretasi_hasil)),
      seropositive: SEROPOSITIVE_RESULTS.has(normalizeResult(row.interpretasi_hasil)),
      negative: NEGATIVE_RESULTS.has(normalizeResult(row.interpretasi_hasil))
    };
  });

  const dimensionDefinitions = [
    {
      key: 'by_method',
      label: (row) => row.method,
      target: () => null,
      regency: () => null,
      district: () => null,
      bucket: (row) => `${row.year}|${row.province}|${row.method}`
    },
    {
      key: 'by_day',
      label: (row) => row.day,
      target: () => null,
      regency: () => null,
      district: () => null,
      bucket: (row) => `${row.year}|${row.province}|${row.day}`
    },
    {
      key: 'by_month',
      label: (row) => row.month,
      target: () => null,
      regency: () => null,
      district: () => null,
      bucket: (row) => `${row.year}|${row.province}|${row.month}`
    },
    {
      key: 'by_year',
      label: (row) => String(row.year),
      target: () => null,
      regency: () => null,
      district: () => null,
      bucket: (row) => `${row.year}|${row.province}|${row.year}`
    },
    {
      key: 'by_province',
      label: (row) => row.province,
      target: () => null,
      regency: () => null,
      district: () => null,
      bucket: (row) => `${row.year}|${row.province}|${row.province}`
    },
    {
      key: 'by_disease_month',
      label: (row) => row.month,
      target: (row) => row.target,
      regency: () => null,
      district: () => null,
      bucket: (row) => `${row.year}|${row.province}|${row.month}|${row.target}`
    },
    {
      key: 'by_regency_month',
      label: (row) => row.month,
      target: () => null,
      regency: (row) => row.regency,
      district: () => null,
      bucket: (row) => `${row.year}|${row.province}|${row.month}|${row.regency}`
    },
    {
      key: 'by_district_month',
      label: (row) => row.month,
      target: () => null,
      regency: (row) => row.regency,
      district: (row) => row.district,
      bucket: (row) => `${row.year}|${row.province}|${row.month}|${row.regency}|${row.district}`
    }
  ];

  const chartAggregates = new Map();
  for (const definition of dimensionDefinitions) {
    const buckets = new Map();
    for (const row of samples) {
      const key = definition.bucket(row);
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          year: row.year,
          province: row.province,
          label: definition.label(row),
          target: definition.target(row),
          regency: definition.regency(row),
          district: definition.district(row),
          total: 0,
          positive: 0,
          seropositive: 0
        };
        buckets.set(key, bucket);
      }
      bucket.total += 1;
      if (row.positive) bucket.positive += 1;
      if (row.seropositive) bucket.seropositive += 1;
    }
    chartAggregates.set(definition.key, buckets);
  }

  const charts = {};
  const ordering = {
    by_method: (a, b) => String(a.year).localeCompare(String(b.year)) || String(a.province).localeCompare(String(b.province)) || String(a.label).localeCompare(String(b.label), 'id', { numeric: true }),
    by_day: (a, b) => String(a.year).localeCompare(String(b.year)) || String(a.province).localeCompare(String(b.province)) || String(a.label).localeCompare(String(b.label), 'id', { numeric: true }),
    by_month: (a, b) => String(a.year).localeCompare(String(b.year)) || String(a.province).localeCompare(String(b.province)) || String(a.label).localeCompare(String(b.label), 'id', { numeric: true }),
    by_year: (a, b) => String(a.year).localeCompare(String(b.year)) || String(a.province).localeCompare(String(b.province)),
    by_province: (a, b) => String(a.year).localeCompare(String(b.year)) || String(a.province).localeCompare(String(b.province)),
    by_disease_month: (a, b) => String(a.year).localeCompare(String(b.year)) || String(a.province).localeCompare(String(b.province)) || String(a.label).localeCompare(String(b.label), 'id', { numeric: true }) || String(a.target ?? '').localeCompare(String(b.target ?? ''), 'id'),
    by_regency_month: (a, b) => String(a.year).localeCompare(String(b.year)) || String(a.province).localeCompare(String(b.province)) || String(a.label).localeCompare(String(b.label), 'id', { numeric: true }) || String(a.regency ?? '').localeCompare(String(b.regency ?? ''), 'id'),
    by_district_month: (a, b) => String(a.year).localeCompare(String(b.year)) || String(a.province).localeCompare(String(b.province)) || String(a.label).localeCompare(String(b.label), 'id', { numeric: true }) || String(a.regency ?? '').localeCompare(String(b.regency ?? ''), 'id') || String(a.district ?? '').localeCompare(String(b.district ?? ''), 'id')
  };
  const pick = (key) => {
    const buckets = chartAggregates.get(key);
    const rows = [...buckets.values()];
    rows.sort((a, b) => ordering[key](a, b));
    if (key === 'by_method' || key === 'by_day' || key === 'by_month' || key === 'by_year' || key === 'by_province') {
      return rows.map((row) => ({
        year: row.year,
        province: row.province,
        label: row.label,
        total: row.total,
        positive: row.positive,
        seropositive: row.seropositive
      }));
    }
    if (key === 'by_disease_month') {
      return rows.map((row) => ({
        year: row.year,
        province: row.province,
        label: row.label,
        target: row.target,
        total: row.total,
        positive: row.positive,
        seropositive: row.seropositive
      }));
    }
    if (key === 'by_regency_month') {
      return rows.map((row) => ({
        year: row.year,
        province: row.province,
        label: row.label,
        regency: row.regency,
        total: row.total,
        positive: row.positive,
        seropositive: row.seropositive
      }));
    }
    return rows.map((row) => ({
      year: row.year,
      province: row.province,
      label: row.label,
      regency: row.regency,
      district: row.district,
      total: row.total,
      positive: row.positive,
      seropositive: row.seropositive
    }));
  };

  const dashboardCharts = {};
  for (const key of ['by_method', 'by_day', 'by_month', 'by_year', 'by_province', 'by_disease_month', 'by_regency_month', 'by_district_month']) {
    dashboardCharts[key] = pick(key);
  }

  const mapAggregates = new Map();
  for (const row of samples) {
    const key = `${row.year}|${row.province}|${row.regency}|${row.district}|${row.target}|${row.sampleId}`;
    let bucket = mapAggregates.get(key);
    if (!bucket) {
      bucket = { year: row.year, province: row.province, regency: row.regency, district: row.district, target: row.target, sampleId: row.sampleId, tests: 0, positive: false, negative: false };
      mapAggregates.set(key, bucket);
    }
    bucket.tests += 1;
    if (row.positive) bucket.positive = true;
    if (row.negative) bucket.negative = true;
  }
  const mapSummaries = new Map();
  for (const bucket of mapAggregates.values()) {
    const key = `${bucket.year}|${bucket.province}|${bucket.regency}|${bucket.district}|${bucket.target}`;
    let summary = mapSummaries.get(key);
    if (!summary) {
      summary = { year: bucket.year, province: bucket.province, regency: bucket.regency, district: bucket.district, target: bucket.target, tests: 0, total: 0, positive: 0, negative: 0, other: 0 };
      mapSummaries.set(key, summary);
    }
    summary.tests += bucket.tests;
    summary.total += 1;
    if (bucket.positive) summary.positive += 1;
    else if (bucket.negative) summary.negative += 1;
    else summary.other += 1;
  }
  const mapRows = [...mapSummaries.values()].sort((a, b) => String(a.year).localeCompare(String(b.year)) || String(a.province).localeCompare(String(b.province)) || String(a.regency ?? '').localeCompare(String(b.regency ?? '')) || String(a.district ?? '').localeCompare(String(b.district ?? '')) || String(a.target ?? '').localeCompare(String(b.target ?? '')));

  return { charts: dashboardCharts, map: mapRows };
}

app.get('/api/summary', async (req, res) => {
  if (summaryCache.value) {
    return res.json(summaryCache.value);
  }
  const result = await query('SELECT id, interpretasi_hasil, provinsi AS province FROM iv_lab_records');
  const summary = computeSummary(result.rows);
  summaryCache.value = summary;
  res.json(summary);
});

app.get('/api/dashboard', async (req, res) => {
  if (dashboardCache.value) {
    return res.json(dashboardCache.value);
  }
  const result = await query('SELECT id, registration_date, kode_sampel, nama_uji, metode_uji, interpretasi_hasil, provinsi AS province, kabupaten, kecamatan, no_registrasi FROM iv_lab_records');
  const dashboard = computeDashboard(result.rows);
  dashboardCache.value = dashboard;
  res.json(dashboard);
});

app.get('/api/records', requireAuth, async (req, res) => {
  const result = await query('SELECT id, import_id, registration_date, kode_sampel, nama_uji, interpretasi_hasil, provinsi, kabupaten, kecamatan, no_registrasi, sample_analysis_number, hewan, jenis_layanan, created_at FROM iv_lab_records ORDER BY created_at DESC LIMIT 50');
  const records = result.rows.map((row) => ({
    id: String(row.id),
    import_id: row.import_id ? String(row.import_id) : null,
    registration_date: row.registration_date ? String(row.registration_date).slice(0, 10) : null,
    kode_sampel: row.kode_sampel,
    nama_uji: row.nama_uji,
    interpretasi_hasil: row.interpretasi_hasil ?? null,
    provinsi: row.provinsi,
    kabupaten: row.kabupaten ?? null,
    kecamatan: row.kecamatan ?? null,
    no_registrasi: row.no_registrasi ?? null,
    sample_analysis_number: row.sample_analysis_number ?? null,
    hewan: row.hewan ?? null,
    jenis_layanan: row.jenis_layanan ?? null,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? '')
  }));
  res.json(records);
});

app.post('/api/records', requireAuth, async (req, res) => {
  const body = req.body ?? {};
  const registrationDate = String(body.registration_date ?? '').slice(0, 10);
  const result = await query(
    `INSERT INTO iv_lab_records (id, registration_date, kode_sampel, nama_uji, metode_uji, interpretasi_hasil, provinsi, kabupaten, kecamatan, no_registrasi, sample_analysis_number, hewan, jenis_layanan, import_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      crypto.randomUUID(),
      registrationDate || null,
      String(body.kode_sampel ?? ''),
      String(body.nama_uji ?? ''),
      String(body.metode_uji ?? ''),
      body.interpretasi_hasil ?? null,
      String(body.provinsi ?? ''),
      body.kabupaten ?? null,
      body.kecamatan ?? null,
      body.no_registrasi ?? null,
      body.sample_analysis_number ?? null,
      body.hewan ?? null,
      body.jenis_layanan ?? null,
      body.import_id ?? null
    ]
  );
  invalidateAggregates();
  res.json({ ok: true });
});

app.delete('/api/records/:id', requireAuth, async (req, res) => {
  const id = req.params.id;
  const recordResult = await query('SELECT import_id FROM iv_lab_records WHERE id = ?', [id]);
  const record = recordResult.rows[0];
  await query('DELETE FROM iv_lab_records WHERE id = ?', [id]);
  if (record?.import_id) {
    await query('UPDATE iv_lab_imports SET record_count = (SELECT COUNT(*) FROM iv_lab_records WHERE import_id = iv_lab_imports.id) WHERE id = ?', [String(record.import_id)]);
  }
  invalidateAggregates();
  res.json({ ok: true });
});

app.get('/api/imports', requireAuth, async (req, res) => {
  const result = await query('SELECT id, file_name, data_year, record_count, skipped_province_count, status, created_at FROM iv_lab_imports ORDER BY created_at DESC');
  const imports = result.rows.map((row) => ({
    id: String(row.id),
    file_name: row.file_name,
    data_year: row.data_year,
    record_count: row.record_count,
    skipped_province_count: row.skipped_province_count,
    status: row.status,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? '')
  }));
  res.json(imports);
});

app.post('/api/imports', requireAuth, async (req, res) => {
  const body = req.body ?? {};
  const fileName = String(body.file_name ?? '');
  const dataYear = Number(body.data_year);
  const skippedProvinceCount = Number(body.skipped_province_count ?? 0);
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const conn = await getClient();
  const importId = crypto.randomUUID();
  try {
    await conn.beginTransaction();
    await conn.query(
      'INSERT INTO iv_lab_imports (id, file_name, data_year, record_count, skipped_province_count, status, imported_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [importId, fileName, dataYear, rows.length, skippedProvinceCount, 'processing', req.session.userId]
    );
    let saved = 0;
    for (const row of rows) {
      await conn.query(
        `INSERT INTO iv_lab_records (id, registration_date, kode_sampel, nama_uji, metode_uji, interpretasi_hasil, provinsi, kabupaten, kecamatan, no_registrasi, sample_analysis_number, hewan, jenis_layanan, import_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          crypto.randomUUID(),
          String(row.registration_date ?? '').slice(0, 10),
          String(row.kode_sampel ?? ''),
          String(row.nama_uji ?? ''),
          String(row.metode_uji ?? ''),
          row.interpretasi_hasil ?? null,
          String(row.provinsi ?? ''),
          row.kabupaten ?? null,
          row.kecamatan ?? null,
          row.no_registrasi ?? null,
          row.sample_analysis_number ?? null,
          row.hewan ?? null,
          row.jenis_layanan ?? null,
          importId
        ]
      );
      saved += 1;
    }
    await conn.query('UPDATE iv_lab_imports SET record_count = ?, status = ? WHERE id = ?', [saved, 'completed', importId]);
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    return res.status(500).json({ error: `Gagal menyimpan data impor: ${error.message}` });
  } finally {
    conn.release();
  }
  invalidateAggregates();
  res.json({ ok: true, status: 'completed' });
});

app.delete('/api/imports/:id', requireAuth, async (req, res) => {
  const id = req.params.id;
  await query('DELETE FROM iv_lab_imports WHERE id = ?', [id]);
  invalidateAggregates();
  res.json({ ok: true });
});

app.delete('/api/data', requireAuth, async (req, res) => {
  await query('DELETE FROM iv_lab_imports');
  invalidateAggregates();
  res.json({ ok: true });
});

// Mode produksi: sajikan hasil build Vite (dist/) + SPA fallback.
// Dev tetap aman — Vite (5173) tidak memakai jalur ini.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, 'dist');
const indexHtml = path.join(distDir, 'index.html');
if (fs.existsSync(indexHtml)) {
  app.use(express.static(distDir));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
    res.sendFile(indexHtml);
  });
}

app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint tidak ditemukan.' });
});

app.listen(PORT, () => {
  console.log(`IV Lab API listening on port ${PORT}`);
});
