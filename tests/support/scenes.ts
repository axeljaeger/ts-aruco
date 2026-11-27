import { type MarkerPlacement, renderScene, rng } from "./synthetic.js";

/** Random marker scene as base64 RGBA, for passing to a browser page. */
export function scene(seed: number, width: number, height: number) {
  const random = rng(seed);
  const markers: MarkerPlacement[] = [];
  const count = 1 + (seed % 3);
  for (let i = 0; i < count; ++i) {
    const size = 70 + random() * 90;
    const cx = size + random() * (width - 2 * size);
    const cy = size + random() * (height - 2 * size);
    const angle = random() * Math.PI * 2;
    markers.push({
      id: Math.floor(random() * 1024),
      corners: [0, 1, 2, 3].map((k) => {
        const a = angle + (k * Math.PI) / 2 - (3 * Math.PI) / 4;
        const r = (size / Math.SQRT2) * (0.85 + random() * 0.3);
        return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
      }),
    });
  }
  const image = renderScene({ width, height, markers, noise: 6, seed, samples: 2 });
  return Buffer.from(image.data.buffer).toString("base64");
}
