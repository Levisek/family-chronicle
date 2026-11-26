// A ZIP archive without compression (STORE), names in UTF-8 (general purpose flag bit 11).
// Used for "download the website" and "download a backup" where the browser cannot write a folder.
//   create(files: Map<string, Uint8Array>, date: Date) -> Uint8Array
(function (g) {
  'use strict';

  const TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function dosTime(d) {
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
    const date = (Math.max(d.getFullYear() - 1980, 0) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return [time, date];
  }

  function create(files, date) {
    const enc = new TextEncoder();
    const [time, day] = dosTime(date);
    const local = [], central = [];
    let offset = 0;
    const header = (size) => { const b = new Uint8Array(size); return [b, new DataView(b.buffer)]; };
    for (const [path, data] of files) {
      const name = enc.encode(path);
      const crc = crc32(data);
      const [h, v] = header(30);
      v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x0800, true); v.setUint16(8, 0, true);
      v.setUint16(10, time, true); v.setUint16(12, day, true); v.setUint32(14, crc, true);
      v.setUint32(18, data.length, true); v.setUint32(22, data.length, true); v.setUint16(26, name.length, true); v.setUint16(28, 0, true);
      local.push(h, name, data);
      const [c, w] = header(46);
      w.setUint32(0, 0x02014b50, true); w.setUint16(4, 20, true); w.setUint16(6, 20, true); w.setUint16(8, 0x0800, true); w.setUint16(10, 0, true);
      w.setUint16(12, time, true); w.setUint16(14, day, true); w.setUint32(16, crc, true);
      w.setUint32(20, data.length, true); w.setUint32(24, data.length, true); w.setUint16(28, name.length, true);
      w.setUint32(42, offset, true);
      central.push(c, name);
      offset += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((n, b) => n + b.length, 0);
    const [e, x] = header(22);
    x.setUint32(0, 0x06054b50, true); x.setUint16(8, files.size, true); x.setUint16(10, files.size, true);
    x.setUint32(12, cdSize, true); x.setUint32(16, offset, true);
    const parts = [...local, ...central, e];
    const out = new Uint8Array(parts.reduce((n, b) => n + b.length, 0));
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  }

  const api = { crc32, create };
  if (typeof module !== 'undefined') module.exports = api;
  else (g.FCEngine = g.FCEngine || {}).zip = api;
})(typeof window !== 'undefined' ? window : globalThis);
