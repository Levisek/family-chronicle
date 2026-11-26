// An ImageAdapter for Node tests: no pixels, but the same sizes as Pillow would give.
// Returns "webp:<sha256 of the input>:<crop>:<maxSize>:<quality>" so a test can see what was asked.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { sha256Hex } = require('../../engine/sha256.js');
const { utf8 } = require('../../engine/text.js');
const { fitSize } = require('../../engine/documents.js');

// Width and height from a PNG or JPEG header.
export function imageSize(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) {
    const v = new DataView(bytes.buffer, bytes.byteOffset);
    return [v.getUint32(16), v.getUint32(20)];
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i < bytes.length) {
      const marker = bytes[i + 1], len = (bytes[i + 2] << 8) | bytes[i + 3];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return [(bytes[i + 7] << 8) | bytes[i + 8], (bytes[i + 5] << 8) | bytes[i + 6]];
      }
      i += 2 + len;
    }
  }
  throw new Error('unknown image format');
}

export function fakeImages(log = []) {
  return {
    async toWebp(bytes, mime, crop, maxSize, quality) {
      log.push({ mime, crop, maxSize, quality });
      let [w, h] = imageSize(bytes);
      if (crop) [w, h] = [crop[2] - crop[0], crop[3] - crop[1]];
      const [width, height] = fitSize(w, h, maxSize);
      return { data: utf8(`webp:${sha256Hex(bytes)}:${JSON.stringify(crop)}:${maxSize}:${quality}`), width, height };
    },
  };
}
