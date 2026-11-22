import { type FormEvent } from 'react';
import type { FlashType } from '../types';

type LoginPageProps = {
  configured: boolean;
  busy: boolean;
  flash: string;
  flashType: FlashType;
  onPage: (page: 'home') => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

function connectionNotice(configured: boolean) {
  if (!configured) {
    return (
      <div className="notice notice-warn">
        <strong>Server IV Lab belum dikonfigurasi.</strong> Isi <code>.env.local</code> saat menjalankan lokal atau environment variables di Vercel. Lihat README untuk langkah setup.
      </div>
    );
  }
  return null;
}

export default function LoginPage({ configured: isConfigured, busy, flash, flashType, onPage, onSubmit }: LoginPageProps) {
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <button type="button" className="back-link" onClick={() => onPage('home')}>← Kembali ke beranda</button>
        <span className="eyebrow">Panel admin</span>
        <h1>Login admin</h1>
        <p>Masuk untuk menginput dan mengelola data laboratorium.</p>
        {connectionNotice(isConfigured)}
        {flash ? <div className={`notice notice-${flashType}`}>{flash}</div> : null}
        <form className="form-stack" onSubmit={onSubmit}>
          <label>Email admin<input type="email" name="email" autoComplete="username" required /></label>
          <label>Kata sandi<input type="password" name="password" autoComplete="current-password" required /></label>
          <button className="button button-dark button-full" type="submit" disabled={!isConfigured || busy}>{busy ? 'Memeriksa…' : 'Masuk ke panel'}</button>
        </form>
        <div className="auth-foot">Akses admin dikelola melalui backend IV Lab. Login perlu diulang setelah halaman dimuat ulang.</div>
      </section>
      <div className="auth-side"><span className="eyebrow eyebrow-light">LAVIDA · Lampung Veterinary Information & Data Analytics Dashboard</span><p>Pencatatan sampel dan hasil uji laboratorium veteriner.</p></div>
    </main>
  );
}
