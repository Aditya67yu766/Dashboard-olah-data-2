import { type FormEvent } from 'react';
import type { FlashType, ReauthState } from '../types';

type ReauthModalProps = {
  reauth: ReauthState | null;
  flash: string;
  flashType: FlashType;
  busy: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
};

export default function ReauthModal({ reauth, flash, flashType, busy, onSubmit, onCancel }: ReauthModalProps) {
  if (!reauth) return null;
  return (
    <div className="modal-backdrop">
      <section className="reauth-card" role="dialog" aria-modal="true" aria-labelledby="reauth-title">
        <span className="eyebrow">Konfirmasi keamanan</span>
        <h2 id="reauth-title">Verifikasi kata sandi</h2>
        <p>Ketik ulang kata sandi admin sebelum menghapus data.</p>
        {flash ? <div className={`notice notice-${flashType}`}>{flash}</div> : null}
        <form className="form-stack" onSubmit={onSubmit}>
          <label>
            Kata sandi admin
            <input type="password" name="password" autoComplete="current-password" required />
          </label>
          <button className="button button-dark button-full" type="submit" disabled={busy}>
            {busy ? 'Memeriksa…' : 'Konfirmasi penghapusan'}
          </button>
        </form>
        <button className="button button-outline button-full reauth-cancel" onClick={onCancel} disabled={busy}>
          Batal
        </button>
      </section>
    </div>
  );
}
