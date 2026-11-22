export type Page = 'home' | 'admin' | 'login' | 'charts' | 'map';

export type FlashType = 'success' | 'error' | 'info';

export type Session = {
  user: {
    id: string;
    email?: string | null;
    user_metadata?: Record<string, unknown>;
  };
};

export type Summary = {
  total: number;
  positive: number;
  seropositive: number;
  province_count: number;
};

export type ChartKey = 'by_method' | 'by_day' | 'by_month' | 'by_year' | 'by_province' | 'by_disease_month' | 'by_regency_month' | 'by_district_month';

export type ChartRow = {
  year: string | number;
  province: string;
  label: string;
  total: number;
  positive: number;
  seropositive: number;
  target?: string | null;
  regency?: string | null;
  district?: string | null;
};

export type MapRow = {
  year: string | number;
  province: string;
  regency?: string | null;
  district?: string | null;
  target?: string | null;
  tests?: number | null;
  total?: number | null;
  positive?: number | null;
  negative?: number | null;
  other?: number | null;
};

export type DashboardData = {
  charts: Record<ChartKey, ChartRow[]>;
  map: MapRow[];
};

export type RecordRow = {
  id: string;
  import_id?: string | null;
  registration_date: string;
  kode_sampel: string;
  nama_uji: string;
  interpretasi_hasil: string | null;
  provinsi: string;
  kabupaten?: string | null;
  kecamatan?: string | null;
  no_registrasi?: string | null;
  sample_analysis_number?: string | null;
  hewan?: string | null;
  jenis_layanan?: string | null;
};

export type ImportRow = {
  id: string;
  file_name: string;
  data_year: number;
  record_count: number;
  skipped_province_count: number | null;
  status: string;
  created_at: string;
};

export type SensitiveAction =
  | { type: 'record'; id: string }
  | { type: 'import'; id: string }
  | { type: 'all' };

export type ReauthState = { step: 'password'; action: SensitiveAction };

export type FlashMessage = { text: string; type: FlashType };
