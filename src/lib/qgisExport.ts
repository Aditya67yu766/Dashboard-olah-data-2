import {
  PETA,
  PETA_KAB,
  PETA_KEC,
  PETA_PROV,
  STATUS_LABEL,
  centroids,
  emptyStat,
  polygonGeometry,
  statusOf,
  svgToLonLat,
  type Level,
  type MapAggregate,
  type Stat
} from './peta';
import { downloadBlob } from './mapExport';
import { createZip } from './zip';

type Point = [number, number];

type Options = {
  aggregate: MapAggregate;
  level: Level;
  yearsLabel: string;
  diseaseLabel: string;
};

const STATUS_KEYS = ['p', 'g', 'o', 'b'] as const;
// Palet diredupkan agar tidak menyala di kanvas QGIS.
const STATUS_COLORS: Record<(typeof STATUS_KEYS)[number], string> = {
  p: '214,123,110,220',
  g: '138,177,139,220',
  o: '230,198,120,220',
  b: '214,209,198,220'
};
const OUTLINE_COLOR = '70,65,55,255';
const CANVAS_COLOR = { red: 226, green: 214, blue: 198 };

const CRS = `<spatialrefsys nativeFormat="Wkt"><wkt>GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]</wkt><proj4>+proj=longlat +datum=WGS84 +no_defs</proj4><srsid>3452</srsid><srid>4326</srid><authid>EPSG:4326</authid><description>WGS 84</description><projectionacronym>longlat</projectionacronym><ellipsoidacronym>EPSG:7030</ellipsoidacronym><geographicflag>true</geographicflag></spatialrefsys>`;

const xml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const option = (name: string, value: unknown) => `<Option value="${xml(value)}" name="${name}" type="QString"/>`;

function numbers(path: string): number[] {
  return (path.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
}

function lineGeometry(path: string) {
  return {
    type: 'MultiLineString' as const,
    coordinates: path
      .split('M')
      .filter((part) => part.trim())
      .map((part) => {
        const values = numbers(part);
        const points: Point[] = [];
        for (let index = 0; index < values.length; index += 2) {
          points.push(svgToLonLat(values[index], values[index + 1]));
        }
        return points;
      })
      .filter((line) => line.length > 1)
  };
}

function featureCollection(name: string, features: unknown[]) {
  return JSON.stringify({ type: 'FeatureCollection', name, features });
}

function fillRenderer(attribute: string, counts: Record<(typeof STATUS_KEYS)[number], number>): string {
  const categories = STATUS_KEYS.map((key, index) =>
    `<category value="${STATUS_LABEL[key]}" label="${xml(`${STATUS_LABEL[key]} (${counts[key]})`)}" symbol="${index}" render="true"/>`
  ).join('');
  const symbols = STATUS_KEYS.map((key, index) =>
    `<symbol type="fill" name="${index}" alpha="1" clip_to_extent="1" force_rhr="0"><layer class="SimpleFill" enabled="1" locked="0" pass="0"><Option type="Map">${option('color', STATUS_COLORS[key])}${option('joinstyle', 'bevel')}${option('offset', '0,0')}${option('offset_unit', 'MM')}${option('outline_color', OUTLINE_COLOR)}${option('outline_style', 'solid')}${option('outline_width', '0.16')}${option('outline_width_unit', 'MM')}${option('style', 'solid')}</Option></layer></symbol>`
  ).join('');
  return `<renderer-v2 type="categorizedSymbol" attr="${attribute}" symbollevels="0" enableorderby="0" forceraster="0" referencescale="-1"><categories>${categories}</categories><symbols>${symbols}</symbols><rotation/><sizescale/></renderer-v2>`;
}

function lineRenderer(width: string, color: string): string {
  return `<renderer-v2 type="singleSymbol" symbollevels="0" enableorderby="0" forceraster="0" referencescale="-1"><symbols><symbol type="line" name="0" alpha="1" clip_to_extent="1" force_rhr="0"><layer class="SimpleLine" enabled="1" locked="0" pass="0"><Option type="Map">${option('line_color', color)}${option('line_style', 'solid')}${option('line_width', width)}${option('line_width_unit', 'MM')}${option('capstyle', 'round')}${option('joinstyle', 'round')}</Option></layer></symbol></symbols><rotation/><sizescale/></renderer-v2>`;
}

function pointRenderer(): string {
  return `<renderer-v2 type="singleSymbol" forceraster="0" symbollevels="0" enableorderby="0"><symbols><symbol type="marker" name="0" alpha="1" clip_to_extent="1" force_rhr="0"><layer class="SimpleMarker" enabled="1" locked="0" pass="0"><Option type="Map">${option('color', '0,0,0,0')}${option('outline_style', 'no')}${option('size', '0.1')}</Option></layer></symbol></symbols><rotation/><sizescale/></renderer-v2>`;
}

function labeling(
  field: string,
  useExpression: 0 | 1,
  size: number,
  weight: number,
  color: string,
  scales = false,
  halo = '255,255,255,235',
  bufferSize = '0.9',
  placement = 1
): string {
  return `<labeling type="simple"><settings calloutType="simple"><text-style fontFamily="Arial" fontSize="${size}" fontSizeUnit="Point" fontWeight="${weight}" fieldName="${xml(field)}" isExpression="${useExpression}" textColor="${color}" textOpacity="1" namedStyle="" multilineHeight="1"><text-buffer bufferDraw="1" bufferSize="${bufferSize}" bufferSizeUnits="MM" bufferColor="${halo}" bufferOpacity="1" bufferJoinStyle="128" bufferNoFill="1" bufferBlendMode="0"/><background shapeDraw="0"/><shadow shadowDraw="0"/></text-style><placement placement="${placement}" quadOffset="4" dist="0" xOffset="0" yOffset="0" centroidInside="1" centroidWhole="0" priority="5"/><rendering scaleVisibility="${scales ? 1 : 0}" obstacle="1" drawLabels="1" displayAll="0" limitNumLabels="0" labelPerPart="0" mergeLines="0" upsidedownLabels="0" zIndex="0" minFeatureSize="0"/></settings></labeling>`;
}

function countStatuses(options: Options, level: Level): Record<(typeof STATUS_KEYS)[number], number> {
  const counts = { p: 0, g: 0, o: 0, b: 0 };
  const rows = level === 'prov' ? PETA_PROV : level === 'kab' ? PETA_KAB : PETA_KEC;
  rows.forEach((row, index) => {
    const stat =
      level === 'prov'
        ? options.aggregate.prov.get(row.pv) ?? emptyStat()
        : level === 'kab'
          ? options.aggregate.kab.get((row as unknown as { b: string }).b) ?? emptyStat()
          : options.aggregate.kec.get(index) ?? emptyStat();
    counts[statusOf(stat)] += 1;
  });
  return counts;
}

function attributes(stat: Stat, prefix: string) {
  return {
    [`${prefix}_uji`]: stat.n,
    [`${prefix}_sampel`]: stat.m,
    [`${prefix}_positif`]: stat.p,
    [`${prefix}_negatif`]: stat.g,
    [`${prefix}_lain`]: stat.o,
    [`${prefix}_status`]: STATUS_LABEL[statusOf(stat)]
  };
}

export async function exportQgisPackage(options: Options) {
  const { aggregate, level, yearsLabel, diseaseLabel } = options;
  const counts = {
    kec: countStatuses(options, 'kec'),
    kab: countStatuses(options, 'kab'),
    prov: countStatuses(options, 'prov')
  };

  const kecFeatures = PETA_KEC.flatMap((row, index) => {
    if (!row.d) return [];
    const kecStat = aggregate.kec.get(index) ?? emptyStat();
    const kabStat = aggregate.kab.get(row.b) ?? emptyStat();
    const provStat = aggregate.prov.get(row.pv) ?? emptyStat();
    return [{
      type: 'Feature' as const,
      properties: {
        provinsi: row.pv,
        kabupaten: row.b,
        kecamatan: row.k,
        tahun: yearsLabel,
        penyakit: diseaseLabel,
        ...attributes(kecStat, 'kec'),
        kec_penyakit_positif: kecStat.top.map(([name, count]) => `${name} (${count})`).join('; '),
        ...attributes(kabStat, 'kab'),
        ...attributes(provStat, 'prov')
      },
      geometry: polygonGeometry(row.d)
    }];
  });

  const boundaryLine = (name: string, path: string) =>
    featureCollection(name, [{ type: 'Feature', properties: { nama: name }, geometry: lineGeometry(path) }]);

  const centroidPoints = (name: string, source: Record<string, { x: number; y: number }>) =>
    featureCollection(name, Object.entries(source).map(([nama, point]) => ({
      type: 'Feature',
      properties: { nama },
      geometry: { type: 'Point', coordinates: svgToLonLat(point.x, point.y) }
    })));

  const centroidData = centroids();

  // Urutan di layer tree: yang paling atas digambar paling akhir.
  // Label berada di atas batas, dengan halo tebal agar garis tetap terlihat di sekitar teks.
  const layers = [
    { name: 'Label Provinsi', file: 'label_provinsi', geometry: 'Point', wkb: 'Point', on: true, renderer: pointRenderer(), labels: labeling('upper("nama")', 1, 10, 75, '27,36,48,255') },
    { name: 'Label Kabupaten/Kota', file: 'label_kabupaten', geometry: 'Point', wkb: 'Point', on: level !== 'prov', renderer: pointRenderer(), labels: labeling('nama', 0, 7, 50, '47,58,70,255', false, CANVAS_RGBA, '0.9', 4) },
    {
      name: 'Label Kecamatan',
      file: 'wilayah_kecamatan',
      geometry: 'Polygon',
      wkb: 'MultiPolygon',
      on: level === 'kec',
      maxScale: '600000',
      renderer: '<renderer-v2 type="nullSymbol" forceraster="0" symbollevels="0" enableorderby="0"/>',
      labels: labeling('kecamatan', 0, 5.5, 50, '74,84,72,255', true, CANVAS_RGBA, '1.1', 4)
    },
    { name: 'Batas Provinsi', file: 'batas_provinsi', geometry: 'Line', wkb: 'MultiLineString', on: true, renderer: lineRenderer('0.7', '45,55,45,255') },
    { name: 'Batas Kabupaten/Kota', file: 'batas_kabupaten', geometry: 'Line', wkb: 'MultiLineString', on: level !== 'prov', renderer: lineRenderer('0.4', '95,90,78,255') },
    { name: 'Status Kecamatan', file: 'wilayah_kecamatan', geometry: 'Polygon', wkb: 'MultiPolygon', on: level === 'kec', renderer: fillRenderer('kec_status', counts.kec) },
    { name: 'Status Kabupaten/Kota', file: 'wilayah_kecamatan', geometry: 'Polygon', wkb: 'MultiPolygon', on: level === 'kab', renderer: fillRenderer('kab_status', counts.kab) },
    { name: 'Status Provinsi', file: 'wilayah_kecamatan', geometry: 'Polygon', wkb: 'MultiPolygon', on: level === 'prov', renderer: fillRenderer('prov_status', counts.prov) }
  ].map((layer, index) => ({ ...layer, id: `lyr${index}_${layer.file}` }));

  // QGIS menggambar dari bawah ke atas.
  const drawLayers = [...layers].reverse();
  const mapLayers = drawLayers.map((layer) =>
    `<maplayer type="vector" geometry="${layer.geometry}" wkbType="${layer.wkb}" labelsEnabled="${layer.labels ? 1 : 0}" styleCategories="AllStyleCategories" hasScaleBasedVisibilityFlag="${layer.maxScale ? 1 : 0}" minScale="${layer.maxScale ? 0 : 100000000}" maxScale="${layer.maxScale ?? 0}" readOnly="0"><id>${layer.id}</id><datasource>./data/${layer.file}.geojson</datasource><layername>${xml(layer.name)}</layername><srs>${CRS}</srs><provider encoding="UTF-8">ogr</provider>${layer.renderer}${layer.labels ?? ''}<blendMode>0</blendMode><featureBlendMode>0</featureBlendMode><layerOpacity>1</layerOpacity></maplayer>`
  ).join('');

  const treeLayers = layers.map((layer) =>
    `<layer-tree-layer id="${layer.id}" name="${xml(layer.name)}" source="./data/${layer.file}.geojson" providerKey="ogr" checked="${layer.on ? 'Qt::Checked' : 'Qt::Unchecked'}" expanded="${layer.renderer.includes('categorized') ? 1 : 0}" legend_exp="" patch_size="-1,-1" legend_split_behavior="0"><customproperties><Option/></customproperties></layer-tree-layer>`
  ).join('');

  const box = PETA.bb[''];
  const southWest = svgToLonLat(box[0], box[3]);
  const northEast = svgToLonLat(box[2], box[1]);
  const projectTitle = `Peta Wilayah Terdampak Sumbagsel - ${yearsLabel}${diseaseLabel !== 'Semua' ? ` - ${diseaseLabel}` : ''}`;

  const qgs = `<!DOCTYPE qgis PUBLIC 'http://mrcc.com/qgis.dtd' 'SYSTEM'>
<qgis version="3.28.0" projectname="${xml(projectTitle)}"><homePath path=""/><title>${xml(projectTitle)}</title><projectCrs>${CRS}</projectCrs><layer-tree-group><customproperties><Option/></customproperties>${treeLayers}<custom-order enabled="0"/></layer-tree-group><mapcanvas name="theMapCanvas" annotationsVisible="1"><units>degrees</units><extent><xmin>${(southWest[0] - 0.15).toFixed(5)}</xmin><ymin>${(southWest[1] - 0.15).toFixed(5)}</ymin><xmax>${(northEast[0] + 0.15).toFixed(5)}</xmax><ymax>${(northEast[1] + 0.15).toFixed(5)}</ymax></extent><rotation>0</rotation><destinationsrs>${CRS}</destinationsrs></mapcanvas><projectlayers>${mapLayers}</projectlayers><layerorder>${drawLayers.map((layer) => `<layer id="${layer.id}"/>`).join('')}</layerorder><properties><Gui><CanvasColorBluePart type="int">${CANVAS_COLOR.blue}</CanvasColorBluePart><CanvasColorGreenPart type="int">${CANVAS_COLOR.green}</CanvasColorGreenPart><CanvasColorRedPart type="int">${CANVAS_COLOR.red}</CanvasColorRedPart></Gui></properties></qgis>`;

  const qgzBytes = new Uint8Array(await createZip([{ name: 'Peta_Sumbagsel.qgs', text: qgs }]).arrayBuffer());

  const instruction = [
    'PETA SIAP PAKAI - Wilayah Terdampak Sumbagsel',
    `Tahun data: ${yearsLabel}`,
    `Penyakit: ${diseaseLabel}`,
    `Tingkat peta saat diekspor: ${level}`,
    '',
    'CARA PAKAI',
    '1. Ekstrak seluruh isi ZIP ini ke satu folder.',
    '2. Buka Peta_Sumbagsel.qgz dengan QGIS 3.x.',
    '3. Peta langsung tampil dengan warna status, batas wilayah, dan label seperti di dashboard web.',
    '4. Jika ingin mengubah tingkat wilayah, aktifkan layer Status Kecamatan / Kabupaten/Kota / Provinsi di panel Layers.',
    '5. Label kecamatan hanya muncul saat skala lebih dekat dari 1:600.000. Jika belum muncul, zoom lagi atau ubah Maximum Scale pada layer Label Kecamatan.',
    '',
    'ISI PAKET',
    'Peta_Sumbagsel.qgz                  : proyek QGIS (EPSG:4326)',
    'data/wilayah_kecamatan.geojson      : poligon + atribut kec_, kab_, prov_',
    'data/batas_kabupaten.geojson        : garis batas kabupaten/kota',
    'data/batas_provinsi.geojson         : garis batas provinsi',
    'data/label_provinsi.geojson         : titik label provinsi',
    'data/label_kabupaten.geojson        : titik label kabupaten/kota',
    '',
    'Sumber batas: GADM 3.6 (disederhanakan, hanya untuk visualisasi).'
  ].join('\n');

  const packageBlob = createZip([
    { name: 'Peta_Sumbagsel.qgz', bytes: qgzBytes },
    { name: 'data/wilayah_kecamatan.geojson', text: featureCollection('wilayah_kecamatan', kecFeatures) },
    { name: 'data/batas_kabupaten.geojson', text: boundaryLine('batas_kabupaten', PETA.bk) },
    { name: 'data/batas_provinsi.geojson', text: boundaryLine('batas_provinsi', PETA.bp) },
    { name: 'data/label_provinsi.geojson', text: centroidPoints('label_provinsi', centroidData.prov) },
    { name: 'data/label_kabupaten.geojson', text: centroidPoints('label_kabupaten', centroidData.kab) },
    { name: 'PETUNJUK.txt', text: instruction }
  ]);

  const slug = (value: string) => value.replace(/[^\w-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  downloadBlob(packageBlob, `qgis_peta_sumbagsel_${slug(yearsLabel)}.zip`);
}

const CANVAS_RGBA = `${CANVAS_COLOR.red},${CANVAS_COLOR.green},${CANVAS_COLOR.blue},255`;
