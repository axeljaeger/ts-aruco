import { describe, expect, test } from "vitest";
import { Flight } from "../../site/src/common/flight.js";
import type { MarkerPose } from "../../site/src/common/tracker.js";

const pose = (x: number, z = -6): MarkerPose => ({
  id: 108,
  position: [x, 0, z],
  quaternion: [0, 0, 0, 1],
  error: 0,
});

/** Feeds 30 fps poses and returns the plane x position after each one. */
function run(xs: number[]): number[] {
  const flight = new Flight();
  const out: number[] = [];
  xs.forEach((x, i) => {
    const t = 1000 + i * 33;
    flight.update([pose(x)], t);
    out.push(flight.step(16, t).position[0]);
  });
  return out;
}

describe("pose filter", () => {
  test("damps jitter of a still marker", () => {
    let s = 7;
    const noise = () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return (s / 0x7fffffff - 0.5) * 0.04;
    };
    const xs = Array.from({ length: 90 }, () => noise());
    const ys = run(xs).slice(30);
    const spread = (a: number[]) => Math.max(...a) - Math.min(...a);
    expect(spread(ys)).toBeLessThan(spread(xs.slice(30)) * 0.5);
  });

  test("follows a moving marker with little lag", () => {
    // 6 marker lengths per second, a brisk hand movement.
    const xs = Array.from({ length: 30 }, (_, i) => i * 0.033 * 6);
    const ys = run(xs);
    const lag = (xs.at(-1) ?? 0) - (ys.at(-1) ?? 0);
    expect(lag).toBeGreaterThanOrEqual(0);
    expect(lag).toBeLessThan(0.15);
  });
});
