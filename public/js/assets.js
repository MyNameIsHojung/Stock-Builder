// Sprite loader: loads Codex-generated PNGs, keys out magenta backgrounds, crops empty margins.
export const SPRITE_NAMES = [
  'worker_hammer', 'worker_carry', 'worker_cheer', 'worker_panic',
  'crane', 'excavator', 'floor', 'roof', 'rubble',
];

const sprites = new Map(); // name -> { img: HTMLCanvasElement, w, h }

function processImage(img) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const px = data.data;
  let minX = c.width, minY = c.height, maxX = -1, maxY = -1;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      // chroma key for magenta fallback backgrounds
      if (px[i] > 200 && px[i + 1] < 70 && px[i + 2] > 200) px[i + 3] = 0;
      if (px[i + 3] > 24) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  ctx.putImageData(data, 0, 0);
  if (maxX < 0) return { img: c, w: c.width, h: c.height };
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d').drawImage(c, minX, minY, w, h, 0, 0, w, h);
  return { img: out, w, h };
}

export function loadSprites() {
  return Promise.all(
    SPRITE_NAMES.map(
      (name) =>
        new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            sprites.set(name, processImage(img));
            resolve();
          };
          img.onerror = () => {
            console.warn(`[assets] missing sprite: /assets/${name}.png — drawing placeholder shape. Run ./scripts/genAssets.sh`);
            resolve();
          };
          img.src = `/assets/${name}.png`;
        })
    )
  );
}

export function getSprite(name) {
  return sprites.get(name) || null;
}
