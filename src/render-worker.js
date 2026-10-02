self.onmessage = () => {
  try {
    const canvas = new OffscreenCanvas(64, 64),
      ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Worker 2D context unavailable.");
    ctx.fillStyle = "#3558f5";
    ctx.fillRect(0, 0, 64, 64);
    const pixel = Array.from(ctx.getImageData(0, 0, 1, 1).data);
    let webgl2 = false;
    try {
      webgl2 = !!new OffscreenCanvas(4, 4).getContext("webgl2");
    } catch {}
    self.postMessage({ ok: true, pixel, webgl2 });
  } catch (e) {
    self.postMessage({ ok: false, error: e.message });
  }
};
