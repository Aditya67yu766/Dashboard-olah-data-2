import rawPeta from '../data/peta.json';
import type { MapRow } from '../types';

export type PetaKec = {
  pv: string;
  b: string;
  k: string;
  d?: string;
  n: number;
  p: number;
  g: number;
  o: number;
  top: [string, number][];
};

export type PetaKab = {
  pv: string;
  b: string;
  n: number;
  p: number;
  g: number;
  o: number;
  top: [string, number][];
};

export type PetaProv = {
  pv: string;
  n: number;
  p: number;
  g: number;
  o: number;
  top: [string, number][];
};

type PetaRaw = {
  kec: PetaKec[];
  kab: PetaKab[];
  prov: PetaProv[];
  bk: string;
  bp: string;
  unm: number;
  unl: string[];
  bb: Record<string, number[]>;
};

export const PETA = rawPeta as unknown as PetaRaw;
export const PETA_KEC = PETA.kec;
export const PETA_KAB = PETA.kab;
export const PETA_PROV = PETA.prov;

export const KAB_BY_NAME: Record<string, PetaKab> = {};
PETA_KAB.forEach((row) => {
  KAB_BY_NAME[row.b] = row;
});

export const PROV_BY_NAME: Record<string, PetaProv> = {};
PETA_PROV.forEach((row) => {
  PROV_BY_NAME[row.pv] = row;
});

export const LEVEL_LABEL = {
  prov: 'Provinsi',
  kab: 'Kabupaten/Kota',
  kec: 'Kecamatan'
} as const;

export type Level = keyof typeof LEVEL_LABEL;
export type StatusKey = 'p' | 'g' | 'o' | 'b';

export const STATUS_COLOR: Record<StatusKey, string> = {
  p: 'var(--pos)',
  g: 'var(--neg)',
  o: 'var(--unk)',
  b: 'var(--nov)'
};

export const STATUS_LABEL: Record<StatusKey, string> = {
  p: 'Positif',
  g: 'Negatif',
  o: 'Hasil lainnya',
  b: 'Belum dikunjungi'
};

export function statusOf(row: { n: number; p: number; g: number }): StatusKey {
  if (!row.n) return 'b';
  if (row.p > 0) return 'p';
  if (row.g > 0) return 'g';
  return 'o';
}

/* ------------------------------------------------------------------ */
/* Name normalisation and region matching                              */
/* ------------------------------------------------------------------ */

export const nz = (value: unknown): string =>
  String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

export const kk = (value: unknown): string =>
  nz(value).replace(/^(kabupaten|kab|kota)/, '');

export function provinceName(value: unknown): string | null {
  const key = nz(value);
  if (key.includes('bangka')) return 'Bangka Belitung';
  if (key.includes('lampung')) return 'Lampung';
  if (key.includes('bengkulu')) return 'Bengkulu';
  if ((key.includes('sumatera') && key.includes('selatan')) || key === 'sumsel') return 'Sumatera Selatan';
  return null;
}

const KAB_LOOKUP: Record<string, Record<string, string>> = {};
PETA_PROV.forEach((row) => {
  KAB_LOOKUP[row.pv] = {};
});
PETA_KAB.forEach((row) => {
  KAB_LOOKUP[row.pv] = KAB_LOOKUP[row.pv] ?? {};
  KAB_LOOKUP[row.pv][kk(row.b)] = row.b;
});

const KEC_LOOKUP: Record<string, Record<string, number>> = {};
PETA_KEC.forEach((row, index) => {
  KEC_LOOKUP[row.b] = KEC_LOOKUP[row.b] ?? {};
  KEC_LOOKUP[row.b][nz(row.k)] = index;
});

export type ResolvedRegion = {
  pv: string;
  b: string | null;
  i: number;
  ks: string;
};

const resolveCache = new Map<string, ResolvedRegion | null>();

function similarity(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m || !n) return 0;
  let previous = Array.from({ length: n + 1 }, (_, index) => index);
  for (let i = 1; i <= m; i += 1) {
    const current = [i];
    for (let j = 1; j <= n; j += 1) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return 1 - previous[n] / Math.max(m, n);
}

export function resolveRegion(province: unknown, regency: unknown, district: unknown): ResolvedRegion | null {
  const cacheKey = `${province ?? ''}|${regency ?? ''}|${district ?? ''}`;
  if (resolveCache.has(cacheKey)) return resolveCache.get(cacheKey) ?? null;

  const pv = provinceName(province);
  let result: ResolvedRegion | null = null;

  if (pv) {
    result = { pv, b: null, i: -1, ks: '' };
    const kabName = KAB_LOOKUP[pv]?.[kk(regency)];
    if (kabName) {
      result.b = kabName;
      const key = nz(String(district ?? '').replace(/^\s*(kecamatan|kec\.?)\s+/i, ''));
      result.ks = key;
      if (key) {
        const lookup = KEC_LOOKUP[kabName] ?? {};
        if (lookup[key] !== undefined) {
          result.i = lookup[key];
        } else {
          let best = 0.8;
          for (const candidate of Object.keys(lookup)) {
            const score = similarity(key, candidate);
            if (score >= best) {
              best = score;
              result.i = lookup[candidate];
            }
          }
        }
      }
    }
  }

  resolveCache.set(cacheKey, result);
  return result;
}

/* ------------------------------------------------------------------ */
/* Disease grouping                                                    */
/* ------------------------------------------------------------------ */

const DISEASE_GROUPS: Record<string, Set<string>> = {};

export function diseaseGroup(target: unknown): string {
  const value = String(target ?? '').trim();
  if (!value) return value;
  const lower = value.toLowerCase();
  const group = /influenza/.test(lower) || /^(ai|aiv|hpai|lpai)([^a-z]|$)/.test(lower) ? 'Influenza' : value;
  DISEASE_GROUPS[group] = DISEASE_GROUPS[group] ?? new Set<string>();
  DISEASE_GROUPS[group].add(value);
  return group;
}

export function diseaseSubtypes(group: string): string[] {
  return [...(DISEASE_GROUPS[group] ?? [])].sort((a, b) => a.localeCompare(b, 'id'));
}

/* ------------------------------------------------------------------ */
/* Aggregation                                                         */
/* ------------------------------------------------------------------ */

export type Stat = {
  n: number;
  p: number;
  g: number;
  o: number;
  m: number;
  sp: number;
  sg: number;
  so: number;
  top: [string, number][];
};

type DiseaseBucket = [number, number, number, number, number, number, number, number];

type RawStat = Stat & {
  d: Record<string, number>;
  t: Record<string, DiseaseBucket>;
};

export type YearData = {
  prov: Map<string, RawStat>;
  kab: Map<string, RawStat>;
  kec: Map<number, RawStat>;
  unm: Map<string, number>;
};

export type MapAggregate = {
  prov: Map<string, Stat>;
  kab: Map<string, Stat>;
  kec: Map<number, Stat>;
  unm: number;
  unmList: string[];
};

const EMPTY_STAT: Stat = { n: 0, p: 0, g: 0, o: 0, m: 0, sp: 0, sg: 0, so: 0, top: [] };

export function emptyStat(): Stat {
  return { ...EMPTY_STAT, top: [] };
}

function makeRaw(): RawStat {
  return { ...EMPTY_STAT, top: [], d: {}, t: {} };
}

function addRaw(map: Map<string | number, RawStat>, key: string | number, row: MapRow, target: string | null) {
  let stat = map.get(key);
  if (!stat) {
    stat = makeRaw();
    map.set(key, stat);
  }
  const tests = Number(row.tests) || Number(row.total) || 0;
  const total = Number(row.total) || 0;
  const positive = Number(row.positive) || 0;
  const negative = Number(row.negative) || 0;
  const other = Number(row.other) || 0;

  // Statistik wilayah selalu diakumulasikan agar status peta (n/p/g/o)
  // terisi walau setiap baris membawa target penyakit.
  stat.n += tests;
  stat.p += positive;
  stat.g += negative;
  stat.o += other;
  stat.m += total;
  stat.sp += positive;
  stat.sg += negative;
  stat.so += other;

  if (target) {
    const disease = diseaseGroup(target);
    const bucket = stat.t[disease] ?? [0, 0, 0, 0, 0, 0, 0, 0];
    bucket[0] += tests;
    bucket[1] += positive;
    bucket[2] += negative;
    bucket[3] += other;
    bucket[4] += total;
    bucket[5] += positive;
    bucket[6] += negative;
    bucket[7] += other;
    stat.t[disease] = bucket;
    stat.d[disease] = (stat.d[disease] ?? 0) + positive;
  }
}

export function buildYearData(rows: MapRow[]): Map<number, YearData> {
  const years = new Map<number, YearData>();

  for (const row of rows) {
    const year = Number(row.year);
    if (!Number.isFinite(year)) continue;
    const target = row.target ? String(row.target) : null;
    const region = resolveRegion(row.province, row.regency, row.district);
    if (!region) continue;

    let data = years.get(year);
    if (!data) {
      data = { prov: new Map(), kab: new Map(), kec: new Map(), unm: new Map() };
      years.set(year, data);
    }

    addRaw(data.prov, region.pv, row, target);
    if (region.b) {
      addRaw(data.kab, region.b, row, target);
      if (region.i >= 0) {
        addRaw(data.kec, region.i, row, target);
      } else if (!target && region.ks) {
        const label = `${String(row.district ?? '').trim()} (${region.b})`;
        data.unm.set(label, (data.unm.get(label) ?? 0) + (Number(row.total) || 0));
      }
    }
  }

  return years;
}

function mergeTop(target: Record<string, number>, source: Record<string, number>, diseases: Set<string>) {
  for (const [disease, count] of Object.entries(source)) {
    if (diseases.size && !diseases.has(disease)) continue;
    target[disease] = (target[disease] ?? 0) + count;
  }
}

function mergeStat(
  target: Map<string | number, { stat: Stat; top: Record<string, number> }>,
  key: string | number,
  source: RawStat,
  diseases: Set<string>
) {
  let entry = target.get(key);
  if (!entry) {
    entry = { stat: emptyStat(), top: {} };
    target.set(key, entry);
  }

  if (diseases.size) {
    const bucket: DiseaseBucket = [0, 0, 0, 0, 0, 0, 0, 0];
    diseases.forEach((disease) => {
      const values = source.t[disease];
      if (!values) return;
      values.forEach((value, index) => {
        bucket[index] += value;
      });
    });
    if (bucket[0]) {
      entry.stat.n += bucket[0];
      entry.stat.p += bucket[1];
      entry.stat.g += bucket[2];
      entry.stat.o += bucket[3];
      entry.stat.m += bucket[4];
      entry.stat.sp += bucket[5];
      entry.stat.sg += bucket[6];
      entry.stat.so += bucket[7];
    }
    mergeTop(entry.top, source.d, diseases);
  } else {
    entry.stat.n += source.n;
    entry.stat.p += source.p;
    entry.stat.g += source.g;
    entry.stat.o += source.o;
    entry.stat.m += source.m;
    entry.stat.sp += source.sp;
    entry.stat.sg += source.sg;
    entry.stat.so += source.so;
    mergeTop(entry.top, source.d, diseases);
  }
}

export function aggregateYears(
  years: Map<number, YearData>,
  selected: Set<number>,
  diseases: Set<string>
): MapAggregate {
  const prov = new Map<string | number, { stat: Stat; top: Record<string, number> }>();
  const kab = new Map<string | number, { stat: Stat; top: Record<string, number> }>();
  const kec = new Map<string | number, { stat: Stat; top: Record<string, number> }>();
  const unmMap = new Map<string, number>();

  for (const year of selected) {
    const data = years.get(year);
    if (!data) continue;
    data.prov.forEach((stat, key) => mergeStat(prov, key, stat, diseases));
    data.kab.forEach((stat, key) => mergeStat(kab, key, stat, diseases));
    data.kec.forEach((stat, key) => mergeStat(kec, key, stat, diseases));
    data.unm.forEach((count, key) => unmMap.set(key, (unmMap.get(key) ?? 0) + count));
  }

  const finish = (source: Map<string | number, { stat: Stat; top: Record<string, number> }>) => {
    const result = new Map<string | number, Stat>();
    source.forEach((entry, key) => {
      const top = Object.entries(entry.top)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3) as [string, number][];
      result.set(key, { ...entry.stat, top });
    });
    return result;
  };

  return {
    prov: finish(prov) as Map<string, Stat>,
    kab: finish(kab) as Map<string, Stat>,
    kec: finish(kec) as Map<number, Stat>,
    unm: [...unmMap.values()].reduce((total, value) => total + value, 0),
    unmList: [...unmMap.keys()].sort((a, b) => a.localeCompare(b, 'id'))
  };
}

export function statOf(aggregate: MapAggregate, level: Level, region: PetaKec | PetaKab | PetaProv, index: number): Stat {
  if (level === 'prov') return aggregate.prov.get((region as PetaProv).pv) ?? EMPTY_STAT;
  if (level === 'kab') return aggregate.kab.get((region as PetaKab).b) ?? EMPTY_STAT;
  return aggregate.kec.get(index) ?? EMPTY_STAT;
}

export function allDiseases(years: Map<number, YearData>): string[] {
  const result = new Set<string>();
  years.forEach((data) => {
    data.prov.forEach((stat) => {
      Object.keys(stat.t).forEach((disease) => result.add(disease));
    });
  });
  return [...result].sort((a, b) => a.localeCompare(b, 'id'));
}

/* ------------------------------------------------------------------ */
/* Geometry helpers                                                    */
/* ------------------------------------------------------------------ */

export type Point = [number, number];
export type BBox = [number, number, number, number];

const numbers = (value: string): number[] => (value.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);

export function pathBBox(path: string): BBox {
  const values = numbers(path);
  const box: BBox = [Infinity, Infinity, -Infinity, -Infinity];
  for (let index = 0; index < values.length; index += 2) {
    box[0] = Math.min(box[0], values[index]);
    box[2] = Math.max(box[2], values[index]);
    box[1] = Math.min(box[1], values[index + 1]);
    box[3] = Math.max(box[3], values[index + 1]);
  }
  return box;
}

export function bboxOfPaths(paths: string[]): BBox {
  const box: BBox = [Infinity, Infinity, -Infinity, -Infinity];
  for (const path of paths) {
    const next = pathBBox(path);
    box[0] = Math.min(box[0], next[0]);
    box[1] = Math.min(box[1], next[1]);
    box[2] = Math.max(box[2], next[2]);
    box[3] = Math.max(box[3], next[3]);
  }
  return box;
}

export function centroidOfPath(path: string): { x: number; y: number; area: number } | null {
  let best: { x: number; y: number; area: number } | null = null;
  for (const part of path.split('Z')) {
    const values = numbers(part);
    if (values.length < 6) continue;
    let area = 0;
    let cx = 0;
    let cy = 0;
    for (let index = 0; index < values.length; index += 2) {
      const next = (index + 2) % values.length;
      const cross = values[index] * values[next + 1] - values[next] * values[index + 1];
      area += cross;
      cx += (values[index] + values[next]) * cross;
      cy += (values[index + 1] + values[next + 1]) * cross;
    }
    area /= 2;
    if (!area) continue;
    const magnitude = Math.abs(area);
    if (!best || magnitude > best.area) {
      best = { x: cx / (6 * area), y: cy / (6 * area), area: magnitude };
    }
  }
  return best;
}

export type Centroids = {
  kec: Array<{ x: number; y: number; area: number } | null>;
  kab: Record<string, { x: number; y: number; area: number }>;
  prov: Record<string, { x: number; y: number; area: number }>;
};

let centroidCache: Centroids | null = null;

export function centroids(): Centroids {
  if (centroidCache) return centroidCache;
  const kec = PETA_KEC.map((row) => (row.d ? centroidOfPath(row.d) : null));
  const kabAcc: Record<string, { sx: number; sy: number; a: number }> = {};
  const provAcc: Record<string, { sx: number; sy: number; a: number }> = {};

  const accumulate = (target: Record<string, { sx: number; sy: number; a: number }>, key: string, point: { x: number; y: number; area: number }) => {
    const entry = target[key] ?? { sx: 0, sy: 0, a: 0 };
    entry.sx += point.x * point.area;
    entry.sy += point.y * point.area;
    entry.a += point.area;
    target[key] = entry;
  };

  PETA_KEC.forEach((row, index) => {
    const point = kec[index];
    if (!point) return;
    accumulate(kabAcc, row.b, point);
    accumulate(provAcc, row.pv, point);
  });

  const kab: Centroids['kab'] = {};
  const prov: Centroids['prov'] = {};
  Object.entries(kabAcc).forEach(([key, value]) => {
    kab[key] = { x: value.sx / value.a, y: value.sy / value.a, area: value.a };
  });
  Object.entries(provAcc).forEach(([key, value]) => {
    prov[key] = { x: value.sx / value.a, y: value.sy / value.a, area: value.a };
  });

  centroidCache = { kec, kab, prov };
  return centroidCache;
}

export const LON_ORIGIN = 100.8;
export const LAT_ORIGIN = -1.5;
export const GEO_SCALE = 200;

export function svgToLonLat(x: number, y: number): Point {
  return [Number((LON_ORIGIN + x / GEO_SCALE).toFixed(5)), Number((LAT_ORIGIN - y / GEO_SCALE).toFixed(5))];
}

export function polygonGeometry(path: string) {
  return {
    type: 'MultiPolygon' as const,
    coordinates: path
      .split('Z')
      .filter((part) => part.trim())
      .map((part) => {
        const values = numbers(part);
        const points: Point[] = [];
        for (let index = 0; index < values.length; index += 2) {
          points.push(svgToLonLat(values[index], values[index + 1]));
        }
        if (points.length) points.push(points[0]);
        return [points];
      })
  };
}
