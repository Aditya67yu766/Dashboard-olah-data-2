import { useEffect, useState, type FormEvent } from 'react';
import { configured, deleteAllRecords, deleteImport, deleteRecord, getSession, getSummary, importCsv, insertRecord, listImports, listRecords, reauth as reauthWithPassword, signIn, signOut, type RecordInput } from './api/client';
import { parseCsv } from './lib/csv';
import type { CsvRecord } from './lib/csv';
import { nullable, numberFormat } from './lib/constants';
import AdminPage from './pages/AdminPage';
import ChartsPage from './pages/ChartsPage';
import HomePage from './pages/HomePage';
import AdminHomePage from './pages/AdminHomePage';
import LoginPage from './pages/LoginPage';
import MapPage from './pages/MapPage';
import ReauthModal from './pages/ReauthModal';
import type {
  FlashMessage,
  FlashType,
  ImportRow,
  Page,
  RecordRow,
  SensitiveAction,
  Session,
  Summary
} from './types';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function App() {
  const [page, setPage] = useState<Page>('home');
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      return localStorage.getItem('thm') === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryError, setSummaryError] = useState('');
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [imports, setImports] = useState<ImportRow[]>([]);
  const [importsLoading, setImportsLoading] = useState(false);
  const [reauth, setReauth] = useState<{ step: 'password'; action: SensitiveAction } | null>(null);
  const [flash, setFlash] = useState<FlashMessage | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('thm', theme);
    } catch {
      // localStorage can be unavailable in private mode.
    }
  }, [theme]);

  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 9000);
    return () => window.clearTimeout(timer);
  }, [flash]);

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      const auth = await getSession();
      if (cancelled) return;
      if (auth.error) {
        setFlash({ text: `Sesi admin tidak dapat diperiksa: ${auth.error}`, type: 'error' });
      } else if (auth.session) {
        setSession(auth.session);
        setIsAdmin(auth.admin);
        setPage('admin');
        setFlash({ text: 'Berhasil masuk.', type: 'success' });
        await Promise.all([loadSummary(), loadAdminRecords(), loadAdminImports()]);
      }
      if (!cancelled) await loadSummary();
    }

    void initialize();
    return () => { cancelled = true; };
    // The initial session check intentionally runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadSummary() {
    const { data, error } = await getSummary();
    if (error) {
      setSummaryError(error);
      setSummary(null);
      return;
    }
    setSummary(data);
    setSummaryError('');
  }

  async function loadAdminRecords() {
    setRecordsLoading(true);
    const { records, error } = await listRecords();
    setRecordsLoading(false);
    if (error) {
      setRecords([]);
      setFlash({ text: `Data admin gagal dimuat: ${error}`, type: 'error' });
      return;
    }
    setRecords(records);
  }

  async function loadAdminImports() {
    setImportsLoading(true);
    const { imports, error } = await listImports();
    setImportsLoading(false);
    if (error) {
      setImports([]);
      setFlash({ text: `Daftar file impor gagal dimuat: ${error}`, type: 'error' });
      return;
    }
    setImports(imports);
  }

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFlash(null);
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') ?? '').trim();
    const password = String(form.get('password') ?? '');
    const { session, error } = await signIn(email, password);
    if (error) {
      setBusy(false);
      setFlash({ text: `Login gagal: ${error}`, type: 'error' });
      return;
    }
    if (!session) {
      setBusy(false);
      setFlash({ text: 'Login gagal.', type: 'error' });
      return;
    }
    setSession(session);
    setIsAdmin(true);
    setPage('admin');
    setFlash({ text: 'Berhasil masuk.', type: 'success' });
    setBusy(false);
    await Promise.all([loadSummary(), loadAdminRecords(), loadAdminImports()]);
  }

  async function handleSignOut() {
    const { error } = await signOut();
    if (error) {
      setFlash({ text: `Gagal keluar: ${error}`, type: 'error' });
      return;
    }
    setSession(null);
    setIsAdmin(false);
    setReauth(null);
    setRecords([]);
    setImports([]);
    setPage('home');
    setFlash(null);
  }

  function beginSensitiveAction(action: SensitiveAction) {
    setReauth({ step: 'password', action });
    setFlash(null);
  }

  async function handleReauth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reauth || busy) return;
    const user = session?.user;
    if (!user?.email) {
      setFlash({ text: 'Email akun admin tidak tersedia. Silakan keluar dan masuk kembali.', type: 'error' });
      return;
    }
    const password = String(new FormData(event.currentTarget).get('password') ?? '');
    setBusy(true);
    setFlash(null);
    const verification = await reauthWithPassword(password);
    setBusy(false);
    if (verification.error) {
      setFlash({ text: `Verifikasi kata sandi gagal: ${verification.error}`, type: 'error' });
      return;
    }
    const { action } = reauth;
    setReauth(null);
    await performSensitiveAction(action);
  }

  async function performSensitiveAction(action: SensitiveAction) {
    if (action.type === 'record') await performDeleteRecord(action.id);
    else if (action.type === 'import') await performDeleteImport(action.id);
    else await performDeleteAllRecords();
  }

  function requestDeleteRecord(id: string) {
    if (!isAdmin || busy) return;
    if (!window.confirm('Hapus data sampel ini?')) return;
    beginSensitiveAction({ type: 'record', id });
  }

  async function performDeleteRecord(id: string) {
    if (!isAdmin) return;
    setBusy(true);
    setFlash({ text: 'Menghapus data…', type: 'info' });
    const { error } = await deleteRecord(id);
    if (error) {
      setBusy(false);
      setFlash({ text: `Data gagal dihapus: ${error}`, type: 'error' });
      return;
    }
    setBusy(false);
    setFlash({ text: 'Data berhasil dihapus.', type: 'success' });
    await Promise.all([loadSummary(), loadAdminRecords(), loadAdminImports()]);
  }

  function requestDeleteImport(id: string) {
    if (!isAdmin || busy) return;
    const importRecord = imports.find((item) => item.id === id);
    if (!importRecord) {
      setFlash({ text: 'Data impor tidak ditemukan. Muat ulang daftar sebelum mencoba lagi.', type: 'error' });
      return;
    }
    const target = importRecord.status === 'legacy'
      ? `data lama tahun ${importRecord.data_year} (nama file aslinya tidak tercatat)`
      : `file "${importRecord.file_name}" tahun ${importRecord.data_year}`;
    if (!window.confirm(`Hapus ${target} beserta ${numberFormat.format(importRecord.record_count)} baris data? Tindakan ini tidak dapat dibatalkan.`)) return;
    beginSensitiveAction({ type: 'import', id });
  }

  async function performDeleteImport(id: string) {
    if (!isAdmin) return;
    const importRecord = imports.find((item) => item.id === id);
    if (!importRecord) {
      setFlash({ text: 'Data impor tidak ditemukan. Muat ulang daftar sebelum mencoba lagi.', type: 'error' });
      return;
    }
    setBusy(true);
    setFlash({ text: 'Menghapus data impor…', type: 'info' });
    const { error } = await deleteImport(id);
    setBusy(false);
    if (error) {
      setFlash({ text: `Data impor gagal dihapus: ${error}`, type: 'error' });
      return;
    }
    setFlash({
      text: importRecord.status === 'legacy' ? 'Data lama tahun tersebut berhasil dihapus.' : 'File dan seluruh data impornya berhasil dihapus.',
      type: 'success'
    });
    await Promise.all([loadSummary(), loadAdminRecords(), loadAdminImports()]);
  }

  function requestDeleteAll() {
    if (!isAdmin || busy) return;
    const confirmation = window.prompt(
      'Ini akan menghapus permanen seluruh data IV Lab dari semua tahun. Ketik HAPUS SEMUA DATA untuk melanjutkan.'
    );
    if (confirmation === null) return;
    if (confirmation.trim() !== 'HAPUS SEMUA DATA') {
      setFlash({ text: 'Konfirmasi tidak cocok. Data tidak dihapus.', type: 'error' });
      return;
    }
    beginSensitiveAction({ type: 'all' });
  }

  async function performDeleteAllRecords() {
    if (!isAdmin) return;
    setBusy(true);
    setFlash({ text: 'Menghapus seluruh data IV Lab…', type: 'info' });
    const { error } = await deleteAllRecords();
    setBusy(false);
    if (error) {
      setFlash({ text: `Penghapusan data gagal: ${error}`, type: 'error' });
      return;
    }
    setFlash({ text: 'Seluruh data IV Lab berhasil dihapus.', type: 'success' });
    await Promise.all([loadSummary(), loadAdminRecords(), loadAdminImports()]);
  }

  async function handleAddRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isAdmin || busy) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const record: RecordInput = {
      registration_date: String(form.get('registration_date') ?? ''),
      kode_sampel: String(form.get('kode_sampel') ?? '').trim(),
      nama_uji: String(form.get('nama_uji') ?? '').trim(),
      metode_uji: String(form.get('metode_uji') ?? '').trim(),
      interpretasi_hasil: nullable(form.get('interpretasi_hasil')),
      provinsi: String(form.get('provinsi') ?? '').trim(),
      kabupaten: nullable(form.get('kabupaten')),
      kecamatan: nullable(form.get('kecamatan')),
      no_registrasi: nullable(form.get('no_registrasi')),
      sample_analysis_number: nullable(form.get('sample_analysis_number')),
      hewan: nullable(form.get('hewan')),
      jenis_layanan: nullable(form.get('jenis_layanan'))
    };

    setBusy(true);
    setFlash(null);
    const { error } = await insertRecord(record);
    setBusy(false);
    if (error) {
      setFlash({ text: `Data gagal disimpan: ${error}`, type: 'error' });
      return;
    }
    formElement.reset();
    setFlash({ text: 'Data sampel berhasil disimpan.', type: 'success' });
    await Promise.all([loadSummary(), loadAdminRecords(), loadAdminImports()]);
  }

  async function handleImportCsv(file: File) {
    if (!isAdmin || busy) return;
    setBusy(true);
    setFlash({ text: `Memvalidasi ${file.name}…`, type: 'info' });

    let rows: CsvRecord[];
    let skippedMissingProvince: number;
    let dataYear: number;
    try {
      const parsed = await parseCsv(file);
      rows = parsed.rows;
      skippedMissingProvince = parsed.skippedMissingProvince;
      if (!rows.length) {
        throw new Error(`Tidak ada baris valid untuk diimpor; ${numberFormat.format(skippedMissingProvince)} baris dilewati karena provinsi kosong.`);
      }
      const years = [...new Set(rows.map((row) => row.registration_date.slice(0, 4)))];
      if (years.length !== 1) {
        throw new Error(`Satu file hanya boleh berisi satu tahun. Tahun yang ditemukan: ${years.join(', ')}.`);
      }
      dataYear = Number(years[0]);
    } catch (error) {
      setBusy(false);
      setFlash({ text: errorMessage(error), type: 'error' });
      return;
    }

    const { error: importError } = await importCsv({
      fileName: file.name,
      dataYear,
      skippedProvinceCount: skippedMissingProvince,
      importedBy: session?.user.id ?? '',
      rows
    });
    setBusy(false);
    const skipped = skippedMissingProvince ? ` ${numberFormat.format(skippedMissingProvince)} baris dilewati karena provinsi kosong.` : '';
    if (importError) {
      setFlash({ text: `File gagal disimpan: ${importError}${skipped}`, type: 'error' });
      await Promise.all([loadSummary(), loadAdminRecords(), loadAdminImports()]);
      return;
    }
    setFlash({ text: `${numberFormat.format(rows.length)} baris berhasil diimpor.${skipped}`, type: 'success' });
    await Promise.all([loadSummary(), loadAdminRecords(), loadAdminImports()]);
  }

  function navigate(nextPage: Page) {
    if (isAdmin && (nextPage === 'charts' || nextPage === 'map')) {
      setPage('admin');
      setFlash({ text: 'Keluar dari akun admin terlebih dahulu untuk melihat dashboard.', type: 'info' });
      return;
    }
    if (nextPage === 'admin' && !isAdmin) {
      setPage('login');
      setFlash(null);
      return;
    }
    setPage(nextPage);
    setFlash(null);
    if (nextPage === 'admin') {
      void loadAdminRecords();
      void loadAdminImports();
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const navItems: Array<[Page, string]> = [['home', 'Beranda']];
  if (!isAdmin) {
    navItems.push(['charts', 'Ringkasan Data'], ['map', 'Peta Wilayah']);
  }
  const flashText = flash?.text ?? '';
  const flashType: FlashType = flash?.type ?? 'success';

  return (
    <div className={`app-shell${page === 'charts' || page === 'map' ? ' dash-mode' : ''}`}>
      <header className="site-header">
        <button className="brand" onClick={() => navigate('home')} aria-label="LAVIDA beranda">
          <img className="brand-logo" src="/logo-bv-lampung.png" alt="" />
          <span><strong>LAVIDA</strong><small>Balai Veterininer Lampung</small></span>
        </button>
        <nav className="main-nav" aria-label="Navigasi utama">
          {navItems.map(([target, label]) => (
            <button key={target} className={page === target ? 'active' : ''} onClick={() => navigate(target)}>
              {label}
            </button>
          ))}
        </nav>
        <div className="header-actions">
          <button
            className="theme-toggle"
            onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
            title={theme === 'dark' ? 'Gunakan tema terang' : 'Gunakan tema gelap'}
            aria-label={theme === 'dark' ? 'Gunakan tema terang' : 'Gunakan tema gelap'}
          >
            {theme === 'dark' ? 'Terang' : 'Gelap'}
          </button>
          {isAdmin ? (
            <>
              <button className="button button-outline" onClick={() => navigate('admin')}>Panel admin</button>
              <button className="button button-dark" onClick={() => void handleSignOut()}>Keluar</button>
            </>
          ) : (
            <button className="button button-dark" onClick={() => navigate('login')}>Login admin</button>
          )}
        </div>
      </header>

      {page === 'home' ? (
        isAdmin ? (
          <AdminHomePage
            summary={summary}
            summaryError={summaryError}
            configured={configured}
            flash={flashText}
            flashType={flashType}
            onPage={(target) => navigate(target)}
            onLogout={() => void handleSignOut()}
            onManage={() => navigate('admin')}
          />
        ) : (
          <HomePage
            summary={summary}
            summaryError={summaryError}
            configured={configured}
            isAdmin={isAdmin}
            flash={flashText}
            flashType={flashType}
            onPage={(page) => navigate(page)}
          />
        )
      ) : null}

      {page === 'login' ? (
        <LoginPage
          configured={configured}
          busy={busy}
          flash={flashText}
          flashType={flashType}
          onPage={(page) => navigate(page)}
          onSubmit={handleSignIn}
        />
      ) : null}

      {page === 'admin' ? (
        isAdmin ? (
          <AdminPage
            records={records}
            recordsLoading={recordsLoading}
            imports={imports}
            importsLoading={importsLoading}
            flash={flashText}
            flashType={flashType}
            busy={busy}
            onAddRecord={handleAddRecord}
            onImportCsv={(file) => void handleImportCsv(file)}
            onDeleteRecord={requestDeleteRecord}
            onDeleteImport={requestDeleteImport}
            onLogout={() => void handleSignOut()}
            onRefreshRecords={() => void loadAdminRecords()}
            onRefreshImports={() => void loadAdminImports()}
            onDeleteAll={requestDeleteAll}
          />
        ) : (
          <LoginPage
            configured={configured}
            busy={busy}
            flash={flashText}
            flashType={flashType}
            onPage={(page) => navigate(page)}
            onSubmit={handleSignIn}
          />
        )
      ) : null}

      {page === 'charts' ? <ChartsPage theme={theme} /> : null}
      {page === 'map' ? <MapPage theme={theme} /> : null}

      <footer className="site-footer">
        <span>LAVIDA · Balai Veterininer Lampung</span>
        <span>Data IV Lab · {new Date().getFullYear()}</span>
      </footer>

      <ReauthModal
        reauth={reauth}
        flash={flashText}
        flashType={flashType}
        busy={busy}
        onSubmit={handleReauth}
        onCancel={() => setReauth(null)}
      />
    </div>
  );
}

export default App;
