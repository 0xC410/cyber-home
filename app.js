const STORAGE_KEY = "cyber_home_config_v5";
const WEATHER_CACHE_KEY = "cyber_home_weather_cache_v2";
const EXTERNAL_DEFAULTS = window.CYBER_HOME_DEFAULTS || window.CYBER_BENTO_DEFAULTS || {};
const FALLBACK_COORDS = EXTERNAL_DEFAULTS.weatherFallback || { name: "LONDON", lat: 51.5072, lon: -0.1276 };

const DEFAULT_CATEGORIES =
  Array.isArray(EXTERNAL_DEFAULTS.categories) && EXTERNAL_DEFAULTS.categories.length > 0
    ? EXTERNAL_DEFAULTS.categories
    : [
        {
          id: "primary",
          name: "Bookmarks",
          protected: true,
          items: []
        }
      ];

const DEFAULT_CONFIG = {
  theme: "green",
  fontSize: "md",
  weatherMode: "auto",
  weatherCity: "",
  timerDefaultMinutes: 45,
  categories: DEFAULT_CATEGORIES,
  notepad: "",
  notepads: [
    { name: "Note 1", text: "" },
    { name: "Note 2", text: "" }
  ],
  activeNotepadSlot: 0,
  checklist: []
};

const SEARCH_ENGINES = {
  g: "https://www.google.com/search?q=",
  gh: "https://github.com/search?q=",
  yt: "https://www.youtube.com/results?search_query=",
  ddg: "https://duckduckgo.com/?q=",
  cve: "https://nvd.nist.gov/vuln/search/results?query=",
  ht: "https://www.google.com/search?q=site%3Abook.hacktricks.wiki+",
  crt: "https://crt.sh/?q=",
  shodan: "https://www.shodan.io/search?query="
};

function ensureHttp(url) {
  const trimmed = String(url || "").trim();
  if (!trimmed) return "";
  if (/^(javascript|data|vbscript):/i.test(trimmed)) return "";
  const cleaned = trimmed.replace(/^\/+/, "");
  const normalized = /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;
  if (/^https?:\/\/$/i.test(normalized)) return "";
  return normalized;
}

function normalizeConfig(parsed) {
  if (!parsed || typeof parsed !== "object") {
    return structuredClone(DEFAULT_CONFIG);
  }
  const categories =
    Array.isArray(parsed.categories) && parsed.categories.length > 0
      ? parsed.categories.map((cat, idx) => ({
          id: String(cat?.id || `cat_${idx}`),
          name: String(cat?.name || "Bookmarks").trim() || "Bookmarks",
          protected: idx === 0 ? true : Boolean(cat?.protected),
          items: Array.isArray(cat?.items)
            ? cat.items
                .filter((item) => item && typeof item.name === "string" && typeof item.url === "string")
                .map((item) => ({ name: item.name.trim(), url: ensureHttp(item.url) }))
                .filter((item) => item.name && item.url)
            : []
        }))
      : structuredClone(DEFAULT_CATEGORIES);

  // Guarantee at least one protected primary category remains
  if (!categories.some((c) => c.protected)) {
    categories[0].protected = true;
  }

  const legacyNotepad =
    typeof parsed.notepad === "string"
      ? parsed.notepad
      : typeof parsed.scratchpad === "string"
        ? parsed.scratchpad
        : "";
  const rawNotepads =
    Array.isArray(parsed.notepads) && parsed.notepads.length > 0
      ? parsed.notepads
      : Array.isArray(parsed.scratchpads) && parsed.scratchpads.length > 0
        ? parsed.scratchpads
        : null;
  const notepads = rawNotepads
    ? rawNotepads.map((s, idx) =>
        typeof s === "string"
          ? { name: `Note ${idx + 1}`, text: s }
          : { name: String(s?.name || `Note ${idx + 1}`).trim() || `Note ${idx + 1}`, text: typeof s?.text === "string" ? s.text : "" }
      )
    : [
        { name: "Note 1", text: legacyNotepad },
        { name: "Note 2", text: "" }
      ];
  const rawSlot = Number.isInteger(parsed.activeNotepadSlot)
    ? parsed.activeNotepadSlot
    : parsed.activeScratchpadSlot;
  const activeNotepadSlot =
    Number.isInteger(rawSlot) && rawSlot >= 0 && rawSlot < notepads.length ? rawSlot : 0;

  return {
    ...structuredClone(DEFAULT_CONFIG),
    ...parsed,
    theme: ["green", "amber", "cyan", "violet"].includes(parsed.theme) ? parsed.theme : DEFAULT_CONFIG.theme,
    fontSize: ["sm", "md", "lg"].includes(parsed.fontSize) ? parsed.fontSize : DEFAULT_CONFIG.fontSize,
    weatherMode: parsed.weatherMode === "city" ? "city" : "auto",
    weatherCity: typeof parsed.weatherCity === "string" ? parsed.weatherCity : "",
    categories,
    notepad: notepads[0]?.text || "",
    notepads,
    activeNotepadSlot,
    checklist: Array.isArray(parsed.checklist)
      ? parsed.checklist
          .filter((t) => t && typeof t.text === "string")
          .map((t) => ({ text: t.text, done: Boolean(t.done) }))
      : []
  };
}

function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem("cyber_bento_config_v5");
    if (!raw) return structuredClone(DEFAULT_CONFIG);
    return normalizeConfig(JSON.parse(raw));
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

function saveConfig() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Ignore storage quota or private-mode access errors
  }
}

let config = loadConfig();
let currentPage = window.location.hash === "#timer" ? "timer" : "home";
let activeHomeCatId = config.categories[0].id;
let isHomeEditMode = false;
let homeEditingItemIndex = -1;
let homeRenamingCatId = null;
let tabDragSrcIdx = -1;
let dragSrcIdx = -1;
let lastWeatherLabel = `${FALLBACK_COORDS.name} · --°C`;

/* Study Timer & Stopwatch State */
const timerState = {
  mode: "timer",
  running: false,
  remainingSec: config.timerDefaultMinutes * 60,
  elapsedSec: 0,
  targetEndMs: 0,
  startMs: 0,
  intervalId: null,
  finished: false,
  alarmIntervalId: null,
  alarmTimeoutId: null,
  alarmActive: false
};

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getHostname(url) {
  try {
    return new URL(ensureHttp(url)).hostname.replace(/^www\./, "");
  } catch {
    return String(url).replace(/^https?:\/\//, "").split("/")[0];
  }
}

function formatDuration(totalSeconds) {
  const sec = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0 || timerState.mode === "stopwatch") {
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function getPrimaryCategory() {
  return config.categories.find((c) => c.protected) || config.categories[0];
}

function getCategoryById(id) {
  return config.categories.find((c) => c.id === id) || config.categories[0];
}

function setPage(page) {
  currentPage = page === "timer" ? "timer" : "home";
  document.body.dataset.page = currentPage;
  try {
    window.history.replaceState(null, "", currentPage === "timer" ? "#timer" : "#");
  } catch {
    // Ignore history restrictions in sandboxed/local contexts
  }

  document.getElementById("home-page-view").classList.toggle("hidden", currentPage !== "home");
  document.getElementById("timer-page-view").classList.toggle("hidden", currentPage !== "timer");
  document.querySelector(".hint-footer").classList.toggle("hidden", currentPage !== "home");

  document.querySelectorAll("[data-page-target]").forEach((btn) => {
    const isActive = btn.dataset.pageTarget === currentPage;
    btn.classList.toggle("active", isActive);
    if (isActive) {
      btn.setAttribute("aria-current", "page");
    } else {
      btn.removeAttribute("aria-current");
    }
  });
}

function applyAppearance() {
  const theme = ["green", "amber", "cyan", "violet"].includes(config.theme) ? config.theme : "green";
  const fontSize = ["sm", "md", "lg"].includes(config.fontSize) ? config.fontSize : "md";
  document.body.dataset.mode = "A";
  document.body.dataset.theme = theme;
  document.body.dataset.fontSize = fontSize;
  document.documentElement.dataset.fontSize = fontSize;
  syncSettingsControls();
}

const ANSI_DIGITS = {
  "0": [" █████┐ ", "██┌──██┐", "██│  ██│", "██│  ██│", "└█████┌┘", " └────┘ "],
  "1": ["  ███┐  ", " ████│  ", "└─███│  ", "  ███│  ", "  ███│  ", "  └──┘  "],
  "2": ["██████┐ ", "└────██┐", " █████┌┘", "██┌───┘ ", "███████┐", "└──────┘"],
  "3": ["██████┐ ", "└────██┐", " █████┌┘", " └───██┐", "██████┌┘", "└─────┘ "],
  "4": ["██┐  ██┐", "██│  ██│", "███████│", "└────██│", "     ██│", "     └─┘"],
  "5": ["███████┐", "██┌────┘", "███████┐", "└────██│", "███████│", "└──────┘"],
  "6": [" ██████┐", "██┌────┘", "██████┐ ", "██┌──██┐", "└█████┌┘", " └────┘ "],
  "7": ["███████┐", "└────██│", "    ██┌┘", "   ██┌┘ ", "   ██│  ", "   └─┘  "],
  "8": [" █████┐ ", "██┌──██┐", "└█████┌┘", "██┌──██┐", "└█████┌┘", " └────┘ "],
  "9": [" █████┐ ", "██┌──██┐", "└██████│", " └───██│", " █████┌┘", " └────┘ "],
  ":": ["   ", "██┐", "└─┘", "██┐", "└─┘", "   "]
};

function renderZenClock(timeStr, dateStr) {
  const preEl = document.getElementById("zen-ascii-clock");
  const subEl = document.getElementById("zen-date-sub");
  if (!preEl) return;
  const rows = ["", "", "", "", "", ""];
  for (const ch of timeStr) {
    const glyph = ANSI_DIGITS[ch];
    if (!glyph) continue;
    for (let r = 0; r < 6; r += 1) {
      rows[r] += (rows[r] ? " " : "") + glyph[r];
    }
  }
  preEl.textContent = rows.join("\n");
  if (subEl) subEl.textContent = `${dateStr}  ·  :zen or ESC to exit`;
}

function updateClock() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString("en-GB", { hour12: false });
  const weekday = now.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
  const day = String(now.getDate()).padStart(2, "0");
  const month = now.toLocaleDateString("en-US", { month: "short" }).toUpperCase();
  const year = now.getFullYear();
  const dateStr = `${weekday}, ${day} ${month} ${year}`;
  document.getElementById("clock-display").textContent = timeStr;
  document.getElementById("date-display").textContent = dateStr;
  if (document.body.dataset.zen === "true") {
    renderZenClock(timeStr, dateStr);
  }
}

/* Weather (Open-Meteo with Fallback -> City · Temp°C) */
function buildWeatherLink(cityQuery) {
  const q = String(cityQuery || FALLBACK_COORDS.name || "").trim();
  return `https://www.google.com/search?q=${encodeURIComponent(q ? `weather ${q}` : "weather")}`;
}

async function fetchWeatherByCoords(lat, lon, cityLabel) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m&current_weather=true&timezone=auto`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Weather request failed");
  const data = await res.json();
  const rawTemp = data?.current?.temperature_2m ?? data?.current_weather?.temperature;
  if (typeof rawTemp !== "number") throw new Error("Temperature unavailable");
  const temp = Math.round(rawTemp);
  const label = `${cityLabel.toUpperCase()} · ${temp}°C`;
  const href = buildWeatherLink(cityLabel);
  try {
    localStorage.setItem(
      WEATHER_CACHE_KEY,
      JSON.stringify({
        ts: Date.now(),
        mode: config.weatherMode,
        city: config.weatherCity.trim().toLowerCase(),
        label,
        href
      })
    );
  } catch {
    // Ignore storage errors
  }
  return { label, href };
}

async function resolveCityCoords(cityName) {
  const clean = String(cityName || "").trim();
  const candidates = [clean];
  if (clean.includes(",")) {
    candidates.push(clean.split(",")[0].trim());
  }

  for (const query of candidates) {
    if (!query) continue;
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=en&format=json`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (data.results && data.results.length > 0) {
        const hit = data.results[0];
        return { name: hit.name, lat: hit.latitude, lon: hit.longitude };
      }
    }
  }

  // Fallback to Nominatim for neighborhoods or specific queries
  const nomUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(clean)}&format=json&limit=1`;
  const nomRes = await fetch(nomUrl);
  if (nomRes.ok) {
    const nomData = await nomRes.json();
    if (Array.isArray(nomData) && nomData.length > 0) {
      const lat = Number(nomData[0].lat);
      const lon = Number(nomData[0].lon);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        return {
          name: clean.split(",")[0].trim(),
          lat,
          lon
        };
      }
    }
  }

  throw new Error("City not found");
}

function getBrowserCoords() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("No geolocation"));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      (err) => reject(err),
      { timeout: 2000, maximumAge: 600000 }
    );
  });
}

async function updateWeather(forceRefresh = false) {
  const el = document.getElementById("weather-display");
  if (!forceRefresh) {
    try {
      const cached = JSON.parse(localStorage.getItem(WEATHER_CACHE_KEY) || "null");
      const cacheMatches =
        cached &&
        cached.mode === config.weatherMode &&
        (config.weatherMode !== "city" || cached.city === config.weatherCity.trim().toLowerCase());
      if (cacheMatches && Date.now() - cached.ts < 15 * 60 * 1000 && cached.href) {
        lastWeatherLabel = cached.label;
        el.textContent = cached.label;
        el.href = cached.href;
        return;
      }
    } catch {
      // ignore cache errors
    }
  }

  let href = buildWeatherLink(config.weatherCity || FALLBACK_COORDS.name);
  try {
    if (config.weatherMode === "city" && config.weatherCity.trim()) {
      const coords = await resolveCityCoords(config.weatherCity.trim());
      const result = await fetchWeatherByCoords(coords.lat, coords.lon, coords.name);
      lastWeatherLabel = result.label;
      href = result.href;
    } else {
      try {
        const pos = await getBrowserCoords();
        const result = await fetchWeatherByCoords(pos.lat, pos.lon, "LOCAL");
        lastWeatherLabel = result.label;
        href = result.href;
      } catch {
        const result = await fetchWeatherByCoords(FALLBACK_COORDS.lat, FALLBACK_COORDS.lon, FALLBACK_COORDS.name);
        lastWeatherLabel = result.label;
        href = result.href;
      }
    }
  } catch {
    lastWeatherLabel = `${(config.weatherCity || FALLBACK_COORDS.name).toUpperCase()} · --°C`;
  }
  el.textContent = lastWeatherLabel;
  el.href = href;
}

/* Unified Bookmarks Rendering */
function renderBookmarkCards(items) {
  if (!items || items.length === 0) {
    return `<p class="muted-text mono" style="margin:0;">// no bookmarks in this category (add in ✎ or ⚙ CONFIG)</p>`;
  }
  return items
    .map(
      (link, idx) => `
      <a class="bookmark-card" href="${escapeHtml(ensureHttp(link.url))}" target="_blank" rel="noopener noreferrer">
        <div class="bookmark-card-left">
          <span class="bookmark-card-id mono">[${String(idx + 1).padStart(2, "0")}]</span>
          <div class="bookmark-card-info">
            <span class="bookmark-card-title">${escapeHtml(link.name)}</span>
            <span class="bookmark-card-host mono">${escapeHtml(getHostname(link.url))}</span>
          </div>
        </div>
        <span class="bookmark-card-arrow mono">↗</span>
      </a>
    `
    )
    .join("");
}

function getActiveHomeCategory() {
  return getCategoryById(activeHomeCatId);
}

function renderLinksArea() {
  if (!config.categories.some((c) => c.id === activeHomeCatId)) {
    activeHomeCatId = config.categories[0].id;
  }

  // Tabs in Unified mode
  const switcher = document.getElementById("links-tab-switcher");
  switcher.innerHTML = config.categories
    .map((cat, idx) => {
      const isActive = cat.id === activeHomeCatId;
      if (!isHomeEditMode) {
        return `
          <button class="tab-btn ${isActive ? "active" : ""}" data-links-tab="${escapeHtml(cat.id)}" type="button" role="tab" aria-selected="${isActive}">
            ${escapeHtml(cat.name)}
          </button>
        `;
      }

      const isRenaming = homeRenamingCatId === cat.id;
      return `
        <div class="tab-edit-chip ${isActive ? "active" : ""}" draggable="${!isRenaming}" data-tab-drag-idx="${idx}" role="presentation">
          <span class="drag-handle tab-drag-handle mono" title="Drag to reorder" aria-hidden="true">⋮⋮</span>
          ${
            isRenaming
              ? `<input class="tab-rename-input mono" data-tab-rename-input="${escapeHtml(cat.id)}" type="text" maxlength="18" autocomplete="off" value="${escapeHtml(cat.name)}" aria-label="Rename category ${escapeHtml(cat.name)}" />
                 <button class="tab-chip-btn mono" data-tab-rename-save="${escapeHtml(cat.id)}" type="button" title="Save name" aria-label="Save category name">✓</button>
                 <button class="tab-chip-btn mono" data-tab-rename-cancel type="button" title="Cancel" aria-label="Cancel rename">✕</button>`
              : `<button class="tab-btn ${isActive ? "active" : ""}" data-links-tab="${escapeHtml(cat.id)}" type="button" role="tab" aria-selected="${isActive}">
                   ${escapeHtml(cat.name)}
                 </button>
                 <button class="tab-chip-btn mono" data-tab-rename="${escapeHtml(cat.id)}" type="button" title="Rename category" aria-label="Rename ${escapeHtml(cat.name)}">✎</button>
                 ${
                   !cat.protected
                     ? `<button class="tab-chip-btn tab-chip-btn-del mono" data-tab-del="${escapeHtml(cat.id)}" type="button" title="Delete category" aria-label="Delete ${escapeHtml(cat.name)}">×</button>`
                     : ""
                 }`
          }
        </div>
      `;
    })
    .join("");

  const activeCat = getActiveHomeCategory();
  const editBtn = document.getElementById("bookmarks-edit-btn");
  const editLabel = editBtn.querySelector(".edit-btn-label");
  editBtn.classList.toggle("active", isHomeEditMode);
  editBtn.setAttribute("aria-pressed", String(isHomeEditMode));
  editBtn.title = isHomeEditMode ? "Done editing bookmarks" : "Edit bookmarks";
  editLabel.classList.toggle("hidden", !isHomeEditMode);

  const linksGridEl = document.getElementById("links-grid");
  const linksEditViewEl = document.getElementById("links-edit-view");
  const addCategoryFormEl = document.getElementById("inline-add-category-form");
  addCategoryFormEl.classList.toggle("hidden", !isHomeEditMode);

  if (isHomeEditMode) {
    linksGridEl.classList.add("hidden");
    linksEditViewEl.classList.remove("hidden");
    document.getElementById("inline-add-link-btn").textContent = `+ ADD TO ${activeCat.name.toUpperCase()}`;
    const editListEl = document.getElementById("links-edit-list");
    editListEl.innerHTML =
      activeCat.items.length === 0
        ? `<p class="muted-text mono" style="margin:0;">// no links in ${escapeHtml(activeCat.name)} yet — add one above</p>`
        : activeCat.items.map((item, i) => renderManageItemHtml(item, i, activeCat.items.length, homeEditingItemIndex)).join("");
  } else {
    linksGridEl.classList.remove("hidden");
    linksEditViewEl.classList.add("hidden");
    linksGridEl.innerHTML = renderBookmarkCards(activeCat.items);
  }
}

/* Digital Desk Alarm Sound */
let sharedAudioCtx = null;

function playAlarmBurst() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!sharedAudioCtx) sharedAudioCtx = new AudioCtx();
    if (sharedAudioCtx.state === "suspended") sharedAudioCtx.resume();

    const pulseOffsets = [0, 0.16, 0.32, 0.48];
    pulseOffsets.forEach((offset) => {
      const start = sharedAudioCtx.currentTime + offset;
      const dur = 0.11;

      const osc1 = sharedAudioCtx.createOscillator();
      const osc2 = sharedAudioCtx.createOscillator();
      const gain = sharedAudioCtx.createGain();

      osc1.type = "square";
      osc2.type = "triangle";
      osc1.frequency.setValueAtTime(1046.5, start);
      osc2.frequency.setValueAtTime(1318.5, start);

      gain.gain.setValueAtTime(0.001, start);
      gain.gain.linearRampToValueAtTime(0.07, start + 0.015);
      gain.gain.setValueAtTime(0.07, start + dur - 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + dur);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(sharedAudioCtx.destination);

      osc1.start(start);
      osc2.start(start);
      osc1.stop(start + dur);
      osc2.stop(start + dur);
    });
  } catch {
    // ignore audio errors
  }
}

function startAlarmLoop() {
  stopAlarmLoop();
  timerState.alarmActive = true;
  playAlarmBurst();
  timerState.alarmIntervalId = setInterval(playAlarmBurst, 1300);
  timerState.alarmTimeoutId = setTimeout(() => {
    stopAlarmLoop();
    renderTimer();
  }, 30000);
}

function stopAlarmLoop() {
  if (timerState.alarmIntervalId) {
    clearInterval(timerState.alarmIntervalId);
    timerState.alarmIntervalId = null;
  }
  if (timerState.alarmTimeoutId) {
    clearTimeout(timerState.alarmTimeoutId);
    timerState.alarmTimeoutId = null;
  }
  timerState.alarmActive = false;
}

function renderTimer() {
  const displayEl = document.getElementById("timer-display");
  const statusEl = document.getElementById("timer-status-tag");
  const subtextEl = document.getElementById("timer-subtext");
  const toggleBtn = document.getElementById("timer-toggle-btn");
  const presetsWrap = document.getElementById("timer-presets");
  const navBadge = document.getElementById("nav-timer-badge");
  const displayWrap = document.getElementById("timer-display-wrap");

  const secondsToShow = timerState.mode === "timer" ? timerState.remainingSec : timerState.elapsedSec;
  const formatted = formatDuration(secondsToShow);
  displayEl.textContent = formatted;

  presetsWrap.classList.toggle("hidden", timerState.mode !== "timer");
  document.body.dataset.alarm = timerState.alarmActive ? "true" : "false";

  navBadge.textContent = timerState.alarmActive ? "ALARM!" : formatted;
  navBadge.classList.toggle("hidden", !timerState.running && !timerState.alarmActive);

  document.querySelectorAll("[data-timer-mode]").forEach((btn) => {
    const isAct = btn.dataset.timerMode === timerState.mode;
    btn.classList.toggle("active", isAct);
    btn.setAttribute("aria-selected", String(isAct));
  });

  document.querySelectorAll(".preset-btn[data-minutes]").forEach((btn) => {
    const isAct = Number(btn.dataset.minutes) === config.timerDefaultMinutes;
    btn.classList.toggle("active", isAct);
    btn.setAttribute("aria-pressed", String(isAct));
  });

  const isInitialState =
    timerState.mode === "timer"
      ? timerState.remainingSec === config.timerDefaultMinutes * 60
      : timerState.elapsedSec === 0;

  if (timerState.alarmActive) {
    statusEl.textContent = "[ALARMING]";
    subtextEl.textContent = "Time is up! Click STOP ALARM or RESET.";
    toggleBtn.textContent = "■ STOP ALARM";
  } else if (timerState.finished) {
    statusEl.textContent = "[COMPLETED]";
    subtextEl.textContent = "Session complete! Take a break or reset.";
    toggleBtn.textContent = "▶ START";
  } else if (timerState.running) {
    statusEl.textContent = "[RUNNING]";
    subtextEl.textContent =
      timerState.mode === "timer" ? "Focus session active · countdown" : "Stopwatch active · elapsed time";
    toggleBtn.textContent = "⏸ PAUSE";
  } else if (isInitialState) {
    statusEl.textContent = "[READY]";
    subtextEl.textContent =
      timerState.mode === "timer" ? "Dedicated study timer · distraction-free view" : "Stopwatch · elapsed time";
    toggleBtn.textContent = "▶ START";
  } else {
    statusEl.textContent = "[PAUSED]";
    subtextEl.textContent =
      timerState.mode === "timer" ? "Session paused · press resume to continue" : "Stopwatch paused · press resume to continue";
    toggleBtn.textContent = "▶ RESUME";
  }

  document.title = timerState.alarmActive
    ? "[ALARM!] HOME"
    : timerState.running
      ? `[${formatted}] HOME`
      : "HOME";
}

function stopTimerInterval() {
  if (timerState.intervalId) {
    clearInterval(timerState.intervalId);
    timerState.intervalId = null;
  }
  timerState.running = false;
}

function toggleTimer() {
  if (timerState.alarmActive) {
    stopAlarmLoop();
    renderTimer();
    return;
  }

  if (timerState.running) {
    stopTimerInterval();
    renderTimer();
    return;
  }

  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx && !sharedAudioCtx) sharedAudioCtx = new AudioCtx();
    if (sharedAudioCtx && sharedAudioCtx.state === "suspended") sharedAudioCtx.resume();
  } catch {
    // ignore
  }

  if (timerState.mode === "timer" && timerState.remainingSec <= 0) {
    timerState.remainingSec = config.timerDefaultMinutes * 60;
  }
  timerState.finished = false;
  timerState.running = true;
  if (timerState.mode === "timer") {
    timerState.targetEndMs = Date.now() + timerState.remainingSec * 1000;
  } else {
    timerState.startMs = Date.now() - timerState.elapsedSec * 1000;
  }

  timerState.intervalId = setInterval(() => {
    const now = Date.now();
    if (timerState.mode === "timer") {
      timerState.remainingSec = Math.max(0, Math.ceil((timerState.targetEndMs - now) / 1000));
      if (timerState.remainingSec <= 0) {
        timerState.remainingSec = 0;
        timerState.finished = true;
        stopTimerInterval();
        startAlarmLoop();
      }
    } else {
      timerState.elapsedSec = Math.max(0, Math.floor((now - timerState.startMs) / 1000));
    }
    renderTimer();
  }, 250);

  renderTimer();
}

function resetTimer() {
  stopTimerInterval();
  stopAlarmLoop();
  timerState.finished = false;
  if (timerState.mode === "timer") {
    timerState.remainingSec = config.timerDefaultMinutes * 60;
  } else {
    timerState.elapsedSec = 0;
  }
  renderTimer();
}

function setTimerMinutes(minutes) {
  const parsed = Math.round(Number(minutes));
  const mins = Number.isFinite(parsed) ? Math.max(1, Math.min(360, parsed)) : 45;
  config.timerDefaultMinutes = mins;
  saveConfig();
  stopTimerInterval();
  stopAlarmLoop();
  timerState.mode = "timer";
  timerState.finished = false;
  timerState.remainingSec = mins * 60;

  document.querySelectorAll(".preset-btn[data-minutes]").forEach((btn) => {
    const isAct = Number(btn.dataset.minutes) === mins;
    btn.classList.toggle("active", isAct);
    btn.setAttribute("aria-pressed", String(isAct));
  });

  renderTimer();
}

/* Settings Modal Sync */
function syncSettingsControls() {
  document.querySelectorAll("[data-font]").forEach((btn) => {
    const isAct = btn.dataset.font === config.fontSize;
    btn.classList.toggle("active", isAct);
    btn.setAttribute("aria-pressed", String(isAct));
  });
  document.querySelectorAll("[data-theme-choice]").forEach((btn) => {
    const isAct = btn.dataset.themeChoice === config.theme;
    btn.classList.toggle("active", isAct);
    btn.setAttribute("aria-pressed", String(isAct));
  });
  document.getElementById("weather-city-input").value = config.weatherMode === "city" ? config.weatherCity : "";
}

function renderManageItemHtml(item, index, total, activeEditIndex = homeEditingItemIndex) {
  const isEditing = activeEditIndex === index;
  const safeName = escapeHtml(item.name);
  return `
    <div class="manage-item mono" draggable="${!isEditing}" data-drag-idx="${index}">
      <div class="manage-item-row">
        <div class="manage-item-main">
          <span class="drag-handle" title="Drag to reorder" aria-hidden="true">⋮⋮</span>
          <div class="manage-item-text">
            <span class="manage-item-title">[${String(index + 1).padStart(2, "0")}] ${safeName}</span>
            <span class="manage-item-url">${escapeHtml(getHostname(item.url))}</span>
          </div>
        </div>
        <div class="manage-actions">
          <button class="manage-action-btn" data-move="${index}:-1" type="button" title="Move up" aria-label="Move ${safeName} up" ${index === 0 ? "disabled" : ""}>↑</button>
          <button class="manage-action-btn" data-move="${index}:1" type="button" title="Move down" aria-label="Move ${safeName} down" ${index === total - 1 ? "disabled" : ""}>↓</button>
          <button class="manage-action-btn" data-edit="${index}" type="button" title="Edit" aria-label="Edit ${safeName}">✎</button>
          <button class="manage-del-btn" data-del="${index}" type="button" title="Remove" aria-label="Remove ${safeName}">×</button>
        </div>
      </div>
      ${
        isEditing
          ? `<div class="manage-edit-row" data-edit-form="${index}">
              <div class="manage-edit-inputs">
                <input class="field-input mono" data-edit-name type="text" autocomplete="off" value="${safeName}" placeholder="Title" aria-label="Bookmark title" />
                <input class="field-input mono" data-edit-url type="text" inputmode="url" autocomplete="off" value="${escapeHtml(item.url)}" placeholder="https://..." aria-label="Bookmark URL" />
              </div>
              <div class="manage-edit-btns">
                <button class="btn-ghost btn-xs mono" data-edit-cancel type="button">CANCEL</button>
                <button class="btn-accent btn-xs mono" data-edit-save="${index}" type="button">SAVE</button>
              </div>
            </div>`
          : ""
      }
    </div>
  `;
}

function renderAll() {
  setPage(currentPage);
  applyAppearance();
  renderLinksArea();
  renderTimer();
  renderNotepad();
  renderChecklist();
}

/* Event Listeners */
document.querySelectorAll("[data-page-target]").forEach((btn) => {
  btn.addEventListener("click", () => setPage(btn.dataset.pageTarget));
});

const searchInputEl = document.getElementById("search-input");
const commandSuggestionsEl = document.getElementById("command-suggestions");
const commandFeedbackEl = document.getElementById("command-feedback");

const INTERNAL_COMMANDS = [
  { cmd: ":zen", usage: ":zen", desc: "Toggle distraction-free Zen Mode" },
  { cmd: ":timer", usage: ":timer [min]", desc: "Open Focus Timer (optional minutes)" },
  { cmd: ":home", usage: ":home", desc: "Switch to Home view" },
  { cmd: ":theme", usage: ":theme <green|amber|cyan|violet>", desc: "Change accent color palette" },
  { cmd: ":font", usage: ":font <sm|md|lg>", desc: "Change font size scale" },
  { cmd: ":config", usage: ":config", desc: "Open workspace settings" },
  { cmd: ":export", usage: ":export", desc: "Export configuration as JSON" },
  { cmd: ":todo", usage: ":todo <task>", desc: "Add task to checklist" },
  { cmd: ":beep", usage: ":beep", desc: "Test Web Audio API alarm beep" },
  { cmd: ":help", usage: ":help", desc: "Show available commands & prefixes" }
];

const commandHistory = [];
let commandHistoryIdx = -1;
let suggestionItems = [];
let suggestionActiveIdx = -1;
let feedbackTimeoutId = null;

function showCommandFeedback(message, isError = false, durationMs = 3500) {
  if (feedbackTimeoutId) clearTimeout(feedbackTimeoutId);
  commandFeedbackEl.textContent = message;
  commandFeedbackEl.classList.toggle("is-error", isError);
  commandFeedbackEl.classList.remove("hidden");
  if (durationMs > 0) {
    feedbackTimeoutId = setTimeout(() => {
      commandFeedbackEl.classList.add("hidden");
    }, durationMs);
  }
}

function hideCommandSuggestions() {
  suggestionItems = [];
  suggestionActiveIdx = -1;
  commandSuggestionsEl.innerHTML = "";
  commandSuggestionsEl.classList.add("hidden");
  searchInputEl.setAttribute("aria-expanded", "false");
  searchInputEl.removeAttribute("aria-activedescendant");
}

function renderCommandSuggestions(items) {
  suggestionItems = items;
  suggestionActiveIdx = items.length > 0 ? 0 : -1;
  if (items.length === 0) {
    hideCommandSuggestions();
    return;
  }

  commandSuggestionsEl.innerHTML = items
    .map(
      (item, idx) => `
      <button type="button" id="command-sug-${idx}" role="option" aria-selected="${idx === suggestionActiveIdx}" class="command-suggestion-item${idx === suggestionActiveIdx ? " active" : ""}" data-sug-idx="${idx}">
        <span class="command-suggestion-main">
          <span class="command-suggestion-key">${escapeHtml(item.label)}</span>
          <span class="command-suggestion-desc">${escapeHtml(item.desc)}</span>
        </span>
        <span class="command-suggestion-desc">${escapeHtml(item.meta || "")}</span>
      </button>
    `
    )
    .join("");
  commandSuggestionsEl.classList.remove("hidden");
  searchInputEl.setAttribute("aria-expanded", "true");
  searchInputEl.setAttribute("aria-activedescendant", "command-sug-0");
}

function updateSuggestionsForInput(raw) {
  const trimmed = raw.trim();

  if (trimmed.startsWith(":")) {
    const query = trimmed.slice(1).toLowerCase().split(/\s+/)[0];
    const matches = INTERNAL_COMMANDS.filter((c) => c.cmd.slice(1).startsWith(query)).map((c) => ({
      type: "command",
      value: c.cmd,
      label: c.usage,
      desc: c.desc,
      meta: "CMD"
    }));
    renderCommandSuggestions(matches);
    return;
  }

  if (trimmed.startsWith("@") || trimmed.startsWith("?")) {
    const query = trimmed.slice(1).trim().toLowerCase();
    const matches = [];
    for (const cat of config.categories) {
      for (const item of cat.items) {
        if (!query || item.name.toLowerCase().includes(query) || item.url.toLowerCase().includes(query)) {
          matches.push({
            type: "bookmark",
            url: ensureHttp(item.url),
            label: item.name,
            desc: getHostname(item.url),
            meta: cat.name
          });
        }
      }
    }
    renderCommandSuggestions(matches.slice(0, 8));
    return;
  }

  hideCommandSuggestions();
}

function setZenMode(enabled) {
  const nextZen = Boolean(enabled);
  document.body.dataset.zen = nextZen ? "true" : "false";
  document.getElementById("zen-clock-wrap")?.classList.toggle("hidden", !nextZen);
  if (nextZen) {
    setPage("home");
    updateClock();
  }
}

async function runInternalCommand(raw) {
  const trimmed = raw.trim();
  const spaceIdx = trimmed.search(/\s/);
  const cmd = (spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)).toLowerCase();
  const restRaw = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1).trim();
  const arg = restRaw.split(/\s+/)[0]?.toLowerCase() || "";

  switch (cmd) {
    case ":zen": {
      const nextZen = document.body.dataset.zen !== "true";
      setZenMode(nextZen);
      showCommandFeedback(nextZen ? "[OK] Zen Mode ON (:zen or ESC to exit)" : "[OK] Zen Mode OFF");
      return true;
    }
    case ":home":
      setPage("home");
      showCommandFeedback("[OK] Switched to HOME");
      return true;
    case ":timer": {
      if (arg) {
        const mins = Number(arg);
        if (!Number.isFinite(mins) || mins < 1 || mins > 360) {
          showCommandFeedback("[ERR] Usage: :timer <1-360>", true);
          return true;
        }
        setTimerMinutes(mins);
      }
      setPage("timer");
      showCommandFeedback(arg ? `[OK] Focus Timer set to ${config.timerDefaultMinutes}m` : "[OK] Switched to FOCUS TIMER");
      return true;
    }
    case ":theme": {
      const valid = ["green", "amber", "cyan", "violet"];
      if (!valid.includes(arg)) {
        showCommandFeedback(`[ERR] Themes: ${valid.join(", ")}`, true);
        return true;
      }
      config.theme = arg;
      saveConfig();
      renderAll();
      showCommandFeedback(`[OK] Theme -> ${arg}`);
      return true;
    }
    case ":font": {
      const valid = ["sm", "md", "lg"];
      if (!valid.includes(arg)) {
        showCommandFeedback(`[ERR] Font sizes: ${valid.join(", ")}`, true);
        return true;
      }
      config.fontSize = arg;
      saveConfig();
      renderAll();
      showCommandFeedback(`[OK] Font size -> ${arg}`);
      return true;
    }
    case ":config":
      openSettingsModal();
      showCommandFeedback("[OK] Opened settings");
      return true;
    case ":export":
      document.getElementById("export-json-btn")?.click();
      showCommandFeedback("[OK] Configuration exported");
      return true;
    case ":todo": {
      if (!restRaw) {
        showCommandFeedback("[ERR] Usage: :todo <task>", true);
        return true;
      }
      if (!Array.isArray(config.checklist)) config.checklist = [];
      config.checklist.unshift({ text: restRaw.slice(0, 80), done: false });
      saveConfig();
      renderChecklist();
      showCommandFeedback(`[OK] Added task: ${restRaw.slice(0, 80)}`);
      return true;
    }
    case ":beep":
      playAlarmBurst();
      showCommandFeedback("[OK] Web Audio API beep triggered");
      return true;
    case ":help":
      showCommandFeedback(
        "Cmds: :zen :todo :beep :timer :theme :font :config :export | Filter: @name",
        false,
        9000
      );
      return true;
    default:
      showCommandFeedback(`[ERR] Unknown command '${cmd}'. Type :help`, true);
      return true;
  }
}

function pushCommandHistory(raw) {
  if (!raw || commandHistory[0] === raw) return;
  commandHistory.unshift(raw);
  if (commandHistory.length > 25) commandHistory.pop();
  commandHistoryIdx = -1;
}

searchInputEl.addEventListener("input", () => {
  commandHistoryIdx = -1;
  updateSuggestionsForInput(searchInputEl.value);
});

function moveSuggestionSelection(delta) {
  if (suggestionItems.length === 0) return;
  suggestionActiveIdx = (suggestionActiveIdx + delta + suggestionItems.length) % suggestionItems.length;
  commandSuggestionsEl.querySelectorAll(".command-suggestion-item").forEach((el, idx) => {
    const isAct = idx === suggestionActiveIdx;
    el.classList.toggle("active", isAct);
    el.setAttribute("aria-selected", String(isAct));
    if (isAct) {
      el.scrollIntoView({ block: "nearest" });
      searchInputEl.setAttribute("aria-activedescendant", el.id);
    }
  });
}

searchInputEl.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    hideCommandSuggestions();
    commandFeedbackEl.classList.add("hidden");
    searchInputEl.blur();
    return;
  }

  if (suggestionItems.length > 0 && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
    e.preventDefault();
    moveSuggestionSelection(e.key === "ArrowDown" ? 1 : -1);
    return;
  }

  if (e.key === "Tab" && suggestionItems.length > 0) {
    e.preventDefault();
    if (suggestionItems.length > 1) {
      moveSuggestionSelection(e.shiftKey ? -1 : 1);
      return;
    }
    const active = suggestionItems[Math.max(0, suggestionActiveIdx)];
    if (active?.type === "command") {
      searchInputEl.value = `${active.value} `;
      updateSuggestionsForInput(searchInputEl.value);
    }
    return;
  }

  if (suggestionItems.length === 0 && (e.key === "ArrowUp" || e.key === "ArrowDown") && commandHistory.length > 0) {
    e.preventDefault();
    if (e.key === "ArrowUp") {
      commandHistoryIdx = Math.min(commandHistoryIdx + 1, commandHistory.length - 1);
    } else {
      commandHistoryIdx = Math.max(commandHistoryIdx - 1, -1);
    }
    searchInputEl.value = commandHistoryIdx === -1 ? "" : commandHistory[commandHistoryIdx];
  }
});

commandSuggestionsEl.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-sug-idx]");
  if (!btn) return;
  const item = suggestionItems[Number(btn.dataset.sugIdx)];
  if (!item) return;

  if (item.type === "bookmark") {
    window.location.href = item.url;
  } else if (item.type === "command") {
    searchInputEl.value = `${item.value} `;
    searchInputEl.focus();
    updateSuggestionsForInput(searchInputEl.value);
  }
});

document.getElementById("search-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const raw = searchInputEl.value.trim();
  if (!raw) return;

  pushCommandHistory(raw);

  if ((raw.startsWith("@") || raw.startsWith("?")) && suggestionItems.length > 0) {
    const selected = suggestionItems[Math.max(0, suggestionActiveIdx)];
    if (selected?.url) {
      window.location.href = selected.url;
      return;
    }
  }

  if (raw.startsWith(":")) {
    hideCommandSuggestions();
    await runInternalCommand(raw);
    searchInputEl.value = "";
    return;
  }

  const [prefix, ...rest] = raw.split(/\s+/);
  const key = prefix.toLowerCase();
  if (SEARCH_ENGINES[key] && rest.length > 0) {
    window.location.href = SEARCH_ENGINES[key] + encodeURIComponent(rest.join(" "));
    return;
  }

  const looksLikeUrl =
    /^(https?:\/\/)/i.test(raw) ||
    /^(localhost|(\d{1,3}\.){3}\d{1,3})(:\d+)?([/?#].*)?$/i.test(raw) ||
    /^[\w-]+(\.[\w-]+)+([/?#].*)?$/i.test(raw);
  if (looksLikeUrl) {
    window.location.href = ensureHttp(raw);
    return;
  }

  window.location.href = SEARCH_ENGINES.g + encodeURIComponent(raw);
});

const linksTabSwitcherEl = document.getElementById("links-tab-switcher");

function saveHomeTabRename(catId) {
  const input = linksTabSwitcherEl.querySelector(`[data-tab-rename-input="${CSS.escape(catId)}"]`);
  const newName = input?.value.trim();
  const cat = config.categories.find((c) => c.id === catId);
  if (cat && newName) {
    cat.name = newName;
    homeRenamingCatId = null;
    saveConfig();
    renderAll();
  }
}

linksTabSwitcherEl.addEventListener("click", (e) => {
  const renameBtn = e.target.closest("[data-tab-rename]");
  if (renameBtn) {
    homeRenamingCatId = renameBtn.dataset.tabRename;
    renderLinksArea();
    const input = linksTabSwitcherEl.querySelector(`[data-tab-rename-input="${CSS.escape(homeRenamingCatId)}"]`);
    if (input) {
      input.focus();
      input.select();
    }
    return;
  }

  const saveBtn = e.target.closest("[data-tab-rename-save]");
  if (saveBtn) {
    saveHomeTabRename(saveBtn.dataset.tabRenameSave);
    return;
  }

  if (e.target.closest("[data-tab-rename-cancel]")) {
    homeRenamingCatId = null;
    renderLinksArea();
    return;
  }

  const delBtn = e.target.closest("[data-tab-del]");
  if (delBtn) {
    const catId = delBtn.dataset.tabDel;
    const cat = getCategoryById(catId);
    if (cat.protected) return;
    if (cat.items.length > 0 && !confirm(`Delete category "${cat.name}" and its ${cat.items.length} bookmark(s)?`)) {
      return;
    }
    config.categories = config.categories.filter((c) => c.id !== catId);
    if (activeHomeCatId === catId) activeHomeCatId = config.categories[0].id;
    if (homeRenamingCatId === catId) homeRenamingCatId = null;
    homeEditingItemIndex = -1;
    saveConfig();
    renderAll();
    return;
  }

  const btn = e.target.closest("[data-links-tab]");
  if (!btn) return;
  activeHomeCatId = btn.dataset.linksTab;
  homeEditingItemIndex = -1;
  renderLinksArea();
});

linksTabSwitcherEl.addEventListener("keydown", (e) => {
  const input = e.target.closest("[data-tab-rename-input]");
  if (!input) return;
  if (e.key === "Enter") {
    e.preventDefault();
    saveHomeTabRename(input.dataset.tabRenameInput);
  } else if (e.key === "Escape") {
    e.preventDefault();
    homeRenamingCatId = null;
    renderLinksArea();
  }
});

linksTabSwitcherEl.addEventListener("dragstart", (e) => {
  const chip = e.target.closest("[data-tab-drag-idx]");
  if (!chip || homeRenamingCatId) return;
  tabDragSrcIdx = Number(chip.dataset.tabDragIdx);
  chip.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
});

linksTabSwitcherEl.addEventListener("dragover", (e) => {
  if (tabDragSrcIdx < 0) return;
  e.preventDefault();
  const chip = e.target.closest("[data-tab-drag-idx]");
  linksTabSwitcherEl.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
  if (chip && Number(chip.dataset.tabDragIdx) !== tabDragSrcIdx) {
    chip.classList.add("drag-over");
  }
});

linksTabSwitcherEl.addEventListener("drop", (e) => {
  if (tabDragSrcIdx < 0) return;
  e.preventDefault();
  const targetChip = e.target.closest("[data-tab-drag-idx]");
  linksTabSwitcherEl.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
  if (!targetChip) return;
  const dropIdx = Number(targetChip.dataset.tabDragIdx);
  if (dropIdx === tabDragSrcIdx) return;

  const [moved] = config.categories.splice(tabDragSrcIdx, 1);
  config.categories.splice(dropIdx, 0, moved);
  tabDragSrcIdx = -1;
  saveConfig();
  renderAll();
});

linksTabSwitcherEl.addEventListener("dragend", () => {
  tabDragSrcIdx = -1;
  linksTabSwitcherEl.querySelectorAll(".dragging, .drag-over").forEach((el) => el.classList.remove("dragging", "drag-over"));
});

document.getElementById("bookmarks-edit-btn").addEventListener("click", () => {
  isHomeEditMode = !isHomeEditMode;
  homeEditingItemIndex = -1;
  homeRenamingCatId = null;
  renderLinksArea();
});

document.getElementById("inline-add-link-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = document.getElementById("inline-new-link-name").value.trim();
  const url = ensureHttp(document.getElementById("inline-new-link-url").value);
  if (!name || !url) return;

  const cat = getActiveHomeCategory();
  cat.items.push({ name, url });
  saveConfig();
  document.getElementById("inline-new-link-name").value = "";
  document.getElementById("inline-new-link-url").value = "";
  renderAll();
});

document.getElementById("inline-add-category-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = document.getElementById("inline-new-category-input");
  const name = input.value.trim();
  if (!name) return;
  if (!config.categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
    const newCat = { id: `cat_${Date.now()}`, name, protected: false, items: [] };
    config.categories.push(newCat);
    activeHomeCatId = newCat.id;
    homeEditingItemIndex = -1;
    homeRenamingCatId = null;
    saveConfig();
  }
  input.value = "";
  renderAll();
});

/* Timer Listeners */
document.querySelectorAll("[data-timer-mode]").forEach((btn) => {
  btn.addEventListener("click", () => {
    stopTimerInterval();
    stopAlarmLoop();
    timerState.finished = false;
    timerState.mode = btn.dataset.timerMode;
    renderTimer();
  });
});

document.querySelectorAll(".preset-btn[data-minutes]").forEach((btn) => {
  btn.addEventListener("click", () => setTimerMinutes(btn.dataset.minutes));
});

document.getElementById("set-custom-min-btn").addEventListener("click", () => {
  const val = document.getElementById("custom-minutes-input").value;
  if (val) setTimerMinutes(val);
});

document.getElementById("custom-minutes-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    const val = e.currentTarget.value;
    if (val) setTimerMinutes(val);
  }
});

document.getElementById("timer-toggle-btn").addEventListener("click", toggleTimer);
document.getElementById("timer-reset-btn").addEventListener("click", resetTimer);

/* Settings Modal Listeners & Focus Trap */
const settingsModal = document.getElementById("settings-modal");
let lastFocusedBeforeModal = null;

function setBackgroundInert(isInert) {
  document.querySelectorAll(".topbar, .app-main, .hint-footer").forEach((el) => {
    if (isInert) {
      el.setAttribute("inert", "");
      el.setAttribute("aria-hidden", "true");
    } else {
      el.removeAttribute("inert");
      el.removeAttribute("aria-hidden");
    }
  });
}

function openSettingsModal() {
  lastFocusedBeforeModal = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  syncSettingsControls();
  settingsModal.classList.remove("hidden");
  setBackgroundInert(true);
  document.getElementById("close-settings-btn")?.focus();
}

function closeSettingsModal() {
  if (settingsModal.classList.contains("hidden")) return;
  settingsModal.classList.add("hidden");
  setBackgroundInert(false);
  if (lastFocusedBeforeModal && typeof lastFocusedBeforeModal.focus === "function") {
    lastFocusedBeforeModal.focus();
  }
  lastFocusedBeforeModal = null;
}

document.getElementById("open-settings-btn").addEventListener("click", openSettingsModal);
document.getElementById("close-settings-btn").addEventListener("click", closeSettingsModal);
settingsModal.addEventListener("click", (e) => {
  if (e.target === settingsModal) {
    closeSettingsModal();
  }
});

settingsModal.addEventListener("keydown", (e) => {
  if (e.key !== "Tab") return;
  const focusables = Array.from(
    settingsModal.querySelectorAll('button:not([disabled]), input:not([disabled]):not(.sr-only), [href], [tabindex]:not([tabindex="-1"])')
  ).filter((el) => !el.closest(".hidden"));
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
});

document.getElementById("font-size-options").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-font]");
  if (!btn) return;
  config.fontSize = btn.dataset.font;
  saveConfig();
  applyAppearance();
});

document.getElementById("theme-options").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-theme-choice]");
  if (!btn) return;
  config.theme = btn.dataset.themeChoice;
  saveConfig();
  applyAppearance();
});

document.getElementById("weather-city-save").addEventListener("click", () => {
  const city = document.getElementById("weather-city-input").value.trim();
  if (!city) return;
  config.weatherMode = "city";
  config.weatherCity = city;
  saveConfig();
  updateWeather(true);
});

document.getElementById("weather-city-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    document.getElementById("weather-city-save").click();
  }
});

document.getElementById("weather-auto-btn").addEventListener("click", () => {
  config.weatherMode = "auto";
  config.weatherCity = "";
  saveConfig();
  syncSettingsControls();
  updateWeather(true);
});

function swapArrayItems(arr, i, j) {
  if (i < 0 || j < 0 || i >= arr.length || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
}

function bindManageListHandlers(listEl, { getCat, getEditIdx, setEditIdx }) {
  listEl.addEventListener("click", (e) => {
    const cat = getCat();

    const moveBtn = e.target.closest("[data-move]");
    if (moveBtn) {
      const [idxStr, deltaStr] = moveBtn.dataset.move.split(":");
      const idx = Number(idxStr);
      const delta = Number(deltaStr);
      swapArrayItems(cat.items, idx, idx + delta);
      if (getEditIdx() === idx) setEditIdx(idx + delta);
      saveConfig();
      renderAll();
      return;
    }

    const editBtn = e.target.closest("[data-edit]");
    if (editBtn) {
      const idx = Number(editBtn.dataset.edit);
      setEditIdx(getEditIdx() === idx ? -1 : idx);
      renderAll();
      return;
    }

    if (e.target.closest("[data-edit-cancel]")) {
      setEditIdx(-1);
      renderAll();
      return;
    }

    const saveBtn = e.target.closest("[data-edit-save]");
    if (saveBtn) {
      const idx = Number(saveBtn.dataset.editSave);
      if (!Number.isInteger(idx) || idx < 0 || idx >= cat.items.length) return;
      const form = saveBtn.closest("[data-edit-form]");
      const name = form.querySelector("[data-edit-name]").value.trim();
      const url = ensureHttp(form.querySelector("[data-edit-url]").value);
      if (!name || !url) return;
      cat.items[idx] = { name, url };
      setEditIdx(-1);
      saveConfig();
      renderAll();
      return;
    }

    const delBtn = e.target.closest("[data-del]");
    if (delBtn) {
      const idx = Number(delBtn.dataset.del);
      if (!Number.isInteger(idx) || idx < 0 || idx >= cat.items.length) return;
      cat.items.splice(idx, 1);
      setEditIdx(-1);
      saveConfig();
      renderAll();
    }
  });

  listEl.addEventListener("keydown", (e) => {
    const form = e.target.closest("[data-edit-form]");
    if (!form) return;
    if (e.key === "Enter") {
      e.preventDefault();
      form.querySelector("[data-edit-save]")?.click();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setEditIdx(-1);
      renderAll();
    }
  });

  listEl.addEventListener("dragstart", (e) => {
    const item = e.target.closest("[data-drag-idx]");
    if (!item) return;
    dragSrcIdx = Number(item.dataset.dragIdx);
    item.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
  });

  listEl.addEventListener("dragover", (e) => {
    e.preventDefault();
    const item = e.target.closest("[data-drag-idx]");
    listEl.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
    if (item && Number(item.dataset.dragIdx) !== dragSrcIdx) {
      item.classList.add("drag-over");
    }
  });

  listEl.addEventListener("drop", (e) => {
    e.preventDefault();
    const targetItem = e.target.closest("[data-drag-idx]");
    listEl.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
    if (!targetItem || dragSrcIdx < 0) return;
    const dropIdx = Number(targetItem.dataset.dragIdx);
    if (dropIdx === dragSrcIdx) return;

    const cat = getCat();
    const [moved] = cat.items.splice(dragSrcIdx, 1);
    cat.items.splice(dropIdx, 0, moved);
    dragSrcIdx = -1;
    setEditIdx(-1);
    saveConfig();
    renderAll();
  });

  listEl.addEventListener("dragend", () => {
    dragSrcIdx = -1;
    listEl.querySelectorAll(".dragging, .drag-over").forEach((el) => el.classList.remove("dragging", "drag-over"));
  });
}

bindManageListHandlers(document.getElementById("links-edit-list"), {
  getCat: getActiveHomeCategory,
  getEditIdx: () => homeEditingItemIndex,
  setEditIdx: (idx) => {
    homeEditingItemIndex = idx;
  },
});

/* Backup Export / Import / Reset */
document.getElementById("export-json-btn").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "cyber-home-config.json";
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("import-json-btn").addEventListener("click", () => {
  document.getElementById("import-json-input").click();
});

document.getElementById("import-json-input").addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      if (!Array.isArray(parsed.categories) || parsed.categories.length === 0) {
        throw new Error("Invalid categories");
      }
      config = normalizeConfig(parsed);
      if (!config.categories.some((c) => c.id === activeHomeCatId)) {
        activeHomeCatId = config.categories[0].id;
      }
      saveConfig();
      renderAll();
      updateWeather(true);
    } catch {
      alert("Invalid JSON configuration file.");
    }
  };
  reader.readAsText(file);
  e.target.value = "";
});

document.getElementById("reset-all-btn").addEventListener("click", () => {
  if (!confirm("Reset all settings and links to defaults?")) return;
  config = structuredClone(DEFAULT_CONFIG);
  activeHomeCatId = config.categories[0].id;
  isHomeEditMode = false;
  homeEditingItemIndex = -1;
  homeRenamingCatId = null;
  saveConfig();
  setTimerMinutes(config.timerDefaultMinutes);
  renderAll();
  updateWeather(true);
});

/* Global Keyboard Shortcuts */
document.addEventListener("keydown", (e) => {
  const activeEl = document.activeElement;
  const activeTag = activeEl?.tagName;
  const isTyping = activeTag === "INPUT" || activeTag === "TEXTAREA" || activeTag === "SELECT";
  const isModalOpen = !settingsModal.classList.contains("hidden");
  const isZen = document.body.dataset.zen === "true";
  const searchInput = document.getElementById("search-input");

  if (e.key === "Escape" && isModalOpen) {
    closeSettingsModal();
    return;
  }

  if (e.key === "Escape" && !isTyping && isZen) {
    setZenMode(false);
    return;
  }

  if (e.key === "Escape" && isHomeEditMode) {
    if (isTyping && activeEl?.closest("#bookmarks-panel")) {
      activeEl.blur();
      return;
    }
    if (homeRenamingCatId !== null) {
      homeRenamingCatId = null;
    } else if (homeEditingItemIndex !== -1) {
      homeEditingItemIndex = -1;
    } else {
      isHomeEditMode = false;
    }
    renderLinksArea();
    return;
  }

  if (isModalOpen) return;

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    if (currentPage !== "home") setPage("home");
    searchInput.focus();
    return;
  }

  if (e.key === "/" && !isTyping) {
    e.preventDefault();
    if (currentPage !== "home") setPage("home");
    searchInput.focus();
    return;
  }

  if (
    currentPage === "home" &&
    !isTyping &&
    !isZen &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey &&
    /^[1-9]$/.test(e.key)
  ) {
    const idx = Number(e.key) - 1;
    const activeItems = getActiveHomeCategory().items;
    if (activeItems[idx]) {
      window.location.href = ensureHttp(activeItems[idx].url);
    }
  }
});

window.addEventListener(
  "keydown",
  (e) => {
    const activeTag = document.activeElement?.tagName;
    const isTyping = activeTag === "INPUT" || activeTag === "TEXTAREA" || activeTag === "SELECT";
    const isModalOpen = !settingsModal.classList.contains("hidden");
    if (isTyping || isModalOpen) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const key = String(e.key || "").toLowerCase();
    const isZen = document.body.dataset.zen === "true";

    if (key === "h" || e.code === "KeyH") {
      e.preventDefault();
      e.stopPropagation();
      if (isZen) setZenMode(false);
      setPage("home");
      return;
    }

    if (key === "t" || e.code === "KeyT") {
      e.preventDefault();
      e.stopPropagation();
      if (isZen) setZenMode(false);
      setPage(currentPage === "home" ? "timer" : "home");
      return;
    }

    if (key === "z" || e.code === "KeyZ") {
      e.preventDefault();
      e.stopPropagation();
      setZenMode(!isZen);
    }
  },
  { capture: true }
);

/* Tablist Arrow Navigation */
document.addEventListener("keydown", (e) => {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  const tab = e.target.closest('[role="tab"]');
  if (!tab) return;
  const tablist = tab.closest('[role="tablist"]');
  if (!tablist) return;
  const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
  if (tabs.length < 2) return;
  e.preventDefault();
  const curIdx = tabs.indexOf(tab);
  const delta = e.key === "ArrowRight" ? 1 : -1;
  const nextTab = tabs[(curIdx + delta + tabs.length) % tabs.length];
  nextTab.focus();
  nextTab.click();
});

/* === Notepad & Checklist (Persisted in config) === */
const notepadInputEl = document.getElementById("notepad-input");
const notepadSlotsEl = document.getElementById("notepad-slots");
const notepadAddBtn = document.getElementById("notepad-add-btn");
const notepadCopyBtn = document.getElementById("notepad-copy-btn");
const notepadClearBtn = document.getElementById("notepad-clear-btn");

let notepadInlineRenameIdx = -1;
let notepadRenameOriginalName = "";
const notepadUndoStack = [];
let notepadCanUndoSnapshot = false;

function pushNotepadUndo() {
  ensureNotepadSlots();
  notepadUndoStack.push({
    notepads: structuredClone(config.notepads),
    activeNotepadSlot: config.activeNotepadSlot
  });
  if (notepadUndoStack.length > 20) notepadUndoStack.shift();
  notepadCanUndoSnapshot = true;
}

function undoNotepadSnapshot() {
  if (notepadUndoStack.length === 0) return false;
  const snap = notepadUndoStack.pop();
  config.notepads = snap.notepads;
  config.activeNotepadSlot = snap.activeNotepadSlot;
  config.notepad = config.notepads[0]?.text || "";
  notepadCanUndoSnapshot = notepadUndoStack.length > 0;
  saveConfig();
  renderNotepad(true);
  notepadInputEl?.focus();
  return true;
}

function ensureNotepadSlots() {
  if (!Array.isArray(config.notepads) || config.notepads.length === 0) {
    config.notepads = [
      { name: "Note 1", text: typeof config.notepad === "string" ? config.notepad : "" },
      { name: "Note 2", text: "" }
    ];
  } else {
    config.notepads = config.notepads.map((s, idx) =>
      typeof s === "string"
        ? { name: `Note ${idx + 1}`, text: s }
        : { name: String(s?.name || `Note ${idx + 1}`).trim() || `Note ${idx + 1}`, text: typeof s?.text === "string" ? s.text : "" }
    );
  }
  if (
    !Number.isInteger(config.activeNotepadSlot) ||
    config.activeNotepadSlot < 0 ||
    config.activeNotepadSlot >= config.notepads.length
  ) {
    config.activeNotepadSlot = 0;
  }
}

function deleteNotepadAt(idx) {
  ensureNotepadSlots();
  if (config.notepads.length <= 1) return;
  if (!Number.isInteger(idx) || idx < 0 || idx >= config.notepads.length) return;
  pushNotepadUndo();
  config.notepads.splice(idx, 1);
  if (config.activeNotepadSlot >= config.notepads.length) {
    config.activeNotepadSlot = config.notepads.length - 1;
  } else if (idx < config.activeNotepadSlot) {
    config.activeNotepadSlot -= 1;
  }
  config.notepad = config.notepads[0]?.text || "";
  saveConfig();
  renderNotepad(true);
  notepadInputEl?.focus();
}

function renderNotepad(scrollActiveIntoView = false) {
  if (!notepadInputEl) return;
  ensureNotepadSlots();
  const activeIdx = config.activeNotepadSlot;
  const activeNote = config.notepads[activeIdx];
  const activeText = activeNote?.text || "";
  if (notepadInputEl.value !== activeText) {
    notepadInputEl.value = activeText;
  }
  if (notepadSlotsEl) {
    const canDelete = config.notepads.length > 1;
    notepadSlotsEl.innerHTML = config.notepads
      .map((note, idx) => {
        const isActive = idx === activeIdx;
        const hasContent = Boolean(note.text && note.text.trim());

        if (notepadInlineRenameIdx === idx) {
          return `<div class="slot-tab active" role="presentation"><input class="slot-rename-input mono" data-notepad-rename="${idx}" type="text" maxlength="20" autocomplete="off" value="${escapeHtml(note.name)}" aria-label="Rename note ${idx + 1}" /></div>`;
        }

        return `
          <div class="slot-tab${isActive ? " active" : ""}${hasContent ? " has-content" : ""}" data-slot-tab="${idx}" role="presentation">
            <button class="slot-btn" data-notepad-slot="${idx}" type="button" role="tab" aria-selected="${isActive}" title="Double-click to rename">${escapeHtml(note.name)}</button>
            ${canDelete ? `<button class="slot-close-btn" data-notepad-del="${idx}" type="button" title="Close ${escapeHtml(note.name)}" aria-label="Close ${escapeHtml(note.name)}">×</button>` : ""}
          </div>
        `;
      })
      .join("");

    if (scrollActiveIntoView) {
      const target = notepadSlotsEl.querySelector(`[data-slot-tab="${activeIdx}"]`);
      target?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }
}

notepadSlotsEl?.addEventListener("click", (e) => {
  const delBtn = e.target.closest("[data-notepad-del]");
  if (delBtn) {
    deleteNotepadAt(Number(delBtn.dataset.notepadDel));
    return;
  }

  const btn = e.target.closest("[data-notepad-slot]");
  if (!btn) return;
  const idx = Number(btn.dataset.notepadSlot);
  if (!Number.isInteger(idx) || idx < 0 || idx >= config.notepads.length) return;
  if (idx === config.activeNotepadSlot) return;

  config.activeNotepadSlot = idx;
  saveConfig();

  // Toggle active state in-place so DOM nodes stay intact for dblclick
  notepadSlotsEl.querySelectorAll("[data-slot-tab]").forEach((tabEl) => {
    const tabIdx = Number(tabEl.dataset.slotTab);
    const isAct = tabIdx === idx;
    tabEl.classList.toggle("active", isAct);
    tabEl.querySelector("[data-notepad-slot]")?.setAttribute("aria-selected", String(isAct));
  });
  if (notepadInputEl) {
    notepadInputEl.value = config.notepads[idx]?.text || "";
  }
  btn.closest("[data-slot-tab]")?.scrollIntoView({ block: "nearest", inline: "nearest" });
});

notepadSlotsEl?.addEventListener("mousedown", (e) => {
  if (e.button !== 1) return;
  if (e.target.closest("[data-slot-tab]")) {
    e.preventDefault();
  }
});

notepadSlotsEl?.addEventListener("auxclick", (e) => {
  if (e.button !== 1) return;
  const tab = e.target.closest("[data-slot-tab]");
  if (!tab) return;
  e.preventDefault();
  deleteNotepadAt(Number(tab.dataset.slotTab));
});

notepadSlotsEl?.addEventListener("dblclick", (e) => {
  const btn = e.target.closest("[data-notepad-slot]");
  if (!btn) return;
  const idx = Number(btn.dataset.notepadSlot);
  if (!Number.isInteger(idx)) return;
  notepadInlineRenameIdx = idx;
  notepadRenameOriginalName = config.notepads[idx]?.name || `Note ${idx + 1}`;
  renderNotepad();
  const input = notepadSlotsEl.querySelector(`[data-notepad-rename="${idx}"]`);
  if (input) {
    input.focus();
    input.select();
  }
});

function commitNotepadRename(input) {
  const idx = Number(input.dataset.notepadRename);
  if (config.notepads[idx]) {
    config.notepads[idx].name = input.value.trim() || `Note ${idx + 1}`;
    saveConfig();
  }
  notepadInlineRenameIdx = -1;
  notepadRenameOriginalName = "";
  renderNotepad();
}

notepadSlotsEl?.addEventListener("keydown", (e) => {
  const input = e.target.closest("[data-notepad-rename]");
  if (!input) return;
  if (e.key === "Enter") {
    e.preventDefault();
    commitNotepadRename(input);
  } else if (e.key === "Escape") {
    e.preventDefault();
    const idx = Number(input.dataset.notepadRename);
    if (config.notepads[idx] && notepadRenameOriginalName) {
      config.notepads[idx].name = notepadRenameOriginalName;
    }
    notepadInlineRenameIdx = -1;
    notepadRenameOriginalName = "";
    renderNotepad();
  }
});

notepadSlotsEl?.addEventListener("focusout", (e) => {
  const input = e.target.closest("[data-notepad-rename]");
  if (!input) return;
  if (notepadInlineRenameIdx !== -1) {
    commitNotepadRename(input);
  }
});

notepadSlotsEl?.addEventListener(
  "wheel",
  (e) => {
    if (notepadSlotsEl.scrollWidth > notepadSlotsEl.clientWidth && e.deltaY !== 0) {
      e.preventDefault();
      notepadSlotsEl.scrollLeft += e.deltaY;
    }
  },
  { passive: false }
);

function getNextNotepadName() {
  const existing = new Set(config.notepads.map((s) => s.name.trim().toLowerCase()));
  let n = 1;
  while (existing.has(`note ${n}`)) n += 1;
  return `Note ${n}`;
}

notepadAddBtn?.addEventListener("click", () => {
  ensureNotepadSlots();
  config.notepads.push({ name: getNextNotepadName(), text: "" });
  config.activeNotepadSlot = config.notepads.length - 1;
  saveConfig();
  renderNotepad(true);
  notepadInputEl?.focus();
});

notepadInputEl?.addEventListener("input", () => {
  ensureNotepadSlots();
  notepadCanUndoSnapshot = false;
  config.notepads[config.activeNotepadSlot].text = notepadInputEl.value;
  if (config.activeNotepadSlot === 0) config.notepad = notepadInputEl.value;
  saveConfig();
  const activeTab = notepadSlotsEl?.querySelector(".slot-tab.active");
  activeTab?.classList.toggle("has-content", Boolean(notepadInputEl.value.trim()));
});

notepadCopyBtn?.addEventListener("click", async () => {
  if (!notepadInputEl) return;
  try {
    await navigator.clipboard.writeText(notepadInputEl.value);
    notepadCopyBtn.textContent = "COPIED";
    setTimeout(() => {
      notepadCopyBtn.textContent = "COPY";
    }, 1200);
  } catch {
    notepadInputEl.select();
  }
});

notepadClearBtn?.addEventListener("click", () => {
  if (!notepadInputEl) return;
  ensureNotepadSlots();
  if (config.notepads[config.activeNotepadSlot]?.text) {
    pushNotepadUndo();
  }
  notepadInputEl.value = "";
  config.notepads[config.activeNotepadSlot].text = "";
  if (config.activeNotepadSlot === 0) config.notepad = "";
  saveConfig();
  renderNotepad();
  notepadInputEl.focus();
});

document.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "z") return;
  if (currentPage !== "home" || !settingsModal.classList.contains("hidden")) return;
  if (!notepadCanUndoSnapshot || notepadUndoStack.length === 0) return;

  const activeEl = document.activeElement;
  const isOtherInput =
    (activeEl?.tagName === "INPUT" || activeEl?.tagName === "TEXTAREA") && activeEl !== notepadInputEl;
  if (isOtherInput) return;

  e.preventDefault();
  undoNotepadSnapshot();
});

const checklistFormEl = document.getElementById("checklist-form");
const checklistInputEl = document.getElementById("checklist-input");
const checklistListEl = document.getElementById("checklist-list");
const checklistCountEl = document.getElementById("checklist-count");
const checklistClearDoneBtn = document.getElementById("checklist-clear-done-btn");

function renderChecklist() {
  if (!checklistListEl || !checklistCountEl) return;
  const tasks = Array.isArray(config.checklist) ? config.checklist : [];
  const doneCount = tasks.filter((t) => t.done).length;
  checklistCountEl.textContent = `[${doneCount}/${tasks.length}]`;
  checklistClearDoneBtn?.classList.toggle("hidden", doneCount === 0);

  if (tasks.length === 0) {
    checklistListEl.innerHTML = "";
    return;
  }

  checklistListEl.innerHTML = tasks
    .map(
      (task, idx) => `
      <li class="checklist-item${task.done ? " done" : ""}">
        <button type="button" class="checklist-toggle" data-check-toggle="${idx}" role="checkbox" aria-checked="${Boolean(task.done)}">
          <span class="checklist-box" aria-hidden="true">${task.done ? "[✓]" : "[ ]"}</span>
          <span class="checklist-text">${escapeHtml(task.text)}</span>
        </button>
        <button type="button" class="checklist-del" data-check-del="${idx}" aria-label="Remove task ${escapeHtml(task.text)}">✕</button>
      </li>
    `
    )
    .join("");
}

checklistClearDoneBtn?.addEventListener("click", () => {
  if (!Array.isArray(config.checklist)) return;
  config.checklist = config.checklist.filter((t) => !t.done);
  saveConfig();
  renderChecklist();
});

checklistFormEl?.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = checklistInputEl.value.trim();
  if (!text) return;
  if (!Array.isArray(config.checklist)) config.checklist = [];
  config.checklist.unshift({ text, done: false });
  checklistInputEl.value = "";
  saveConfig();
  renderChecklist();
});

function sortChecklistPendingFirst() {
  if (!Array.isArray(config.checklist)) return;
  const pending = config.checklist.filter((t) => !t.done);
  const done = config.checklist.filter((t) => t.done);
  config.checklist = [...pending, ...done];
}

checklistListEl?.addEventListener("click", (e) => {
  if (!Array.isArray(config.checklist)) return;
  const toggleBtn = e.target.closest("[data-check-toggle]");
  if (toggleBtn) {
    const idx = Number(toggleBtn.dataset.checkToggle);
    if (config.checklist[idx]) {
      config.checklist[idx].done = !config.checklist[idx].done;
      sortChecklistPendingFirst();
      saveConfig();
      renderChecklist();
    }
    return;
  }

  const delBtn = e.target.closest("[data-check-del]");
  if (delBtn) {
    const idx = Number(delBtn.dataset.checkDel);
    if (!Number.isInteger(idx) || idx < 0 || idx >= config.checklist.length) return;
    config.checklist.splice(idx, 1);
    saveConfig();
    renderChecklist();
  }
});

/* === Connectivity Easter Egg (SYS // ONLINE <-> SYS // OFFLINE) === */
const statusBadgeEl = document.querySelector(".status-badge");
const faviconEl = document.querySelector('link[rel="icon"]');

function setConnectivityUI(isOnline) {
  document.body.dataset.online = isOnline ? "true" : "false";
  if (statusBadgeEl) {
    statusBadgeEl.textContent = isOnline ? "SYS // ONLINE" : "SYS // OFFLINE";
  }
  if (faviconEl) {
    faviconEl.setAttribute("href", isOnline ? "favicon.svg" : "favicon-offline.svg");
  }
}

function checkInternetConnectivity() {
  setConnectivityUI(navigator.onLine !== false);
}

window.addEventListener("online", () => {
  setConnectivityUI(true);
});

window.addEventListener("offline", () => {
  setConnectivityUI(false);
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    checkInternetConnectivity();
  }
});

/* Init */
updateClock();
setInterval(updateClock, 1000);
renderAll();
updateWeather();
checkInternetConnectivity();
