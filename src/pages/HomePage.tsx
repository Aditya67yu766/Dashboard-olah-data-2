import { numberFormat } from '../lib/constants';
import type { Summary } from '../types';

type HomePageProps = {
  summary: Summary | null;
  summaryError: string;
  configured: boolean;
  isAdmin: boolean;
  flash: string;
  flashType: string;
  onPage: (page: 'charts' | 'map') => void;
};

function connectionNotice({ configured, summaryError, summary }: Pick<HomePageProps, 'configured' | 'summaryError' | 'summary'>) {
  if (!configured) {
    return (
      <div className="notice notice-warn">
        <strong>Server IV Lab belum dikonfigurasi.</strong> Isi <code>.env.local</code> saat menjalankan lokal atau environment variables di Vercel. Lihat README untuk langkah setup.
      </div>
    );
  }
  if (summaryError) {
    return (
      <div className="notice notice-warn">
        <strong>Ringkasan belum dapat dimuat.</strong> {summaryError} Pastikan skema database sudah dijalankan.
      </div>
    );
  }
  if (summary === null) {
    return null;
  }
  return null;
}

function SummaryPanel({ summary }: { summary: Summary | null }) {
  const display = (value?: number | null) => value == null ? '—' : numberFormat.format(value);
  const positivity = summary?.total ? (summary.positive / summary.total) * 100 : null;
  const positivityDisplay = positivity == null ? '—' : `${positivity.toFixed(1)}%`;

  return (
    <aside className="hero-summary" aria-label="Ringkasan data">
      <div className="summary-head">
        <span>Ringkasan data</span>
        <span className="summary-live"><span className="live-dot" aria-hidden="true" />Diperbarui otomatis</span>
      </div>
      <div className="summary-main">
        <strong>{display(summary?.total)}</strong>
        <span>Sampel tercatat</span>
      </div>
      <div className="summary-stats">
        <div><span>Positif</span><strong>{display(summary?.positive)}</strong></div>
        <div><span>Seropositif</span><strong>{display(summary?.seropositive)}</strong></div>
        <div><span>Provinsi</span><strong>{display(summary?.province_count)}</strong></div>
      </div>
      <div className="summary-rate">
        <span>Tingkat positif</span>
        <strong>{positivityDisplay}</strong>
      </div>
    </aside>
  );
}

function dashboardCards(onPage: (page: 'charts' | 'map') => void) {
  return (
    <div className="dashboard-grid">
      <button className="dashboard-card" onClick={() => onPage('charts')}>
        <span className="card-index">01</span>
        <strong>Ringkasan Data</strong>
        <span className="card-copy">
          Ringkasan sampel, hasil positif, dan seropositif per metode uji, hari, bulan, tahun, dan provinsi,
          lengkap dengan filter dan tabel ringkasan.
        </span>
        <span className="card-link">Buka dashboard</span>
      </button>
      <button className="dashboard-card" onClick={() => onPage('map')}>
        <span className="card-index">02</span>
        <strong>Peta Wilayah</strong>
        <span className="card-copy">
          Sebaran status pengujian per provinsi, kabupaten/kota, dan kecamatan, dengan mode presentasi serta
          ekspor PNG, CSV, GeoJSON, paket QGIS, dan cetak.
        </span>
        <span className="card-link">Buka dashboard</span>
      </button>
    </div>
  );
}

export default function HomePage({ summary, summaryError, configured, isAdmin, flash, flashType, onPage }: HomePageProps) {
  return (
    <main>
      <section className="hero">
        <div className="hero-grid">
          <div className="hero-copy">
            <span className="eyebrow">Pantau Penyakit · Balai Veteriner Lampung</span>
            <h1>Data pengujian <em>IV Lab</em></h1>
            <p>
              Pantau sebaran penyakit hewan melalui ringkasan hasil uji laboratorium veteriner.
              Data agregat tersaji publik; detail sampel dikelola melalui panel admin.
            </p>
            <div className="hero-actions">
              <button className="button button-cream" onClick={() => onPage('charts')}>Lihat ringkasan data</button>
              <button className="hero-text-link" onClick={() => onPage('map')}>Lihat peta wilayah</button>
            </div>
          </div>
          <SummaryPanel summary={summary} />
        </div>
      </section>

      {!isAdmin && (
        <section className="section-block">
          {flash ? <div className={`notice notice-${flashType}`}>{flash}</div> : null}
          {connectionNotice({ configured, summaryError, summary })}
          <div className="section-heading">
            <div>
              <h2>Pilih tampilan data</h2>
              <p>Grafik ringkasan atau sebaran wilayah, sesuai kebutuhan Anda.</p>
            </div>
          </div>
          {dashboardCards(onPage)}
        </section>
      )}

      <section className="about-panel">
        <div>
          <h2>Tentang data ini</h2>
          <p>Angka pada halaman publik merupakan ringkasan agregat. Detail sampel hanya dapat dikelola oleh admin yang berwenang.</p>
        </div>
        <button className="text-link" onClick={() => onPage('charts')}>Buka ringkasan data</button>
      </section>
    </main>
  );
}
