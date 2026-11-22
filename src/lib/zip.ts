export type ZipEntry = {
  name: string;
  text?: string;
  bytes?: Uint8Array;
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let k = 0; k < 8; k += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[n] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    value = CRC_TABLE[(value ^ bytes[index]) & 255] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

export function createZip(entries: ZipEntry[]): Blob {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  let centralSize = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const data = entry.bytes ?? encoder.encode(entry.text ?? '');
    const checksum = crc32(data);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, 0, true);
    local.setUint16(12, 0x21, true);
    local.setUint32(14, checksum, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);

    parts.push(new Uint8Array(local.buffer), name, data);

    const directory = new DataView(new ArrayBuffer(46));
    directory.setUint32(0, 0x02014b50, true);
    directory.setUint16(4, 20, true);
    directory.setUint16(6, 20, true);
    directory.setUint16(8, 0x0800, true);
    directory.setUint16(14, 0x21, true);
    directory.setUint32(16, checksum, true);
    directory.setUint32(20, data.length, true);
    directory.setUint32(24, data.length, true);
    directory.setUint16(28, name.length, true);
    directory.setUint32(42, offset, true);
    central.push(new Uint8Array(directory.buffer), name);

    offset += 30 + name.length + data.length;
    centralSize += 46 + name.length;
  }

  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  const blobParts = [...parts, ...central, new Uint8Array(end.buffer)] as BlobPart[];
  return new Blob(blobParts, { type: 'application/zip' });
}
