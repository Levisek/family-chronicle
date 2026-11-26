// The ImageAdapter of the engine (engine/documents.js) in the browser: decode with
// createImageBitmap (which applies the EXIF orientation), crop and scale on a canvas, encode with
// canvas.toBlob as WebP; a browser that gives another type (Safari before 17) gets JPEG 0.85.
// A canvas carries no metadata, so nothing of the original file's EXIF gets into the website.
(function (g) {
  'use strict';

  const toBlob = (canvas, type, q) => new Promise((resolve) => canvas.toBlob(resolve, type, q));

  const adapter = {
    async toWebp(bytes, mime, crop, maxSize, quality) {
      const bitmap = await g.createImageBitmap(new Blob([bytes], { type: mime }));
      const [sx, sy, sw, sh] = crop ? [crop[0], crop[1], crop[2] - crop[0], crop[3] - crop[1]] : [0, 0, bitmap.width, bitmap.height];
      const [width, height] = g.FCEngine.documents.fitSize(sw, sh, maxSize);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, width, height);
      bitmap.close();
      let blob = await toBlob(canvas, 'image/webp', quality / 100);
      if (!blob || blob.type !== 'image/webp') blob = await toBlob(canvas, 'image/jpeg', 0.85);
      return { data: new Uint8Array(await blob.arrayBuffer()), width, height };
    },
  };

  g.FCApp.images = { adapter };
})(window);
