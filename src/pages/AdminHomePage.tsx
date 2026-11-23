import { numberFormat } from '../lib/constants';
import type { Summary } from '../types';

type AdminHomePageProps = {
  summary: Summary | null;
  summaryError: string;
  configured: boolean;
  flash: string | null;
  flashType: string;
  onLogout: () => void;
  onManage: () => void;
};

function adminNotice({ configured, summaryError }: { configured: boolean; summaryError: string }) {
  if (!configured) {
    return (
      <div className="notice notice-warn admin-notice">
        <strong>Server IV Lab belum dikonfigurasi.</strong> Isi <code>.env.local</code> atau environment variables VPS.
      </div>
    );
  }
  if (summaryError) {
    return (
      <div className="notice notice-warn admin-notice">
        <strong>Statistik belum dapat dimuat.</strong> {summaryError}
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
          <p>
            Kelola seluruh data pengujian laboratorium dari satu tempat. Setiap perubahan akan langsung
            memperbarui angka dan tampilan publik.
          </p>
        </div>
        <div className="admin-hero-actions">
          <button className="button button-light" onClick={onManage}>
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
            <h2>Statistik Sistem</h2>
            <p>Angka terkini dari seluruh data yang telah diimpor.</p>
          </div>
          <span className="admin-live-badge">
            <i /> Data tersinkron
          </span>
        </div>
        <div className="admin-stats-grid">
          {adminStatCard('Total Sampel', numberFormat.format(total), 'info')}
          {adminStatCard('Positif', numberFormat.format(positive), 'danger')}
          {adminStatCard('Seropositif', numberFormat.format(seropositive), 'success')}
          {adminStatCard('Provinsi', numberFormat.format(provinces), 'neutral')}
        </div>
      </section>

      <section className="admin-section admin-manage-section">
        <div className="admin-section-head">
          <div>
            <h2>Aksi Pengelolaan</h2>
            <p>Satu pintu untuk semua kebutuhan pengelolaan data.</p>
          </div>
        </div>
        <button className="admin-action-card admin-action-primary" onClick={onManage}>
          <span className="admin-action-index">01</span>
          <div>
            <strong>Pengelolaan Data</strong>
            <span>
              Impor CSV, tambah sampel secara manual, lihat riwayat file impor, dan kelola entri data.
            </span>
          </div>
          <span className="admin-action-arrow" aria-hidden="true">→</span>
        </button>
      </section>

      <section className="admin-info-panel">
        <div className="admin-info-icon" aria-hidden="true">i</div>
        <div>
          <strong>Perubahan Anda berlaku langsung</strong>
          <p>
            Setiap data yang diimpor atau diubah di panel ini segera tercermin pada angka statistik di atas
            dan tampilan publik aplikasi. Tidak perlu menyalin data atau melakukan sinkronisasi manual.
          </p>
        </div>
      </section>

      <section className="admin-warning-panel">
        <div>
          <strong>Akses terbatas</strong>
          <p>
            Halaman ini khusus administrator yang berwenang. Gunakan tombol <b>Keluar dari Panel</b> untuk
            kembali ke tampilan publik sebagai pengunjung biasa.
          </p>
        </div>
      </section>
    </main>
  );
}
