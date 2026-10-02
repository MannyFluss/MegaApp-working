export function createProbes({ drawing, notify, onResult, openState }) {
  const active = new Map();
  const pending = new Map();
  let audio = null;
  const output = document.getElementById("probe-output");
  const report = (message) => {
    output.hidden = false;
    output.replaceChildren();
    const title = document.createElement("h2");
    title.textContent = "Live result";
    const pre = document.createElement("pre");
    pre.textContent =
      typeof message === "string" ? message : JSON.stringify(message, null, 2);
    output.append(title, pre);
    notify(typeof message === "string" ? message : "Live result updated.");
  };
  const running = (id, cleanup) => {
    active.set(id, cleanup);
    onResult(id, "Running");
  };
  const stop = (id) => {
    const token = pending.get(id);
    if (token) token.valid = false;
    pending.delete(id);
    const cleanup = active.get(id);
    active.delete(id);
    cleanup?.();
    onResult(id, "Stopped");
  };
  function context() {
    if (!audio) {
      const C = window.AudioContext || window.webkitAudioContext;
      audio = new C({ latencyHint: "interactive" });
    }
    return audio;
  }
  function recorder(stream, id, kind) {
    const candidates =
      kind === "audio"
        ? ["audio/mp4", "audio/webm;codecs=opus", "audio/ogg;codecs=opus"]
        : ["video/mp4", "video/webm;codecs=vp9", "video/webm"];
    const mime = candidates.find((t) => MediaRecorder.isTypeSupported(t)),
      rec = new MediaRecorder(stream, mime ? { mimeType: mime } : {}),
      chunks = [];
    let timer;
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    rec.onstop = () => {
      clearTimeout(timer);
      stream.getTracks().forEach((t) => t.stop());
      if (chunks.length) {
        const type = rec.mimeType || chunks[0].type;
        drawing.download(
          new Blob(chunks, { type }),
          `megaapp-${kind}.${type.includes("mp4") ? "mp4" : type.includes("ogg") ? "ogg" : "webm"}`,
        );
        notify("Recording saved to Downloads.");
      }
    };
    rec.onerror = (e) => {
      notify(e.error?.message || "Recording failed.");
      stop(id);
    };
    rec.start();
    timer = setTimeout(() => stop(id), 60000);
    return () => {
      clearTimeout(timer);
      if (rec.state !== "inactive") rec.stop();
      else stream.getTracks().forEach((t) => t.stop());
    };
  }
  function live(value) {
    output.hidden = false;
    let pre = output.querySelector("pre");
    if (!pre) {
      output.replaceChildren();
      pre = document.createElement("pre");
      output.append(pre);
    }
    pre.textContent =
      typeof value === "string" ? value : JSON.stringify(value, null, 2);
  }
  const actions = {
    canvas2d() {
      const c = document
        .createElement("canvas")
        .getContext("2d", { desynchronized: true });
      return (
        c.getContextAttributes?.() ||
        "Canvas 2D created. Context attributes are not exposed."
      );
    },
    p3() {
      const c = document
          .createElement("canvas")
          .getContext("2d", { colorSpace: "display-p3" }),
        a = c?.getContextAttributes?.();
      if (!a) throw new Error("Color-space attributes are not exposed.");
      if (a.colorSpace !== "display-p3")
        throw new Error("The context fell back to sRGB.");
      return a;
    },
    async worker() {
      const w = new Worker(new URL("./render-worker.js", import.meta.url), {
        type: "module",
      });
      try {
        return await new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("Worker test timed out.")),
            5000,
          );
          w.onmessage = (e) => {
            clearTimeout(timer);
            e.data.ok ? resolve(e.data) : reject(new Error(e.data.error));
          };
          w.onerror = (e) => {
            clearTimeout(timer);
            reject(new Error(e.message));
          };
          w.postMessage({});
        });
      } finally {
        w.terminate();
      }
    },
    webgl() {
      const gl = document.createElement("canvas").getContext("webgl2");
      if (!gl) throw new Error("WebGL 2 context creation was refused.");
      const info = {
        version: gl.getParameter(gl.VERSION),
        maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      };
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      return info;
    },
    async webgpu() {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) throw new Error("No WebGPU adapter is available.");
      const device = await adapter.requestDevice();
      try {
        const buffer = device.createBuffer({
          size: 16,
          usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
        });
        buffer.destroy();
        return {
          features: [...adapter.features],
          maxTextureDimension2D: adapter.limits.maxTextureDimension2D,
          deviceCreated: true,
        };
      } finally {
        device.destroy();
      }
    },
    path() {
      const c = document.createElement("canvas").getContext("2d"),
        p = new Path2D();
      p.rect(10, 10, 20, 20);
      return {
        inside: c.isPointInPath(p, 15, 15),
        outside: c.isPointInPath(p, 40, 40),
      };
    },
    "canvas-record"() {
      const stream = drawing.canvas.captureStream(30);
      try {
        running("canvas-record", recorder(stream, "canvas-record", "video"));
        return "Recording the canvas. Tap Stop to save; automatic stop after 60 seconds.";
      } catch (e) {
        stream.getTracks().forEach((t) => t.stop());
        throw e;
      }
    },
    async audio() {
      const c = context();
      await c.resume();
      const o = c.createOscillator(),
        g = c.createGain();
      o.frequency.value = 440;
      g.gain.setValueAtTime(0, c.currentTime);
      g.gain.linearRampToValueAtTime(0.07, c.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.4);
      o.connect(g).connect(c.destination);
      o.start();
      o.stop(c.currentTime + 0.42);
      o.onended = () => {
        o.disconnect();
        g.disconnect();
      };
      return {
        state: c.state,
        sampleRate: c.sampleRate,
        baseLatency: c.baseLatency ?? "Not exposed",
      };
    },
    async "offline-audio"() {
      const c = new OfflineAudioContext(1, 4410, 44100),
        o = c.createOscillator();
      o.connect(c.destination);
      o.start();
      o.stop(0.05);
      const b = await c.startRendering();
      return {
        samples: b.length,
        duration: b.duration,
        sampleRate: b.sampleRate,
      };
    },
    async "audio-worklet"() {
      const c = context();
      await c.resume();
      await c.audioWorklet.addModule(
        new URL("./audio-worklet.js", import.meta.url),
      );
      const node = new AudioWorkletNode(c, "megaapp-silence");
      node.connect(c.destination);
      await new Promise((r) => setTimeout(r, 80));
      node.disconnect();
      node.port.close();
      return "AudioWorklet loaded and processed a silent test block.";
    },
    "audio-session"() {
      return {
        type: navigator.audioSession.type,
        state: navigator.audioSession.state,
      };
    },
    async microphone(token) {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!token.valid || document.hidden) {
        stream.getTracks().forEach((t) => t.stop());
        throw new DOMException("Capture cancelled.", "AbortError");
      }
      try {
        if (typeof MediaRecorder !== "undefined")
          running("microphone", recorder(stream, "microphone", "audio"));
        else
          running("microphone", () =>
            stream.getTracks().forEach((t) => t.stop()),
          );
        return "Microphone active. Tap Stop to release it; recording stops after 60 seconds.";
      } catch (e) {
        stream.getTracks().forEach((t) => t.stop());
        throw e;
      }
    },
    async camera(token) {
      const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        }),
        video = document.createElement("video");
      if (!token.valid || document.hidden) {
        stream.getTracks().forEach((t) => t.stop());
        throw new DOMException("Capture cancelled.", "AbortError");
      }
      video.muted = true;
      video.autoplay = true;
      video.playsInline = true;
      video.className = "camera-preview";
      video.srcObject = stream;
      try {
        await video.play();
      } catch (e) {
        stream.getTracks().forEach((t) => t.stop());
        throw e;
      }
      if (!token.valid || document.hidden) {
        stream.getTracks().forEach((t) => t.stop());
        video.srcObject = null;
        throw new DOMException("Capture cancelled.", "AbortError");
      }
      running("camera", () => {
        stream.getTracks().forEach((t) => t.stop());
        video.srcObject = null;
        video.remove();
      });
      report("Camera preview stays in this page. Tap Stop to release it.");
      output.append(video);
      return { keepOutput: true };
    },
    codecs() {
      return Object.fromEntries(
        [
          "audio/mp4",
          "audio/webm;codecs=opus",
          "audio/ogg;codecs=opus",
          "audio/wav",
          "video/mp4",
          "video/webm;codecs=vp9",
        ].map((f) => [f, MediaRecorder.isTypeSupported(f)]),
      );
    },
    async webcodecs() {
      const info = Object.fromEntries(
        ["AudioEncoder", "AudioDecoder", "VideoEncoder", "VideoDecoder"].map(
          (k) => [k, typeof window[k] !== "undefined"],
        ),
      );
      if (window.AudioEncoder) {
        try {
          info.opus = (
            await AudioEncoder.isConfigSupported({
              codec: "opus",
              sampleRate: 48000,
              numberOfChannels: 1,
              bitrate: 64000,
            })
          ).supported;
        } catch (e) {
          info.opus = e.message;
        }
      }
      return info;
    },
    speech() {
      speechSynthesis.cancel();
      speechSynthesis.speak(
        new SpeechSynthesisUtterance("Hey. Make something good."),
      );
      return "Greeting queued for speech synthesis.";
    },
    "speech-recognition"() {
      const C = window.SpeechRecognition || window.webkitSpeechRecognition,
        r = new C();
      r.continuous = true;
      r.interimResults = true;
      r.onresult = (e) =>
        report([...e.results].map((x) => x[0].transcript).join(" "));
      r.onerror = (e) => {
        report(`Recognition: ${e.error}`);
        stop("speech-recognition");
      };
      r.onend = () => {
        if (active.has("speech-recognition")) stop("speech-recognition");
      };
      r.start();
      running("speech-recognition", () => {
        r.onend = null;
        r.stop();
      });
      return "Listening. Tap Stop when finished.";
    },
    "file-import"() {
      openState();
      document.getElementById("state-file").click();
      return "Choose a MegaApp sample JSON snapshot.";
    },
    async opfs() {
      const root = await navigator.storage.getDirectory(),
        name = `megaapp-probe-${crypto.randomUUID()}.txt`;
      try {
        const h = await root.getFileHandle(name, { create: true });
        if (!h.createWritable)
          throw new Error(
            "Async OPFS writing is not exposed. Older Safari requires a worker sync handle.",
          );
        const w = await h.createWritable();
        await w.write("MegaApp local file test");
        await w.close();
        return {
          readBack: await (await h.getFile()).text(),
          location: "Origin-private browser storage",
        };
      } finally {
        await root.removeEntry(name).catch(() => {});
      }
    },
    async storage() {
      const estimate = await navigator.storage.estimate();
      return {
        usageBytes: estimate.usage,
        quotaBytes: estimate.quota,
        persistenceGranted: navigator.storage.persist
          ? await navigator.storage.persist()
          : false,
      };
    },
    async offline() {
      const r = await navigator.serviceWorker.getRegistration();
      return {
        resultStatus: "Observed",
        registered: !!r,
        controllingThisPage: !!navigator.serviceWorker.controller,
        caches: await caches.keys(),
        installed:
          matchMedia("(display-mode: standalone)").matches ||
          !!navigator.standalone,
      };
    },
    async share() {
      await navigator.share({
        title: "MegaApp playground",
        url: location.href,
      });
      return "Share Sheet completed.";
    },
    async clipboard() {
      await navigator.clipboard.writeText(
        "Hey. Make something good. — MegaApp",
      );
      return "Greeting copied.";
    },
    async "clipboard-image"() {
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": drawing.image() }),
      ]);
      return "Canvas image copied.";
    },
    async fullscreen() {
      await drawing.stage.requestFullscreen();
      return "Fullscreen opened. Use the system exit gesture or Escape to leave.";
    },
    async "keyboard-lock"() {
      await drawing.stage.requestFullscreen({ keyboardLock: "browser" });
      return {
        resultStatus: "Requested",
        message:
          "Fullscreen requested with keyboard capture. Test actual shortcuts with your keyboard; older versions can ignore this option.",
      };
    },
    async "pointer-lock"() {
      await drawing.canvas.requestPointerLock();
      return {
        resultStatus:
          document.pointerLockElement === drawing.canvas
            ? "Test passed"
            : "Requested",
        message:
          document.pointerLockElement === drawing.canvas
            ? "Pointer locked. Press Escape to exit."
            : "Pointer lock requested; completion is not yet confirmed.",
      };
    },
    gamepad() {
      let frame;
      const poll = () => {
        const pads = [...navigator.getGamepads()].filter(Boolean).map((p) => ({
          id: p.id,
          axes: [...p.axes],
          buttons: p.buttons.map((b) => b.value),
        }));
        live(pads.length ? pads : "Press a button on a connected controller.");
        frame = requestAnimationFrame(poll);
      };
      running("gamepad", () => cancelAnimationFrame(frame));
      poll();
      return { keepOutput: true };
    },
    async motion(token) {
      const asks = [window.DeviceMotionEvent, window.DeviceOrientationEvent]
        .filter((C) => typeof C?.requestPermission === "function")
        .map((C) => C.requestPermission());
      if ((await Promise.all(asks)).some((p) => p !== "granted"))
        throw new Error("Sensor permission was not granted.");
      if (!token.valid || document.hidden)
        throw new DOMException("Sensors cancelled.", "AbortError");
      const read = (e) =>
        live(
          e.type === "devicemotion"
            ? {
                acceleration: e.acceleration,
                rotationRate: e.rotationRate,
                interval: e.interval,
              }
            : {
                alpha: e.alpha,
                beta: e.beta,
                gamma: e.gamma,
                absolute: e.absolute,
              },
        );
      window.addEventListener("devicemotion", read);
      window.addEventListener("deviceorientation", read);
      running("motion", () => {
        window.removeEventListener("devicemotion", read);
        window.removeEventListener("deviceorientation", read);
      });
      return "Sensor listeners active; readings need a sensor-equipped device. Tap Stop to end.";
    },
    location() {
      return new Promise((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(
          (p) =>
            resolve({
              latitude: p.coords.latitude,
              longitude: p.coords.longitude,
              accuracyMeters: p.coords.accuracy,
            }),
          (e) => reject(new Error(e.message)),
          { timeout: 10000, maximumAge: 60000 },
        ),
      );
    },
    async "wake-lock"(token) {
      const sentinel = await navigator.wakeLock.request("screen");
      if (!token.valid || document.hidden) {
        await sentinel.release();
        throw new DOMException("Wake lock cancelled.", "AbortError");
      }
      const release = () => sentinel.release();
      sentinel.addEventListener("release", () => {
        if (active.get("wake-lock") === release) {
          active.delete("wake-lock");
          onResult("wake-lock", "Released by system");
        }
      });
      running("wake-lock", release);
      return "Wake lock acquired. Tap Stop to release it.";
    },
    orientation() {
      return {
        type: screen.orientation.type,
        angle: screen.orientation.angle,
        lockExposed: typeof screen.orientation.lock === "function",
      };
    },
    async notification() {
      const permission = await Notification.requestPermission();
      if (permission !== "granted")
        throw new Error(`Notification permission: ${permission}`);
      const r = await navigator.serviceWorker.getRegistration();
      if (!r)
        throw new Error("Offline worker not ready. Reload and try again.");
      await r.showNotification("Hey. Make something good.", {
        body: "A local MegaApp notification test.",
        tag: "megaapp-test",
      });
      return "Local notification sent. Remote push is not configured.";
    },
    async badge() {
      await navigator.setAppBadge(1);
      setTimeout(() => navigator.clearAppBadge?.(), 5000);
      return "App badge set to 1; clears in five seconds.";
    },
    async midi() {
      const m = await navigator.requestMIDIAccess({ sysex: false });
      return {
        inputs: [...m.inputs.values()].map((i) => i.name),
        outputs: [...m.outputs.values()].map((i) => i.name),
      };
    },
    vibration() {
      return navigator.vibrate(25)
        ? "Vibration requested."
        : "Vibration was refused.";
    },
    appearance() {
      return Object.fromEntries(
        [
          "(prefers-color-scheme: dark)",
          "(prefers-reduced-motion: reduce)",
          "(prefers-contrast: more)",
          "(pointer: fine)",
          "(any-pointer: fine)",
          "(hover: hover)",
          "(color-gamut: p3)",
        ].map((q) => [q, matchMedia(q).matches]),
      );
    },
    async wasm() {
      const bytes = new Uint8Array([
        0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 127, 3, 2, 1, 0, 7, 10,
        1, 6, 97, 110, 115, 119, 101, 114, 0, 0, 10, 6, 1, 4, 0, 65, 42, 11,
      ]);
      const { instance } = await WebAssembly.instantiate(bytes);
      return {
        answer: instance.exports.answer(),
        sharedMemoryAvailable:
          crossOriginIsolated && typeof SharedArrayBuffer !== "undefined",
      };
    },
    async crypto() {
      const hash = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode("MegaApp"),
      );
      return {
        algorithm: "SHA-256",
        digest: [...new Uint8Array(hash)]
          .map((b) => b.toString(16).padStart(2, "0"))
          .join(""),
      };
    },
    async fetch() {
      const r = await fetch(
        new URL("../manifest.webmanifest", import.meta.url),
        { signal: AbortSignal.timeout(5000) },
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return {
        status: r.status,
        name: (await r.json()).name,
        streamingExposed: !!r.body?.getReader,
      };
    },
    async webrtc() {
      const a = new RTCPeerConnection(),
        b = new RTCPeerConnection();
      let timer;
      try {
        a.onicecandidate = (e) => {
          if (e.candidate) b.addIceCandidate(e.candidate).catch(() => {});
        };
        b.onicecandidate = (e) => {
          if (e.candidate) a.addIceCandidate(e.candidate).catch(() => {});
        };
        const send = a.createDataChannel("megaapp"),
          received = new Promise((resolve, reject) => {
            timer = setTimeout(
              () => reject(new Error("Local connection timed out.")),
              7000,
            );
            b.ondatachannel = (e) =>
              (e.channel.onmessage = (m) => resolve(m.data));
            send.onopen = () => send.send("Local data channel works.");
          });
        received.catch(() => {});
        await a.setLocalDescription(await a.createOffer());
        await b.setRemoteDescription(a.localDescription);
        await b.setLocalDescription(await b.createAnswer());
        await a.setRemoteDescription(b.localDescription);
        return await received;
      } finally {
        clearTimeout(timer);
        a.close();
        b.close();
      }
    },
  };
  async function run(id) {
    if (active.has(id) || pending.has(id)) {
      stop(id);
      report("Stopped and released resources.");
      return;
    }
    const token = { valid: true };
    pending.set(id, token);
    onResult(id, "Starting");
    try {
      const value = await actions[id](token);
      if (!token.valid) return;
      if (!active.has(id)) onResult(id, value?.resultStatus || "Test passed");
      if (!value?.keepOutput) report(value?.message || value);
    } catch (e) {
      if (!token.valid) return;
      onResult(
        id,
        e.name === "AbortError" ? "Cancelled" : "Could not complete",
      );
      report(
        e.name === "AbortError"
          ? "Cancelled."
          : `${e.name || "Error"}: ${e.message}`,
      );
    } finally {
      if (pending.get(id) === token) pending.delete(id);
    }
  }
  function stopAll() {
    for (const id of new Set([...active.keys(), ...pending.keys()])) stop(id);
    window.speechSynthesis?.cancel();
    audio?.suspend().catch(() => {});
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopAll();
    }
  });
  window.addEventListener("pagehide", stopAll);
  return { run, stopAll };
}
