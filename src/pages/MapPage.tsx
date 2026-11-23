import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { getDashboardData } from '../api/client';
import MultiSelect from '../components/MultiSelect';
import { numberFormat } from '../lib/constants';
import {
  GEO_SCALE,
  KAB_BY_NAME,
  LAT_ORIGIN,
  LON_ORIGIN,
  PETA,
  PETA_KAB,
  PETA_KEC,
  PETA_PROV,
  LEVEL_LABEL,
  STATUS_COLOR,
  STATUS_LABEL,
  aggregateYears,
  allDiseases,
  bboxOfPaths,
  buildYearData,
  centroids,
  diseaseSubtypes,
  emptyStat,
  pathBBox,
  polygonGeometry,
  statusOf,
  type BBox,
  type Level,
  type PetaKec,
  type Stat,
  type StatusKey
} from '../lib/peta';
import { downloadCsv, downloadJson, exportMapPng, type LegendItem } from '../lib/mapExport';
import { exportQgisPackage } from '../lib/qgisExport';
import type { ChartKey, ChartRow, MapRow } from '../types';
import '../styles/map.css';

type SortKey = 'name' | 'm' | 'sp' | 'sg' | 'so';

type RegionRow = {
  index: number;
  name: string;
  pv: string;
  b: string;
  stat: Stat;
  status: StatusKey;
};

type LabelItem = {
  text: string;
  x: number;
  y: number;
  size: number;
  weight: number;
  area: number;
  spacing?: number;
  kind?: 'kec';
};

const PAGE_SIZE = 12;
const EMPTY = emptyStat();
const STATUS_VAR: Record<StatusKey, string> = { p: 'pos', g: 'neg', o: 'unk', b: 'nov' };

function compactYears(years: number[]): string {
  if (!years.length) return 'belum ada data';
  if (years.length <= 3) return years.join(', ');
  return `${years[0]}–${years[years.length - 1]}`;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
function monthLabel(value: string): string {
  const parts = value.split('-');
  if (parts.length !== 2) return value;
  return `${MONTH_NAMES[Number(parts[1]) - 1] ?? parts[1]} ${parts[0]}`;
}

function decimal2(value: number): string {
  return value.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type OutbreakView = {
  province: string;
  areaLabel: string;
  scopeLabel: string;
  series: Array<[string, number]>;
  mean: number;
  sd: number;
  upper1: number;
  upper2: number;
  lastValue: number;
  targets: number;
  maximum: number;
  first: string;
  last: string;
  isOutbreak: boolean;
  isYearly: boolean;
};

function buildMapOutbreak(
  rows: ChartRow[],
  province: string,
  regency: string | null,
  district: string | null,
  selectedYears: Set<number>,
  mapRows: MapRow[],
  yearly = false
): OutbreakView | null {
  const monthly = new Map<string, number>();
  rows.forEach((row) => {
    if (row.province !== province) return;
    if (regency && row.regency !== regency) return;
    if (district && row.district !== district) return;
    if (selectedYears.size && !selectedYears.has(Number(row.year))) return;
    const label = String(row.label ?? '');
    const key = yearly ? label.split('-')[0] : label;
    monthly.set(key, (monthly.get(key) ?? 0) + (Number(row.positive) || 0));
  });
  if (!monthly.size) return null;

  const series = [...monthly.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const values = series.map(([, value]) => value);
  const count = values.length;
  const mean = values.reduce((sum, value) => sum + value, 0) / count;
  const variance = count > 1 ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (count - 1) : 0;
  const sd = Math.sqrt(variance);
  const upper1 = mean + sd;
  const upper2 = mean + 2 * sd;
  const lastValue = values[count - 1];
  const targets = new Set(
    mapRows
      .filter((row) =>
        row.province === province &&
        (!regency || row.regency === regency) &&
        (!district || row.district === district) &&
        row.target
      )
      .map((row) => row.target as string)
  ).size;
  const areaLabel = district || regency || province;
  const scopeLabel = district
    ? `${district} · ${regency ?? ''} · ${province}`
    : regency
      ? `${regency} · ${province}`
      : province;
  return {
    province,
    areaLabel,
    scopeLabel,
    series,
    mean,
    sd,
    upper1,
    upper2,
    lastValue,
    targets,
    maximum: Math.max(...values, upper2, 1),
    first: yearly ? series[0][0] : monthLabel(series[0][0]),
    last: yearly ? series[series.length - 1][0] : monthLabel(series[series.length - 1][0]),
    isOutbreak: upper2 > 0 && lastValue >= upper2,
    isYearly: yearly
  };
}

function OutbreakSvg({ data }: { data: OutbreakView }) {
  const left = 46;
  const right = 14;
  const top = 16;
  const baseline = 178;
  const width = 520;
  const height = 226;
  const plotWidth = width - left - right;
  const plotHeight = baseline - top;
  const yOf = (value: number) => baseline - (value / data.maximum) * plotHeight;
  const slot = plotWidth / data.series.length;
  const barWidth = Math.max(6, Math.min(26, slot * 0.55));

  return (
    <svg className="map-outbreak-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Grafik batas outbreak rata-rata plus dua standar deviasi">
      {[0, 0.5, 1].map((factor) => {
        const value = data.maximum * factor;
        const y = yOf(value);
        return (
          <g key={factor}>
            <line x1={left} y1={y} x2={width - right} y2={y} className="map-outbreak-grid" />
            <text x={left - 7} y={y + 3} textAnchor="end" className="map-outbreak-tick">{numberFormat.format(Math.round(value))}</text>
          </g>
        );
      })}
      {data.series.map(([label, value], index) => {
        const x = left + index * slot + (slot - barWidth) / 2;
        const y = yOf(value);
        return (
          <g key={label}>
            <rect x={x} y={y} width={barWidth} height={Math.max(0, baseline - y)} rx="2" className="map-outbreak-bar" />
            <text x={x + barWidth / 2} y={baseline + 14} textAnchor="middle" className="map-outbreak-month">{monthLabel(label).split(' ')[0]}</text>
          </g>
        );
      })}
      <line x1={left} y1={yOf(data.mean)} x2={width - right} y2={yOf(data.mean)} className="map-outbreak-mean" />
      <line x1={left} y1={yOf(data.upper1)} x2={width - right} y2={yOf(data.upper1)} className="map-outbreak-sd1" />
      <line x1={left} y1={yOf(data.upper2)} x2={width - right} y2={yOf(data.upper2)} className="map-outbreak-sd2" />
      <text x={left} y={baseline + 32} className="map-outbreak-axis">{data.first} s/d {data.last}</text>
    </svg>
  );
}

function OutbreakBlock({ label, data }: { label: string; data: OutbreakView }) {
  const statusColor = data.isOutbreak ? 'var(--pos)' : 'var(--neg)';
  return (
    <div className="map-outbreak-block">
      <div className="map-outbreak-block-head">
        <div className="map-outbreak-block-title">
          <span>{label}</span>
          <strong>{data.areaLabel}</strong>
        </div>
        <p className="map-outbreak-period">
          {data.scopeLabel} · {data.first} s/d {data.last} · {data.targets} target uji
        </p>
        <div className="map-outbreak-status-row">
          <span className="map-outbreak-status-label">{data.isYearly ? 'Tahun terakhir' : 'Bulan terakhir'}</span>
          <span className="map-outbreak-status-value">
            {numberFormat.format(data.lastValue)} kasus
          </span>
          <span
            className={`map-outbreak-status-badge ${data.isOutbreak ? 'is-outbreak' : 'is-safe'}`}
            style={{ color: statusColor }}
          >
            {data.isOutbreak ? 'OUTBREAK' : 'AMAN'}
          </span>
        </div>
      </div>
      <OutbreakSvg data={data} />
      <div className="map-outbreak-stats">
        <span className="map-outbreak-stat">
          <i className="mean" />Rata-rata <b>{numberFormat.format(Math.round(data.mean))}</b>
        </span>
        <span className="map-outbreak-stat">
          <i className="sd1" />+1 SD <b>{numberFormat.format(Math.round(data.upper1))}</b>
        </span>
        <span className="map-outbreak-stat">
          <i className="sd2" />+2 SD <b>{numberFormat.format(Math.round(data.upper2))}</b>
        </span>
      </div>
      <p className="map-outbreak-note">
        Batang abu = kasus positif per {data.isYearly ? 'tahun' : 'bulan'}. Garis hitam = rata-rata; oranye putus-putus = +1 SD; merah titik-titik = batas outbreak (+2 SD).
      </p>
    </div>
  );
}

function TooltipOutbreakSvg({ data }: { data: OutbreakView }) {
  const left = 26;
  const right = 8;
  const top = 8;
  const baseline = 60;
  const width = 250;
  const height = 78;
  const plotWidth = width - left - right;
  const plotHeight = baseline - top;
  const yOf = (value: number) => baseline - (value / data.maximum) * plotHeight;
  const slot = plotWidth / data.series.length;
  const barWidth = Math.max(5, Math.min(16, slot * 0.52));

  return (
    <svg className="map-tooltip-spark" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Grafik kasus positif per bulan dan batas outbreak">
      <text x={left - 4} y={top + 4} textAnchor="end" className="map-spark-tick">{numberFormat.format(Math.round(data.maximum))}</text>
      <text x={left - 4} y={baseline + 3} textAnchor="end" className="map-spark-tick">0</text>
      <line x1={left} y1={baseline} x2={width - right} y2={baseline} className="map-spark-axis" />
      {data.series.map(([label, value], index) => {
        const x = left + index * slot + (slot - barWidth) / 2;
        const y = yOf(value);
        const className = data.upper2 > 0 && value >= data.upper2
          ? 'map-spark-bar outbreak'
          : data.upper1 > 0 && value >= data.upper1
            ? 'map-spark-bar warning'
            : 'map-spark-bar';
        return <rect key={label} x={x} y={y} width={barWidth} height={Math.max(0, baseline - y)} rx="1.5" className={className} />;
      })}
      <line x1={left} y1={yOf(data.mean)} x2={width - right} y2={yOf(data.mean)} className="map-spark-mean" />
      <line x1={left} y1={yOf(data.upper1)} x2={width - right} y2={yOf(data.upper1)} className="map-spark-sd1" />
      <line x1={left} y1={yOf(data.upper2)} x2={width - right} y2={yOf(data.upper2)} className="map-spark-sd2" />
      <text x={left} y={height - 4} className="map-spark-label">{data.first}</text>
      <text x={width - right} y={height - 4} textAnchor="end" className="map-spark-label">{data.last}</text>
    </svg>
  );
}

function fitViewBox(box: number[], width: number, height: number): BBox {
  const padding = 18;
  const safe = box && box.length === 4 && box.every((value) => Number.isFinite(value)) ? box : [0, 0, 1600, 960];
  const boxWidth = safe[2] - safe[0] + padding * 2;
  const boxHeight = safe[3] - safe[1] + padding * 2;
  const aspect = width > 0 && height > 0 ? width / height : 1.4;
  let viewWidth = boxWidth;
  let viewHeight = boxHeight;
  if (viewWidth / viewHeight < aspect) viewWidth = viewHeight * aspect;
  else viewHeight = viewWidth / aspect;
  return [
    safe[0] - padding - (viewWidth - boxWidth) / 2,
    safe[1] - padding - (viewHeight - boxHeight) / 2,
    viewWidth,
    viewHeight
  ];
}

function fileSlug(value: string): string {
  return value
    .replace(/[^\w-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 70);
}

export default function MapPage({ theme }: { theme: 'light' | 'dark' }) {
  const [rows, setRows] = useState<MapRow[] | null>(null);
  const [charts, setCharts] = useState<Record<ChartKey, ChartRow[]> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedYears, setSelectedYears] = useState<Set<number>>(new Set());
  const [diseases, setDiseases] = useState<Set<string>>(new Set());
  const [diseaseQuery, setDiseaseQuery] = useState('');
  const [level, setLevel] = useState<Level>('kab');
  const [provinces, setProvinces] = useState<Set<string>>(new Set());
  const [regencies, setRegencies] = useState<Set<string>>(new Set());
  const [districts, setDistricts] = useState<Set<string>>(new Set());
  const [statuses, setStatuses] = useState<Set<string>>(new Set());
  const [tableQuery, setTableQuery] = useState('');
  const [tablePage, setTablePage] = useState(1);
  const [sortKey, setSortKey] = useState<SortKey>('m');
  const [sortAsc, setSortAsc] = useState(false);
  const [presentation, setPresentation] = useState(false);
  const [toast, setToast] = useState('');
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [viewBox, setViewBox] = useState<BBox>([0, 0, 1600, 960]);
  const [hover, setHover] = useState<{ index: number; x: number; y: number } | null>(null);
  const [pinnedIndex, setPinnedIndex] = useState<number | null>(null);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const mapWrapRef = useRef<HTMLDivElement | null>(null);
  const diseaseRef = useRef<HTMLDetailsElement | null>(null);
  const exportRef = useRef<HTMLDetailsElement | null>(null);
  const fittedRef = useRef(false);
  const pointers = useRef(new Map<number, [number, number]>());
  const dragDistance = useRef(0);

  /* -------------------------------------------------------------- */
  /* Data                                                            */
  /* -------------------------------------------------------------- */

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError('');
      const { data, error: loadError } = await getDashboardData();
      if (cancelled) return;
      if (loadError || !data?.charts) {
        setRows(null);
        setCharts(null);
        setError(loadError ?? 'Data peta belum tersedia dari server IV Lab.');
        setLoading(false);
        return;
      }
      const mapRows = Array.isArray(data.map) ? data.map : [];
      setRows(mapRows);
      setCharts(data.charts);
      const nextYears = new Set(
        mapRows.map((row) => Number(row.year)).filter((year) => Number.isFinite(year))
      );
      setSelectedYears(nextYears);
      setDiseases(new Set());
      setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const yearData = useMemo(() => buildYearData(rows ?? []), [rows]);
  const years = useMemo(() => [...yearData.keys()].sort((a, b) => a - b), [yearData]);
  const yearTotals = useMemo(() => {
    const result = new Map<number, number>();
    yearData.forEach((data, year) => {
      let total = 0;
      data.prov.forEach((stat) => {
        total += stat.m || stat.n;
      });
      result.set(year, total);
    });
    return result;
  }, [yearData]);
  const diseaseOptions = useMemo(() => allDiseases(yearData), [yearData]);
  const aggregate = useMemo(
    () => aggregateYears(yearData, selectedYears, diseases),
    [yearData, selectedYears, diseases]
  );

  useEffect(() => {
    if (!years.length) return;
    setSelectedYears((previous) => {
      if (!previous.size) return new Set(years);
      const valid = [...previous].filter((year) => years.includes(year));
      if (valid.length === previous.size) return previous;
      return new Set(valid.length ? valid : years);
    });
  }, [years]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  /* -------------------------------------------------------------- */
  /* Layout and map viewport                                         */
  /* -------------------------------------------------------------- */

  useEffect(() => {
    const element = mapWrapRef.current;
    if (!element) return;
    const update = () => setSize({ w: element.clientWidth, h: element.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [loading, rows, error]);

  useEffect(() => {
    if (size.w > 0 && size.h > 0 && !fittedRef.current) {
      setViewBox(fitViewBox(PETA.bb[''], size.w, size.h));
      fittedRef.current = true;
    }
  }, [size]);

  function fitBox(box: number[]) {
    setViewBox(fitViewBox(box, size.w, size.h));
  }

  function zoom(factor: number, centerX?: number, centerY?: number) {
    setViewBox(([x, y, w, h]) => {
      const width = size.w || 1;
      const height = size.h || 1;
      const px = centerX ?? width / 2;
      const py = centerY ?? height / 2;
      const mapX = x + (px / width) * w;
      const mapY = y + (py / height) * h;
      return [mapX - (mapX - x) * factor, mapY - (mapY - y) * factor, w * factor, h * factor];
    });
  }

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const handler = (event: WheelEvent) => {
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      zoom(
        event.deltaY > 0 ? 1.2 : 0.83,
        event.clientX - rect.left,
        event.clientY - rect.top
      );
    };
    svg.addEventListener('wheel', handler, { passive: false });
    return () => svg.removeEventListener('wheel', handler);
    // The listener reads the latest viewport through the state updater.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w, size.h]);

  function handlePointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, [event.clientX, event.clientY]);
    dragDistance.current = 0;
  }

  function handlePointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();

    if (pointers.current.size === 1) {
      const dx = event.clientX - previous[0];
      const dy = event.clientY - previous[1];
      dragDistance.current += Math.abs(dx) + Math.abs(dy);
      if (dx || dy) {
        setViewBox(([x, y, w, h]) => [
          x - (dx / rect.width) * w,
          y - (dy / rect.height) * h,
          w,
          h
        ]);
      }
      pointers.current.set(event.pointerId, [event.clientX, event.clientY]);
      return;
    }

    const before = [...pointers.current.values()];
    const oldDistance = Math.hypot(before[0][0] - before[1][0], before[0][1] - before[1][1]);
    pointers.current.set(event.pointerId, [event.clientX, event.clientY]);
    const after = [...pointers.current.values()];
    const newDistance = Math.hypot(after[0][0] - after[1][0], after[0][1] - after[1][1]);
    if (oldDistance && newDistance) {
      zoom(
        oldDistance / newDistance,
        (after[0][0] + after[1][0]) / 2 - rect.left,
        (after[0][1] + after[1][1]) / 2 - rect.top
      );
    }
  }

  function handlePointerUp(event: ReactPointerEvent<SVGSVGElement>) {
    pointers.current.delete(event.pointerId);
  }

  /* -------------------------------------------------------------- */
  /* Regions and table                                               */
  /* -------------------------------------------------------------- */

  const regions = useMemo<RegionRow[]>(() => {
    if (level === 'prov') {
      return PETA_PROV.map((row, index) => {
        const stat = aggregate.prov.get(row.pv) ?? EMPTY;
        return { index, name: row.pv, pv: row.pv, b: '', stat, status: statusOf(stat) };
      });
    }
    if (level === 'kab') {
      return PETA_KAB.map((row, index) => {
        const stat = aggregate.kab.get(row.b) ?? EMPTY;
        return { index, name: row.b, pv: row.pv, b: row.b, stat, status: statusOf(stat) };
      });
    }
    return PETA_KEC.map((row, index) => {
      const stat = aggregate.kec.get(index) ?? EMPTY;
      return { index, name: row.k, pv: row.pv, b: row.b, stat, status: statusOf(stat) };
    });
  }, [level, aggregate]);

  const scopedRegions = useMemo(
    () =>
      regions.filter((region) => {
        if (provinces.size && !provinces.has(region.pv)) return false;
        if (regencies.size && !regencies.has(region.b)) return false;
        if (level === 'kec' && districts.size && !districts.has(String(region.index))) return false;
        return true;
      }),
    [regions, provinces, regencies, districts, level]
  );

  const statusCounts = useMemo(() => {
    const counts: Record<StatusKey, number> = { p: 0, g: 0, o: 0, b: 0 };
    scopedRegions.forEach((region) => {
      counts[region.status] += 1;
    });
    return counts;
  }, [scopedRegions]);

  const sampleTotals = useMemo(() => {
    const result = { m: 0, sp: 0, sg: 0, so: 0 };
    const add = (stat: Stat) => {
      result.m += stat.m;
      result.sp += stat.sp;
      result.sg += stat.sg;
      result.so += stat.so;
    };

    if (districts.size) {
      districts.forEach((value) => add(aggregate.kec.get(Number(value)) ?? EMPTY));
      return result;
    }
    if (regencies.size) {
      regencies.forEach((name) => add(aggregate.kab.get(name) ?? EMPTY));
      return result;
    }
    aggregate.prov.forEach((stat, province) => {
      if (provinces.size && !provinces.has(province)) return;
      add(stat);
    });
    return result;
  }, [aggregate, provinces, regencies, districts]);

  const tableRows = useMemo(() => {
    const term = tableQuery.trim().toLowerCase();
    const filtered = scopedRegions.filter((region) => {
      if (statuses.size && !statuses.has(region.status)) return false;
      if (!term) return true;
      return `${region.name} ${region.pv} ${region.b}`.toLowerCase().includes(term);
    });
    const direction = sortAsc ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name, 'id', { numeric: true }) * direction;
      return (a.stat[sortKey] - b.stat[sortKey]) * direction || a.name.localeCompare(b.name, 'id');
    });
  }, [scopedRegions, statuses, tableQuery, sortKey, sortAsc]);

  useEffect(() => {
    setTablePage(1);
  }, [level, provinces, regencies, districts, statuses, tableQuery, sortKey, sortAsc, selectedYears, diseases]);

  const hasOther = scopedRegions.some((region) => region.stat.so > 0);
  const pageCount = Math.max(1, Math.ceil(tableRows.length / PAGE_SIZE));
  const currentPage = Math.min(tablePage, pageCount);
  const pageRows = tableRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  /* -------------------------------------------------------------- */
  /* Labels and legend                                               */
  /* -------------------------------------------------------------- */

  const labels = useMemo(() => {
    const { kec: kecCentroids, kab: kabCentroids, prov: provCentroids } = centroids();
    const scale = Math.min(size.w / viewBox[2], size.h / viewBox[3]) || 1;
    const showProv = level === 'prov' || scale < 0.75;
    const showKab = !showProv && (level === 'kab' || level === 'kec') && scale < 1.7;
    const showKec = !showProv && level === 'kec' && scale >= 1.7;
    const items: LabelItem[] = [];
    const visible = (x: number, y: number) =>
      x >= viewBox[0] && x <= viewBox[0] + viewBox[2] && y >= viewBox[1] && y <= viewBox[1] + viewBox[3];

    if (showProv) {
      Object.entries(provCentroids).forEach(([name, point]) => {
        if (provinces.size && !provinces.has(name)) return;
        if (!visible(point.x, point.y)) return;
        items.push({ text: name.toUpperCase(), x: point.x, y: point.y, size: 13, weight: 700, area: 1e12, spacing: 1.2 });
      });
    } else {
      if (showKab) {
        PETA_KAB.forEach((row) => {
          if (provinces.size && !provinces.has(row.pv)) return;
          if (regencies.size && !regencies.has(row.b)) return;
          const point = kabCentroids[row.b];
          if (!point || !visible(point.x, point.y)) return;
          items.push({ text: row.b, x: point.x, y: point.y, size: 11.5, weight: 600, area: point.area });
        });
      }
      if (showKec) {
        PETA_KEC.forEach((row, index) => {
          if (provinces.size && !provinces.has(row.pv)) return;
          if (regencies.size && !regencies.has(row.b)) return;
          if (districts.size && !districts.has(String(index))) return;
          const point = kecCentroids[index];
          if (!point || !visible(point.x, point.y)) return;
          items.push({
            text: row.k,
            x: point.x,
            y: point.y,
            size: 8.5,
            weight: 400,
            area: point.area * 0.5,
            kind: 'kec'
          });
        });
      }
    }

    items.sort((a, b) => b.area - a.area);
    const unit = 1 / scale;
    const boxes: BBox[] = [];
    const output: Array<{ item: LabelItem; fontSize: number; letterSpacing?: number }> = [];

    for (const item of items) {
      const fontSize = item.size * unit;
      const letterSpacing = item.spacing ? item.spacing * unit : undefined;
      const width = item.text.length * (fontSize * 0.58 + (letterSpacing ?? 0) * 0.6);
      const height = fontSize * 1.3;
      const box: BBox = [item.x - width / 2, item.y - height / 2, item.x + width / 2, item.y + height / 2];
      if (boxes.some((other) => box[0] < other[2] && box[2] > other[0] && box[1] < other[3] && box[3] > other[1])) continue;
      boxes.push(box);
      output.push({ item, fontSize, letterSpacing });
      if (output.length >= 180) break;
    }
    return output;
  }, [level, provinces, regencies, districts, viewBox, size.w, size.h]);

  const grid = useMemo(() => {
    const scale = Math.min(size.w / viewBox[2], size.h / viewBox[3]) || 1;
    const unit = 1 / scale;
    const step = scale > 5 ? 0.25 : scale > 2.2 ? 0.5 : 1;
    const [x, y, width, height] = viewBox;
    const toX = (longitude: number) => (longitude - LON_ORIGIN) * GEO_SCALE;
    const toY = (latitude: number) => (LAT_ORIGIN - latitude) * GEO_SCALE;
    const lonStart = LON_ORIGIN + x / GEO_SCALE;
    const lonEnd = LON_ORIGIN + (x + width) / GEO_SCALE;
    const latTop = LAT_ORIGIN - y / GEO_SCALE;
    const latBottom = LAT_ORIGIN - (y + height) / GEO_SCALE;
    const format = (value: number) => value.toFixed(2).replace('.', ',');
    const lines: string[] = [];
    const texts: Array<{ x: number; y: number; text: string }> = [];

    for (let longitude = Math.ceil(lonStart / step) * step; longitude <= lonEnd; longitude += step) {
      const px = toX(longitude);
      lines.push(`M${px.toFixed(1)} ${y}V${(y + height).toFixed(1)}`);
      texts.push({ x: px + 3 * unit, y: y + 12 * unit, text: `${format(longitude)}°BT` });
    }
    for (let latitude = Math.ceil(latBottom / step) * step; latitude <= latTop; latitude += step) {
      const py = toY(latitude);
      lines.push(`M${x} ${py.toFixed(1)}H${(x + width).toFixed(1)}`);
      texts.push({ x: x + 4 * unit, y: py - 7 * unit, text: `${format(Math.abs(latitude))}°LS` });
    }

    return { d: lines.join(' '), texts, fontSize: 9.5 * unit };
  }, [viewBox, size.w, size.h]);

  const legend = useMemo<LegendItem[]>(() => {
    const total = scopedRegions.length || 1;
    return (['p', 'g', 'o', 'b'] as StatusKey[])
      .filter((key) => key !== 'o' || statusCounts.o > 0)
      .map((key) => ({
        label: STATUS_LABEL[key],
        variable: STATUS_VAR[key],
        count: statusCounts[key],
        percent: Math.round((statusCounts[key] / total) * 100)
      }));
  }, [scopedRegions.length, statusCounts]);

  const selectedYearList = useMemo(() => [...selectedYears].sort((a, b) => a - b), [selectedYears]);
  const yearsLabel = compactYears(selectedYearList);
  const diseaseLabel = diseases.size
    ? [...diseases].sort((a, b) => a.localeCompare(b, 'id')).join(', ')
    : 'Semua';
  const districtNames = [...districts]
    .map((value) => PETA_KEC[Number(value)]?.k ?? '')
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'id'));
  const scopeLabel = [
    [...provinces].sort((a, b) => a.localeCompare(b, 'id')).join(', '),
    [...regencies].sort((a, b) => a.localeCompare(b, 'id')).join(', '),
    districtNames.join(', ')
  ].filter(Boolean).join(' · ');
  const unitLabel = LEVEL_LABEL[level];

  const scale = Math.min(size.w / viewBox[2], size.h / viewBox[3]) || 1;
  const pixelsPerKm = scale / 0.5549;
  const kilometerOptions = [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500];
  const visibleKilometers = kilometerOptions.filter((value) => value * pixelsPerKm <= 130);
  const scaleKilometers = visibleKilometers.length ? visibleKilometers[visibleKilometers.length - 1] : 500;
  const scaleWidth = Math.max(18, Math.min(150, scaleKilometers * pixelsPerKm));

  /* -------------------------------------------------------------- */
  /* Filter handlers                                                 */
  /* -------------------------------------------------------------- */

  function toggleYear(year: number) {
    setSelectedYears((previous) => {
      const next = new Set(previous);
      if (next.has(year)) {
        if (next.size > 1) next.delete(year);
      } else {
        next.add(year);
      }
      return next;
    });
  }

  function toggleDisease(disease: string) {
    setDiseases((previous) => {
      const next = new Set(previous);
      if (next.has(disease)) next.delete(disease);
      else next.add(disease);
      return next;
    });
  }

  function selectVisibleDiseases() {
    const term = diseaseQuery.trim().toLowerCase();
    setDiseases((previous) => {
      const next = new Set(previous);
      diseaseOptions.forEach((disease) => {
        if (!term || disease.toLowerCase().includes(term)) next.add(disease);
      });
      return next;
    });
  }

  function pathsForScope(
    nextProvinces: Set<string>,
    nextRegencies: Set<string>,
    nextDistricts: Set<string>
  ): string[] {
    return PETA_KEC.flatMap((row, index) => {
      if (!row.d) return [];
      if (nextProvinces.size && !nextProvinces.has(row.pv)) return [];
      if (nextRegencies.size && !nextRegencies.has(row.b)) return [];
      if (nextDistricts.size && !nextDistricts.has(String(index))) return [];
      return [row.d];
    });
  }

  function focusForFilters(
    nextProvinces: Set<string>,
    nextRegencies: Set<string>,
    nextDistricts: Set<string>
  ) {
    const paths = pathsForScope(nextProvinces, nextRegencies, nextDistricts);
    fitBox(paths.length ? bboxOfPaths(paths) : PETA.bb['']);
  }

  function handleProvinceChange(next: Set<string>) {
    setProvinces(next);
    setRegencies(new Set());
    setDistricts(new Set());
    focusForFilters(next, new Set(), new Set());
  }

  function handleRegencyChange(next: Set<string>) {
    setRegencies(next);
    setDistricts(new Set());
    if (next.size) {
      const derivedProvinces = new Set(
        [...next].map((name) => KAB_BY_NAME[name]?.pv).filter((value): value is string => Boolean(value))
      );
      setProvinces(derivedProvinces);
      if (level === 'prov') setLevel('kab');
      focusForFilters(derivedProvinces, next, new Set());
    } else {
      focusForFilters(provinces, new Set(), new Set());
    }
  }

  function handleDistrictChange(next: Set<string>) {
    setDistricts(next);
    if (next.size) {
      const rows = [...next].map((value) => PETA_KEC[Number(value)]).filter((row): row is PetaKec => Boolean(row));
      const derivedRegencies = new Set(rows.map((row) => row.b));
      const derivedProvinces = new Set(rows.map((row) => row.pv));
      setRegencies(derivedRegencies);
      setProvinces(derivedProvinces);
      setLevel('kec');
      focusForFilters(derivedProvinces, derivedRegencies, next);
    } else {
      focusForFilters(provinces, regencies, new Set());
    }
  }

  function changeLevel(nextLevel: Level) {
    setLevel(nextLevel);
    setDistricts(new Set());
    if (nextLevel === 'prov') {
      setRegencies(new Set());
      focusForFilters(provinces, new Set(), new Set());
    } else {
      focusForFilters(provinces, regencies, new Set());
    }
  }

  function resetFilters() {
    setProvinces(new Set());
    setRegencies(new Set());
    setDistricts(new Set());
    setStatuses(new Set());
    setTableQuery('');
    fitBox(PETA.bb['']);
  }

  function zoomToRegion(region: RegionRow) {
    let paths: string[] = [];
    if (level === 'prov') {
      paths = PETA_KEC.filter((row) => row.pv === region.pv && row.d).map((row) => row.d as string);
    } else if (level === 'kab') {
      paths = PETA_KEC.filter((row) => row.b === region.b && row.d).map((row) => row.d as string);
    } else {
      const row = PETA_KEC[region.index];
      if (row?.d) paths = [row.d];
    }
    fitBox(paths.length ? bboxOfPaths(paths) : PETA.bb[region.pv] ?? PETA.bb['']);
  }

  function changeSort(key: SortKey) {
    if (sortKey === key) setSortAsc((value) => !value);
    else {
      setSortKey(key);
      setSortAsc(key === 'name');
    }
  }

  function sortMark(key: SortKey) {
    if (sortKey !== key) return '';
    return sortAsc ? ' ↑' : ' ↓';
  }

  /* -------------------------------------------------------------- */
  /* Exports                                                         */
  /* -------------------------------------------------------------- */

  const exportSuffix = `${level}_${fileSlug(yearsLabel)}${diseases.size ? `_${fileSlug(diseaseLabel)}` : ''}`;

  function handleCsv() {
    const header = [
      'No',
      'Wilayah',
      ...(level === 'kec' ? ['Kabupaten/Kota'] : []),
      ...(level !== 'prov' ? ['Provinsi'] : []),
      'Sampel',
      'Positif',
      'Negatif',
      ...(hasOther ? ['Lainnya'] : []),
      'Status'
    ];
    const body = tableRows.map((region, index) => [
      index + 1,
      region.name,
      ...(level === 'kec' ? [region.b] : []),
      ...(level !== 'prov' ? [region.pv] : []),
      region.stat.m,
      region.stat.sp,
      region.stat.sg,
      ...(hasOther ? [region.stat.so] : []),
      STATUS_LABEL[region.status]
    ]);
    downloadCsv([header, ...body], `daftar_wilayah_${exportSuffix}.csv`);
    setToast('Daftar wilayah berhasil diunduh sebagai CSV.');
  }

  function handleGeoJson() {
    const features = PETA_KEC.flatMap((row, index) => {
      if (!row.d) return [];
      const kecStat = aggregate.kec.get(index) ?? EMPTY;
      const kabStat = aggregate.kab.get(row.b) ?? EMPTY;
      const provStat = aggregate.prov.get(row.pv) ?? EMPTY;
      return [{
        type: 'Feature' as const,
        properties: {
          provinsi: row.pv,
          kabupaten: row.b,
          kecamatan: row.k,
          tahun: yearsLabel,
          penyakit: diseaseLabel,
          kec_sampel: kecStat.m,
          kec_uji: kecStat.n,
          kec_positif: kecStat.p,
          kec_negatif: kecStat.g,
          kec_lain: kecStat.o,
          kec_status: STATUS_LABEL[statusOf(kecStat)],
          kec_penyakit_positif: kecStat.top.map(([name, count]) => `${name} (${count})`).join('; '),
          kab_sampel: kabStat.m,
          kab_positif: kabStat.p,
          kab_negatif: kabStat.g,
          kab_status: STATUS_LABEL[statusOf(kabStat)],
          prov_sampel: provStat.m,
          prov_positif: provStat.p,
          prov_negatif: provStat.g,
          prov_status: STATUS_LABEL[statusOf(provStat)]
        },
        geometry: polygonGeometry(row.d)
      }];
    });
    downloadJson(
      { type: 'FeatureCollection', name: 'wilayah_terdampak', features },
      `wilayah_terdampak_${exportSuffix}.geojson`
    );
    setToast('Data wilayah dan batas kecamatan berhasil diunduh sebagai GeoJSON.');
  }

  async function handlePng() {
    const svg = svgRef.current;
    if (!svg) return;
    setToast('Menyiapkan gambar peta…');
    try {
      await exportMapPng({
        svg,
        viewBox,
        title: 'Peta Wilayah Terdampak – Sumbagsel',
        subtitle: `Pantau Penyakit · Balai Veteriner Lampung · Tahun ${yearsLabel} · ${unitLabel}${scopeLabel ? ` · ${scopeLabel}` : ''}${diseases.size ? ` · Penyakit: ${diseaseLabel}` : ''}`,
        legend,
        filename: `peta_wilayah_terdampak_${fileSlug(yearsLabel)}.png`
      });
      setToast('Gambar peta berhasil diunduh.');
    } catch (exportError) {
      setToast(exportError instanceof Error ? exportError.message : String(exportError));
    }
  }

  async function handleQgis() {
    setToast('Menyiapkan paket QGIS…');
    try {
      await exportQgisPackage({
        aggregate,
        level,
        yearsLabel,
        diseaseLabel
      });
      setToast('Paket QGIS berhasil diunduh. Ekstrak ZIP lalu buka Peta_Sumbagsel.qgz di QGIS.');
    } catch (exportError) {
      setToast(exportError instanceof Error ? exportError.message : String(exportError));
    }
  }

  /* -------------------------------------------------------------- */
  /* Presentation mode                                               */
  /* -------------------------------------------------------------- */

  useEffect(() => {
    document.body.classList.toggle('map-present', presentation);
    if (presentation) {
      document.documentElement.requestFullscreen?.().catch(() => undefined);
    } else if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => undefined);
    }
    return () => document.body.classList.remove('map-present');
  }, [presentation]);

  useEffect(() => {
    const handler = () => {
      if (!document.fullscreenElement) setPresentation(false);
    };
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches?.('input, select, textarea, summary')) return;
      if (event.key === 'p' || event.key === 'P') {
        event.preventDefault();
        setPresentation((value) => !value);
      } else if (event.key === 'Escape' && presentation) {
        setPresentation(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [presentation]);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      [diseaseRef.current, exportRef.current].forEach((element) => {
        if (element?.open && !element.contains(event.target as Node)) element.open = false;
      });
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  /* -------------------------------------------------------------- */
  /* Derived map pieces                                              */
  /* -------------------------------------------------------------- */

  const kabOptions = useMemo(
    () => PETA_KAB.filter((row) => !provinces.size || provinces.has(row.pv)).sort((a, b) => a.b.localeCompare(b.b, 'id')),
    [provinces]
  );

  const kecOptions = useMemo(
    () =>
      PETA_KEC.map((row, index) => ({ ...row, index }))
        .filter((row) =>
          row.d &&
          (!provinces.size || provinces.has(row.pv)) &&
          (!regencies.size || regencies.has(row.b))
        )
        .sort((a, b) => a.k.localeCompare(b.k, 'id')),
    [provinces, regencies]
  );

  const hoveredRow = hover ? PETA_KEC[hover.index] : null;
  const pinnedRow = pinnedIndex === null ? null : PETA_KEC[pinnedIndex] ?? null;
  const activeRegion = pinnedRow ?? hoveredRow;
  const hoveredStat = hover
    ? level === 'prov'
      ? aggregate.prov.get(PETA_KEC[hover.index].pv) ?? EMPTY
      : level === 'kab'
        ? aggregate.kab.get(PETA_KEC[hover.index].b) ?? EMPTY
        : aggregate.kec.get(hover.index) ?? EMPTY
    : null;
  const hoveredName = hoveredRow
    ? level === 'prov'
      ? hoveredRow.pv
      : level === 'kab'
        ? hoveredRow.b
        : hoveredRow.k
    : '';

  const hoveredIndex = hover?.index ?? null;

  const outbreakYearly = selectedYears.size > 1;

  const tooltipOutbreak = useMemo(() => {
    if (!hoveredRow) return null;
    if (level === 'kec') {
      return buildMapOutbreak(charts?.by_district_month ?? [], hoveredRow.pv, hoveredRow.b, hoveredRow.k, selectedYears, rows ?? [], outbreakYearly);
    }
    if (level === 'kab') {
      return buildMapOutbreak(charts?.by_regency_month ?? [], hoveredRow.pv, hoveredRow.b, null, selectedYears, rows ?? [], outbreakYearly);
    }
    return buildMapOutbreak(charts?.by_month ?? [], hoveredRow.pv, null, null, selectedYears, rows ?? [], outbreakYearly);
  }, [hoveredRow, level, charts, selectedYears, rows, outbreakYearly]);

  const activeOutbreak = useMemo(
    () => activeRegion ? buildMapOutbreak(charts?.by_month ?? [], activeRegion.pv, null, null, selectedYears, rows ?? [], outbreakYearly) : null,
    [activeRegion, charts, selectedYears, rows, outbreakYearly]
  );

  const activeRegencyOutbreak = useMemo(
    () => activeRegion ? buildMapOutbreak(charts?.by_regency_month ?? [], activeRegion.pv, activeRegion.b, null, selectedYears, rows ?? [], outbreakYearly) : null,
    [activeRegion, charts, selectedYears, rows, outbreakYearly]
  );

  const activeDistrictOutbreak = useMemo(
    () => activeRegion ? buildMapOutbreak(charts?.by_district_month ?? [], activeRegion.pv, activeRegion.b, activeRegion.k, selectedYears, rows ?? [], outbreakYearly) : null,
    [activeRegion, charts, selectedYears, rows, outbreakYearly]
  );

  const highlightD = useMemo(() => {
    if (hoveredIndex === null) return '';
    const row = PETA_KEC[hoveredIndex];
    if (!row) return '';
    return PETA_KEC
      .filter((item) =>
        item.d && (
          level === 'kec'
            ? item === row
            : level === 'kab'
              ? item.b === row.b
              : item.pv === row.pv
        )
      )
      .map((item) => item.d as string)
      .join(' ');
  }, [hoveredIndex, level]);

  const mapShapes = useMemo(() => {
    return PETA_KEC.map((row, index) => {
      if (!row.d) return null;
      const stat =
        level === 'prov'
          ? aggregate.prov.get(row.pv)
          : level === 'kab'
            ? aggregate.kab.get(row.b)
            : aggregate.kec.get(index);
      const current = stat ?? EMPTY;
      const status = statusOf(current);
      const inScope =
        (!provinces.size || provinces.has(row.pv)) &&
        (!regencies.size || regencies.has(row.b)) &&
        (!districts.size || districts.has(String(index)));
      const visible = inScope && (!statuses.size || statuses.has(status));
      return (
        <path
          key={index}
          d={row.d}
          className={`map-shape${pinnedIndex === index ? ' is-pinned' : ''}`}
          fill={STATUS_COLOR[status]}
          fillOpacity={visible ? 0.92 : 0.12}
          stroke={level === 'kec' ? 'var(--ksep)' : STATUS_COLOR[status]}
          strokeOpacity={visible ? 1 : 0.28}
          onClick={() => {
            if (dragDistance.current > 6) return;
            setPinnedIndex((current) => current === index ? null : index);
            if (row.d) fitBox(pathBBox(row.d));
          }}
          onMouseMove={(event: ReactMouseEvent<SVGPathElement>) =>
            setHover({ index, x: event.clientX, y: event.clientY })
          }
          onMouseLeave={() => setHover(null)}
        />
      );
    });
  }, [aggregate, level, provinces, regencies, districts, statuses, pinnedIndex, size.w, size.h]);

  const breadcrumb = [
    provinces.size ? [...provinces].sort((a, b) => a.localeCompare(b, 'id')).join(', ') : 'Semua provinsi',
    ...(level !== 'prov'
      ? [regencies.size ? [...regencies].sort((a, b) => a.localeCompare(b, 'id')).join(', ') : 'Semua kab/kota']
      : []),
    ...(level === 'kec' ? [districtNames.length ? districtNames.join(', ') : 'Semua kecamatan'] : [])
  ].join(' › ');

  return (
    <main className={`dash-page map-page${presentation ? ' presentation' : ''}`} data-theme={theme}>
      <header className="dash-page-head map-page-head">
        <div>
          <span className="eyebrow">Peta wilayah · IV Lab</span>
          <h1>Peta Wilayah Terdampak</h1>
          <p>Sebaran hasil pengujian IV Lab di Sumatera Selatan, Lampung, Bangka Belitung, dan Bengkulu.</p>
        </div>
        <div className="dash-head-actions map-actions">
          <button className="button button-outline" onClick={() => setReloadKey((key) => key + 1)} disabled={loading}>
            {loading ? 'Memuat…' : 'Muat ulang data'}
          </button>
          <button className="button button-outline" onClick={() => setPresentation((value) => !value)}>
            {presentation ? 'Keluar presentasi' : 'Presentasi'}
          </button>
          <details className="map-export" ref={exportRef}>
            <summary className="button button-outline">Ekspor</summary>
            <div className="map-export-menu">
              <button onClick={() => { if (exportRef.current) exportRef.current.open = false; void handlePng(); }}>Gambar peta (PNG)</button>
              <button onClick={() => { if (exportRef.current) exportRef.current.open = false; handleCsv(); }}>Daftar wilayah (CSV)</button>
              <button onClick={() => { if (exportRef.current) exportRef.current.open = false; handleGeoJson(); }}>Batas &amp; data (GeoJSON)</button>
              <button onClick={() => { if (exportRef.current) exportRef.current.open = false; void handleQgis(); }}>Paket QGIS (ZIP)</button>
              <button onClick={() => { if (exportRef.current) exportRef.current.open = false; window.print(); }}>Cetak halaman</button>
            </div>
          </details>
        </div>
      </header>

      {error ? (
        <div className="notice notice-error">
          <strong>Data peta belum dapat dimuat.</strong> {error}
        </div>
      ) : null}

      {loading ? (
        <div className="dash-loading panel">
          <span className="loader" aria-hidden="true" />
          <span>Memuat data peta dari server IV Lab…</span>
        </div>
      ) : null}

      {!loading && rows && rows.length === 0 && !error ? (
        <div className="notice notice-info">
          <strong>Belum ada data peta.</strong> Wilayah akan tampil abu-abu sampai data diimpor melalui panel admin.
        </div>
      ) : null}

      {!loading && rows !== null && !error ? (
        <>
          <section className="panel map-filters">
            <div className="map-filter-grid">
              <MultiSelect
                label="Provinsi"
                options={PETA_PROV.map((row) => ({ value: row.pv, label: row.pv }))}
                selected={provinces}
                onChange={handleProvinceChange}
                allLabel="Semua provinsi"
                searchable
              />
              <MultiSelect
                label="Kabupaten / kota"
                options={kabOptions.map((row) => ({ value: row.b, label: row.b, hint: row.pv }))}
                selected={regencies}
                onChange={handleRegencyChange}
                allLabel="Semua kab/kota"
                searchable
              />
              <MultiSelect
                label="Kecamatan"
                options={kecOptions.map((row) => ({
                  value: String(row.index),
                  label: regencies.size ? row.k : `${row.k} · ${row.b}`,
                  hint: row.pv
                }))}
                selected={districts}
                onChange={handleDistrictChange}
                allLabel="Semua kecamatan"
                searchable
              />
              <MultiSelect
                label="Status"
                options={(['p', 'g', 'o', 'b'] as StatusKey[]).map((key) => ({ value: key, label: STATUS_LABEL[key] }))}
                selected={statuses}
                onChange={setStatuses}
                allLabel="Semua status"
              />
              <div className="map-disease-field">
                <span>Penyakit</span>
                <details className="map-disease" ref={diseaseRef}>
                  <summary>
                    {diseases.size ? (diseases.size <= 2 ? diseaseLabel : `${diseases.size} penyakit dipilih`) : 'Semua penyakit'}
                  </summary>
                  <div className="map-disease-pop">
                    <input
                      type="search"
                      value={diseaseQuery}
                      onChange={(event) => setDiseaseQuery(event.target.value)}
                      placeholder="Cari penyakit… (mis. AI)"
                      aria-label="Cari penyakit"
                    />
                    <div className="map-disease-actions">
                      <button type="button" onClick={selectVisibleDiseases}>Pilih yang tampil</button>
                      <button type="button" onClick={() => setDiseases(new Set())}>Hapus pilihan</button>
                    </div>
                    <div className="map-disease-list">
                      {diseaseOptions.map((disease) => {
                        const subtypes = diseaseSubtypes(disease);
                        return (
                          <label key={disease} title={subtypes.length > 1 ? `Termasuk: ${subtypes.join(', ')}` : disease}>
                            <input
                              type="checkbox"
                              checked={diseases.has(disease)}
                              onChange={() => toggleDisease(disease)}
                            />
                            <span>{disease}</span>
                            {subtypes.length > 1 ? <small>({subtypes.length} subtipe)</small> : null}
                          </label>
                        );
                      })}
                      {!diseaseOptions.length ? <p className="map-disease-empty">Belum ada nama penyakit pada data.</p> : null}
                    </div>
                  </div>
                </details>
              </div>
              <div className="map-level-field">
                <span>Tingkat peta</span>
                <div className="map-segment" role="group" aria-label="Tingkat peta">
                  {(['prov', 'kab', 'kec'] as Level[]).map((item) => (
                    <button
                      key={item}
                      type="button"
                      className={level === item ? 'active' : ''}
                      onClick={() => changeLevel(item)}
                    >
                      {item === 'prov' ? 'Provinsi' : item === 'kab' ? 'Kab/Kota' : 'Kecamatan'}
                    </button>
                  ))}
                </div>
              </div>
              <button className="button button-outline map-reset" type="button" onClick={resetFilters}>
                Reset filter
              </button>
            </div>

            <div className="map-years">
              {years.length ? <span className="map-years-label">Tahun:</span> : null}
              {years.map((year) => (
                <label
                  key={year}
                  className={`map-year-chip${selectedYears.has(year) ? ' active' : ''}`}
                  title={`Tampilkan atau sembunyikan data tahun ${year}`}
                >
                  <input
                    type="checkbox"
                    checked={selectedYears.has(year)}
                    onChange={() => toggleYear(year)}
                  />
                  {year} <small>({numberFormat.format(yearTotals.get(year) ?? 0)})</small>
                </label>
              ))}
              {years.length > 1 ? (
                <button type="button" className="map-year-all" onClick={() => setSelectedYears(new Set(years))}>
                  Semua
                </button>
              ) : null}
              {!years.length ? <span className="map-years-empty">Belum ada tahun data.</span> : null}
            </div>
          </section>

          <section className="map-kpis" aria-label="Ringkasan wilayah">
            <article className="map-kpi">
              <span>Total {unitLabel.toLowerCase()}</span>
              <strong>{numberFormat.format(scopedRegions.length)}</strong>
              <small>wilayah pada filter ini</small>
            </article>
            <article className="map-kpi positive">
              <span>{unitLabel} positif</span>
              <strong>{numberFormat.format(statusCounts.p)}</strong>
              <small>minimal 1 sampel positif</small>
            </article>
            <article className="map-kpi negative">
              <span>{unitLabel} negatif</span>
              <strong>{numberFormat.format(statusCounts.g)}</strong>
              <small>ada pengujian, tanpa positif</small>
            </article>
            <article className="map-kpi visited">
              <span>Belum dikunjungi</span>
              <strong>{numberFormat.format(statusCounts.b)}</strong>
              <small>tidak ada sampel pada tahun terpilih</small>
            </article>
            <article className="map-kpi">
              <span>Jumlah sampel</span>
              <strong>{numberFormat.format(sampleTotals.m)}</strong>
              <small>sampel unik pada filter ini</small>
            </article>
            <article className="map-kpi positive">
              <span>Sampel positif</span>
              <strong>{numberFormat.format(sampleTotals.sp)}</strong>
              <small>{sampleTotals.m ? `${((sampleTotals.sp / sampleTotals.m) * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 })}% dari sampel` : '—'}</small>
            </article>
            <article className="map-kpi negative">
              <span>Sampel negatif</span>
              <strong>{numberFormat.format(sampleTotals.sg)}</strong>
              <small>{sampleTotals.m ? `${((sampleTotals.sg / sampleTotals.m) * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 })}% dari sampel` : '—'}</small>
            </article>
            {sampleTotals.so ? (
              <article className="map-kpi other">
                <span>Sampel lainnya</span>
                <strong>{numberFormat.format(sampleTotals.so)}</strong>
                <small>hasil bukan positif/negatif</small>
              </article>
            ) : null}
          </section>

          <div className="map-layout">
            <section className="panel map-card">
              <div className="map-card-head">
                <div>
                  <h2>Peta status wilayah</h2>
                  <p>{unitLabel} · Tahun {yearsLabel}{diseases.size ? ` · Penyakit: ${diseaseLabel}` : ''}</p>
                </div>
                <span className="map-breadcrumb">{breadcrumb}</span>
              </div>

              <div className="map-canvas" ref={mapWrapRef}>
                <svg
                  ref={svgRef}
                  className="map-svg"
                  viewBox={viewBox.join(' ')}
                  role="img"
                  aria-label={`Peta status wilayah tingkat ${unitLabel}`}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                >
                  <g className="map-graticule" aria-hidden="true">
                    <path d={grid.d} />
                    {grid.texts.map((text, index) => (
                      <text key={index} x={text.x} y={text.y} fontSize={grid.fontSize}>
                        {text.text}
                      </text>
                    ))}
                  </g>
                  <g>{mapShapes}</g>
                  <path className="map-boundary-kab" d={PETA.bk} />
                  <path className="map-boundary-prov" d={PETA.bp} />
                  {highlightD ? (
                    <g className="map-highlight" aria-hidden="true">
                      <path className="map-highlight-halo" d={highlightD} />
                      <path className="map-highlight-line" d={highlightD} />
                    </g>
                  ) : null}
                  <g className="map-labels">
                    {labels.map(({ item, fontSize, letterSpacing }, index) => (
                      <text
                        key={`${item.text}-${index}`}
                        className={`map-label${item.kind === 'kec' ? ' map-label-kec' : ''}`}
                        x={item.x}
                        y={item.y}
                        fontSize={fontSize}
                        fontWeight={item.weight}
                        letterSpacing={letterSpacing}
                      >
                        {item.text}
                      </text>
                    ))}
                  </g>
                </svg>

                <div className="map-zoom" aria-label="Kontrol zoom peta">
                  <button type="button" onClick={() => zoom(0.7)} title="Perbesar">+</button>
                  <button type="button" onClick={() => zoom(1.4)} title="Perkecil">−</button>
                  <button type="button" onClick={() => fitBox(PETA.bb[''])} title="Tampilkan seluruh wilayah">⤢</button>
                </div>

                <div className="map-legend">
                  <div className="map-legend-title">Status wilayah · {unitLabel}</div>
                  {legend.map((item) => (
                    <div className="map-legend-row" key={item.label}>
                      <i style={{ background: `var(--${item.variable})` }} />
                      <span>{item.label}</span>
                      <b>{numberFormat.format(item.count)}</b>
                      <em>{item.percent}%</em>
                    </div>
                  ))}
                  <div className="map-legend-note">Tahun {yearsLabel}{diseases.size ? ` · ${diseaseLabel}` : ''}</div>
                </div>

                <div className="map-scale">
                  <div className="map-north" aria-hidden="true">
                    <span>U</span>
                    <svg viewBox="0 0 20 24" width="11" height="14"><path d="M10 1 17 22 10 17 3 22Z" fill="currentColor" /></svg>
                  </div>
                  <div className="map-scale-body">
                    <span>{scaleKilometers.toLocaleString('id-ID')} km</span>
                    <div className="map-scale-bar" style={{ width: scaleWidth }} />
                  </div>
                </div>

                {hover && hoveredRow && hoveredStat ? (
                  <div
                    className="map-tooltip"
                    style={{
                      left: Math.min(hover.x + 14, window.innerWidth - 350),
                      top: Math.min(hover.y + 14, window.innerHeight - 430)
                    }}
                  >
                    <div className="map-tooltip-title">
                      <strong>{hoveredName}</strong>
                      <span className="map-tooltip-sub">
                        {level === 'kec' ? `${hoveredRow.b} · ` : ''}{hoveredRow.pv}
                      </span>
                    </div>
                    <span className={`map-status status-${statusOf(hoveredStat)}`}>
                      <i style={{ background: STATUS_COLOR[statusOf(hoveredStat)] }} />
                      {STATUS_LABEL[statusOf(hoveredStat)]}
                    </span>
                    {hoveredStat.n ? (
                      <>
                        <span>
                          Jumlah sampel: <b>{numberFormat.format(hoveredStat.m)}</b> (positif {numberFormat.format(hoveredStat.sp)},
                          negatif {numberFormat.format(hoveredStat.sg)}{hoveredStat.so ? `, lainnya ${numberFormat.format(hoveredStat.so)}` : ''})
                        </span>
                        <span>Total hasil uji: {numberFormat.format(hoveredStat.n)}</span>
                        {hoveredStat.top.length ? (
                          <span>
                            Positif terbanyak: {hoveredStat.top.map(([name, count]) => `${name} (${numberFormat.format(count)})`).join('; ')}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <span>Tidak ada sampel pada tahun terpilih.</span>
                    )}
                    {tooltipOutbreak ? (
                      <>
                        <div className="map-tooltip-divider" />
                        <div className="map-tooltip-section-title">Kasus positif per {tooltipOutbreak?.isYearly ? 'tahun' : 'bulan'} · {diseaseLabel}</div>
                        <TooltipOutbreakSvg data={tooltipOutbreak} />
                        <div className="map-tooltip-legend">Garis: abu = rata-rata, kuning = +1 SD, merah = +2 SD</div>
                        <div className="map-tooltip-stats">
                          Rata-rata: {decimal2(tooltipOutbreak.mean)} · SD {decimal2(tooltipOutbreak.sd)} · batas outbreak {decimal2(tooltipOutbreak.upper2)}
                        </div>
                        <div className="map-tooltip-status">
                          <span>{tooltipOutbreak.last}: {numberFormat.format(tooltipOutbreak.lastValue)} kasus</span>
                          <b className={tooltipOutbreak.isOutbreak ? 'is-outbreak' : 'is-normal'}>
                            → {tooltipOutbreak.isOutbreak ? 'OUTBREAK' : 'Normal'}
                          </b>
                          <span>
                            · {tooltipOutbreak.series.filter(([, value]) => tooltipOutbreak.upper2 > 0 && value >= tooltipOutbreak.upper2).length} bulan melewati batas
                          </span>
                        </div>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <p className="map-hint">
                Scroll/pinch untuk zoom · seret untuk geser · klik wilayah untuk mendekatkan sekaligus mengunci grafik outbreak · klik lagi untuk melepas · tekan <b>P</b> untuk presentasi.
              </p>
            </section>

            <aside className="panel map-side">
              {activeOutbreak || activeRegencyOutbreak || activeDistrictOutbreak ? (
                <section className="map-outbreak">
                  <div className="map-outbreak-title">
                    <span>Batas Outbreak (Rata-rata + 2 SD)</span>
                    {pinnedRow ? (
                      <button type="button" className="map-outbreak-unpin" onClick={() => setPinnedIndex(null)}>
                        Terkunci: {pinnedRow.k} · Klik untuk lepas
                      </button>
                    ) : (
                      <small>Mengikuti kursor · klik wilayah untuk mengunci</small>
                    )}
                  </div>
                  {activeOutbreak ? <OutbreakBlock label="Provinsi" data={activeOutbreak} /> : null}
                  {activeRegencyOutbreak ? <OutbreakBlock label="Kabupaten/Kota" data={activeRegencyOutbreak} /> : null}
                  {activeDistrictOutbreak ? <OutbreakBlock label="Kecamatan" data={activeDistrictOutbreak} /> : null}
                </section>
              ) : (
                <div className="map-outbreak-empty">
                  Arahkan kursor ke wilayah peta untuk melihat batas outbreak (SD) tingkat provinsi, kabupaten/kota, dan kecamatan. Klik wilayah untuk mengunci grafik.
                </div>
              )}
              <div className="map-side-head">
                <div>
                  <h2>Daftar wilayah</h2>
                  <p>{numberFormat.format(tableRows.length)} wilayah · {unitLabel}</p>
                </div>
                <input
                  type="search"
                  value={tableQuery}
                  onChange={(event) => setTableQuery(event.target.value)}
                  placeholder="Cari nama wilayah…"
                  aria-label="Cari wilayah pada tabel"
                />
              </div>

              <div className="map-table-wrap">
                <table className="map-table">
                  <thead>
                    <tr>
                      <th>
                        <button type="button" className="map-th-sort" onClick={() => changeSort('name')}>
                          Wilayah{sortMark('name')}
                        </button>
                      </th>
                      <th className="n">
                        <button type="button" className="map-th-sort" onClick={() => changeSort('m')}>
                          Sampel{sortMark('m')}
                        </button>
                      </th>
                      <th className="n">
                        <button type="button" className="map-th-sort" onClick={() => changeSort('sp')}>
                          Positif{sortMark('sp')}
                        </button>
                      </th>
                      <th className="n">
                        <button type="button" className="map-th-sort" onClick={() => changeSort('sg')}>
                          Negatif{sortMark('sg')}
                        </button>
                      </th>
                      {hasOther ? (
                        <th className="n">
                          <button type="button" className="map-th-sort" onClick={() => changeSort('so')}>
                            Lainnya{sortMark('so')}
                          </button>
                        </th>
                      ) : null}
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((region) => (
                      <tr key={`${level}-${region.index}`} onClick={() => zoomToRegion(region)}>
                        <td className="cell-wrap">
                          {region.name}
                          <small>
                            {level === 'kec' ? `${region.b} · ` : ''}
                            {region.pv}
                          </small>
                        </td>
                        <td className="n">{numberFormat.format(region.stat.m)}</td>
                        <td className="n">{numberFormat.format(region.stat.sp)}</td>
                        <td className="n">{numberFormat.format(region.stat.sg)}</td>
                        {hasOther ? <td className="n">{numberFormat.format(region.stat.so)}</td> : null}
                        <td>
                          <span className={`map-status status-${region.status}`}>
                            <i style={{ background: STATUS_COLOR[region.status] }} />
                            {STATUS_LABEL[region.status]}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {!pageRows.length ? (
                      <tr>
                        <td colSpan={hasOther ? 6 : 5} className="map-table-empty">
                          Tidak ada wilayah yang cocok dengan filter.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              <div className="map-pager">
                <span>
                  Menampilkan {tableRows.length ? (currentPage - 1) * PAGE_SIZE + 1 : 0}–{Math.min(currentPage * PAGE_SIZE, tableRows.length)} dari {numberFormat.format(tableRows.length)}
                </span>
                <div>
                  <button
                    type="button"
                    className="button button-outline button-small"
                    onClick={() => setTablePage((page) => Math.max(1, page - 1))}
                    disabled={currentPage <= 1}
                  >
                    Sebelumnya
                  </button>
                  <span>{currentPage} / {pageCount}</span>
                  <button
                    type="button"
                    className="button button-outline button-small"
                    onClick={() => setTablePage((page) => Math.min(pageCount, page + 1))}
                    disabled={currentPage >= pageCount}
                  >
                    Berikutnya
                  </button>
                </div>
              </div>
            </aside>
          </div>

          <details className="panel map-notes">
            <summary>Keterangan status &amp; catatan data</summary>
            <div className="map-notes-body">
              <p>
                <b>Positif</b> berarti minimal satu hasil Positif/Seropositif. <b>Negatif</b> berarti ada pengujian,
                ada hasil negatif, dan tidak ada yang positif. <b>Hasil lainnya</b> berarti ada pengujian tetapi semua
                hasilnya bukan positif/negatif (misalnya meragukan). <b>Belum dikunjungi</b> berarti tidak ada sampel
                dari wilayah itu pada tahun yang dipilih.
              </p>
              <p>
                Nama penyakit diambil dari kolom <b>nama_uji</b>; nama yang diawali AI atau memuat kata
                “influenza” digabung menjadi <b>Influenza</b>. Satu sampel dihitung sekali per wilayah, sehingga
                <b> Sampel = Positif + Negatif</b> (ditambah hasil lainnya bila ada). Jika beberapa penyakit dipilih
                sekaligus, sampel dihitung per penyakit lalu dijumlahkan.
              </p>
              {aggregate.unm ? (
                <p>
                  <b>{numberFormat.format(aggregate.unm)} sampel</b> berasal dari kecamatan yang tidak ada di peta
                  (kecamatan baru/pemekaran); data tersebut tetap dihitung di level kabupaten dan provinsi.
                  <span className="map-notes-list"> {aggregate.unmList.join('; ')}</span>
                </p>
              ) : null}
              <p>
                Batas wilayah: GADM 3.6 (disederhanakan). Pemekaran terbaru tidak ada di GADM; Pesisir Barat,
                Musi Rawas Utara, dan PALI dipisahkan dari kabupaten induknya berdasarkan daftar kecamatan.
              </p>
            </div>
          </details>
        </>
      ) : null}

      {toast ? <div className="map-toast" role="status">{toast}</div> : null}
    </main>
  );
}
