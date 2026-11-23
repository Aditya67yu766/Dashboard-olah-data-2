import type { DashboardData, ImportRow, RecordRow, Session, Summary } from '../types';
import type { CsvRecord } from '../lib/csv';

const TOKEN_KEY = 'iv_lab_token';

function apiBaseUrl(): string {
  const base = (import.meta.env.VITE_API_URL ?? '').trim().replace(/\/+$/, '');
  return base;
}

export const configured = true;

let token: string | null = null;

function getToken(): string | null {
  if (token) return token;
  try {
    // Bersihkan token lama dari localStorage (perilaku lama: ingat 7 hari).
    // Token sekarang hanya disimpan di sessionStorage per tab.
    if (localStorage.getItem(TOKEN_KEY)) localStorage.removeItem(TOKEN_KEY);
    token = sessionStorage.getItem(TOKEN_KEY);
  } catch {
    token = null;
  }
  return token;
}

function setToken(next: string | null) {
  token = next;
  try {
    if (next) sessionStorage.setItem(TOKEN_KEY, next);
    else sessionStorage.removeItem(TOKEN_KEY);
    // Pastikan token tidak pernah tertinggal di localStorage.
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Penyimpanan browser tidak tersedia; sesi hanya berlaku selama tab terbuka.
  }
}

type ApiResult<T> = { data?: T; error?: string };

async function apiRequest<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<ApiResult<T>> {
  const authToken = getToken();
  try {
    const response = await fetch(`${apiBaseUrl()}/api${path}`, {
      method: options.method ?? 'GET',
      headers: {
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      return { data: undefined, error: typeof payload.error === 'string' ? payload.error : `Permintaan gagal (HTTP ${response.status}).` };
    }
    return { data: payload as T, error: undefined };
  } catch {
    return { data: undefined, error: 'Tidak dapat menjangkau server IV Lab. Pastikan server berjalan dan database dapat dihubungkan.' };
  }
}

export type AuthState = {
  session: Session | null;
  admin: boolean;
  error?: string;
};

export async function getSession(): Promise<AuthState> {
  const result = await apiRequest<{ admin: boolean; user: { id: string; email: string | null } | null }>('/auth/session');
  if (result.error) return { session: null, admin: false, error: result.error };
  const admin = Boolean(result.data?.admin);
  const user = result.data?.user ?? null;
  if (!admin || !user) {
    setToken(null);
    return { session: null, admin: false };
  }
  return { session: { user: { id: user.id, email: user.email } }, admin: true };
}

export async function signIn(email: string, password: string): Promise<{ session: Session | null; error: string }> {
  try {
    const response = await fetch(`${apiBaseUrl()}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const payload = (await response.json().catch(() => ({}))) as { token?: string; user?: { id?: number | string; email?: string | null }; error?: string };
    if (!response.ok) return { session: null, error: payload.error ?? 'Login gagal.' };
    const tokenValue = typeof payload.token === 'string' ? payload.token : '';
    const userId = payload.user?.id != null ? String(payload.user.id) : '';
    const userEmail = payload.user?.email ?? null;
    if (tokenValue) setToken(tokenValue);
    const session = tokenValue ? { user: { id: userId, email: userEmail } } : null;
    return { session, error: tokenValue ? '' : 'Login gagal.' };
  } catch {
    return { session: null, error: 'Tidak dapat menjangkau server IV Lab. Pastikan server berjalan dan database dapat dihubungkan.' };
  }
}

export async function signOut(): Promise<{ error: string }> {
  const result = await apiRequest<{ ok: boolean }>('/auth/logout', { method: 'POST' });
  setToken(null);
  return { error: result.error ?? '' };
}

export async function reauth(password: string): Promise<{ token?: string; error?: string }> {
  const result = await apiRequest<{ token: string }>('/auth/reauth', { method: 'POST', body: { password } });
  if (result.error) return { token: undefined, error: result.error };
  if (!result.data?.token) return { token: undefined, error: 'Verifikasi gagal.' };
  setToken(result.data.token);
  return { token: result.data.token };
}

export async function getSummary(): Promise<{ data: Summary | null; error?: string }> {
  const result = await apiRequest<Summary>('/summary');
  if (result.error) return { data: null, error: result.error };
  return { data: result.data ?? null, error: undefined };
}

export async function getDashboardData(): Promise<{ data: DashboardData | null; error?: string }> {
  const result = await apiRequest<DashboardData>('/dashboard');
  if (result.error) return { data: null, error: result.error };
  return { data: result.data ?? null, error: undefined };
}

export async function listRecords(): Promise<{ records: RecordRow[]; error?: string }> {
  const result = await apiRequest<RecordRow[]>('/records');
  if (result.error) return { records: [], error: result.error };
  return { records: result.data ?? [], error: undefined };
}

export async function insertRecord(record: RecordInput): Promise<{ error: string }> {
  const result = await apiRequest<{ ok: boolean }>('/records', { method: 'POST', body: record });
  return { error: result.error ?? '' };
}

export async function deleteRecord(id: string): Promise<{ error: string }> {
  const result = await apiRequest<{ ok: boolean }>(`/records/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return { error: result.error ?? '' };
}

export async function listImports(): Promise<{ imports: ImportRow[]; error?: string }> {
  const result = await apiRequest<ImportRow[]>('/imports');
  if (result.error) return { imports: [], error: result.error };
  return { imports: result.data ?? [], error: undefined };
}

export async function deleteImport(id: string): Promise<{ error: string }> {
  const result = await apiRequest<{ ok: boolean }>(`/imports/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return { error: result.error ?? '' };
}

export async function deleteAllRecords(): Promise<{ error: string }> {
  const result = await apiRequest<{ ok: boolean }>('/data', { method: 'DELETE' });
  return { error: result.error ?? '' };
}

export type ImportCsvInput = {
  fileName: string;
  dataYear: number;
  skippedProvinceCount: number;
  importedBy: string;
  rows: CsvRecord[];
};

export type RecordInput = {
  registration_date: string;
  kode_sampel: string;
  nama_uji: string;
  metode_uji: string;
  interpretasi_hasil: string | null;
  provinsi: string;
  kabupaten?: string | null;
  kecamatan?: string | null;
  no_registrasi?: string | null;
  sample_analysis_number?: string | null;
  hewan?: string | null;
  jenis_layanan?: string | null;
  import_id?: string | null;
};

export async function importCsv(input: ImportCsvInput): Promise<{ error: string }> {
  const result = await apiRequest<{ ok: boolean; status?: string }>('/imports', {
    method: 'POST',
    body: {
      file_name: input.fileName,
      data_year: input.dataYear,
      skipped_province_count: input.skippedProvinceCount,
      imported_by: input.importedBy ? Number(input.importedBy) : null,
      rows: input.rows
    }
  });
  return { error: result.error ?? '' };
}
