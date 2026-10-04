const VERSION = "megaapp-shell-v19";
const WORKING = self.location.pathname.startsWith("/MegaApp-working/");
const CACHE_PREFIX = WORKING ? "megaapp-working-shell-" : "megaapp-shell-";
const CACHE_VERSION = WORKING ? VERSION.replace("megaapp-shell-", CACHE_PREFIX) : VERSION;
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./files-demo.css",
  "./reading.css",
  "./meta.css",
  "./frontend.css",
  "./moments.css",
  "./src/moments.js",
  "./src/moment-record.js",
  "./src/moment-replay.js",
  "./src/input.js",
  "./src/design.js",
  "./src/design-content.js",
  "./docs/design.md",
  "./docs/design-dictionary.md",
  "./src/meta.js",
  "./src/environment.js",
  "./src/pdf-workspace.js",
  "./src/reading.js",
  "./src/reading-git.js",
  "./src/reading-assets.js",
  "./src/reading-library.js",
  "./src/reading-config.js",
  "./output/pdf/a-place-for-papers.pdf",
  "./reading/git-guide.html",
  "./vendor/pdfjs/pdf.mjs",
  "./vendor/pdfjs/pdf.worker.mjs",
  "./vendor/pdfjs/standard_fonts/FoxitDingbats.pfb",
  "./vendor/pdfjs/standard_fonts/FoxitFixed.pfb",
  "./vendor/pdfjs/standard_fonts/FoxitFixedBold.pfb",
  "./vendor/pdfjs/standard_fonts/FoxitFixedBoldItalic.pfb",
  "./vendor/pdfjs/standard_fonts/FoxitFixedItalic.pfb",
  "./vendor/pdfjs/standard_fonts/FoxitSerif.pfb",
  "./vendor/pdfjs/standard_fonts/FoxitSerifBold.pfb",
  "./vendor/pdfjs/standard_fonts/FoxitSerifBoldItalic.pfb",
  "./vendor/pdfjs/standard_fonts/FoxitSerifItalic.pfb",
  "./vendor/pdfjs/standard_fonts/FoxitSymbol.pfb",
  "./vendor/pdfjs/standard_fonts/LiberationSans-Bold.ttf",
  "./vendor/pdfjs/standard_fonts/LiberationSans-BoldItalic.ttf",
  "./vendor/pdfjs/standard_fonts/LiberationSans-Italic.ttf",
  "./vendor/pdfjs/standard_fonts/LiberationSans-Regular.ttf",
  "./vendor/pdfjs/wasm/jbig2.wasm",
  "./vendor/pdfjs/wasm/jbig2_nowasm_fallback.js",
  "./vendor/pdfjs/wasm/openjpeg.wasm",
  "./vendor/pdfjs/wasm/openjpeg_nowasm_fallback.js",
  "./vendor/pdfjs/wasm/qcms_bg.wasm",
  "./vendor/pdfjs/wasm/quickjs-eval.js",
  "./vendor/pdfjs/wasm/quickjs-eval.wasm",
  "./favicon.svg",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./src/app.js",
  "./src/files-demo.js",
  "./src/file-repository.js",
  "./src/file-workspace.js",
  "./src/file-export.js",
  "./src/file-fingerprint.js",
  "./src/mock-drive.js",
  "./src/drive-adapter.js",
  "./src/intro.js",
  "./src/canvas.js",
  "./src/marble.js",
  "./src/marble-physics.js",
  "./src/platformer.js",
  "./src/platformer-engine.js",
  "./src/state.js",
  "./src/capabilities.js",
  "./src/probes.js",
  "./src/render-worker.js",
  "./src/audio-worklet.js",
  "./src/webmcp.js",
  "./reading/care-and-consequence.html",
];
const urls = new Set(ASSETS.map((p) => new URL(p, self.location).href));
// A new shell must not inherit still-fresh HTTP responses from the old app.
self.addEventListener("install", (event) =>
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) =>
        cache.addAll(
          [...urls].map((url) => new Request(url, { cache: "reload" })),
        ),
      ),
  ),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key.startsWith(CACHE_PREFIX) && key !== CACHE_VERSION)
          await caches.delete(key);
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  requestUrl.hash = "";
  // Storage mode is UI configuration; both modes use the same offline shell.
  // Broker APIs and file bytes remain outside this exact asset allowlist.
  if (event.request.mode === "navigate" &&
      [new URL("./", self.location).pathname, new URL("./index.html", self.location).pathname].includes(requestUrl.pathname))
    requestUrl.search = "";
  if (event.request.method !== "GET" || !urls.has(requestUrl.href)) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      try {
        // Revalidate online assets; the shell cache still handles offline use.
        const response = await fetch(event.request, { cache: "no-cache" });
        if (response.ok) await cache.put(requestUrl.href, response.clone());
        return response;
      } catch {
        const saved = await cache.match(requestUrl.href);
        if (saved) return saved;
        return new Response(
          "Open MegaApp online once to prepare offline use.",
          { status: 503, headers: { "Content-Type": "text/plain" } },
        );
      }
    })(),
  );
});
