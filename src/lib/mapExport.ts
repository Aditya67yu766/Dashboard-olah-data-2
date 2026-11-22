export type LegendItem = {
  label: string;
  variable: string;
  count: number;
  percent: number;
};

export function downloadBlob(blob: Blob, filename: string) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 4000);
}

export function downloadCsv(rows: Array<Array<string | number>>, filename: string) {
  if (!rows.length) return;
  const quote = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
  const content = rows.map((row) => row.map(quote).join(',')).join('\n');
  downloadBlob(new Blob(['\ufeff' + content], { type: 'text/csv;charset=utf-8' }), filename);
}

export function downloadJson(value: unknown, filename: string) {
  downloadBlob(new Blob([JSON.stringify(value)], { type: 'application/geo+json' }), filename);
}

function cssVariables(): Map<string, string> {
  const styles = getComputedStyle(document.documentElement);
  const names = [
    'bg', 'card', 'ink', 'muted', 'line', 'soft', 'accent', 'pos', 'neg', 'unk', 'nov',
    'map-bg1', 'map-bg2', 'map-water', 'ksep', 'halo', 'bkc', 'bpc', 'lbc'
  ];
  const result = new Map<string, string>();
  names.forEach((name) => {
    result.set(name, styles.getPropertyValue(`--${name}`).trim());
  });
  return result;
}

// Palet khusus ekspor PNG: sedikit lebih dalam dan konsisten untuk cetak,
// tanpa mengubah warna yang tampil di layar.
function pngVariables(): Map<string, string> {
  const variables = cssVariables();
  const overrides: Record<string, string> = {
    card: '#ffffff',
    ink: '#1c241d',
    muted: '#5f6a60',
    line: '#d5d8d1',
    soft: '#f0f2ed',
    accent: '#2f4a36',
    pos: '#b44530',
    neg: '#3f7c49',
    unk: '#b68616',
    nov: '#98998f',
    'map-bg1': '#fbfaf7',
    'map-water': '#eef0ea',
    'map-bg2': '#eef0ea',
    halo: 'rgba(255, 255, 255, .95)',
    ksep: 'rgba(255, 255, 255, .85)'
  };
  Object.entries(overrides).forEach(([name, value]) => variables.set(name, value));
  return variables;
}

function svgImage(
  svg: SVGSVGElement,
  viewBox: number[],
  width: number,
  height: number,
  variables: Map<string, string>
): Promise<HTMLImageElement> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  clone.setAttribute('viewBox', viewBox.join(' '));

  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent = `
    .map-shape { stroke: #6f736c; stroke-opacity: .45; stroke-width: .5px; vector-effect: non-scaling-stroke; }
    .map-boundary-kab { fill: none; stroke: #4a4d47; stroke-opacity: .88; stroke-width: 1px; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
    .map-boundary-prov { fill: none; stroke: #11160f; stroke-width: 1.9px; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
    .map-label { text-anchor: middle; dominant-baseline: central; paint-order: stroke; stroke-linejoin: round; font-family: "DM Sans", "Segoe UI", Arial, sans-serif; fill: var(--ink); stroke: var(--halo); stroke-width: .3em; }
    .map-label-kec { fill: var(--muted); opacity: .82; stroke-width: .22em; }
    .map-graticule path { fill: none; stroke: var(--muted); stroke-opacity: .28; stroke-width: .6px; stroke-dasharray: 3 4; vector-effect: non-scaling-stroke; }
    .map-graticule text { fill: var(--muted); stroke: var(--halo); stroke-width: .25em; paint-order: stroke; letter-spacing: .04em; }
    text { font-family: "DM Sans", "Segoe UI", Arial, sans-serif; }
  `;
  clone.insertBefore(style, clone.firstChild);

  const serialized = new XMLSerializer()
    .serializeToString(clone)
    .replace(/var\(--([\w-]+)\)/g, (match, name: string) => variables.get(name) || match);

  const image = new Image();
  return new Promise((resolve, reject) => {
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Peta SVG tidak dapat dirender menjadi gambar.'));
    image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(serialized);
  });
}

export async function exportMapPng(options: {
  svg: SVGSVGElement;
  viewBox: number[];
  title: string;
  subtitle: string;
  legend: LegendItem[];
  filename: string;
}) {
  const { svg, viewBox, title, subtitle, legend, filename } = options;
  const width = 1600;
  const height = 1080;
  const header = 118;
  const footer = 34;
  const mapHeight = height - header - footer;
  const ratio = width / mapHeight;

  let [x, y, w, h] = viewBox;
  if (w / h < ratio) {
    const nextW = h * ratio;
    x -= (nextW - w) / 2;
    w = nextW;
  } else {
    const nextH = w / ratio;
    y -= (nextH - h) / 2;
    h = nextH;
  }

  const variables = pngVariables();
  const image = await svgImage(svg, [x, y, w, h], width, mapHeight, variables);
  const color = (name: string, fallback: string) => variables.get(name) || fallback;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas tidak tersedia di peramban ini.');

  context.fillStyle = color('card', '#f1eadf');
  context.fillRect(0, 0, width, height);

  const gradient = context.createLinearGradient(0, header, 0, header + mapHeight);
  gradient.addColorStop(0, color('map-bg1', '#f7f2e9'));
  gradient.addColorStop(1, color('map-water', '#eae2d4'));
  context.fillStyle = gradient;
  context.fillRect(0, header, width, mapHeight);
  context.drawImage(image, 0, header, width, mapHeight);

  context.fillStyle = color('accent', '#475641');
  context.fillRect(0, 0, 14, header);
  context.fillStyle = color('ink', '#232b20');
  context.font = '700 42px "DM Sans", "Segoe UI", Arial, sans-serif';
  context.fillText(title, 48, 58);
  context.fillStyle = color('muted', '#5e6858');
  context.font = '400 21px "DM Sans", "Segoe UI", Arial, sans-serif';
  context.fillText(subtitle, 48, 96);
  context.fillStyle = color('line', '#d5d8d1');
  context.fillRect(0, header - 1, width, 1);

  const boxX = 36;
  const boxY = header + mapHeight - 196;
  const boxWidth = 380;
  const boxHeight = 160;
  context.fillStyle = color('card', '#f1eadf');
  context.fillRect(boxX, boxY, boxWidth, boxHeight);
  context.strokeStyle = color('line', '#cbbda9');
  context.lineWidth = 1.5;
  context.strokeRect(boxX, boxY, boxWidth, boxHeight);

  context.fillStyle = color('ink', '#232b20');
  context.font = '700 19px "DM Sans", "Segoe UI", Arial, sans-serif';
  context.fillText('Status wilayah', boxX + 18, boxY + 30);
  context.font = '400 17px "DM Sans", "Segoe UI", Arial, sans-serif';
  legend.slice(0, 4).forEach((item, index) => {
    const lineY = boxY + 60 + index * 26;
    context.fillStyle = color(item.variable, '#999999');
    context.beginPath();
    context.arc(boxX + 26, lineY - 5, 7, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = color('ink', '#232b20');
    context.fillText(item.label, boxX + 44, lineY);
    context.textAlign = 'right';
    context.font = '600 17px "DM Sans", "Segoe UI", Arial, sans-serif';
    context.fillText(`${item.count} (${item.percent}%)`, boxX + boxWidth - 18, lineY);
    context.textAlign = 'left';
    context.font = '400 17px "DM Sans", "Segoe UI", Arial, sans-serif';
  });

  context.fillStyle = color('muted', '#5e6858');
  context.font = '400 15px "DM Sans", "Segoe UI", Arial, sans-serif';
  context.fillText('Sumber: LAVIDA · Balai Veteriner Lampung · Batas wilayah: GADM 3.6 (disederhanakan)', 48, height - 12);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Gambar peta tidak dapat dibuat.');
  downloadBlob(blob, filename);
}
