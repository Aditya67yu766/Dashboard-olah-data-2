import { useEffect, useMemo, useRef, useState } from 'react';
import Chart from 'chart.js/auto';
import type { ChartConfiguration, Plugin } from 'chart.js';
import { getDashboardData } from '../api/client';
import MultiSelect from '../components/MultiSelect';
import { numberFormat } from '../lib/constants';
import { diseaseGroup } from '../lib/peta';
import type { ChartKey, ChartRow, MapRow } from '../types';
import '../styles/charts.css';

type ViewKey = Exclude<ChartKey, 'by_disease_month' | 'by_regency_month' | 'by_district_month'> | 'by_disease' | 'by_regency' | 'by_district';
type Tab = ViewKey | 'multi' | 'table' | 'coverage' | 'outbreak';
type SortKey = 'label' | 'total' | 'positive' | 'seropositive' | 'mean' | 'sd' | 'upper';
type GroupedRow = { key: string; label: string; total: number; positive: number; seropositive: number; mean: number; sd: number; upper: number };

const DIMENSION_KEYS: Array<'by_method' | 'by_disease'> = ['by_method', 'by_disease'];
const DIMENSION_LABELS: Record<'by_method' | 'by_disease', string> = {
  by_method: 'Per Metode Uji',
  by_disease: 'Per Penyakit'
};

const CHART_TABS: Array<{ key: Tab; label: string }> = [
  { key: 'by_day', label: 'Per Hari' },
  { key: 'by_month', label: 'Per Bulan' },
  { key: 'by_year', label: 'Per Tahun' },
  { key: 'outbreak', label: 'Batas Outbreak (SD)' },
  { key: 'by_province', label: 'Per Provinsi' },
  { key: 'by_regency', label: 'Per Kab/Kota' },
  { key: 'by_district', label: 'Per Kecamatan' }
];

const DISEASE_TABS: Tab[] = ['by_year', 'by_province', 'by_regency', 'by_district'];

const VIEW_TITLES: Record<ViewKey, string> = {
  by_disease: 'Jumlah sampel per penyakit',
  by_method: 'Jumlah sampel per metode uji',
  by_day: 'Jumlah sampel per hari',
  by_month: 'Jumlah sampel per bulan',
  by_year: 'Jumlah sampel per tahun',
  by_province: 'Jumlah sampel per provinsi',
  by_regency: 'Jumlah sampel per kabupaten/kota',
  by_district: 'Jumlah sampel per kecamatan'
};

const DIMENSION_LABEL: Record<ViewKey, string> = {
  by_disease: 'Penyakit',
  by_method: 'Metode uji',
  by_day: 'Tanggal',
  by_month: 'Bulan',
  by_year: 'Tahun',
  by_province: 'Provinsi',
  by_regency: 'Kabupaten/Kota',
  by_district: 'Kecamatan'
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const MONTH_OPTIONS = MONTHS.map((label, index) => ({ value: String(index + 1).padStart(2, '0'), label }));
const PAGE_SIZE = 10;

function displayLabel(key: ViewKey, value: string): string {
  if (!value) return '(kosong)';
  if (key === 'by_month' && /^\d{4}-\d{2}$/.test(value)) {
    const [year, month] = value.split('-');
    return `${MONTHS[Number(month) - 1] ?? month} ${year}`;
  }
  if (key === 'by_day' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-');
    return `${day} ${MONTHS[Number(month) - 1] ?? month} ${year}`;
  }
  return value;
}

function groupRows(key: ViewKey, rows: ChartRow[]): GroupedRow[] {
  const map = new Map<string, GroupedRow>();
  const valuesByKey = new Map<string, number[]>();
  for (const row of rows) {
    const rawKey = row.label ?? '';
    const value = Number(row.positive) || 0;
    const values = valuesByKey.get(rawKey) ?? [];
    values.push(value);
    valuesByKey.set(rawKey, values);
    const item = map.get(rawKey) ?? {
      key: rawKey,
      label: displayLabel(key, rawKey),
      total: 0,
      positive: 0,
      seropositive: 0,
      mean: 0,
      sd: 0,
      upper: 0
    };
    item.total += Number(row.total) || 0;
    item.positive += value;
    item.seropositive += Number(row.seropositive) || 0;
    map.set(rawKey, item);
  }
  const grouped = [...map.values()];
  grouped.forEach((item) => {
    const values = valuesByKey.get(item.key) ?? [];
    const totalValue = values.reduce((sum, value) => sum + value, 0);
    const mean = values.length ? totalValue / values.length : 0;
    const variance = values.length > 1 ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1) : 0;
    item.mean = mean;
    item.sd = Math.sqrt(variance);
    item.upper = mean + 2 * item.sd;
  });
  if (key === 'by_disease' || key === 'by_method' || key === 'by_province' || key === 'by_regency' || key === 'by_district') {
    grouped.sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, 'id'));
  } else {
    grouped.sort((a, b) => a.label.localeCompare(b.label, 'id', { numeric: true }));
  }
  return grouped;
}

function chartHeightFor(rowCount: number, horizontal: boolean): number {
  // Grafik horizontal butuh ruang per baris agar label kategori tidak bertumpuk.
  // Tinggi mengikuti jumlah baris (maksimum 12000px) sehingga teks tetap terbaca.
  if (horizontal) return Math.max(360, Math.min(12000, rowCount * 36));
  return Math.max(390, Math.min(720, rowCount * 26));
}

function percent(value: number, total: number): string {
  if (!total) return '—';
  return `${((value / total) * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`;
}

function fileSlugText(value: string): string {
  return value.replace(/[^\w-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'semua-provinsi';
}

type OutbreakSeriesData = {
  series: Array<[string, number]>;
  mean: number;
  sd: number;
  upper1: number;
  upper2: number;
  lastValue: number;
  maximum: number;
  first: string;
  last: string;
  isOutbreak: boolean;
  isYearly: boolean;
};

function buildOutbreakSeries(monthly: Map<string, number>): OutbreakSeriesData {
  const series = [...monthly.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const values = series.map(([, value]) => value);
  const count = values.length;
  const mean = count ? values.reduce((sum, value) => sum + value, 0) / count : 0;
  const variance = count > 1 ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (count - 1) : 0;
  const sd = Math.sqrt(variance);
  const upper1 = mean + sd;
  const upper2 = mean + 2 * sd;
  const lastValue = count ? values[count - 1] : 0;
  return {
    series,
    mean,
    sd,
    upper1,
    upper2,
    lastValue,
    maximum: Math.max(...values, upper2, 1),
    first: series.length ? displayLabel('by_month', series[0][0]) : '—',
    last: series.length ? displayLabel('by_month', series[series.length - 1][0]) : '—',
    isOutbreak: upper2 > 0 && lastValue >= upper2,
    isYearly: false
  };
}

function buildOutbreakSeriesYearly(yearly: Map<string, number>): OutbreakSeriesData {
  const series = [...yearly.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const values = series.map(([, value]) => value);
  const count = values.length;
  const mean = count ? values.reduce((sum, value) => sum + value, 0) / count : 0;
  const variance = count > 1 ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (count - 1) : 0;
  const sd = Math.sqrt(variance);
  const upper1 = mean + sd;
  const upper2 = mean + 2 * sd;
  const lastValue = count ? values[count - 1] : 0;
  return {
    series,
    mean,
    sd,
    upper1,
    upper2,
    lastValue,
    maximum: Math.max(...values, upper2, 1),
    first: series.length ? series[0][0] : '—',
    last: series.length ? series[series.length - 1][0] : '—',
    isOutbreak: upper2 > 0 && lastValue >= upper2,
    isYearly: true
  };
}

function OutbreakTable({ data, name }: { data: OutbreakSeriesData; name: string }) {
  const format = (value: number) => numberFormat.format(Math.round(value));
  return (
    <div className="outbreak-table-wrap">
      <table className="dash-table outbreak-table">
        <thead>
          <tr>
            <th>{data.isYearly ? 'Tahun' : 'Bulan'}</th>
            <th className="n">{name}</th>
            <th className="n">Rata-rata</th>
            <th className="n">SD</th>
            <th className="n">+1 SD</th>
            <th className="n">+2 SD</th>
            <th>Keterangan</th>
          </tr>
        </thead>
        <tbody>
          {data.series.map(([label, value]) => (
            <tr key={label}>
              <td>{data.isYearly ? label : displayLabel('by_month', label)}</td>
              <td className="n">{numberFormat.format(value)}</td>
              <td className="n">{format(data.mean)}</td>
              <td className="n">{format(data.sd)}</td>
              <td className="n">{format(data.upper1)}</td>
              <td className="n">{format(data.upper2)}</td>
              <td>
                <span className={`outbreak-status${data.upper2 > 0 && value >= data.upper2 ? ' is-outbreak' : ''}`}>
                  {data.upper2 > 0 && value >= data.upper2 ? 'OUTBREAK' : 'AMAN'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function withAlpha(color: string, alpha: number): string {
  const hex = color.replace('#', '');
  if (/^[0-9a-f]{6}$/i.test(hex)) {
    const value = Number.parseInt(hex, 16);
    return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
  }
  return color;
}

function cssColor(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

const valueLabelPlugin: Plugin<'bar'> = {
  id: 'valueLabels',
  afterDatasetsDraw(chart) {
    if ((chart.data.labels?.length ?? 0) > 30) return;
    const dataset = chart.data.datasets[0];
    const meta = chart.getDatasetMeta(0);
    if (!dataset || !meta) return;
    const horizontal = chart.options.indexAxis === 'y';
    const { ctx } = chart;
    ctx.save();
    ctx.fillStyle = cssColor('--ink', '#232b20');
    ctx.font = '600 12px "DM Sans", sans-serif';
    ctx.textAlign = horizontal ? 'left' : 'center';
    ctx.textBaseline = horizontal ? 'middle' : 'bottom';
    meta.data.forEach((element, index) => {
      const value = dataset.data[index];
      if (typeof value !== 'number' || value <= 0) return;
      const point = element as unknown as { x: number; y: number };
      if (horizontal) ctx.fillText(numberFormat.format(value), point.x + 6, point.y);
      else ctx.fillText(numberFormat.format(value), point.x, point.y - 5);
    });
    ctx.restore();
  }
};

type ChartsPageProps = { theme: 'light' | 'dark' };

export default function ChartsPage({ theme }: ChartsPageProps) {
  const [charts, setCharts] = useState<Record<ChartKey, ChartRow[]> | null>(null);
  const [mapRows, setMapRows] = useState<MapRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [tab, setTab] = useState<Tab>('multi');
  const [dimensions, setDimensions] = useState<Set<'by_method' | 'by_disease'>>(new Set(['by_method']));
  const [tableDim, setTableDim] = useState<ViewKey>('by_method');
  const [selectedDiseases, setSelectedDiseases] = useState<Set<string>>(new Set());
  const [selectedYears, setSelectedYears] = useState<Set<string>>(new Set());
  const [selectedProvinces, setSelectedProvinces] = useState<Set<string>>(new Set());
  const [selectedRegencies, setSelectedRegencies] = useState<Set<string>>(new Set());
  const [selectedDistricts, setSelectedDistricts] = useState<Set<string>>(new Set());
  const [outbreakYears, setOutbreakYears] = useState<Set<string>>(new Set());
  const [outbreakProvinces, setOutbreakProvinces] = useState<Set<string>>(new Set());
  const [outbreakDiseases, setOutbreakDiseases] = useState<Set<string>>(new Set());
  const [outbreakMonths, setOutbreakMonths] = useState<Set<string>>(new Set());
  const [outbreakShowPositive, setOutbreakShowPositive] = useState(true);
  const [outbreakShowSeropositive, setOutbreakShowSeropositive] = useState(true);
  const [showPositive, setShowPositive] = useState(true);
  const [showSeropositive, setShowSeropositive] = useState(true);
  const [query, setQuery] = useState('');
  const [tablePage, setTablePage] = useState(1);
  const [sortKey, setSortKey] = useState<SortKey>('label');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const canvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
  const outbreakPositiveCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const outbreakSeroCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      const { data, error: loadError } = await getDashboardData();
      if (cancelled) return;
      if (loadError || !data?.charts) {
        setCharts(null);
        setMapRows([]);
        setError(loadError ?? 'Data ringkasan belum tersedia dari server IV Lab.');
        setLoading(false);
        return;
      }
      setCharts(data.charts);
      setMapRows(Array.isArray(data.map) ? data.map : []);
      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [reloadKey]);

  const diseaseOptions = useMemo(() => {
    const groups = new Set<string>();
    mapRows.forEach((row) => {
      if (row.target) groups.add(diseaseGroup(row.target));
    });
    return [...groups].sort((a, b) => a.localeCompare(b, 'id'));
  }, [mapRows]);

  const diseaseCharts = useMemo(() => {
    const accumulators = {
      by_disease: new Map<string, ChartRow>(),
      by_year: new Map<string, ChartRow>(),
      by_province: new Map<string, ChartRow>(),
      by_regency: new Map<string, ChartRow>(),
      by_district: new Map<string, ChartRow>()
    };

    mapRows.forEach((row) => {
      if (!row.target) return;
      const group = diseaseGroup(row.target);
      if (selectedDiseases.size && !selectedDiseases.has(group)) return;
      const provinceName = row.province || '(kosong)';
      const regencyName = row.regency || '(kosong)';
      const districtName = row.district || '(kosong)';
      const total = Number(row.total) || 0;
      const positive = Number(row.positive) || 0;

      (['by_disease', 'by_year', 'by_province', 'by_regency', 'by_district'] as const).forEach((dimension) => {
        const label = dimension === 'by_disease'
          ? group
          : dimension === 'by_year'
            ? String(row.year)
            : dimension === 'by_province'
              ? provinceName
              : dimension === 'by_regency'
                ? regencyName
                : districtName;
        const key = `${row.year}|${provinceName}|${regencyName}|${districtName}|${label}`;
        const bucket = accumulators[dimension];
        let item = bucket.get(key);
        if (!item) {
          item = { year: row.year, province: provinceName, label, total: 0, positive: 0, seropositive: 0 };
          bucket.set(key, item);
        }
        item.total += total;
        item.positive += positive;
      });
    });

    return {
      by_disease: [...accumulators.by_disease.values()],
      by_year: [...accumulators.by_year.values()],
      by_province: [...accumulators.by_province.values()],
      by_regency: [...accumulators.by_regency.values()],
      by_district: [...accumulators.by_district.values()]
    };
  }, [mapRows, selectedDiseases]);

  const regionCharts = useMemo(() => {
    const accumulators = {
      by_regency: new Map<string, ChartRow>(),
      by_district: new Map<string, ChartRow>()
    };

    mapRows.forEach((row) => {
      if (row.target) return;
      const provinceName = row.province || '(kosong)';
      const regencyName = row.regency || '(kosong)';
      const districtName = row.district || '(kosong)';
      const total = Number(row.total) || 0;
      const positive = Number(row.positive) || 0;

      (['by_regency', 'by_district'] as const).forEach((dimension) => {
        const label = dimension === 'by_regency' ? regencyName : districtName;
        const key = `${row.year}|${provinceName}|${regencyName}|${districtName}|${label}`;
        const bucket = accumulators[dimension];
        let item = bucket.get(key);
        if (!item) {
          item = { year: row.year, province: provinceName, label, total: 0, positive: 0, seropositive: 0 };
          bucket.set(key, item);
        }
        item.total += total;
        item.positive += positive;
      });
    });

    return {
      by_regency: [...accumulators.by_regency.values()],
      by_district: [...accumulators.by_district.values()]
    };
  }, [mapRows]);

  const viewCharts = useMemo<Record<ViewKey, ChartRow[]>>(() => {
    if (!charts) {
      return { by_disease: [], by_method: [], by_day: [], by_month: [], by_year: [], by_province: [], by_regency: [], by_district: [] };
    }
    if (!selectedDiseases.size) {
      return {
        ...charts,
        by_disease: diseaseCharts.by_disease,
        by_regency: regionCharts.by_regency,
        by_district: regionCharts.by_district
      };
    }
    return {
      by_disease: diseaseCharts.by_disease,
      by_method: [],
      by_day: [],
      by_month: [],
      by_year: diseaseCharts.by_year,
      by_province: diseaseCharts.by_province,
      by_regency: diseaseCharts.by_regency,
      by_district: diseaseCharts.by_district
    };
  }, [charts, selectedDiseases, diseaseCharts, regionCharts]);

  const visibleChartTabs = useMemo(
    () => (selectedDiseases.size ? CHART_TABS.filter((item) => DISEASE_TABS.includes(item.key)) : CHART_TABS),
    [selectedDiseases]
  );

  useEffect(() => {
    if (
      selectedDiseases.size &&
      !DISEASE_TABS.includes(tab) &&
      tab !== 'multi' &&
      tab !== 'table' &&
      tab !== 'coverage' &&
      tab !== 'outbreak'
    ) {
      setTab('multi');
    }
  }, [selectedDiseases, tab]);

  useEffect(() => {
    if (selectedDiseases.size && !DISEASE_TABS.includes(tableDim)) setTableDim('by_disease');
  }, [selectedDiseases, tableDim]);

  const allRows = useMemo(() => Object.values(viewCharts).flat(), [viewCharts]);
  const yearOptions = useMemo(() => [...new Set(allRows.map((row) => String(row.year)))].sort(), [allRows]);
  const provinceOptions = useMemo(
    () => [...new Set(allRows.map((row) => row.province))].sort((a, b) => a.localeCompare(b, 'id')),
    [allRows]
  );
  const regencyOptions = useMemo(
    () => [...new Set(mapRows.map((row) => row.regency).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, 'id')),
    [mapRows]
  );
  const districtOptions = useMemo(
    () => [...new Set(mapRows.map((row) => row.district).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, 'id')),
    [mapRows]
  );

  const outbreak = useMemo(() => {
    const source = outbreakDiseases.size ? (charts?.by_disease_month ?? []) : (charts?.by_month ?? []);
    const rows = source.filter((row) => {
      if (outbreakYears.size && !outbreakYears.has(String(row.year))) return false;
      if (outbreakProvinces.size && !outbreakProvinces.has(row.province)) return false;
      if (outbreakDiseases.size) {
        const group = row.target ? diseaseGroup(row.target) : '';
        if (!outbreakDiseases.has(group)) return false;
      }
      if (outbreakMonths.size) {
        const month = String(row.label ?? '').split('-').pop() ?? '';
        if (!outbreakMonths.has(month)) return false;
      }
      return true;
    });

    const isOutbreakYearly = outbreakYears.size > 1;

    const positiveMonthly = new Map<string, number>();
    const seroMonthly = new Map<string, number>();
    const positiveYearly = new Map<string, number>();
    const seroYearly = new Map<string, number>();

    rows.forEach((row) => {
      const label = String(row.label ?? '');
      const month = label.split('-').pop() ?? label;
      const year = String(row.year ?? label.split('-')[0]);
      const key = isOutbreakYearly ? year : `${year}-${month}`;
      if (isOutbreakYearly) {
        positiveYearly.set(key, (positiveYearly.get(key) ?? 0) + (Number(row.positive) || 0));
        seroYearly.set(key, (seroYearly.get(key) ?? 0) + (Number(row.seropositive) || 0));
      } else {
        positiveMonthly.set(key, (positiveMonthly.get(key) ?? 0) + (Number(row.positive) || 0));
        seroMonthly.set(key, (seroMonthly.get(key) ?? 0) + (Number(row.seropositive) || 0));
      }
    });

    const yearLabel = outbreakYears.size
      ? [...outbreakYears].sort((a, b) => a.localeCompare(b)).join(', ')
      : 'Semua tahun';
    const provinceLabel = outbreakProvinces.size
      ? [...outbreakProvinces].sort((a, b) => a.localeCompare(b, 'id')).join(', ')
      : 'Semua provinsi';
    const diseaseLabel = outbreakDiseases.size
      ? [...outbreakDiseases].sort((a, b) => a.localeCompare(b, 'id')).join(', ')
      : 'Semua penyakit';
    const targets = outbreakDiseases.size
      ? outbreakDiseases.size
      : new Set(
          mapRows
            .filter((row) => !outbreakProvinces.size || outbreakProvinces.has(row.province))
            .map((row) => row.target)
            .filter((value): value is string => Boolean(value))
        ).size;
    return {
      positive: isOutbreakYearly ? buildOutbreakSeriesYearly(positiveYearly) : buildOutbreakSeries(positiveMonthly),
      seropositive: isOutbreakYearly ? buildOutbreakSeriesYearly(seroYearly) : buildOutbreakSeries(seroMonthly),
      yearLabel,
      provinceLabel,
      diseaseLabel,
      targets,
      isYearly: isOutbreakYearly
    };
  }, [charts, outbreakYears, outbreakProvinces, outbreakDiseases, outbreakMonths, mapRows]);
  const hasData = allRows.length > 0;

  const primaryDimension: 'by_method' | 'by_disease' = dimensions.has('by_disease') ? 'by_disease' : 'by_method';
  const activeChartKey: ViewKey | null =
    tab === 'table' ? tableDim : tab === 'coverage' || tab === 'outbreak' ? null : tab === 'multi' ? primaryDimension : tab;
  const diseaseMode = selectedDiseases.size > 0 || activeChartKey === 'by_disease';
  const regionMode = activeChartKey === 'by_regency' || activeChartKey === 'by_district';
  const combinedMode = diseaseMode || regionMode;

  const groupedByKey = useMemo<Record<ViewKey, GroupedRow[]>>(() => {
    const result = {} as Record<ViewKey, GroupedRow[]>;
    (Object.keys(viewCharts) as ViewKey[]).forEach((key) => {
      const rows = viewCharts[key].filter((row) => {
        if (key !== 'by_year' && selectedYears.size && !selectedYears.has(String(row.year))) return false;
        if (selectedProvinces.size && !selectedProvinces.has(row.province)) return false;
        if ((key === 'by_regency' || key === 'by_district') && selectedRegencies.size && !selectedRegencies.has(row.label)) return false;
        if (key === 'by_district' && selectedDistricts.size && !selectedDistricts.has(row.label)) return false;
        return true;
      });
      result[key] = groupRows(key, rows);
    });
    return result;
  }, [viewCharts, selectedYears, selectedProvinces]);

  const displayedKey = (tab === 'table' || tab === 'multi') ? tableDim : activeChartKey ?? 'by_method';
  const displayStatsMode = displayedKey === 'by_disease' || displayedKey === 'by_province' || displayedKey === 'by_regency' || displayedKey === 'by_district';
  const grouped = groupedByKey[displayedKey];
  const chartKeys: ViewKey[] = tab === 'multi'
    ? DIMENSION_KEYS.filter((key) => dimensions.has(key))
    : activeChartKey
      ? [activeChartKey]
      : [];

  const kpiRows = useMemo(() => {
    if (!charts) return [];
    return viewCharts.by_province.filter((row) => {
      if (selectedYears.size && !selectedYears.has(String(row.year))) return false;
      if (selectedProvinces.size && !selectedProvinces.has(row.province)) return false;
      return true;
    });
  }, [charts, viewCharts, selectedYears, selectedProvinces]);

  const kpi = useMemo(() => {
    const totals = kpiRows.reduce(
      (result, row) => ({
        total: result.total + (Number(row.total) || 0),
        positive: result.positive + (Number(row.positive) || 0),
        seropositive: result.seropositive + (Number(row.seropositive) || 0)
      }),
      { total: 0, positive: 0, seropositive: 0 }
    );
    return { ...totals, rows: kpiRows.length };
  }, [kpiRows]);

  useEffect(() => {
    setTablePage(1);
  }, [tab, tableDim, query, selectedYears, selectedProvinces, selectedRegencies, selectedDistricts, selectedDiseases]);

  useEffect(() => {
    const chartsToRender = chartKeys.flatMap((key) => {
      const canvas = canvasRefs.current[key];
      const rows = groupedByKey[key] ?? [];
      if (!canvas || !rows.length) return [];
      return [{
        key,
        canvas,
        rows,
        horizontal: key === 'by_disease' || key === 'by_method' || key === 'by_province' || key === 'by_regency' || key === 'by_district'
      }];
    });
    if (!chartsToRender.length) return;

    const sampleColor = cssColor('--nov', '#8a8576');
    const positiveColor = cssColor('--pos', '#c4402f');
    const seroColor = cssColor('--neg', '#4a8a4f');
    const ink = cssColor('--ink', '#232b20');
    const muted = cssColor('--muted', '#5e6858');
    const line = cssColor('--line', '#cbbda9');

    const instances = chartsToRender.map(({ canvas, rows, horizontal, key }) => {
      const keyDiseaseMode = selectedDiseases.size > 0 || key === 'by_disease';
      const keyStatsMode = keyDiseaseMode || regionMode;

      const datasets: ChartConfiguration<'bar'>['data']['datasets'] = [
        {
          label: 'Jumlah sampel',
          data: rows.map((row) => row.total),
          backgroundColor: withAlpha(sampleColor, .38),
          borderColor: sampleColor,
          borderWidth: 1,
          borderRadius: 3
        }
      ];
      if (showPositive) {
        datasets.push({
          label: keyStatsMode ? 'Positif / seropositif' : 'Positif',
          data: rows.map((row) => row.positive),
          backgroundColor: withAlpha(positiveColor, .42),
          borderColor: positiveColor,
          borderWidth: 1,
          borderRadius: 3
        });
      }
      if (showSeropositive && !keyStatsMode) {
        datasets.push({
          label: 'Seropositif',
          data: rows.map((row) => row.seropositive),
          backgroundColor: withAlpha(seroColor, .42),
          borderColor: seroColor,
          borderWidth: 1,
          borderRadius: 3
        });
      }

      const config: ChartConfiguration<'bar'> = {
        type: 'bar',
        data: {
          labels: rows.map((row) => row.label),
          datasets
        },
        options: {
          indexAxis: horizontal ? 'y' : 'x',
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          layout: { padding: { top: horizontal ? 4 : 24, right: horizontal ? 30 : 8 } },
          plugins: {
            legend: {
              position: 'bottom',
              labels: {
                usePointStyle: true,
                boxWidth: 8,
                padding: 18,
                color: ink,
                font: { size: 12, family: 'DM Sans' }
              }
            },
            tooltip: {
              callbacks: {
                label: (context) => `${context.dataset.label}: ${numberFormat.format(Number(context.raw) || 0)}`
              }
            }
          },
          scales: horizontal
            ? {
                x: {
                  beginAtZero: true,
                  grid: { color: line, drawTicks: false },
                  border: { display: false },
                  ticks: { color: muted, callback: (value) => numberFormat.format(Number(value)), font: { size: 11.5 } }
                },
                y: {
                  grid: { display: false },
                  border: { display: false },
                  ticks: { color: ink, font: { size: 12, weight: 500 }, autoSkip: false }
                }
              }
            : {
                x: {
                  grid: { display: false },
                  border: { color: line },
                  ticks: { color: muted, maxRotation: 0, minRotation: 0, autoSkip: true, font: { size: 11.5 } }
                },
                y: {
                  beginAtZero: true,
                  grace: '8%',
                  grid: { color: line, drawTicks: false },
                  border: { display: false },
                  ticks: { color: muted, callback: (value) => numberFormat.format(Number(value)), font: { size: 11.5 } }
                }
              }
        },
        plugins: [valueLabelPlugin]
      };

      return new Chart(canvas, config);
    });

    return () => instances.forEach((chart) => chart.destroy());
  }, [chartKeys.join('|'), groupedByKey, showPositive, showSeropositive, theme, selectedDiseases]);

  useEffect(() => {
    if (tab !== 'outbreak') return;
    const positiveColor = cssColor('--pos', '#c4402f');
    const seroColor = cssColor('--neg', '#4a8a4f');
    const warningColor = cssColor('--unk', '#b8860b');
    const ink = cssColor('--ink', '#232b20');
    const muted = cssColor('--muted', '#5e6858');
    const line = cssColor('--line', '#cbbda9');
    const rounded = (value: number) => Math.round(value);
    const instances: Chart[] = [];

    const render = (canvas: HTMLCanvasElement | null, data: OutbreakSeriesData, name: string, color: string) => {
      if (!canvas || !data.series.length) return;
      const flat = (value: number) => data.series.map(() => value);
      const labelFormatter = data.isYearly
        ? (label: string) => label
        : (label: string) => displayLabel('by_month', label);
      const config: ChartConfiguration = {
        type: 'bar',
        data: {
          labels: data.series.map(([label]) => labelFormatter(label)),
          datasets: [
            {
              type: 'bar' as const,
              label: name,
              data: data.series.map(([, value]) => value),
              backgroundColor: withAlpha(color, .45),
              borderColor: color,
              borderWidth: 1,
              borderRadius: 3,
              order: 4
            },
            {
              type: 'line' as const,
              label: `Rata-rata (${numberFormat.format(rounded(data.mean))})`,
              data: flat(data.mean),
              borderColor: ink,
              borderWidth: 1.6,
              pointRadius: 0,
              fill: false,
              order: 3
            },
            {
              type: 'line' as const,
              label: `+1 SD (${numberFormat.format(rounded(data.upper1))})`,
              data: flat(data.upper1),
              borderColor: warningColor,
              borderWidth: 1.6,
              borderDash: [7, 4],
              pointRadius: 0,
              fill: false,
              order: 2
            },
            {
              type: 'line' as const,
              label: `Batas outbreak, +2 SD (${numberFormat.format(rounded(data.upper2))})`,
              data: flat(data.upper2),
              borderColor: positiveColor,
              borderWidth: 1.8,
              borderDash: [2, 3],
              pointRadius: 0,
              fill: false,
              order: 1
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          layout: { padding: { top: 22, right: 12 } },
          plugins: {
            legend: {
              position: 'bottom',
              labels: { usePointStyle: true, boxWidth: 10, padding: 16, color: ink, font: { size: 11.5, family: 'DM Sans' } }
            },
            tooltip: {
              callbacks: { label: (context) => `${context.dataset.label}: ${numberFormat.format(Number(context.raw) || 0)} kasus` }
            }
          },
          scales: {
            x: {
              grid: { color: line, drawTicks: false },
              border: { display: false },
              ticks: { color: muted, maxRotation: 0, minRotation: 0, autoSkip: true, font: { size: 11 } }
            },
            y: {
              beginAtZero: true,
              grace: '8%',
              grid: { color: line, drawTicks: false },
              border: { display: false },
              title: { display: true, text: `${name} per ${data.isYearly ? 'tahun' : 'bulan'}`, color: muted, font: { size: 11.5, family: 'DM Sans' } },
              ticks: { color: muted, callback: (value) => numberFormat.format(Number(value)), font: { size: 11 } }
            }
          }
        },
        plugins: [valueLabelPlugin]
      };
      instances.push(new Chart(canvas, config));
    };

    if (outbreakShowPositive) render(outbreakPositiveCanvasRef.current, outbreak.positive, 'Positif', positiveColor);
    if (outbreakShowSeropositive) render(outbreakSeroCanvasRef.current, outbreak.seropositive, 'Seropositif', seroColor);
    return () => instances.forEach((chart) => chart.destroy());
  }, [tab, outbreak, theme, outbreakShowPositive, outbreakShowSeropositive]);

  const searchedRows = useMemo(() => {
    const term = query.trim().toLowerCase();
    const rows = term
      ? grouped.filter((row) => row.label.toLowerCase().includes(term))
      : [...grouped];
    rows.sort((a, b) => {
      const direction = sortDir === 'asc' ? 1 : -1;
      if (sortKey === 'label') return a.label.localeCompare(b.label, 'id', { numeric: true }) * direction;
      return (a[sortKey] - b[sortKey]) * direction;
    });
    return rows;
  }, [grouped, query, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(searchedRows.length / PAGE_SIZE));
  const currentPage = Math.min(tablePage, pageCount);
  const pageRows = searchedRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const coverage = useMemo(() => {
    if (!charts) {
      return {
        rows: 0,
        years: 0,
        provinces: 0,
        methods: 0,
        byYear: [] as Array<{ year: string; provinces: number; rows: number; total: number; positive: number; seropositive: number }>,
        byProvince: [] as Array<{ province: string; rows: number; total: number; positive: number; seropositive: number }>
      };
    }

    const yearMap = new Map<string, { year: string; provinces: Set<string>; rows: number; total: number; positive: number; seropositive: number }>();
    for (const row of viewCharts.by_year) {
      if (selectedYears.size && !selectedYears.has(String(row.year))) continue;
      if (selectedProvinces.size && !selectedProvinces.has(row.province)) continue;
      const key = String(row.year);
      const item = yearMap.get(key) ?? { year: key, provinces: new Set<string>(), rows: 0, total: 0, positive: 0, seropositive: 0 };
      item.provinces.add(row.province);
      item.rows += 1;
      item.total += Number(row.total) || 0;
      item.positive += Number(row.positive) || 0;
      item.seropositive += Number(row.seropositive) || 0;
      yearMap.set(key, item);
    }

    const provinceMap = new Map<string, { province: string; rows: number; total: number; positive: number; seropositive: number }>();
    for (const row of viewCharts.by_province) {
      if (selectedYears.size && !selectedYears.has(String(row.year))) continue;
      if (selectedProvinces.size && !selectedProvinces.has(row.province)) continue;
      const item = provinceMap.get(row.province) ?? { province: row.province, rows: 0, total: 0, positive: 0, seropositive: 0 };
      item.rows += 1;
      item.total += Number(row.total) || 0;
      item.positive += Number(row.positive) || 0;
      item.seropositive += Number(row.seropositive) || 0;
      provinceMap.set(row.province, item);
    }

    return {
      rows: Object.values(viewCharts).reduce((total, rows) => total + rows.length, 0),
      years: new Set(allRows.map((row) => String(row.year))).size,
      provinces: new Set(allRows.map((row) => row.province)).size,
      methods: new Set(viewCharts.by_method.map((row) => row.label)).size,
      byYear: [...yearMap.values()]
        .map((item) => ({ ...item, provinces: item.provinces.size }))
        .sort((a, b) => a.year.localeCompare(b.year)),
      byProvince: [...provinceMap.values()].sort((a, b) => b.total - a.total || a.province.localeCompare(b.province, 'id'))
    };
  }, [charts, viewCharts, selectedYears, selectedProvinces, allRows]);

  function changeSort(key: SortKey) {
    if (sortKey === key) setSortDir((current) => (current === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir(key === 'label' ? 'asc' : 'desc');
    }
  }

  function sortMark(key: SortKey) {
    if (sortKey !== key) return '';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  }

  function downloadCsv() {
    const rows = searchedRows;
    if (!rows.length) return;
    const quote = (value: unknown) => `"${String(value).replace(/"/g, '""')}"`;
    const header = combinedMode
      ? [DIMENSION_LABEL[activeChartKey ?? 'by_disease'], 'sampel', 'positif_seropositif', 'persen_positif']
      : [DIMENSION_LABEL[activeChartKey ?? 'by_method'], 'sampel', 'positif', 'seropositif', 'persen_positif', 'persen_seropositif'];
    const lines = [header.map(quote).join(',')].concat(
      rows.map((row) => combinedMode
        ? [
            row.label,
            row.total,
            row.positive,
            row.total ? Math.round((row.positive / row.total) * 1000) / 10 : 0
          ].map(quote).join(',')
        : [
            row.label,
            row.total,
            row.positive,
            row.seropositive,
            row.total ? Math.round((row.positive / row.total) * 1000) / 10 : 0,
            row.total ? Math.round((row.seropositive / row.total) * 1000) / 10 : 0
          ].map(quote).join(','))
    );
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `ringkasan_${activeChartKey ?? 'data'}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 4000);
  }

  function downloadChart(key: ViewKey) {
    const canvas = canvasRefs.current[key];
    if (!canvas) return;
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = `grafik_${key}.png`;
    link.click();
  }

  function toggleDimension(key: 'by_method' | 'by_disease') {
    const next = new Set(dimensions);
    if (next.has(key)) {
      if (next.size > 1) next.delete(key);
    } else {
      next.add(key);
    }
    setDimensions(next);
    setTableDim(next.has('by_disease') ? 'by_disease' : 'by_method');
    setTab('multi');
  }

  function selectTab(nextTab: Tab) {
    setTab(nextTab);
    if (nextTab === 'outbreak' && selectedDiseases.size) setSelectedDiseases(new Set());
    if (nextTab !== 'multi' && nextTab !== 'table' && nextTab !== 'coverage' && nextTab !== 'outbreak') {
      setTableDim(nextTab);
    }
  }

  const subtitleParts = [
    selectedYears.size ? `Tahun ${[...selectedYears].sort().join(', ')}` : 'Semua tahun',
    selectedProvinces.size ? [...selectedProvinces].sort((a, b) => a.localeCompare(b, 'id')).join(', ') : 'Semua provinsi'
  ];
  if (selectedDiseases.size) {
    const names = [...selectedDiseases].sort((a, b) => a.localeCompare(b, 'id'));
    const shown = names.slice(0, 2).join(', ');
    const rest = names.length - 2;
    subtitleParts.push(`Penyakit ${shown}${rest > 0 ? ` +${rest} lainnya` : ''}`);
  }
  if (tab === 'table') subtitleParts.push(`${searchedRows.length} baris`);

  return (
    <main className="dash-page charts-page">
      <header className="dash-page-head">
        <div>
          <span className="eyebrow">Ringkasan data · IV Lab</span>
          <h1>Ringkasan Data Pengujian</h1>
          <p>Ringkasan sampel, hasil positif, dan seropositif dari data yang tersimpan di panel admin.</p>
        </div>
        <div className="dash-head-actions">
          <button className="button button-outline" onClick={() => setReloadKey((key) => key + 1)} disabled={loading}>
            {loading ? 'Memuat…' : 'Muat ulang data'}
          </button>
        </div>
      </header>

      {error ? (
        <div className="notice notice-error">
          <strong>Data dashboard belum dapat dimuat.</strong> {error}
        </div>
      ) : null}

      {loading ? (
        <div className="dash-loading panel">
          <span className="loader" aria-hidden="true" />
          <span>Memuat ringkasan data dari server IV Lab…</span>
        </div>
      ) : null}

      {!loading && !error && !hasData ? (
        <div className="dash-empty panel">
          <span className="eyebrow">Belum ada data</span>
          <h2>Data pengujian masih kosong</h2>
          <p>Masuk ke panel admin lalu impor CSV atau tambahkan sampel secara manual. Ringkasan akan muncul otomatis di sini.</p>
        </div>
      ) : null}

      {!loading && !error && hasData ? (
        <>
          <section className="dash-toolbar panel">
            <div className="dash-tabs" role="tablist" aria-label="Pilih tampilan dashboard">
              {visibleChartTabs.map((item) => (
                <button
                  key={item.key}
                  role="tab"
                  aria-selected={tab === item.key}
                  className={`dash-tab${tab === item.key ? ' active' : ''}`}
                  onClick={() => selectTab(item.key)}
                >
                  {item.label}
                </button>
              ))}
              <span className="dash-tab-separator" aria-hidden="true" />
              <button
                role="tab"
                aria-selected={tab === 'table'}
                className={`dash-tab${tab === 'table' ? ' active' : ''}`}
                onClick={() => selectTab('table')}
              >
                Tabel Ringkasan
              </button>
              <button
                role="tab"
                aria-selected={tab === 'coverage'}
                className={`dash-tab${tab === 'coverage' ? ' active' : ''}`}
                onClick={() => selectTab('coverage')}
              >
                Cakupan Data
              </button>
            </div>

            {tab !== 'outbreak' ? (
            <>
            <div className="dash-dimensions" aria-label="Dimensi grafik">
              <span>Dimensi grafik:</span>
              {DIMENSION_KEYS.map((key) => (
                <label key={key} className={dimensions.has(key) ? 'active' : ''}>
                  <input
                    type="checkbox"
                    checked={dimensions.has(key)}
                    onChange={() => toggleDimension(key)}
                  />
                  {DIMENSION_LABELS[key]}
                </label>
              ))}
              <small>Centang keduanya untuk menampilkan dua grafik secara bertumpuk.</small>
            </div>

            <div className="dash-filter-row">
              <MultiSelect
                label="Tahun"
                options={yearOptions.map((item) => ({ value: item, label: item }))}
                selected={selectedYears}
                onChange={setSelectedYears}
                allLabel="Semua tahun"
                disabled={activeChartKey === 'by_year'}
              />
              <MultiSelect
                label="Provinsi"
                options={provinceOptions.map((item) => ({ value: item, label: item }))}
                selected={selectedProvinces}
                onChange={setSelectedProvinces}
                allLabel="Semua provinsi"
                searchable
              />
              <MultiSelect
                label="Kabupaten/Kota"
                options={regencyOptions.map((item) => ({ value: item, label: item }))}
                selected={selectedRegencies}
                onChange={setSelectedRegencies}
                allLabel="Semua kab/kota"
                searchable
              />
              <MultiSelect
                label="Kecamatan"
                options={districtOptions.map((item) => ({ value: item, label: item }))}
                selected={selectedDistricts}
                onChange={setSelectedDistricts}
                allLabel="Semua kecamatan"
                searchable
              />
              <MultiSelect
                label="Penyakit"
                options={diseaseOptions.map((item) => ({ value: item, label: item }))}
                selected={selectedDiseases}
                onChange={setSelectedDiseases}
                allLabel="Semua penyakit"
                searchable
                emptyText="Belum ada penyakit pada data."
              />
              <div className="dash-checks" aria-label="Pilihan seri grafik">
                <label><input type="checkbox" checked={showPositive} onChange={(event) => setShowPositive(event.target.checked)} /> {combinedMode ? 'Positif / seropositif' : 'Positif'}</label>
                {!combinedMode ? (
                  <label><input type="checkbox" checked={showSeropositive} onChange={(event) => setShowSeropositive(event.target.checked)} /> Seropositif</label>
                ) : null}
              </div>
            </div>

            {diseaseMode ? (
              <p className="dash-filter-note">
                Data per penyakit diambil dari hasil uji pada RPC dashboard. Angka positif sudah termasuk seropositif; tampilan metode, hari, dan bulan hanya tersedia saat filter penyakit dinonaktifkan.
              </p>
            ) : null}
            </>
            ) : null}
          </section>

          {tab === 'outbreak' ? (
            <section className="dash-card panel outbreak-card">
              <div className="dash-filter-row outbreak-filter-row">
                <MultiSelect
                  label="Tahun"
                  options={yearOptions.map((item) => ({ value: item, label: item }))}
                  selected={outbreakYears}
                  onChange={setOutbreakYears}
                  allLabel="Semua tahun"
                />
                <MultiSelect
                  label="Provinsi"
                  options={provinceOptions.map((item) => ({ value: item, label: item }))}
                  selected={outbreakProvinces}
                  onChange={setOutbreakProvinces}
                  allLabel="Semua provinsi"
                  searchable
                />
                <MultiSelect
                  label="Penyakit"
                  options={diseaseOptions.map((item) => ({ value: item, label: item }))}
                  selected={outbreakDiseases}
                  onChange={setOutbreakDiseases}
                  allLabel="Semua penyakit"
                  searchable
                  emptyText="Belum ada penyakit pada data."
                />
                <MultiSelect
                  label="Bulan"
                  options={MONTH_OPTIONS}
                  selected={outbreakMonths}
                  onChange={setOutbreakMonths}
                  allLabel="Semua bulan"
                />
                <div className="dash-checks" aria-label="Pilihan grafik outbreak">
                  <label><input type="checkbox" checked={outbreakShowPositive} onChange={(event) => setOutbreakShowPositive(event.target.checked)} /> Positif</label>
                  <label><input type="checkbox" checked={outbreakShowSeropositive} onChange={(event) => setOutbreakShowSeropositive(event.target.checked)} /> Seropositif</label>
                </div>
              </div>
              <div className="outbreak-chart-head">
                <h2>Batas Outbreak (Rata-rata + 2 SD)</h2>
                <p>
                  {outbreak.positive.first} s/d {outbreak.positive.last} · {outbreak.yearLabel} · {outbreak.provinceLabel} · {outbreak.diseaseLabel} · {outbreak.targets} target uji
                </p>
              </div>

              {!outbreakShowPositive && !outbreakShowSeropositive ? (
                <div className="dash-empty compact">Centang Positif dan/atau Seropositif untuk menampilkan grafik.</div>
              ) : (
                <div className="outbreak-series-grid">
                  {outbreakShowPositive ? (
                    <div className="outbreak-series panel">
                      <div className="outbreak-series-head">
                        <div>
                          <h3>Positif – {outbreak.provinceLabel}</h3>
                          <p>{outbreak.isYearly ? 'Tahun terakhir' : 'Bulan terakhir'}: <b>{numberFormat.format(outbreak.positive.lastValue)} kasus ({outbreak.positive.isOutbreak ? 'OUTBREAK' : 'AMAN'})</b></p>
                        </div>
                        <button
                          className="button button-outline button-small"
                          onClick={() => {
                            const canvas = outbreakPositiveCanvasRef.current;
                            if (!canvas) return;
                            const link = document.createElement('a');
                            link.href = canvas.toDataURL('image/png');
                            link.download = `batas_outbreak_positif_${fileSlugText(`${outbreak.provinceLabel}_${outbreak.diseaseLabel}`)}.png`;
                            link.click();
                          }}
                          disabled={!outbreak.positive.series.length}
                        >
                          Unduh PNG
                        </button>
                      </div>
                      {outbreak.positive.series.length ? (
                        <>
                          <div className="outbreak-chart-wrap">
                            <canvas ref={outbreakPositiveCanvasRef} role="img" aria-label="Grafik batas outbreak kasus positif" />
                          </div>
                          <div className="outbreak-legend" aria-label="Legenda batas outbreak positif">
                            <span><i className="outbreak-legend-mean" />Rata-rata ({numberFormat.format(Math.round(outbreak.positive.mean))})</span>
                            <span><i className="outbreak-legend-sd1" />+1 SD ({numberFormat.format(Math.round(outbreak.positive.upper1))})</span>
                            <span><i className="outbreak-legend-sd2" />+2 SD ({numberFormat.format(Math.round(outbreak.positive.upper2))})</span>
                            <span><i className="outbreak-legend-case" />Kasus positif</span>
                          </div>
                          <OutbreakTable data={outbreak.positive} name="Positif" />
                        </>
                      ) : (
                        <div className="dash-empty compact">Belum ada data {outbreak.isYearly ? 'tahunan' : 'bulanan'} untuk filter ini.</div>
                      )}
                    </div>
                  ) : null}

                  {outbreakShowSeropositive ? (
                    <div className="outbreak-series panel">
                      <div className="outbreak-series-head">
                        <div>
                          <h3>Seropositif – {outbreak.provinceLabel}</h3>
                          <p>{outbreak.isYearly ? 'Tahun terakhir' : 'Bulan terakhir'}: <b>{numberFormat.format(outbreak.seropositive.lastValue)} kasus ({outbreak.seropositive.isOutbreak ? 'OUTBREAK' : 'AMAN'})</b></p>
                        </div>
                        <button
                          className="button button-outline button-small"
                          onClick={() => {
                            const canvas = outbreakSeroCanvasRef.current;
                            if (!canvas) return;
                            const link = document.createElement('a');
                            link.href = canvas.toDataURL('image/png');
                            link.download = `batas_outbreak_seropositif_${fileSlugText(`${outbreak.provinceLabel}_${outbreak.diseaseLabel}`)}.png`;
                            link.click();
                          }}
                          disabled={!outbreak.seropositive.series.length}
                        >
                          Unduh PNG
                        </button>
                      </div>
                      {outbreak.seropositive.series.length ? (
                        <>
                          <div className="outbreak-chart-wrap">
                            <canvas ref={outbreakSeroCanvasRef} role="img" aria-label="Grafik batas outbreak kasus seropositif" />
                          </div>
                          <div className="outbreak-legend" aria-label="Legenda batas outbreak seropositif">
                            <span><i className="outbreak-legend-mean" />Rata-rata ({numberFormat.format(Math.round(outbreak.seropositive.mean))})</span>
                            <span><i className="outbreak-legend-sd1" />+1 SD ({numberFormat.format(Math.round(outbreak.seropositive.upper1))})</span>
                            <span><i className="outbreak-legend-sd2" />+2 SD ({numberFormat.format(Math.round(outbreak.seropositive.upper2))})</span>
                            <span><i className="outbreak-legend-case" />Kasus seropositif</span>
                          </div>
                          <OutbreakTable data={outbreak.seropositive} name="Seropositif" />
                        </>
                      ) : (
                        <div className="dash-empty compact">Belum ada data {outbreak.isYearly ? 'tahunan' : 'bulanan'} untuk filter ini.</div>
                      )}
                    </div>
                  ) : null}
                </div>
              )}
            </section>
          ) : null}

          {tab !== 'outbreak' ? (
          <section className={`dash-kpis${diseaseMode ? ' is-disease' : ''}`} aria-label="Ringkasan angka">
            <article className="dash-kpi">
              <span>Total sampel</span>
              <strong>{numberFormat.format(kpi.total)}</strong>
              <small>
                {selectedDiseases.size === 1
                  ? `sampel diuji untuk ${[...selectedDiseases][0]}`
                  : diseaseMode
                    ? 'sampel per penyakit'
                    : 'sampel unik per provinsi'}
              </small>
            </article>
            <article className="dash-kpi positive">
              <span>{combinedMode ? 'Positif / seropositif' : 'Positif'}</span>
              <strong>{numberFormat.format(kpi.positive)}</strong>
              <small>{percent(kpi.positive, kpi.total)} dari sampel</small>
            </article>
            {!combinedMode ? (
              <article className="dash-kpi sero">
                <span>Seropositif</span>
                <strong>{numberFormat.format(kpi.seropositive)}</strong>
                <small>{percent(kpi.seropositive, kpi.total)} dari sampel</small>
              </article>
            ) : null}
            <article className="dash-kpi">
              <span>Wilayah data</span>
              <strong>{numberFormat.format(kpi.rows)}</strong>
              <small>baris provinsi/tahun</small>
            </article>
          </section>
          ) : null}

          {tab !== 'table' && tab !== 'coverage' && tab !== 'outbreak' ? (
            <div className="dash-chart-stack">
              {chartKeys.map((key) => {
                const chartRows = groupedByKey[key] ?? [];
                const horizontal = key === 'by_disease' || key === 'by_method' || key === 'by_province' || key === 'by_regency' || key === 'by_district';
                const keyStatsMode = selectedDiseases.size > 0 || key === 'by_disease' || key === 'by_regency' || key === 'by_district';
                return (
                  <section className="dash-card panel" key={key}>
                    <div className="dash-card-head">
                      <div>
                        <h2>{VIEW_TITLES[key]}</h2>
                        <p>{subtitleParts.join(' · ')}</p>
                      </div>
                      <button
                        className="button button-outline button-small"
                        onClick={() => downloadChart(key)}
                        disabled={!chartRows.length}
                      >
                        Unduh grafik PNG
                      </button>
                    </div>
                    {chartRows.length ? (
                      <>
                        <div className="dash-chart-wrap" style={{ height: chartHeightFor(chartRows.length, horizontal) }}>
                          <canvas
                            ref={(element) => { canvasRefs.current[key] = element; }}
                            aria-label={VIEW_TITLES[key]}
                            role="img"
                          />
                        </div>
                        <p className="dash-chart-note">
                          {keyStatsMode
                            ? 'Abu-abu = jumlah sampel · Merah = positif/seropositif. Data per penyakit diambil dari hasil uji pada RPC dashboard.'
                            : 'Abu-abu = jumlah sampel · Merah = positif · Hijau = seropositif. Angka dihitung dari sampel unik.'}
                        </p>
                      </>
                    ) : (
                      <div className="dash-empty compact">Tidak ada data untuk kombinasi filter ini.</div>
                    )}
                  </section>
                );
              })}
            </div>
          ) : null}

          {tab !== 'coverage' && tab !== 'outbreak' ? (
            <section className="dash-card panel">
              <div className="dash-card-head">
                <div>
                  <h2>Tabel ringkasan per {DIMENSION_LABEL[tableDim].toLowerCase()}</h2>
                  <p>{subtitleParts.join(' · ')}</p>
                </div>
                <label className="dash-inline-select">
                  Kelompokkan
                  <select value={tableDim} onChange={(event) => setTableDim(event.target.value as ViewKey)}>
                    {(Object.keys(DIMENSION_LABEL) as ViewKey[]).map((key) => (
                      <option key={key} value={key}>{DIMENSION_LABEL[key]}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="dash-table-toolbar">
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Cari kategori…"
                  aria-label="Cari baris tabel"
                />
                <div className="dash-table-actions">
                  <span>{numberFormat.format(searchedRows.length)} baris</span>
                  <button className="button button-outline button-small" onClick={downloadCsv} disabled={!searchedRows.length}>
                    Unduh CSV
                  </button>
                </div>
              </div>

              <div className="dash-table-wrap">
                <table className="dash-table">
                  <thead>
                    <tr>
                      <th><button className="dash-th-sort" onClick={() => changeSort('label')}>{DIMENSION_LABEL[activeChartKey ?? 'by_method']}{sortMark('label')}</button></th>
                      <th className="n"><button className="dash-th-sort" onClick={() => changeSort('total')}>Sampel{sortMark('total')}</button></th>
                      <th className="n"><button className="dash-th-sort" onClick={() => changeSort('positive')}>{combinedMode ? 'Positif / seropositif' : 'Positif'}{sortMark('positive')}</button></th>
                      {displayStatsMode ? (
                        <>
                          <th className="n"><button className="dash-th-sort" onClick={() => changeSort('mean')}>Rata-rata{sortMark('mean')}</button></th>
                          <th className="n"><button className="dash-th-sort" onClick={() => changeSort('sd')}>SD{sortMark('sd')}</button></th>
                          <th className="n"><button className="dash-th-sort" onClick={() => changeSort('upper')}>Batas mean + 2SD{sortMark('upper')}</button></th>
                        </>
                      ) : null}
                      {!combinedMode ? (
                        <>
                          <th className="n"><button className="dash-th-sort" onClick={() => changeSort('seropositive')}>Seropositif{sortMark('seropositive')}</button></th>
                          <th className="n">% Positif</th>
                          <th className="n">% Seropositif</th>
                        </>
                      ) : (
                        <th className="n">% Positif / seropositif</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((row) => (
                      <tr key={row.key}>
                        <td className="cell-wrap">{row.label}</td>
                        <td className="n">{numberFormat.format(row.total)}</td>
                        <td className="n">{numberFormat.format(row.positive)}</td>
                        {displayStatsMode ? (
                          <>
                            <td className="n">{numberFormat.format(Math.round(row.mean))}</td>
                            <td className="n">{numberFormat.format(Math.round(row.sd))}</td>
                            <td className="n">{numberFormat.format(Math.round(row.upper))}</td>
                          </>
                        ) : null}
                        {!combinedMode ? (
                          <>
                            <td className="n">{numberFormat.format(row.seropositive)}</td>
                            <td className="n">{percent(row.positive, row.total)}</td>
                            <td className="n">{percent(row.seropositive, row.total)}</td>
                          </>
                        ) : (
                          <td className="n">{percent(row.positive, row.total)}</td>
                        )}
                      </tr>
                    ))}
                    {!pageRows.length ? (
                      <tr>
                        <td colSpan={displayStatsMode ? (combinedMode ? 7 : 9) : diseaseMode ? 4 : 6} className="dash-table-empty">Tidak ada baris yang cocok dengan pencarian.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              <div className="dash-pager">
                <span>Menampilkan {searchedRows.length ? (currentPage - 1) * PAGE_SIZE + 1 : 0}–{Math.min(currentPage * PAGE_SIZE, searchedRows.length)} dari {numberFormat.format(searchedRows.length)}</span>
                <div>
                  <button className="button button-outline button-small" onClick={() => setTablePage((page) => Math.max(1, page - 1))} disabled={currentPage <= 1}>Sebelumnya</button>
                  <span>Halaman {currentPage} / {pageCount}</span>
                  <button className="button button-outline button-small" onClick={() => setTablePage((page) => Math.min(pageCount, page + 1))} disabled={currentPage >= pageCount}>Berikutnya</button>
                </div>
              </div>
            </section>
          ) : (
            <section className="dash-card panel">
              <div className="dash-card-head">
                <div>
                  <h2>Cakupan data tersimpan</h2>
                  <p>Pemeriksaan cepat jumlah baris agregat, tahun, provinsi, dan metode uji.</p>
                </div>
              </div>

              <div className="dash-coverage-kpis">
                <div><span>Baris agregat</span><strong>{numberFormat.format(coverage.rows)}</strong></div>
                <div><span>Tahun</span><strong>{numberFormat.format(coverage.years)}</strong></div>
                <div><span>Provinsi</span><strong>{numberFormat.format(coverage.provinces)}</strong></div>
                <div><span>Metode uji</span><strong>{numberFormat.format(coverage.methods)}</strong></div>
              </div>

              <div className="dash-coverage-grid">
                <div>
                  <h3>Per tahun</h3>
                  <div className="dash-table-wrap">
                    <table className="dash-table">
                      <thead><tr><th>Tahun</th><th className="n">Provinsi</th><th className="n">Baris</th><th className="n">Sampel</th><th className="n">Positif</th></tr></thead>
                      <tbody>
                        {coverage.byYear.map((row) => (
                          <tr key={row.year}>
                            <td>{row.year}</td>
                            <td className="n">{numberFormat.format(row.provinces)}</td>
                            <td className="n">{numberFormat.format(row.rows)}</td>
                            <td className="n">{numberFormat.format(row.total)}</td>
                            <td className="n">{numberFormat.format(row.positive)}</td>
                          </tr>
                        ))}
                        {!coverage.byYear.length ? <tr><td colSpan={5} className="dash-table-empty">Belum ada data.</td></tr> : null}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div>
                  <h3>Per provinsi</h3>
                  <div className="dash-table-wrap">
                    <table className="dash-table">
                      <thead><tr><th>Provinsi</th><th className="n">Sampel</th><th className="n">Positif</th><th className="n">Seropositif</th></tr></thead>
                      <tbody>
                        {coverage.byProvince.map((row) => (
                          <tr key={row.province}>
                            <td>{row.province}</td>
                            <td className="n">{numberFormat.format(row.total)}</td>
                            <td className="n">{numberFormat.format(row.positive)}</td>
                            <td className="n">{numberFormat.format(row.seropositive)}</td>
                          </tr>
                        ))}
                        {!coverage.byProvince.length ? <tr><td colSpan={4} className="dash-table-empty">Belum ada data.</td></tr> : null}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="dash-coverage-note">
                <strong>Catatan penghitungan.</strong> Satu sampel dihitung sekali per provinsi, sehingga total pada kartu ringkasan tidak menggandakan sampel yang diuji dengan beberapa metode. Angka per metode uji dapat lebih besar dari total sampel karena satu sampel bisa memiliki beberapa metode pemeriksaan.
              </div>
            </section>
          )}
        </>
      ) : null}
    </main>
  );
}
