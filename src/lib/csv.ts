import Papa from 'papaparse';
import { nullable, normalizeDate, requiredCsvFields } from './constants';

export type CsvRecord = {
  registration_date: string;
  kode_sampel: string;
  nama_uji: string;
  metode_uji: string;
  interpretasi_hasil: string | null;
  provinsi: string;
  kabupaten: string | null;
  kecamatan: string | null;
  no_registrasi: string | null;
  sample_analysis_number: string | null;
  hewan: string | null;
  jenis_layanan: string | null;
};

export type ParsedCsv = {
  rows: CsvRecord[];
  skippedMissingProvince: number;
};

function csvToRecord(row: Record<string, unknown>, rowNumber: number): CsvRecord | null {
  const values = Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key.trim().toLowerCase(), String(value ?? '').trim()])
  );
  if (!values.provinsi) return null;

  const missing = requiredCsvFields.filter((field) => !values[field]);
  if (missing.length) {
    throw new Error(`Baris ${rowNumber}: kolom wajib kosong (${missing.join(', ')}).`);
  }

  const date = normalizeDate(values.registration_date);
  if (!date) {
    throw new Error(`Baris ${rowNumber}: tanggal "${values.registration_date}" tidak valid.`);
  }

  return {
    registration_date: date,
    kode_sampel: values.kode_sampel,
    nama_uji: values.nama_uji,
    metode_uji: values.metode_uji,
    interpretasi_hasil: nullable(values.interpretasi_hasil),
    provinsi: values.provinsi,
    kabupaten: nullable(values.kabupaten || values['kabupaten/kota'] || values.kab_kota),
    kecamatan: nullable(values.kecamatan),
    no_registrasi: nullable(values.no_registrasi),
    sample_analysis_number: nullable(values.sample_analysis_number),
    hewan: nullable(values.hewan),
    jenis_layanan: nullable(values.jenis_layanan)
  };
}

export function parseCsv(file: File): Promise<ParsedCsv> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (header) => header.trim(),
      complete: (result) => {
        if (result.errors.length) {
          reject(new Error(`CSV tidak dapat dibaca: ${result.errors[0].message}`));
          return;
        }
        if (!result.meta.fields?.length) {
          reject(new Error('File CSV tidak memiliki baris header.'));
          return;
        }
        const headers = result.meta.fields.map((field) => field.toLowerCase());
        const missing = requiredCsvFields.filter((field) => !headers.includes(field));
        if (missing.length) {
          reject(new Error(`Kolom wajib tidak ditemukan: ${missing.join(', ')}.`));
          return;
        }

        try {
          const rows: CsvRecord[] = [];
          let skippedMissingProvince = 0;
          result.data.forEach((row, index) => {
            const record = csvToRecord(row, index + 2);
            if (record) rows.push(record);
            else skippedMissingProvince += 1;
          });
          resolve({ rows, skippedMissingProvince });
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      },
      error: (error) => reject(error)
    });
  });
}
