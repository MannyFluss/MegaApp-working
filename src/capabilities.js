const mdn = (name) =>
  `https://developer.mozilla.org/en-US/docs/Web/API/${name}`;
const has = (obj, key) => obj != null && key in obj;
export const CAPABILITIES = [
  [
    "Drawing & graphics",
    "Canvas 2D",
    "Precise document coordinates and frame-scheduled drawing.",
    () => !!document.createElement("canvas").getContext("2d"),
    "canvas2d",
    mdn("CanvasRenderingContext2D"),
  ],
  [
    "Drawing & graphics",
    "Pointer Events",
    "Pencil, touch, mouse, hover, pressure, tilt, contact, and buttons.",
    () => typeof PointerEvent !== "undefined",
    null,
    mdn("PointerEvent"),
  ],
  [
    "Drawing & graphics",
    "Coalesced pointer samples",
    "Uses all actual samples supplied between pointer events.",
    () =>
      typeof PointerEvent !== "undefined" &&
      typeof PointerEvent.prototype.getCoalescedEvents === "function",
    null,
    mdn("PointerEvent/getCoalescedEvents"),
  ],
  [
    "Drawing & graphics",
    "Predicted pointer samples",
    "Temporary feedback; predictions never enter exported drawings.",
    () =>
      typeof PointerEvent !== "undefined" &&
      typeof PointerEvent.prototype.getPredictedEvents === "function",
    null,
    mdn("PointerEvent/getPredictedEvents"),
  ],
  [
    "Drawing & graphics",
    "Pencil orientation",
    "Altitude and azimuth telemetry. Actual values depend on hardware.",
    () =>
      typeof PointerEvent !== "undefined" &&
      has(PointerEvent.prototype, "altitudeAngle"),
    null,
    "https://webkit.org/blog/16301/webkit-features-in-safari-18-2/",
  ],
  [
    "Drawing & graphics",
    "Raw pointer events",
    "Optional path; Safari uses pointermove and coalescing.",
    () => has(window, "onpointerrawupdate"),
    null,
    mdn("Element/pointerrawupdate_event"),
  ],
  [
    "Drawing & graphics",
    "Pencil roll, squeeze & double tap",
    "Twist is exploratory. Squeeze and double tap need native integration.",
    () => false,
    null,
    "https://developer.apple.com/documentation/applepencil/handling-squeezes-from-apple-pencil",
  ],
  [
    "Drawing & graphics",
    "Retina canvas & viewport",
    "DPR-aware drawing, ResizeObserver, VisualViewport, and safe-area layout.",
    () => typeof ResizeObserver !== "undefined",
    null,
    mdn("Window/devicePixelRatio"),
  ],
  [
    "Drawing & graphics",
    "Display-P3 color",
    "Checks whether a separate context actually accepts wide-gamut color.",
    () =>
      !!document
        .createElement("canvas")
        .getContext("2d", { colorSpace: "display-p3" }),
    "p3",
    mdn("HTMLCanvasElement/getContext"),
  ],
  [
    "Drawing & graphics",
    "OffscreenCanvas worker",
    "Creates and draws a separate canvas off the main thread.",
    () =>
      typeof OffscreenCanvas !== "undefined" && typeof Worker !== "undefined",
    "worker",
    mdn("OffscreenCanvas"),
  ],
  [
    "Drawing & graphics",
    "WebGL 2",
    "Tests actual context creation and reports graphics limits.",
    () => typeof WebGL2RenderingContext !== "undefined",
    "webgl",
    mdn("WebGL2RenderingContext"),
  ],
  [
    "Drawing & graphics",
    "WebGPU",
    "Requests an adapter and device. Hardware or context can still reject it.",
    () => !!navigator.gpu,
    "webgpu",
    "https://webkit.org/blog/17333/webkit-features-in-safari-26-0/",
  ],
  [
    "Drawing & graphics",
    "Path hit testing",
    "Checks geometric selection using Path2D and isPointInPath.",
    () => typeof Path2D !== "undefined",
    "path",
    mdn("CanvasRenderingContext2D/isPointInPath"),
  ],
  [
    "Drawing & graphics",
    "Canvas recording",
    "Records this canvas. Tap again to stop and save.",
    () =>
      !!HTMLCanvasElement.prototype.captureStream &&
      typeof MediaRecorder !== "undefined",
    "canvas-record",
    mdn("HTMLCanvasElement/captureStream"),
  ],
  [
    "Sound & media",
    "Web Audio",
    "Plays a short, quiet tone using the audio clock.",
    () => !!(window.AudioContext || window.webkitAudioContext),
    "audio",
    mdn("Web_Audio_API"),
  ],
  [
    "Sound & media",
    "Offline audio rendering",
    "Renders a short sound buffer without microphone access.",
    () => typeof OfflineAudioContext !== "undefined",
    "offline-audio",
    mdn("OfflineAudioContext"),
  ],
  [
    "Sound & media",
    "AudioWorklet",
    "Loads a local audio processor and runs a silent test.",
    () => typeof AudioWorkletNode !== "undefined",
    "audio-worklet",
    mdn("AudioWorklet"),
  ],
  [
    "Sound & media",
    "Audio session",
    "Reports Safari audio-session behavior without changing its type.",
    () => !!navigator.audioSession,
    "audio-session",
    mdn("AudioSession"),
  ],
  [
    "Sound & media",
    "Microphone & recording",
    "Requests microphone access. Tap Stop to release it and save the recording.",
    () => !!navigator.mediaDevices?.getUserMedia,
    "microphone",
    mdn("MediaDevices/getUserMedia"),
  ],
  [
    "Sound & media",
    "Camera",
    "Requests camera access for a local preview. Tap Stop to end.",
    () => !!navigator.mediaDevices?.getUserMedia,
    "camera",
    mdn("MediaDevices/getUserMedia"),
  ],
  [
    "Sound & media",
    "MediaRecorder formats",
    "Checks codec support instead of assuming a container.",
    () => typeof MediaRecorder !== "undefined",
    "codecs",
    mdn("MediaRecorder/isTypeSupported_static"),
  ],
  [
    "Sound & media",
    "WebCodecs",
    "Checks audio/video exposure and an Opus audio encoding config.",
    () =>
      typeof AudioEncoder !== "undefined" ||
      typeof VideoEncoder !== "undefined",
    "webcodecs",
    mdn("WebCodecs_API"),
  ],
  [
    "Sound & media",
    "Speech synthesis",
    "Speaks a short greeting after you tap.",
    () => !!window.speechSynthesis,
    "speech",
    mdn("SpeechSynthesis"),
  ],
  [
    "Sound & media",
    "Speech recognition",
    "Listen and transcribe; may use a remote speech service.",
    () => !!(window.SpeechRecognition || window.webkitSpeechRecognition),
    "speech-recognition",
    mdn("SpeechRecognition"),
  ],
  [
    "Sound & media",
    "Media Session",
    "Available for playback controls in a future music app.",
    () => !!navigator.mediaSession,
    null,
    mdn("Media_Session_API"),
  ],
  [
    "Sound & media",
    "Picture in Picture",
    "Requires eligible loaded video; not an empty player.",
    () =>
      !!document.pictureInPictureEnabled ||
      !!HTMLVideoElement.prototype.webkitSetPresentationMode,
    null,
    mdn("Picture-in-Picture_API"),
  ],
  [
    "Sound & media",
    "Screen capture",
    "Usually absent on iPad. Canvas recording is separate.",
    () => !!navigator.mediaDevices?.getDisplayMedia,
    null,
    mdn("MediaDevices/getDisplayMedia"),
  ],
  [
    "Files & persistence",
    "IndexedDB",
    "Device-local typed sample variables, with validated JSON import/export.",
    () => !!window.indexedDB,
    null,
    mdn("IndexedDB_API"),
  ],
  [
    "Files & persistence",
    "File import & export",
    "User-selected JSON files, plus JSON, PNG, and SVG downloads.",
    () => typeof FileReader !== "undefined" && typeof Blob !== "undefined",
    "file-import",
    mdn("File_API"),
  ],
  [
    "Files & persistence",
    "Origin-private file system",
    "Creates, reads, and removes a test file in browser-owned storage.",
    () => !!navigator.storage?.getDirectory,
    "opfs",
    mdn("File_System_API"),
  ],
  [
    "Files & persistence",
    "Storage quota & persistence",
    "Checks usage and requests protection from eviction.",
    () => !!navigator.storage?.estimate,
    "storage",
    mdn("StorageManager"),
  ],
  [
    "Files & persistence",
    "External file handles",
    "Safari uses import/export; persistent Files app handles are not exposed.",
    () => typeof window.showOpenFilePicker === "function",
    null,
    mdn("Window/showOpenFilePicker"),
  ],
  [
    "Files & persistence",
    "Offline app shell",
    "Caches the playground. Browser tabs and Home Screen storage are separate.",
    () => !!navigator.serviceWorker && !!window.caches,
    "offline",
    mdn("Service_Worker_API"),
  ],
  [
    "Files & persistence",
    "Background synchronization",
    "Future Safari sync must retry on reopening; not a persistent process.",
    () => typeof window.SyncManager !== "undefined",
    null,
    mdn("Background_Synchronization_API"),
  ],
  [
    "Device & interaction",
    "Native sharing",
    "Opens the native Share Sheet for this playground.",
    () => typeof navigator.share === "function",
    "share",
    mdn("Navigator/share"),
  ],
  [
    "Device & interaction",
    "Clipboard text",
    "Copies a greeting after your action.",
    () => !!navigator.clipboard?.writeText,
    "clipboard",
    mdn("Clipboard_API"),
  ],
  [
    "Device & interaction",
    "Clipboard image",
    "Copies the canvas when PNG clipboard writing is permitted.",
    () => !!navigator.clipboard?.write && typeof ClipboardItem !== "undefined",
    "clipboard-image",
    mdn("ClipboardItem"),
  ],
  [
    "Device & interaction",
    "Fullscreen",
    "Tries fullscreen on the canvas. iPadOS keeps system gestures.",
    () => !!document.fullscreenEnabled && !!Element.prototype.requestFullscreen,
    "fullscreen",
    mdn("Fullscreen_API"),
  ],
  [
    "Device & interaction",
    "Fullscreen keyboard capture",
    "Newer Safari request; actual shortcut capture needs hardware testing.",
    () => !!document.fullscreenEnabled && !!Element.prototype.requestFullscreen,
    "keyboard-lock",
    "https://webkit.org/blog/17862/webkit-features-for-safari-26-4/",
  ],
  [
    "Device & interaction",
    "Pointer lock",
    "Optional mouse control for games; exposure is not successful locking.",
    () => !!Element.prototype.requestPointerLock,
    "pointer-lock",
    mdn("Pointer_Lock_API"),
  ],
  [
    "Device & interaction",
    "Keyboard & composition",
    "Drawing shortcuts; text fields keep native editing behavior.",
    () => typeof KeyboardEvent !== "undefined",
    null,
    mdn("KeyboardEvent"),
  ],
  [
    "Device & interaction",
    "Gamepad",
    "Polls controllers while visible. Press a controller button to expose it.",
    () => !!navigator.getGamepads,
    "gamepad",
    mdn("Gamepad_API"),
  ],
  [
    "Device & interaction",
    "Motion & orientation",
    "Requests sensor permission and shows readings. Tap Stop to end.",
    () =>
      typeof DeviceMotionEvent !== "undefined" ||
      typeof DeviceOrientationEvent !== "undefined",
    "motion",
    mdn("DeviceMotionEvent/requestPermission_static"),
  ],
  [
    "Device & interaction",
    "Geolocation",
    "One-time location request. The result stays in this page.",
    () => !!navigator.geolocation,
    "location",
    mdn("Geolocation_API"),
  ],
  [
    "Device & interaction",
    "Keep screen awake",
    "Requests screen wake lock; may be released when hidden.",
    () => !!navigator.wakeLock,
    "wake-lock",
    mdn("Screen_Wake_Lock_API"),
  ],
  [
    "Device & interaction",
    "Screen orientation",
    "Reads orientation; locking is not guaranteed.",
    () => !!screen.orientation,
    "orientation",
    mdn("ScreenOrientation"),
  ],
  [
    "Device & interaction",
    "Home Screen notifications",
    "Requires installation on iPad. Remote push needs a future server.",
    () => typeof Notification !== "undefined" && !!navigator.serviceWorker,
    "notification",
    "https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/",
  ],
  [
    "Device & interaction",
    "Home Screen badge",
    "Sets an app badge to 1, then clears it.",
    () => !!navigator.setAppBadge,
    "badge",
    "https://webkit.org/blog/14112/badging-for-home-screen-web-apps/",
  ],
  [
    "Device & interaction",
    "Web MIDI",
    "External MIDI access is currently unavailable in Safari.",
    () => !!navigator.requestMIDIAccess,
    "midi",
    mdn("Web_MIDI_API"),
  ],
  [
    "Device & interaction",
    "Bluetooth, USB, HID & serial",
    "Safari gaps; future hardware use may need a native shell or gateway.",
    () =>
      !!(
        navigator.bluetooth ||
        navigator.usb ||
        navigator.hid ||
        navigator.serial
      ),
    null,
    "https://webkit.org/tracking-prevention/",
  ],
  [
    "Device & interaction",
    "Vibration",
    "Optional feedback where exposed; unavailable in Safari.",
    () => !!navigator.vibrate,
    "vibration",
    mdn("Navigator/vibrate"),
  ],
  [
    "Device & interaction",
    "Appearance & accessibility",
    "Checks color scheme, motion, contrast, pointer, hover, and gamut.",
    () => typeof matchMedia === "function",
    "appearance",
    mdn("Window/matchMedia"),
  ],
  [
    "Compute & connections",
    "WebAssembly",
    "Runs a small compiled module locally.",
    () => typeof WebAssembly !== "undefined",
    "wasm",
    mdn("WebAssembly"),
  ],
  [
    "Compute & connections",
    "Shared memory & threads",
    "Requires cross-origin isolation headers; plain Pages hosting cannot set them.",
    () =>
      !!window.crossOriginIsolated && typeof SharedArrayBuffer !== "undefined",
    null,
    mdn("Window/crossOriginIsolated"),
  ],
  [
    "Compute & connections",
    "Web Crypto",
    "Hashes a test string. Active app code can access secrets it uses.",
    () => !!crypto.subtle,
    "crypto",
    mdn("Web_Crypto_API"),
  ],
  [
    "Compute & connections",
    "Fetch & streaming",
    "Fetches a local asset. Cloud connections later need CORS and authentication.",
    () => typeof fetch === "function",
    "fetch",
    mdn("Fetch_API"),
  ],
  [
    "Compute & connections",
    "WebSocket",
    "Future cloud or Mac gateway; no remote endpoint configured.",
    () => typeof WebSocket !== "undefined",
    null,
    mdn("WebSockets_API"),
  ],
  [
    "Compute & connections",
    "WebRTC data channels",
    "Tests a local connection. Remote connections also need signaling.",
    () => typeof RTCPeerConnection !== "undefined",
    "webrtc",
    mdn("WebRTC_API"),
  ],
  [
    "Compute & connections",
    "WebTransport",
    "Needs a compatible cloud endpoint; feature-detected here.",
    () => typeof WebTransport !== "undefined",
    null,
    "https://webkit.org/blog/17862/webkit-features-for-safari-26-4/",
  ],
  [
    "Compute & connections",
    "Passkeys",
    "Future authentication; verification needs a private service.",
    () => typeof PublicKeyCredential !== "undefined",
    null,
    mdn("Web_Authentication_API"),
  ],
  [
    "Compute & connections",
    "WebMCP",
    "Experimental agent tools, registered only when the API is exposed.",
    () =>
      !!(
        document.modelContext?.registerTool ||
        navigator.modelContext?.registerTool
      ),
    null,
    "https://webmachinelearning.github.io/webmcp/",
  ],
].map(([group, name, note, test, action, url], i) => ({
  id: `cap-${i}`,
  group,
  name,
  note,
  test,
  action,
  url,
}));
export function inspectCapabilities() {
  return CAPABILITIES.map((c) => {
    let available = false;
    try {
      available = !!c.test();
    } catch {}
    return { ...c, available };
  });
}
export function renderCapabilities({ runProbe, results = new Map() }) {
  const list = document.getElementById("capability-list"),
    search = document.getElementById("capability-search").value.toLowerCase(),
    filter = document.getElementById("capability-filter").value,
    rows = inspectCapabilities();
  const summary = document.getElementById("device-summary");
  summary.replaceChildren();
  for (const text of [
    `${rows.filter((c) => c.available).length} APIs exposed`,
    `${rows.length} capabilities checked`,
    `${devicePixelRatio || 1}× display`,
    matchMedia("(display-mode: standalone)").matches || navigator.standalone
      ? "Home Screen app"
      : "Browser tab",
    isSecureContext ? "Secure context" : "Insecure context",
  ]) {
    const span = document.createElement("span");
    span.className = "summary-item";
    span.textContent = text;
    summary.append(span);
  }
  list.replaceChildren();
  for (const group of [...new Set(rows.map((c) => c.group))]) {
    const items = rows.filter(
      (c) =>
        c.group === group &&
        (filter === "all" || c.available === (filter === "available")) &&
        `${c.name} ${c.note}`.toLowerCase().includes(search),
    );
    if (!items.length) continue;
    const section = document.createElement("section");
    section.className = "capability-group";
    const heading = document.createElement("h2");
    heading.textContent = group;
    section.append(heading);
    for (const c of items) {
      const row = document.createElement("article");
      row.className = "capability-row";
      const text = document.createElement("div");
      text.className = "capability-text";
      const title = document.createElement("h3");
      title.textContent = c.name;
      const desc = document.createElement("p");
      desc.textContent = c.note;
      const link = document.createElement("a");
      link.href = c.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Documentation";
      text.append(title, desc, link);
      const controls = document.createElement("div");
      controls.className = "capability-controls";
      const status = document.createElement("span");
      status.className = `capability-status ${c.available ? "exposed" : ""}`;
      status.textContent =
        results.get(c.action) || (c.available ? "API exposed" : "Not exposed");
      controls.append(status);
      if (c.action) {
        const button = document.createElement("button");
        button.className = "quiet-button";
        button.textContent = ["Running", "Starting"].includes(
          results.get(c.action),
        )
          ? "Stop"
          : "Try it";
        button.disabled = !c.available;
        button.onclick = () => runProbe(c.action);
        controls.append(button);
      }
      row.append(text, controls);
      section.append(row);
    }
    list.append(section);
  }
  if (!list.children.length) {
    const empty = document.createElement("p");
    empty.textContent = "No matching capabilities. Try another search.";
    list.append(empty);
  }
}
