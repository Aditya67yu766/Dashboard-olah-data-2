import { numberFormat } from '../lib/constants';
import type { Summary } from '../types';

type AdminHomePageProps = {
  summary: Summary | null;
  summaryError: string;
  configured: boolean;
  flash: string | null;
  flashType: string;
  onPage: (page: 'charts' | 'map') => void;
  onLogout: () => void;
  onManage: () => void;
};

function adminNotice({ configured, summaryError }: { configured: boolean; summaryError: string }) {
  if (!configured) {
    return (
      <div className="notice notice-warn admin-notice">
        <strong>Server IV Lab belum dikonfigurasi.</strong> Isi <code>.env.local</code> atau environment variables Vercel.
      </div>
    );
  }
  if (summaryError) {
    return (
      <div className="notice notice-warn admin-notice">
        <strong>Ringkasan belum dapat dimuat.</strong> {summaryError}
      </div>
    );
  }
  return null;
}

function adminStatCard(label: string, value: string | number, tone: 'info' | 'danger' | 'success' | 'neutral' = 'info') {
  return (
    <article className={`admin-stat ${tone}`}>
      <span className="admin-stat-label">{label}</span>
      <strong className="admin-stat-value">{value}</strong>
    </article>
  );
}

export default function AdminHomePage({
  summary,
  summaryError,
  configured,
  flash,
  flashType,
  onPage,
  onLogout,
  onManage,
}: AdminHomePageProps) {
  const total = summary?.total ?? 0;
  const positive = summary?.positive ?? 0;
  const seropositive = summary?.seropositive ?? 0;
  const provinces = summary?.province_count ?? 0;

  return (
    <main className="page-content admin-home">
      <section className="admin-hero">
        <div className="admin-hero-band">
          <span className="admin-hero-eyebrow">PANEL ADMIN — HANYA UNTUK PENGELOLA</span>
          <h1>Kelola Data IV Lab</h1>
          <p>Data yang Anda impor atau masukkan secara langsung akan memperbarui grafik dan peta publik otomatis.</p>
        </div>
        <div className="admin-hero-actions">
          <button className="button button-dark" onClick={onManage}>
            Buka Pengelolaan Data
          </button>
          <button className="button button-outline" onClick={onLogout}>
            Keluar dari Panel
          </button>
        </div>
      </section>

      {flash ? <div className={`notice notice-${flashType}`}>{flash}</div> : null}
      {adminNotice({ configured, summaryError })}

      <section className="admin-section">
        <div className="admin-section-head">
          <div>
            <h2>Ringkasan Data Saat Ini</h2>
            <p>Angka berikut dikumpulkan dari semua file CSV yang telah diimpor.</p>
          </div>
        </div>
        <div className="admin-stats-grid">
          {adminStatCard('Total Sampel', numberFormat.format(total), 'info')}
          {adminStatCard('Positif', numberFormat.format(positive), 'danger')}
          {adminStatCard('Seropositif', numberFormat.format(seropositive), 'success')}
          {adminStatCard('Provinsi', numberFormat.format(provinces), 'neutral')}
        </div>
      </section>

      <section className="admin-section">
        <div className="admin-section-head">
          <div>
            <h2>Tindakan Cepat Admin</h2>
            <p>Pilih tugas yang ingin Anda lakukan.</p>
          </div>
        </div>
        <div className="admin-actions-grid">
          <button className="admin-action-card" onClick={onManage}>
            <span className="admin-action-index">01</span>
            <div>
              <strong>Pengelolaan Data</strong>
              <span>Impor CSV, tambah sampel, lihat riwayat impor, dan kelola entri data.</span>
            </div>
          </button>
          <button className="admin-action-card" onClick={() => onPage('charts')}>
            <span className="admin-action-index">02</span>
            <div>
              <strong>Olah Data</strong>
              <span>Lihat grafik ringkasan sampel, positif, dan seropositif per metode, hari, bulan, dan provinsi.</span>
            </div>
          </button>
          <button className="admin-action-card" onClick={() => onPage('map')}>
            <span className="admin-action-index">03</span>
            <div>
              <strong>Peta Wilayah</strong>
              <span>Lihat sebaran status pengujian per provinsi, kabupaten/kota, dan kecamatan.</span>
            </div>
          </button>
        </div>
      </section>

      <section className="admin-warning-panel">
        <div>
          <strong>Perhatian</strong>
          <p>
            Halaman ini hanya untuk administrator yang berwenang. Jika Anda bukan admin, silakan gunakan{' '}
            <button className="text-link" onClick={() => onPage('charts')}>tampilan publik</button> sebagai pengunjung biasa.
          </p>
        </div>
      </section>
    </main>
  );
}