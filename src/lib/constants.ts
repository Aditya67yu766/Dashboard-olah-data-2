export const requiredCsvFields = [
  'registration_date',
  'kode_sampel',
  'nama_uji',
  'metode_uji',
  'provinsi'
];

export const provinces = ['Lampung', 'Sumatera Selatan', 'Bengkulu', 'Bangka Belitung'];

export const numberFormat = new Intl.NumberFormat('id-ID');

export function nullable(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text || null;
}

export function normalizeDate(value: unknown): string | null {
  const text = String(value ?? '').trim();
  let match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  let year: number;
  let month: number;
  let day: number;
  if (match) {
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  } else {
    match = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (!match) return null;
    day = Number(match[1]);
    month = Number(match[2]);
    year = Number(match[3]);
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year.toString().padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
