import { api } from "./db.js";

const NORMAL_HELP_LINES = [
  "normal commands",
  "help         - show available commands",
  "installer    - open desktop installer screen",
  "installer direct - download Windows installer",
  "check updates - check and install desktop app updates",
  "bg image     - choose terminal background image",
  "bg clear     - remove terminal background image",
  "login        - admin login",
  "admin        - admin login",
  "toot on      - enable sound",
  "toot off     - disable sound",
  "apps         - print all apps",
  "mails        - print all mail accounts",
  "search mails <text> - find mail accounts by text",
  "mails=gmail  - print gmail addresses",
  "mails=yhoo   - print yahoo addresses",
  "clear        - clear terminal output",
  "cls          - clear terminal output",
];

const ADMIN_HELP_LINES = [
  "admin commands",
  "logout       - end admin session",
  "add          - bulk add apps or mails",
  "apps format  - name,link,description|name,link,description",
  "mails format - email1,email2,email3",
  "delete mail <email> - delete one mail account",
  "db           - show tables",
  "db <table>   - show rows from a table",
  "wipe all data - delete all table data with y/n confirm",
  "wipe data from <table> - delete all rows from one table",
  "wipe <table> - drop a table",
  "seed         - insert sample data",
];

const ASCII_LOGO = String.raw`
██╗  ██╗███╗   ██╗██╗   ██╗██╗     ██╗
██║ ██╔╝████╗  ██║██║   ██║██║     ██║
█████╔╝ ██╔██╗ ██║██║   ██║██║     ██║
██╔═██╗ ██║╚██╗██║██║   ██║██║     ██║
██║  ██╗██║ ╚████║╚██████╔╝███████╗███████╗
╚═╝  ╚═╝╚═╝  ╚═══╝ ╚═════╝ ╚══════╝╚══════╝
`;

const PROMPT_TEXT = "root@knull:~$";
const PASSWORD_PROMPT = "password@knull:~$";
const SOUND_PREF_KEY = "knull_sound_enabled";
const BACKGROUND_PREF_KEY = "knull_background_image";
const INSTALLER_FILE = "/downloads/KNULL-setup.exe";

const sound = {
  context: null,
  master: null,
  unlocked: false,
  enabled: loadSoundPreference(),

  ensureContext() {
    if (!window.AudioContext && !window.webkitAudioContext) return;
    if (!this.context) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.context = new AudioCtx();
      this.master = this.context.createGain();
      this.master.gain.value = 1.8;
      this.master.connect(this.context.destination);
    }
  },

  async unlock() {
    this.ensureContext();
    if (!this.context) return;

    if (this.context.state === "suspended") {
      await this.context.resume();
    }

    this.unlocked = this.context.state === "running";
  },

  pulse({ type = "sine", frequency = 440, duration = 0.05, volume = 0.03, attack = 0.002, release = 0.05, detune = 0 } = {}) {
    if (!this.enabled || !this.unlocked || !this.context || !this.master) return;

    const now = this.context.currentTime;
    const gain = this.context.createGain();
    const osc = this.context.createOscillator();

    osc.type = type;
    osc.frequency.setValueAtTime(frequency, now);
    osc.detune.setValueAtTime(detune, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration + release);

    osc.connect(gain);
    gain.connect(this.master);

    osc.start(now);
    osc.stop(now + duration + release + 0.01);
  },

  chirp({ type = "triangle", from = 780, to = 520, duration = 0.018, volume = 0.11, attack = 0.001, release = 0.018 } = {}) {
    if (!this.enabled || !this.unlocked || !this.context || !this.master) return;

    const now = this.context.currentTime;
    const gain = this.context.createGain();
    const osc = this.context.createOscillator();

    osc.type = type;
    osc.frequency.setValueAtTime(from, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), now + duration);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration + release);

    osc.connect(gain);
    gain.connect(this.master);

    osc.start(now);
    osc.stop(now + duration + release + 0.01);
  },

  playPrint() {
    this.chirp({
      type: "triangle",
      from: 760 + Math.random() * 90,
      to: 500 + Math.random() * 70,
      duration: 0.016,
      volume: 0.12,
      release: 0.016,
    });
  },

  setEnabled(nextValue) {
    this.enabled = nextValue;
    try {
      localStorage.setItem(SOUND_PREF_KEY, nextValue ? "1" : "0");
    } catch {
      // Ignore storage failures and keep the in-memory setting.
    }
  },
};

const state = {
  status: null,
  flow: null,
  loading: null,
  outputQueue: Promise.resolve(),
};

const elements = {
  output: document.querySelector("#terminal-output"),
  form: document.querySelector("#command-form"),
  input: document.querySelector("#command-input"),
  backgroundPicker: document.querySelector("#background-picker"),
  prompt: document.querySelector(".prompt"),
  installerScreen: document.querySelector("#installer-screen"),
  installerLogo: document.querySelector("#installer-logo"),
  installerDownload: document.querySelector("#installer-download"),
  installerClose: document.querySelector("#installer-close"),
  installerPrintLines: [...document.querySelectorAll(".installer-screen__printline")],
};

function loadSoundPreference() {
  try {
    return localStorage.getItem(SOUND_PREF_KEY) !== "0";
  } catch {
    return true;
  }
}

function loadBackgroundPreference() {
  try {
    return localStorage.getItem(BACKGROUND_PREF_KEY) || "";
  } catch {
    return "";
  }
}

function applyBackgroundImage(dataUrl, persist = true) {
  const hasImage = Boolean(dataUrl);
  document.body.style.backgroundImage = hasImage ? `url("${dataUrl}")` : "";
  document.body.classList.toggle("has-bg-image", hasImage);

  if (!persist) return;

  try {
    if (hasImage) {
      localStorage.setItem(BACKGROUND_PREF_KEY, dataUrl);
    } else {
      localStorage.removeItem(BACKGROUND_PREF_KEY);
    }
  } catch {
    appendLine("background applied for this session only", "line--muted");
  }
}

function clearBackgroundImage() {
  applyBackgroundImage("");
}

function requestBackgroundImage() {
  elements.backgroundPicker.value = "";
  elements.backgroundPicker.click();
}

function isDesktopApp() {
  return Boolean(window.__TAURI__?.core?.invoke);
}

async function runDesktopUpdateCheck() {
  if (!isDesktopApp()) {
    appendLine("check updates is available only in the desktop app", "line--error");
    return;
  }

  const result = await withLoading("checking updates", async () => {
    return window.__TAURI__.core.invoke("check_updates");
  }, { minDuration: 200 });

  appendLine(result, "line--subtle");
}

function scrollToBottom() {
  const output = elements.output;
  const follow = () => {
    output.scrollTop = output.scrollHeight + 1000;
  };

  follow();
  requestAnimationFrame(follow);
  setTimeout(follow, 0);
  setTimeout(follow, 16);
}

function appendNode(node) {
  elements.output.appendChild(node);
  scrollToBottom();
}

function appendLineNow(text, variant = "") {
  const div = document.createElement("div");
  div.className = variant ? `line ${variant}` : "line";
  div.textContent = text;
  appendNode(div);
  if (!variant.includes("loading")) {
    sound.playPrint();
  }
  return div;
}

function appendLine(text, variant = "") {
  return enqueueOutput(() => appendLineNow(text, variant));
}

function appendAppRow(app) {
  const row = document.createElement("div");
  row.className = "line";

  const name = document.createElement("span");
  name.textContent = `${app.name}  ${app.description}  `;
  row.appendChild(name);

  const link = document.createElement("a");
  link.href = app.link;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.className = "line-link";
  link.textContent = "download";
  row.appendChild(link);

  enqueueOutput(() => {
    appendNode(row);
    sound.playPrint();
  });
}

function appendDownloadRow(label, href, filename) {
  const row = document.createElement("div");
  row.className = "line";

  const text = document.createElement("span");
  text.textContent = `${label}  `;
  row.appendChild(text);

  const link = document.createElement("a");
  link.href = href;
  link.className = "line-link";
  link.textContent = "download";
  link.setAttribute("download", filename);
  row.appendChild(link);

  enqueueOutput(() => {
    appendNode(row);
    sound.playPrint();
  });
}

function triggerInstallerDownload() {
  const link = document.createElement("a");
  link.href = INSTALLER_FILE;
  link.download = "KNULL-setup.exe";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function openInstallerScreen() {
  renderInstallerLogo();
  elements.installerScreen.hidden = false;
  elements.installerScreen.setAttribute("aria-hidden", "false");
  elements.form.setAttribute("aria-hidden", "true");
  elements.form.style.visibility = "hidden";
  await animateInstallerScreen();
  elements.installerDownload.focus();
}

function closeInstallerScreen() {
  elements.installerScreen.hidden = true;
  elements.installerScreen.setAttribute("aria-hidden", "true");
  elements.form.removeAttribute("aria-hidden");
  elements.form.style.visibility = "";
  elements.input.focus();
}

function buildAsciiElement(text) {
  const pre = document.createElement("pre");
  pre.className = "ascii";
  const lines = text.trim().split("\n");

  lines.forEach((line, index) => {
    const span = document.createElement("span");
    span.className = "ascii__line";
    span.textContent = line;
    span.style.setProperty("--flicker-delay", `${(index * 0.37).toFixed(2)}s`);
    span.style.setProperty("--flicker-duration", `${(3.8 + index * 0.43).toFixed(2)}s`);
    pre.appendChild(span);
  });

  return pre;
}

function appendAscii(text) {
  const pre = buildAsciiElement(text);
  return enqueueOutput(() => appendNode(pre));
}

function renderInstallerLogo() {
  elements.installerLogo.innerHTML = "";
  elements.installerLogo.appendChild(buildAsciiElement(ASCII_LOGO));
}

async function animateInstallerScreen() {
  const asciiLines = [...elements.installerLogo.querySelectorAll(".ascii__line")];

  asciiLines.forEach((line) => line.classList.remove("is-visible"));
  elements.installerPrintLines.forEach((line) => line.classList.remove("is-visible"));

  for (const line of asciiLines) {
    line.classList.add("is-visible");
    sound.playPrint();
    await sleep(70);
  }

  for (const line of elements.installerPrintLines) {
    line.classList.add("is-visible");
    sound.playPrint();
    await sleep(86);
  }
}

function appendSpacer() {
  const div = document.createElement("div");
  div.className = "spacer";
  return enqueueOutput(() => appendNode(div));
}

function appendTable(title, rows) {
  appendLine(title, "line--section");

  if (!rows.length) {
    appendLine("(no rows)", "line--subtle");
    return;
  }

  const columns = Object.keys(rows[0]);
  const widths = columns.map((column) =>
    Math.max(
      column.length,
      ...rows.map((row) => String(row[column] ?? "").length)
    )
  );

  const formatRow = (row) =>
    columns
      .map((column, index) => String(row[column] ?? "").padEnd(widths[index], " "))
      .join(" | ");

  appendLine(formatRow(Object.fromEntries(columns.map((column) => [column, column]))), "line--section");
  appendLine(widths.map((width) => "-".repeat(width)).join("-+-"), "line--subtle");
  rows.forEach((row) => appendLine(formatRow(row)));
}

function appendAppList(apps) {
  appendLine("apps", "line--section");

  if (!apps.length) {
    appendLine("(no apps)", "line--subtle");
    return;
  }

  apps.forEach(appendAppRow);
}

function appendMailGroups(emails) {
  appendLine("mails", "line--section");

  if (!emails.length) {
    appendLine("(no mails)", "line--subtle");
    return;
  }

  const columnWidth = emails.reduce(
    (max, email) => Math.max(max, email.length),
    0
  );

  for (let index = 0; index < emails.length; index += 3) {
    const row = emails
      .slice(index, index + 3)
      .map((email) => email.padEnd(columnWidth, " "))
      .join("  |  ");
    appendLine(row);
  }
}

function filterMailsByProvider(emails, provider) {
  const aliases = {
    gmail: ["gmail.com"],
    yahoo: ["yahoo.com"],
    yhoo: ["yahoo.com"],
    outlook: ["outlook.com", "hotmail.com", "live.com"],
    proton: ["proton.me", "protonmail.com"],
  };

  const domains = aliases[provider] || [provider];
  return emails.filter((email) => {
    const atIndex = email.lastIndexOf("@");
    if (atIndex === -1) return false;
    const domain = email.slice(atIndex + 1).toLowerCase();
    return domains.includes(domain);
  });
}

function setPrompt(text, isPassword = false) {
  elements.prompt.textContent = text;
  elements.input.dataset.password = isPassword ? "true" : "false";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function enqueueOutput(task, delay = 28) {
  state.outputQueue = state.outputQueue.then(async () => {
    const result = task();
    if (delay > 0) {
      await sleep(delay);
    }
    return result;
  });

  return state.outputQueue;
}

function setBusy(isBusy) {
  elements.input.disabled = isBusy;
  elements.input.placeholder = isBusy ? "processing..." : 'type "help"';
}

function resetPrompt() {
  setPrompt(PROMPT_TEXT);
}

function clearFlow() {
  state.flow = null;
  resetPrompt();
}

function beginAdminLoginFlow() {
  state.flow = {
    type: "admin-login",
    steps: [{ key: "password", prompt: "enter admin password:" }],
    index: 0,
    answers: {},
  };
  setPrompt(PASSWORD_PROMPT, true);
  appendLine("enter admin password:", "line--section");
}

function beginAddFlow() {
  state.flow = { type: "choose-add-target" };
  appendLine("1. apps", "line--section");
  appendLine("2. mails", "line--section");
  appendLine("select option number:", "line--subtle");
}

function beginBulkAddAppsFlow() {
  state.flow = { type: "add-app-bulk" };
  appendLine("paste apps in this format:", "line--section");
  appendLine("appname,link,description|appname,link,description", "line--subtle");
}

function beginBulkAddMailsFlow() {
  state.flow = { type: "add-mail-bulk" };
  appendLine("paste mail accounts in this format:", "line--section");
  appendLine("email1@gmail.com,email2@yahoo.com,email3@outlook.com", "line--subtle");
  appendLine("or use one email per line. | is also supported.", "line--subtle");
  appendLine("tip: use Shift+Enter for a new line before submitting.", "line--subtle");
}

function beginWipeAllConfirmFlow() {
  state.flow = {
    type: "confirm-wipe-all",
    steps: [{ key: "confirm", prompt: "confirm wipe all data? (y/n):" }],
    index: 0,
    answers: {},
  };
  appendLine("confirm wipe all data? (y/n):", "line--error");
}

function printHelp() {
  appendLine("normal commands", "line--section");
  NORMAL_HELP_LINES.slice(1).forEach((line) => appendLine(line));

  if (state.status?.adminAuthenticated) {
    appendSpacer();
    appendLine("admin commands", "line--section");
    ADMIN_HELP_LINES.slice(1).forEach((line) => appendLine(line));
  }
}

function printStatusLines() {
  if (!state.status) {
    appendLine("status unavailable", "line--error");
    return;
  }

  appendLine(
    state.status.dbConnected ? "neon database connected" : "neon database unavailable",
    state.status.dbConnected ? "line--subtle" : "line--error"
  );
  appendLine(
    state.status.adminAuthenticated ? "admin session unlocked" : "admin commands locked",
    state.status.adminAuthenticated ? "line--subtle" : "line--subtle"
  );
}

function printWelcome() {
  appendAscii(ASCII_LOGO);
  appendLine('type "help" to view commands', "line--section");
  printStatusLines();
  appendSpacer();
}

function clearOutput() {
  elements.output.innerHTML = "";
  printWelcome();
}

function requireAdmin() {
  if (state.status?.adminAuthenticated) return true;
  appendLine('admin only command. use "login" or "admin".', "line--error");
  return false;
}

async function refreshStatus() {
  state.status = await api.getStatus();
}

function waitForPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(resolve);
    });
  });
}

async function withLoading(label, action, options = {}) {
  if (state.loading) {
    return action();
  }

  const minDuration = options.minDuration ?? 180;

  const frames = [
    "\u280b",
    "\u2819",
    "\u2839",
    "\u2838",
    "\u283c",
    "\u2834",
    "\u2826",
    "\u2827",
    "\u2807",
    "\u280f",
  ];
  const line = appendLine(`${frames[0]} ${label}`, "line--loading");
  await state.outputQueue;
  const loadingLine = elements.output.lastElementChild;
  let frameIndex = 0;
  const startedAt = Date.now();

  state.loading = {
    timer: setInterval(() => {
      frameIndex = (frameIndex + 1) % frames.length;
      loadingLine.textContent = `${frames[frameIndex]} ${label}`;
      scrollToBottom();
    }, 90),
  };

  setBusy(true);
  await waitForPaint();

  try {
    const result = await action();
    const elapsed = Date.now() - startedAt;
    if (elapsed < minDuration) {
      await sleep(minDuration - elapsed);
    }
    clearInterval(state.loading.timer);
    loadingLine.textContent = `${label} [done]`;
    return result;
  } catch (error) {
    const elapsed = Date.now() - startedAt;
    if (elapsed < minDuration) {
      await sleep(minDuration - elapsed);
    }
    clearInterval(state.loading.timer);
    loadingLine.textContent = `${label} [fail]`;
    throw error;
  } finally {
    state.loading = null;
    setBusy(false);
  }
}

async function completeFlow() {
  const { type, answers, payload } = state.flow;

  if (type === "admin-login") {
    await withLoading("verifying admin", async () => {
      await api.login(answers.password);
      await refreshStatus();
    });
    appendLine("admin login successful", "line--success");
    clearFlow();
    return;
  }

  if (type === "add-app-bulk") {
    const apps = parseAppsPayload(payload);
    const result = await withLoading("saving apps", () => api.bulkAddApps(apps));
    appendLine(`${result.inserted} apps saved`, "line--success");
    clearFlow();
    return;
  }

  if (type === "add-mail-bulk") {
    const mails = parseMailsPayload(payload);
    const result = await withLoading("saving mails", () => api.bulkAddMails(mails));
    appendLine(`${result.inserted} mail accounts saved`, "line--success");
    clearFlow();
    return;
  }

  if (type === "confirm-wipe-all") {
    if (answers.confirm.toLowerCase() !== "y") {
      appendLine("wipe all cancelled", "line--muted");
      clearFlow();
      return;
    }

    await withLoading("wiping all data", () => api.wipeAllData());
    appendLine("all table data deleted", "line--success");
    clearFlow();
  }
}

function splitFields(record, fieldCount) {
  const parts = record.split(",");
  if (parts.length < fieldCount) {
    throw new Error("invalid add format");
  }

  const head = parts.slice(0, fieldCount - 1).map((part) => part.trim());
  const tail = parts.slice(fieldCount - 1).join(",").trim();
  return [...head, tail];
}

function parseAppsPayload(payload) {
  const records = payload
    .split("|")
    .map((record) => record.trim())
    .filter(Boolean);

  if (!records.length) {
    throw new Error("no apps provided");
  }

  return records.map((record) => {
    const [name, link, description] = splitFields(record, 3);
    if (!name || !link || !description) {
      throw new Error("each app must include name, link, and description");
    }
    return { name, link, description };
  });
}

function parseMailsPayload(payload) {
  const records = payload
    .split(/[\r\n|,]+/)
    .map((record) => record.trim())
    .filter(Boolean);

  if (!records.length) {
    throw new Error("no mail accounts provided");
  }

  const invalid = records.find((record) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record));
  if (invalid) {
    throw new Error(`invalid email: ${invalid}`);
  }

  return [...new Set(records.map((record) => record.toLowerCase()))].map((accountEmail) => ({
    accountEmail,
  }));
}

async function submitFlowAnswer(value) {
  if (state.flow.type === "admin-login") {
    state.flow.answers.password = value;
    await completeFlow();
    return;
  }

  if (state.flow.type === "confirm-wipe-all") {
    state.flow.answers.confirm = value;
    await completeFlow();
    return;
  }

  if (state.flow.type === "add-app-bulk" || state.flow.type === "add-mail-bulk") {
    state.flow.payload = value;
    await completeFlow();
  }
}

function handleAddChoice(value) {
  if (value === "1") {
    beginBulkAddAppsFlow();
    return;
  }

  if (value === "2") {
    beginBulkAddMailsFlow();
    return;
  }

    appendLine("invalid option. select 1 or 2.", "line--error");
    appendLine("select option number:", "line--subtle");
}

function normalizeTableName(value) {
  return value.trim().replace(/^<|>$/g, "").trim();
}

function normalizeSearchValue(value) {
  return value.trim().replace(/^["'<]+|[>"']+$/g, "").trim().toLowerCase();
}

function normalizeMailSearchToken(value) {
  return normalizeSearchValue(value).replace(/[^a-z0-9@._+-]/g, "");
}

function matchesMailSearch(email, query) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedQuery = normalizeMailSearchToken(query);

  if (!normalizedQuery) return false;
  if (normalizedEmail.includes(normalizedQuery)) return true;

  const localPart = normalizedEmail.split("@")[0] || "";
  if (localPart.includes(normalizedQuery)) return true;

  const compactEmail = normalizedEmail.replace(/[^a-z0-9]/g, "");
  const compactQuery = normalizedQuery.replace(/[^a-z0-9]/g, "");
  return compactQuery ? compactEmail.includes(compactQuery) : false;
}

async function runCommand(rawValue) {
  const command = rawValue.trim().toLowerCase();
  if (!command) return;

  if (state.flow?.type === "choose-add-target") {
    handleAddChoice(command);
    return;
  }

  if (state.flow) {
    await submitFlowAnswer(rawValue.trim());
    return;
  }

  if (command === "help") {
    printHelp();
    return;
  }

  if (command === "installer") {
    await openInstallerScreen();
    return;
  }

  if (command === "installer direct") {
    appendLine("starting installer download", "line--muted");
    triggerInstallerDownload();
    return;
  }

  if (command === "check updates") {
    await runDesktopUpdateCheck();
    return;
  }

  if (command === "bg image" || command === "background image") {
    appendLine("choose a background image", "line--muted");
    requestBackgroundImage();
    return;
  }

  if (command === "bg clear" || command === "background clear") {
    clearBackgroundImage();
    appendLine("background image cleared", "line--muted");
    return;
  }

  if (command === "toot on") {
    sound.setEnabled(true);
    appendLine("sound enabled", "line--success");
    return;
  }

  if (command === "toot off") {
    sound.setEnabled(false);
    appendLine("sound disabled", "line--muted");
    return;
  }

  if (command === "login" || command === "admin") {
    if (state.status?.adminAuthenticated) {
      appendLine("admin session already active", "line--muted");
      return;
    }
    beginAdminLoginFlow();
    return;
  }

  if (command === "logout") {
    await withLoading("closing admin session", async () => {
      await api.logout();
      await refreshStatus();
    });
    appendLine("admin session closed", "line--muted");
    return;
  }

  if (command === "add") {
    if (!requireAdmin()) return;
    beginAddFlow();
    return;
  }

  if (command === "seed") {
    if (!requireAdmin()) return;
    const result = await withLoading("seeding database", () => api.seed());
    appendLine(
      result.inserted ? "sample data inserted" : "seed skipped, data already exists",
      result.inserted ? "line--success" : "line--muted"
    );
    return;
  }

  if (command === "apps") {
    const result = await withLoading("reading apps", () => api.listApps());
    appendAppList(result.apps);
    return;
  }

  if (command === "mails") {
    const result = await withLoading("reading mails", () => api.listMailAccounts());
    appendMailGroups(result.mails);
    return;
  }

  if (command.startsWith("search mails ")) {
    const query = rawValue.slice("search mails ".length);
    if (!query) {
      appendLine("usage: search mails <text>", "line--error");
      return;
    }

    const result = await withLoading(`searching mails for ${query}`, () => api.listMailAccounts());
    const filtered = result.mails.filter((email) => matchesMailSearch(email, query));
    appendMailGroups(filtered);
    return;
  }

  if (command.startsWith("mails=")) {
    const provider = command.slice("mails=".length).trim();
    if (!provider) {
      appendLine("usage: mails=gmail", "line--error");
      return;
    }

    const result = await withLoading(`reading ${provider} mails`, () => api.listMailAccounts());
    const filtered = filterMailsByProvider(result.mails, provider);
    appendMailGroups(filtered);
    return;
  }

  if (command.startsWith("delete mail ")) {
    if (!requireAdmin()) return;
    const email = rawValue.slice("delete mail ".length).trim().toLowerCase();
    if (!email) {
      appendLine("usage: delete mail <email>", "line--error");
      return;
    }

    await withLoading(`deleting ${email}`, () => api.deleteMailAccount(email));
    appendLine(`mail account deleted: ${email}`, "line--success");
    return;
  }

  if (command === "db") {
    if (!requireAdmin()) return;
    const result = await withLoading("reading tables", () => api.getTables());
    appendTable("tables", result.tables);
    return;
  }

  if (command.startsWith("db ")) {
    if (!requireAdmin()) return;
    const table = normalizeTableName(rawValue.slice(3));
    const result = await withLoading(`reading ${table}`, () => api.getTable(table));
    appendTable(`table: ${table}`, result.rows);
    return;
  }

  if (command === "wipe all data" || command === "wipe all") {
    if (!requireAdmin()) return;
    beginWipeAllConfirmFlow();
    return;
  }

  if (command.startsWith("wipe data from ")) {
    if (!requireAdmin()) return;
    const table = normalizeTableName(rawValue.slice("wipe data from ".length));
    await withLoading(`wiping data from ${table}`, () => api.wipeTableData(table));
    appendLine(`all data deleted from ${table}`, "line--success");
    return;
  }

  if (command.startsWith("wipe ")) {
    if (!requireAdmin()) return;
    const table = normalizeTableName(rawValue.slice("wipe ".length));
    await withLoading(`dropping ${table}`, () => api.dropTable(table));
    appendLine(`table dropped: ${table}`, "line--success");
    return;
  }

  if (command === "clear" || command === "cls") {
    clearOutput();
    return;
  }

  appendLine(`unknown command: ${rawValue}`, "line--error");
}

async function init() {
  sound.ensureContext();
  const savedBackground = loadBackgroundPreference();
  if (savedBackground) {
    applyBackgroundImage(savedBackground, false);
  }
  await withLoading("connecting backend", refreshStatus, { minDuration: 120 });
  printWelcome();
  await state.outputQueue;
  resetPrompt();
  elements.input.focus();
}

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await sound.unlock();
  const rawValue = elements.input.value;
  const value = rawValue.trim();
  if (!value) return;

  const maskedValue = state.flow?.type === "admin-login" ? "*".repeat(value.length) : value;
  await appendLine(`${elements.prompt.textContent} ${maskedValue}`, "line--command");
  
  elements.input.value = "";
  elements.input.style.height = "";

  try {
    await runCommand(value);
  } catch (error) {
    if (state.flow?.type === "admin-login") {
      clearFlow();
    }
    appendLine(error.message || "command failed", "line--error");
  }

  scrollToBottom();
  elements.input.focus();
});

elements.input.addEventListener("pointerdown", () => {
  sound.unlock().catch(() => {});
});

elements.input.addEventListener("keydown", () => {
  sound.unlock().catch(() => {});
}, { once: true });

elements.input.addEventListener("focus", () => {
  scrollToBottom();
});
elements.input.addEventListener("input", () => {
  elements.input.style.height = "auto";
  elements.input.style.height = `${Math.min(elements.input.scrollHeight, 140)}px`;
});
elements.backgroundPicker.addEventListener("change", () => {
  const [file] = elements.backgroundPicker.files || [];
  if (!file) {
    appendLine("background selection cancelled", "line--muted");
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    applyBackgroundImage(String(reader.result || ""));
    appendLine(`background image loaded: ${file.name}`, "line--muted");
  };
  reader.onerror = () => {
    appendLine("unable to read background image", "line--error");
  };
  reader.readAsDataURL(file);
});
elements.input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    elements.form.requestSubmit();
  }
});

new MutationObserver(() => {
  scrollToBottom();
}).observe(elements.output, {
  childList: true,
  subtree: true,
  characterData: true,
});

elements.installerDownload.addEventListener("click", () => {
  closeInstallerScreen();
});

elements.installerClose.addEventListener("click", () => {
  closeInstallerScreen();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !elements.installerScreen.hidden) {
    closeInstallerScreen();
  }
});

init().catch((error) => {
  console.error(error);
  appendLine("boot failure", "line--error");
});

