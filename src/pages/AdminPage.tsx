import { useMemo, useState, type FormEvent } from 'react';
import { numberFormat, provinces, requiredCsvFields } from '../lib/constants';
import type { FlashType, ImportRow, RecordRow } from '../types';

type AdminPageProps = {
  records: RecordRow[];
  recordsLoading: boolean;
  imports: ImportRow[];
  importsLoading: boolean;
  flash: string;
  flashType: FlashType;
  busy: boolean;
  onAddRecord: (event: FormEvent<HTMLFormElement>) => void;
  onImportCsv: (file: File) => void;
  onDeleteRecord: (id: string) => void;
  onDeleteImport: (id: string) => void;
  onLogout: () => void;
  onRefreshRecords: () => void;
  onRefreshImports: () => void;
  onDeleteAll: () => void;
};

const importStatus: Record<string, { label: string; tone: string }> = {
  completed: { label: 'Selesai', tone: 'success' },
  partial: { label: 'Sebagian', tone: 'warning' },
  failed: { label: 'Gagal', tone: 'danger' },
  legacy: { label: 'Data lama', tone: 'neutral' },
  processing: { label: 'Diproses', tone: 'neutral' }
};

function resultTone(result: string | null): string {
  const value = (result ?? '').toLowerCase();
  if (!value) return 'neutral';
  if (value.includes('seropositif') || value === 'positif' || value === 'positive' || value === 'positip') return 'danger';
  if (value.includes('negatif') || value.includes('negative') || value.includes('negatip')) return 'success';
  return 'warning';
}

function formatDate(value: string): string {
  if (!value) return '—';
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function ImportsTable({ imports, onDeleteImport }: { imports: ImportRow[]; onDeleteImport: (id: string) => void }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>File</th>
            <th className="n">Tahun</th>
            <th className="n">Baris</th>
            <th>Status</th>
            <th>Diimpor</th>
            <th className="cell-actions"></th>
          </tr>
        </thead>
        <tbody>
          {imports.map((item) => {
            const status = importStatus[item.status] ?? { label: item.status || 'Diproses', tone: 'neutral' };
            return (
              <tr key={item.id}>
                <td className="cell-wrap">
                  {item.file_name}
                  {item.skipped_province_count ? <small>{numberFormat.format(item.skipped_province_count)} baris tanpa provinsi dilewati</small> : null}
                </td>
                <td className="n">{item.data_year}</td>
                <td className="n">{numberFormat.format(item.record_count)}</td>
                <td><span className={`status-badge ${status.tone}`}>{status.label}</span></td>
                <td>{formatDateTime(item.created_at)}</td>
                <td className="cell-actions">
                  <button className="delete-button" onClick={() => onDeleteImport(item.id)}>
                    {item.status === 'legacy' ? 'Hapus tahun' : 'Hapus file'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RecordsTable({ records, onDeleteRecord }: { records: RecordRow[]; onDeleteRecord: (id: string) => void }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Tanggal</th>
            <th>Kode sampel</th>
            <th>Nama uji</th>
            <th>Hasil</th>
            <th>Provinsi</th>
            <th className="cell-actions"></th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr key={record.id}>
              <td>{formatDate(record.registration_date)}</td>
              <td className="cell-wrap">{record.kode_sampel}</td>
              <td className="cell-wrap">{record.nama_uji}</td>
              <td>
                <span className={`status-badge ${resultTone(record.interpretasi_hasil)}`}>
                  {record.interpretasi_hasil || 'Belum ada hasil'}
                </span>
              </td>
              <td>{record.provinsi}</td>
              <td className="cell-actions">
                <button className="delete-button" onClick={() => onDeleteRecord(record.id)} aria-label={`Hapus data ${record.kode_sampel}`}>
                  Hapus
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AdminPage(props: AdminPageProps) {
  const {
    records, recordsLoading, imports, importsLoading, flash, flashType, busy,
    onAddRecord, onImportCsv, onDeleteRecord, onDeleteImport, onLogout,
    onRefreshRecords, onRefreshImports, onDeleteAll
  } = props;

  const [recordQuery, setRecordQuery] = useState('');
  const [importQuery, setImportQuery] = useState('');

  const filteredRecords = useMemo(() => {
    const query = recordQuery.trim().toLowerCase();
    if (!query) return records;
    return records.filter((record) =>
      [record.kode_sampel, record.nama_uji, record.provinsi, record.interpretasi_hasil]
        .some((value) => String(value ?? '').toLowerCase().includes(query))
    );
  }, [records, recordQuery]);

  const filteredImports = useMemo(() => {
    const query = importQuery.trim().toLowerCase();
    if (!query) return imports;
    return imports.filter((item) =>
      [item.file_name, String(item.data_year), item.status]
        .some((value) => String(value ?? '').toLowerCase().includes(query))
    );
  }, [imports, importQuery]);

  const totalImportedRows = imports.reduce((sum, item) => sum + Number(item.record_count || 0), 0);

  return (
    <main className="page-content admin-content">
      <section className="page-intro admin-intro">
        <div>
          <span className="eyebrow">Panel admin</span>
          <h1>Kelola data IV Lab</h1>
          <p>Data yang tersimpan langsung memperbarui ringkasan grafik dan peta publik.</p>
        </div>
        <button className="button button-outline" onClick={onLogout}>Keluar dari panel</button>
      </section>

      {flash ? <div className={`notice notice-${flashType}`}>{flash}</div> : null}

      <section className="admin-grid">
        <article className="panel admin-panel">
          <div className="panel-heading">
            <div><h2>Impor dari CSV</h2></div>
          </div>
          <p className="panel-description">
            CSV wajib memiliki kolom <code>{requiredCsvFields.join('</code>, <code>')}</code>. Kolom <code>interpretasi_hasil</code> boleh kosong. Satu file hanya untuk satu tahun; file yang sama jangan diimpor dua kali.
          </p>
          <label className={`upload-zone${busy ? ' is-busy' : ''}`} htmlFor="csv-file">
            <strong>{busy ? 'Memproses file…' : 'Pilih file CSV'}</strong>
            <small>Format data IV Lab yang sudah digunakan</small>
            <input
              type="file"
              id="csv-file"
              accept=".csv,text/csv"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onImportCsv(file);
                event.target.value = '';
              }}
            />
          </label>
          <p className="form-hint">Kolom wilayah opsional: <code>kabupaten</code> dan <code>kecamatan</code>. Baris dengan provinsi kosong akan dilewati otomatis.</p>
        </article>

        <article className="panel admin-panel">
          <div className="panel-heading">
            <div><h2>Tambah satu sampel</h2></div>
          </div>
          <form className="record-form" onSubmit={onAddRecord}>
            <label>Tanggal registrasi<input name="registration_date" type="date" required /></label>
            <label>Kode sampel<input name="kode_sampel" placeholder="Contoh: 2026.001" required /></label>
            <label>Nama uji<input name="nama_uji" placeholder="Contoh: Newcastle Disease" required /></label>
            <label>Metode uji<input name="metode_uji" placeholder="Contoh: HI" required /></label>
            <label>Interpretasi hasil<input name="interpretasi_hasil" placeholder="Kosongkan jika belum ada hasil" /></label>
            <label>Provinsi<select name="provinsi" required defaultValue=""><option value="" disabled>Pilih provinsi</option>{provinces.map((province) => <option key={province}>{province}</option>)}</select></label>
            <label>Kabupaten / kota<input name="kabupaten" placeholder="Opsional" /></label>
            <label>Kecamatan<input name="kecamatan" placeholder="Opsional" /></label>
            <details className="optional-fields">
              <summary>Informasi tambahan (opsional)</summary>
              <div>
                <label>No. registrasi<input name="no_registrasi" /></label>
                <label>No. analisis sampel<input name="sample_analysis_number" /></label>
                <label>Jenis hewan<input name="hewan" /></label>
                <label>Jenis layanan<input name="jenis_layanan" /></label>
              </div>
            </details>
            <button className="button button-dark" type="submit" disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan data'}</button>
          </form>
        </article>
      </section>

      <section className="panel admin-imports">
        <div className="panel-heading">
          <div><h2>File data tersimpan</h2></div>
          <button className="button button-outline button-small" onClick={onRefreshImports} disabled={importsLoading}>Muat ulang</button>
        </div>
        <div className="table-toolbar">
          <input
            type="search"
            value={importQuery}
            onChange={(event) => setImportQuery(event.target.value)}
            placeholder="Cari nama file atau tahun…"
            aria-label="Cari riwayat impor"
          />
          <span className="table-count">{numberFormat.format(imports.length)} file · {numberFormat.format(totalImportedRows)} baris</span>
        </div>
        {importsLoading
          ? <div className="empty-state"><span className="loader" aria-hidden="true" /> Memuat daftar file…</div>
          : filteredImports.length
            ? <ImportsTable imports={filteredImports} onDeleteImport={onDeleteImport} />
            : <div className="empty-state">{imports.length ? 'Tidak ada file yang cocok dengan pencarian.' : 'Belum ada file impor tersimpan.'}</div>}
        <p className="table-foot">Menghapus file juga menghapus seluruh baris yang diimpor dari file tersebut.</p>
      </section>

      <section className="panel admin-records">
        <div className="panel-heading">
          <div><h2>Entri terbaru</h2></div>
          <div className="panel-actions">
            <button className="button button-outline button-small" onClick={onRefreshRecords} disabled={recordsLoading}>Muat ulang</button>
            <button className="button button-danger button-small" onClick={onDeleteAll} disabled={busy}>Hapus semua data</button>
          </div>
        </div>
        <div className="table-toolbar">
          <input
            type="search"
            value={recordQuery}
            onChange={(event) => setRecordQuery(event.target.value)}
            placeholder="Cari kode sampel, uji, atau provinsi…"
            aria-label="Cari data sampel"
          />
          <span className="table-count">Menampilkan {numberFormat.format(filteredRecords.length)} dari {numberFormat.format(records.length)} entri terbaru</span>
        </div>
        {recordsLoading
          ? <div className="empty-state"><span className="loader" aria-hidden="true" /> Memuat data…</div>
          : filteredRecords.length
            ? <RecordsTable records={filteredRecords} onDeleteRecord={onDeleteRecord} />
            : <div className="empty-state">{records.length ? 'Tidak ada entri yang cocok dengan pencarian.' : 'Belum ada data tersimpan.'}</div>}
        <p className="table-foot">Daftar ini menampilkan maksimal 50 entri terbaru. Gunakan pencarian untuk menemukan data tertentu.</p>
      </section>
    </main>
  );
}
