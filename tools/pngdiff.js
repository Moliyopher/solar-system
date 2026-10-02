/* PNG diff tool: amplify and visualise the difference between two screenshots.
 * usage: node pngdiff.js a.png b.png out.png [threshold]
 */
'use strict';
const fs = require('fs'), zlib = require('zlib');

function readPNG(file){
  const b = fs.readFileSync(file);
  let p = 8, w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (p < b.length){
    const len = b.readUInt32BE(p), type = b.toString('ascii', p + 4, p + 8);
    if (type === 'IHDR'){
      w = b.readUInt32BE(p + 8); h = b.readUInt32BE(p + 12);
      bitDepth = b[p + 16]; colorType = b[p + 17];
    } else if (type === 'IDAT') idat.push(b.slice(p + 8, p + 8 + len));
    p += 12 + len;
  }
  if (bitDepth !== 8) throw new Error('only 8-bit PNG supported');
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0;
  if (!ch) throw new Error('unsupported color type ' + colorType);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(stride * h);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++){
    const ft = raw[y * (stride + 1)];
    const line = raw.slice(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = Buffer.alloc(stride);
    for (let i = 0; i < stride; i++){
      const a = i >= ch ? cur[i - ch] : 0, bb = prev[i], c = i >= ch ? prev[i - ch] : 0;
      let v = line[i];
      if (ft === 1) v += a;
      else if (ft === 2) v += bb;
      else if (ft === 3) v += (a + bb) >> 1;
      else if (ft === 4){
        const pp = a + bb - c, pa = Math.abs(pp - a), pb = Math.abs(pp - bb), pc = Math.abs(pp - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? bb : c);
      }
      cur[i] = v & 0xff;
    }
    cur.copy(out, y * stride);
    prev = cur;
  }
  return { w, h, ch, data: out };
}

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++){ let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return buf => { let c = -1; for (const x of buf) c = t[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
})();
function chunk(type, data){
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(td));
  return Buffer.concat([len, td, crc]);
}
function writePNG(file, w, h, rgb){
  const stride = w * 3;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++){
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))
  ]));
}

const [fa, fb, fout, thrArg, cropArg] = process.argv.slice(2);
const thr = Number(thrArg || 20);
const crop = cropArg ? cropArg.split(',').map(Number) : [0, 0, 1e9, 1e9];
const A = readPNG(fa), B = readPNG(fb);
if (A.w !== B.w || A.h !== B.h) throw new Error('size mismatch');
const rgb = Buffer.alloc(A.w * A.h * 3);
let changed = 0, total = 0;
for (let y = 0; y < A.h; y++){
  for (let x = 0; x < A.w; x++){
    const i = y * A.w + x, o = i * 3;
    const inCrop = x >= crop[0] && y >= crop[1] && x < crop[2] && y < crop[3];
    const ia = i * A.ch, ib = i * B.ch;
    const d = Math.max(Math.abs(A.data[ia] - B.data[ib]), Math.abs(A.data[ia+1] - B.data[ib+1]), Math.abs(A.data[ia+2] - B.data[ib+2]));
    if (inCrop) total++;
    if (d > thr){ if (inCrop) changed++; rgb[o] = 255; rgb[o+1] = Math.min(255, d * 3); rgb[o+2] = 0; }
    else { const g = d * 3; rgb[o] = g; rgb[o+1] = g; rgb[o+2] = g; }
  }
}
writePNG(fout, A.w, A.h, rgb);
console.log(`${fa} vs ${fb}: ${changed} px (max-channel > ${thr}) = ${(100*changed/total).toFixed(2)}% of the ${cropArg ? 'cropped region' : 'image'}  -> ${fout}`);
