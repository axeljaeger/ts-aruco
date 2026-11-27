import { expect, test } from "@playwright/test";

const SITE = "http://127.0.0.1:4174";
const BUILT = "http://127.0.0.1:4175/ts-aruco";

test.describe("demo site", () => {
  test("landing page shows QR code, marker and demo links", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${SITE}/`);
    await expect(page.locator("#marker-id")).toHaveText("108");
    await expect(page.locator("#marker-link")).toHaveAttribute("href", /marker\.html\?id=108$/);
    await expect(page.locator(".card")).toHaveCount(3);
    // The QR canvas has been drawn (not blank).
    const dark = await page.locator("#qr").evaluate((c: HTMLCanvasElement) => {
      const d = c.getContext("2d")?.getImageData(0, 0, c.width, c.height).data ?? [];
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] < 128) ++n;
      return n;
    });
    expect(dark).toBeGreaterThan(1000);
    expect(errors).toEqual([]);
  });

  test("original demos are served", async ({ request }) => {
    for (const path of [
      "samples/getusermedia/getusermedia.html",
      "samples/debug/debug.html",
      "samples/debug-posit/debug-posit.html",
      "samples/libs/polyfill.js",
      "src/aruco.js",
      "src/cv.js",
    ]) {
      const res = await request.get(`${SITE}/original/${path}`);
      expect(res.ok(), path).toBe(true);
    }
  });

  test("marker page draws the requested marker", async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 860 });
    await page.goto(`${SITE}/marker.html?id=5`);
    await expect(page.locator("#id")).toHaveText("5");
    await page.locator("#next").click();
    await expect(page.locator("#id")).toHaveText("6");
    await page.locator("#start").click();
    await expect(page.locator("#panel")).toBeHidden();
  });

  // WebGPU canvases are not composited in headless Chromium, so the demos are checked with their
  // WebGL2 renderer here. A synthetic camera shows marker 108.
  for (const [demo, mode] of [
    ["three", "cpu"],
    ["three", "webgl2"],
    ["babylon", "cpu"],
  ] as const) {
    test(`${demo} demo tracks the marker (${mode} preprocessing)`, async ({ page }) => {
      await page.addInitScript({ path: "tests/e2e/fixtures/fake-camera.js" });
      await page.goto(`${SITE}/demos/${demo}.html?mode=${mode}&renderer=webgl2`);
      await expect(page.locator("#stats")).toContainText("marker 108", { timeout: 20_000 });
      await expect(page.locator("#message")).toBeHidden();
    });
  }

  // The build as GitHub Pages serves it: under /ts-aruco/, with assets resolved relative to it.
  for (const demo of ["three", "babylon"] as const) {
    test(`built ${demo} demo loads its assets under a sub path`, async ({ page }) => {
      const failed: string[] = [];
      page.on("response", (r) => {
        if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
      });
      await page.addInitScript({ path: "tests/e2e/fixtures/fake-camera.js" });
      await page.goto(`${BUILT}/demos/${demo}.html?mode=cpu&renderer=webgl2`);
      await expect(page.locator("#stats")).toContainText("marker 108", { timeout: 20_000 });
      await expect(page.locator("#message")).toBeHidden();
      expect(failed).toEqual([]);
    });
  }
});
