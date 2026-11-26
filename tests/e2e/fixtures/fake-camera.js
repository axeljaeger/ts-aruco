// Replaces getUserMedia with a 1280x720 canvas stream showing ArUco marker 108 that slowly moves
// and tilts, so the demos can be tested without a camera. Use with page.addInitScript().
(() => {
  const ROWS = [
    [1, 0, 0, 0, 0],
    [1, 0, 1, 1, 1],
    [0, 1, 0, 0, 1],
    [0, 1, 1, 1, 0],
  ];
  const id = 108;
  function fakeStream() {
    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext("2d");
    const start = performance.now();
    const draw = () => {
      const t = (performance.now() - start) / 1000;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const g = ctx.createLinearGradient(0, 0, 1280, 720);
      g.addColorStop(0, "#6b7a8f");
      g.addColorStop(1, "#c9b79c");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 1280, 720);
      const size = 230;
      const x = 640 + Math.sin(t * 0.8) * 260;
      const y = 360 + Math.sin(t * 1.1) * 90;
      ctx.translate(x, y);
      ctx.rotate(Math.sin(t * 0.5) * 0.5);
      ctx.transform(1, 0, Math.sin(t * 0.7) * 0.15, 1, 0, 0);
      const cell = size / 9;
      ctx.fillStyle = "#fff";
      ctx.fillRect(-size / 2, -size / 2, size, size);
      ctx.fillStyle = "#000";
      ctx.fillRect(-size / 2 + cell, -size / 2 + cell, 7 * cell, 7 * cell);
      ctx.fillStyle = "#fff";
      for (let r = 0; r < 5; ++r) {
        const code = ROWS[(id >> (2 * (4 - r))) & 3];
        for (let c = 0; c < 5; ++c) {
          if (code[c])
            ctx.fillRect(
              -size / 2 + (2 + c) * cell,
              -size / 2 + (2 + r) * cell,
              cell + 0.5,
              cell + 0.5,
            );
        }
      }
      requestAnimationFrame(draw);
    };
    draw();
    return canvas.captureStream(30);
  }
  navigator.mediaDevices.getUserMedia = async () => fakeStream();
})();
