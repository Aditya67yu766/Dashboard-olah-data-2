import { useEffect, useMemo, useRef, useState } from 'react';
import '../styles/multiselect.css';

export type MultiSelectOption = {
  value: string;
  label: string;
  hint?: string;
};

type MultiSelectProps = {
  label: string;
  options: MultiSelectOption[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  allLabel?: string;
  searchable?: boolean;
  disabled?: boolean;
  emptyText?: string;
};

export default function MultiSelect({
  label,
  options,
  selected,
  onChange,
  allLabel = 'Semua',
  searchable = false,
  disabled = false,
  emptyText = 'Tidak ada pilihan.'
}: MultiSelectProps) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(false);
  const detailsRef = useRef<HTMLDetailsElement | null>(null);

  useEffect(() => {
    const closeOnOutsideClick = (event: MouseEvent) => {
      const element = detailsRef.current;
      if (element?.open && !element.contains(event.target as Node)) element.open = false;
    };
    document.addEventListener('click', closeOnOutsideClick);
    return () => document.removeEventListener('click', closeOnOutsideClick);
  }, []);

  const visibleOptions = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return options;
    return options.filter((option) => option.label.toLowerCase().includes(term));
  }, [options, query]);

  const summaryText = selected.size === 0
    ? allLabel
    : selected.size <= 2
      ? [...selected]
          .map((value) => options.find((option) => option.value === value)?.label ?? value)
          .join(', ')
      : `${selected.size} dipilih`;

  function toggle(value: string) {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(next);
  }

  return (
    <div className="ms-field">
      <span className="ms-label">{label}</span>
      <details className={`ms${expanded ? ' expanded' : ''}`} ref={detailsRef}>
        <summary
          className={disabled ? 'is-disabled' : ''}
          onClick={(event) => {
            if (disabled) event.preventDefault();
          }}
          title={selected.size ? [...selected].join(', ') : allLabel}
        >
          {summaryText}
        </summary>
        <div className="ms-pop">
          <div className="ms-pop-head">
            <span>{label}</span>
            <button type="button" onClick={() => setExpanded((value) => !value)}>
              {expanded ? 'Kecilkan' : 'Perbesar'}
            </button>
          </div>
          {searchable ? (
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Cari…"
              aria-label={`Cari ${label.toLowerCase()}`}
            />
          ) : null}
          <div className="ms-actions">
            <button type="button" onClick={() => onChange(new Set(visibleOptions.map((option) => option.value)))}>
              Pilih yang tampil
            </button>
            <button type="button" onClick={() => onChange(new Set())}>Hapus pilihan</button>
          </div>
          <div className="ms-list">
            {visibleOptions.map((option) => (
              <label key={option.value} title={option.hint ?? option.label}>
                <input
                  type="checkbox"
                  checked={selected.has(option.value)}
                  onChange={() => toggle(option.value)}
                />
                <span>{option.label}</span>
                {option.hint ? <small>{option.hint}</small> : null}
              </label>
            ))}
            {!visibleOptions.length ? <p className="ms-empty">{emptyText}</p> : null}
          </div>
        </div>
      </details>
    </div>
  );
}
