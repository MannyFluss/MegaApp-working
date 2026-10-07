import { createCanvas } from "./canvas.js";
import { createMarbleMusic } from "./marble.js";
import { createPlatformer } from "./platformer.js";
import { createIntro } from "./intro.js";
import { createMeta } from "./meta.js";
import { createReading } from "./reading.js";
import { readingPrefix } from "./reading-style.js";
import { createFilesDemo } from "./files-demo.js";
import { validateScene } from "./marble-physics.js";
import {
  createSampleStore,
  parseValue,
  serializeValue,
  validateSnapshot,
} from "./state.js";
import { renderCapabilities } from "./capabilities.js";
import { createProbes } from "./probes.js";
import { registerAgentTools } from "./webmcp.js";
import { storageName } from "./environment.js";
import { createInputSystem } from "./input.js";
import { createDesign } from "./design.js";
import { createMoments } from "./moments.js";
import { createTaste } from "./taste.js";

const $ = (id) => document.getElementById(id);
let moments;
const input = createInputSystem();
let toastTimer, store;
function notify(text) {
  $("toast").textContent = text;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 6000);
}
const rawStoreReady = createSampleStore();
function sceneFromRows(rows) {
  const row = rows.find((value) => value.name === "apps.marble.scene");
  if (!row) return null;
  if (row.type !== "object")
    throw new Error("apps.marble.scene needs a Marble Music scene object.");
  return validateScene(row.value);
}
// Route external edits through the open instrument so pending saves cannot
// overwrite an imported scene. The instrument's own saves use the raw store.
const storeReady = rawStoreReady.then((raw) => ({
  ...raw,
  set(name, type, value) {
    if (name !== "apps.marble.scene") return raw.set(name, type, value);
    const scene = sceneFromRows([{ name, type, value }]);
    return marble.replaceSavedScene(scene, () => raw.set(name, type, scene));
  },
  setMany(values) {
    return values.some(row => row.name === 'apps.marble.scene')
      ? marble.replaceSavedScene(sceneFromRows(values), () => raw.setMany(values))
      : raw.setMany(values);
  },
  remove(name) {
    return name === "apps.marble.scene"
      ? marble.replaceSavedScene(null, () => raw.remove(name))
      : raw.remove(name);
  },
  replace(value) {
    const validated = validateSnapshot(value);
    const scene = sceneFromRows(validated.variables);
    return marble.replaceSavedScene(scene, () => raw.replace(validated));
  },
  reset() {
    return marble.replaceSavedScene(null, () => raw.reset());
  },
}));
const drawing = createCanvas({
  notify,
  onSettings: async (name, type, value) => {
    try {
      store = await storeReady;
      await store.set(name, type, value);
      renderState();
    } catch (e) {
      notify(`Value could not be saved: ${e.message}`);
    }
  },
});
const marble = createMarbleMusic({
  notify,
  loadScene: storeReady.then(
    (value) =>
      value
        .rows()
        .find(
          (row) => row.name === "apps.marble.scene" && row.type === "object",
        )?.value ?? null,
  ),
  onSave: async (scene) => {
    const raw = await rawStoreReady;
    await raw.set("apps.marble.scene", "object", scene);
    store = await storeReady;
    renderState();
  },
});
const platformer = createPlatformer({ notify });
platformer.setVisible(false);
const files = createFilesDemo({ notify });
const reading = createReading({ notify, stateReady: storeReady, onRepositorySaved: () => { storeReady.then((value) => { store = value; renderState(); }); } });
const design = createDesign({ input, notify, onFeedback: () => moments?.keep({ feedback: true }), onMoment: event => moments?.record(event), onSettings: async ({ response, settling }) => {
  store = await storeReady;
  await store.set("system.input.response", "number", response);
  await store.set("system.input.settling", "number", settling);
  renderState();
  applyPreferences();
} });
const taste = createTaste({ notify, onMoment: event => moments?.record(event) });
const tabs = [...document.querySelectorAll("[data-panel]")];
const results = new Map();
const lastAppKey = storageName("megaapp.last-app.v1");
let activePanel = "marble", meta, resumeAfterMeta, resumeAfterMoment;
function updateAppVisibility() {
  const working = !meta?.isOpen() && !moments?.isOpen();
  marble.setVisible(working && activePanel === "marble");
  platformer.setVisible(working && activePanel === "jump");
  files.setVisible(activePanel === "files");
  reading.setVisible(working && activePanel === "reading");
  design.setVisible(working && activePanel === "design");
  taste.setVisible(working && activePanel === "taste");
}
function focusApp() {
  const panel = $(`panel-${activePanel}`);
  panel.tabIndex = -1;
  panel.focus({ preventScroll: true });
}
function selectTab(tab, { route = true, focus = route } = {}) {
  for (const t of tabs) {
    const active = t === tab;
    t.setAttribute("aria-selected", String(active));
    t.tabIndex = active ? 0 : -1;
    t.classList.toggle("selected", active);
    $(`panel-${t.dataset.panel}`).hidden = !active;
  }
  activePanel = tab.dataset.panel;
  try { localStorage.setItem(lastAppKey, activePanel); } catch { /* Resume is optional. */ }
  if (activePanel === "canvas") drawing.resize();
  updateAppVisibility();
  if (tab.dataset.panel === "device") renderDevice();
  if (route)
    history.replaceState(
      null,
      "",
      `${location.pathname}${location.search}#${tab.dataset.panel}`,
    );
  const wasOpen = meta?.isOpen();
  if (wasOpen) meta.close({ restoreFocus: false });
  if (focus || wasOpen) focusApp();
  if (route && !input.reduced) input.present($(`panel-${activePanel}`));
  moments?.appChanged(activePanel);
}
function selectFromHash() {
  const tab = tabs.find((value) => `#${value.dataset.panel}` === location.hash);
  let resumed;
  if (!location.hash) {
    try { resumed = tabs.find((value) => value.dataset.panel === localStorage.getItem(lastAppKey)); }
    catch { /* Local storage is optional. */ }
  }
  selectTab(tab || resumed || $("tab-marble"), { route: Boolean(resumed), focus: false });
}
window.addEventListener("hashchange", selectFromHash);
const openState = () => selectTab($("tab-state"));
const probes = createProbes({
  drawing,
  notify,
  openState,
  onResult: (id, value) => {
    results.set(id, value);
    renderDevice();
  },
});
function renderDevice() {
  renderCapabilities({ runProbe: probes.run, results });
}
meta = createMeta({
  input,
  onReading: async (enabled, prefix) => {
    store = await storeReady;
    await store.setMany([{ name: 'system.reading.emphasis', type: 'boolean', value: enabled }, { name: 'system.reading.prefix', type: 'number', value: readingPrefix(prefix) }]); renderState(); applyPreferences();
    moments?.record({ kind: 'action', app: activePanel, action: 'Set reading preference', outcome: `Word emphasis ${enabled ? `on, ${Math.round(readingPrefix(prefix) * 100)}% beginning` : 'off'}`, context: activePanel === 'design' ? design.captureContext() : { app: activePanel, coverage: 'Declared reading preference only', reading: { wordEmphasis: enabled, prefix: readingPrefix(prefix) } } });
    return store.mode !== 'session';
  },
  onReadingFont(info, action, result) {
    applyPreferences();
    if (action) moments?.record({ kind: 'action', app: activePanel, action: 'Set reading font', outcome: action === 'remove' ? `Removed device font${result?.persistent === false ? ' for this session; saved font could not be cleared' : ''}` : `${info?.enabled ? 'Using' : 'Paused'} ${info?.name || 'device font'}`, context: activePanel === 'design' ? design.captureContext() : { app: activePanel, coverage: 'Declared reading font metadata only', reading: { font: info } } });
  },
  onReach: async side => {
    store = await storeReady; await store.set("system.meta.side", "string", side); renderState(); applyPreferences();
    moments?.record({ kind: "action", app: activePanel, action: "Set Meta reach", outcome: `Saved ${side} reach`, context: activePanel === "design" ? { ...design.captureContext(), meta: { side } } : { app: activePanel, coverage: "Meta reach preference only", meta: { side } } });
    return store.mode !== "session";
  },
  onOpenChange(open) {
    if (open) resumeAfterMeta = {
      panel: activePanel,
      marble: $("marble-play").getAttribute("aria-pressed") === "true",
      jump: $("platformer-canvas").dataset.phase === "playing",
    };
    updateAppVisibility();
    if (!open) {
      if (resumeAfterMeta?.panel === activePanel && !document.hidden) {
        if (resumeAfterMeta.marble && activePanel === "marble") $("marble-play").click();
        if (resumeAfterMeta.jump && activePanel === "jump" && $("platformer-canvas").dataset.phase === "paused") $("platformer-play").click();
      }
      resumeAfterMeta = null;
    }
  },
  focusApp,
});
moments = createMoments({ getApp: () => activePanel, getDesignContext: () => design.captureContext(), closeMeta: () => meta.close({ restoreFocus: false }), notify,
  onOpenChange(open) {
    if (open) resumeAfterMoment = { panel: activePanel, marble: $("marble-play").getAttribute("aria-pressed") === "true", jump: $("platformer-canvas").dataset.phase === "playing" };
    updateAppVisibility();
    if (!open) {
      if (resumeAfterMoment?.panel === activePanel && !document.hidden) {
        if (resumeAfterMoment.marble && activePanel === "marble") $("marble-play").click();
        if (resumeAfterMoment.jump && activePanel === "jump" && $("platformer-canvas").dataset.phase === "paused") $("platformer-play").click();
      }
      resumeAfterMoment = null;
    }
  },
});
for (const tab of tabs) {
  tab.onclick = () => selectTab(tab);
  tab.onkeydown = (e) => {
    if (
      ![
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Home",
        "End",
      ].includes(e.key)
    )
      return;
    e.preventDefault();
    const i = tabs.indexOf(tab),
      next =
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? tabs.length - 1
            : (i +
                (["ArrowRight", "ArrowDown"].includes(e.key)
                  ? 1
                  : tabs.length - 1)) %
              tabs.length;
    for (const value of tabs) value.tabIndex = value === tabs[next] ? 0 : -1;
    tabs[next].focus();
  };
}
for (const id of ["capability-search", "capability-filter"])
  $(id).addEventListener("input", renderDevice);
$("refresh-capabilities").onclick = renderDevice;
$("panel-device").insertBefore($("probe-output"), $("capability-list"));
function connection() {
  $("connection-status").textContent = navigator.onLine ? "Online" : "Offline";
}
window.addEventListener("online", connection);
window.addEventListener("offline", connection);
connection();
$("install-help").onclick = () => $("install-dialog").showModal();
const colorScheme = matchMedia("(prefers-color-scheme: dark)");
function applyPreferences() {
  if (!store) return;
  const values = Object.fromEntries(store.rows().map((r) => [r.name, r])),
    preference = values["system.theme"]?.value;
  document.documentElement.dataset.theme =
    preference === "dark" || preference === "light"
      ? preference
      : colorScheme.matches
        ? "dark"
        : "light";
  const nextTheme =
    document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  $("theme-toggle").setAttribute("aria-label", `Switch to ${nextTheme} theme`);
  $("theme-toggle").title = `Switch to ${nextTheme} theme`;
  input.configure(values);
  design.applyReadingPreference(values['system.reading.emphasis']?.value === true, values['system.reading.prefix']?.value, meta?.readingFontInfo());
  meta?.configure(values);
  design.applySettings();
  drawing.applySettings(values);
  drawing.redraw();
  marble.redraw();
  platformer.redraw();
  reading.redraw();
}
colorScheme.addEventListener("change", applyPreferences);
$("theme-toggle").onclick = async () => {
  try {
    store = await storeReady;
    const theme =
      document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    await store.set("system.theme", "string", theme);
    applyPreferences();
    renderState();
  } catch (e) {
    notify(e.message);
  }
};
$("canvas-fullscreen").onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (drawing.stage.requestFullscreen)
      await drawing.stage.requestFullscreen();
    else
      notify(
        "Fullscreen is not exposed here. Add to Home Screen for an app window.",
      );
  } catch (e) {
    notify(e.message);
  }
};

function renderState() {
  if (!store) return;
  $("storage-status").textContent =
    store.mode === "session" ? "Session only" : "Saved on this device";
  const list = $("variable-list");
  list.replaceChildren();
  for (const row of store.rows()) {
    const item = document.createElement("article");
    item.className = "variable-row";
    const label = document.createElement("div");
    label.className = "variable-label";
    const name = document.createElement("strong");
    name.textContent = row.name;
    const type = document.createElement("span");
    type.className = "type-label";
    type.textContent = row.type;
    label.append(name, type);
    const value = document.createElement("code");
    value.textContent = serializeValue(row);
    const actions = document.createElement("div");
    actions.className = "variable-row-actions";
    const edit = document.createElement("button");
    edit.className = "quiet-button";
    edit.textContent = "Edit";
    edit.setAttribute("aria-label", `Edit ${row.name}`);
    edit.onclick = () => {
      $("variable-name").value = row.name;
      $("variable-type").value = row.type;
      $("variable-value").value = serializeValue(row);
      $("variable-error").hidden = true;
      $("variable-value").focus();
    };
    const remove = document.createElement("button");
    remove.className = "quiet-button";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove ${row.name}`);
    remove.onclick = async () => {
      try {
        await store.remove(row.name);
        renderState();
        applyPreferences();
        notify("Sample value removed.");
      } catch (e) {
        notify(e.message);
      }
    };
    actions.append(edit, remove);
    item.append(label, value, actions);
    list.append(item);
  }
  if (!list.children.length) {
    const empty = document.createElement("p");
    empty.textContent = "Add your first sample value above.";
    list.append(empty);
  }
}
$("variable-type").onchange = () => {
  const type = $("variable-type").value;
  $("variable-value").value = {
    string: "",
    number: "120",
    boolean: "true",
    object: "{}",
    array: "[]",
    null: "null",
  }[type];
};
$("variable-form").onsubmit = async (e) => {
  e.preventDefault();
  const button = e.submitter;
  button.disabled = true;
  try {
    store = await storeReady;
    const name = $("variable-name").value.trim(),
      type = $("variable-type").value,
      value = parseValue(type, $("variable-value").value);
    await store.set(name, type, value);
    renderState();
    applyPreferences();
    $("variable-error").hidden = true;
    notify(
      store.mode === "session"
        ? "Value saved for this session. Export to keep a copy."
        : "Value saved on this device.",
    );
  } catch (error) {
    $("variable-error").textContent = error.message;
    $("variable-error").hidden = false;
  } finally {
    button.disabled = false;
  }
};
$("export-state").onclick = async () => {
  store = await storeReady;
  drawing.download(
    new Blob([JSON.stringify(store.snapshot())], {
      type: "application/json",
    }),
    "megaapp-sample.json",
  );
  notify("Sample snapshot ready in Downloads.");
};
$("import-state").onclick = () => $("state-file").click();
$("state-file").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    if (file.size > 2 * 1024 * 1024)
      throw new Error("Keep sample snapshots below 2 MB.");
    const snapshot = validateSnapshot(JSON.parse(await file.text()));
    store = await storeReady;
    await store.replace(snapshot);
    renderState();
    applyPreferences();
    notify("Sample snapshot imported.");
  } catch (error) {
    notify(`Import failed; existing values were kept. ${error.message}`);
  } finally {
    e.target.value = "";
  }
};
$("reset-state").onclick = async () => {
  try {
    store = await storeReady;
    await store.reset();
    renderState();
    applyPreferences();
    notify("Sample values reset.");
  } catch (e) {
    notify(e.message);
  }
};
storeReady
  .then((value) => {
    store = value;
    renderState();
    applyPreferences();
    if (store.warning) notify(store.warning);
    registerAgentTools({
      store,
      renderState: () => {
        renderState();
        applyPreferences();
      },
      openState,
    });
  })
  .catch((e) => notify(`Sample storage could not open: ${e.message}`));
renderDevice();
selectFromHash();
createIntro();
if ("serviceWorker" in navigator && isSecureContext) {
  navigator.serviceWorker
    .register("./sw.js")
    .then((registration) => {
      const offerUpdate = () => {
        if (!registration.waiting) return;
        let button = $("update-app");
        if (!button) {
          button = document.createElement("button");
          button.id = "update-app";
          button.className = "quiet-button";
          button.textContent = "Update ready";
          document.querySelector(".topbar-actions").prepend(button);
        }
        button.onclick = () => {
          navigator.serviceWorker.addEventListener(
            "controllerchange",
            () => location.reload(),
            { once: true },
          );
          registration.waiting.postMessage("SKIP_WAITING");
        };
      };
      offerUpdate();
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        worker?.addEventListener("statechange", () => {
          if (
            worker.state === "installed" &&
            navigator.serviceWorker.controller
          )
            offerUpdate();
        });
      });
    })
    .catch(() =>
      notify(
        "Offline setup could not finish. Reload while online to try again.",
      ),
    );
}
