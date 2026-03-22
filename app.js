import { api } from "./db.js";

const ASCII_LOGO = String.raw`
██╗  ██╗███╗   ██╗██╗   ██╗██╗     ██╗
██║ ██╔╝████╗  ██║██║   ██║██║     ██║
█████╔╝ ██╔██╗ ██║██║   ██║██║     ██║
██╔═██╗ ██║╚██╗██║██║   ██║██║     ██║
██║  ██╗██║ ╚████║╚██████╔╝███████╗███████╗
╚═╝  ╚═╝╚═╝  ╚═══╝ ╚═════╝ ╚══════╝╚══════╝
`;

const HELP_LINES = [
  "commands",
  "help    - show available commands",
  "login   - admin login",
  "admin   - admin login",
  "logout  - end admin session",
  "add     - bulk add apps or mails after admin login",
  'apps format: name,link,description|name,link,description',
  "apps    - print all apps",
  "mails format: email1,email2,email3",
  "or use one email per line",
  "mails   - print all mail accounts",
  "db      - show tables",
  "db <table> - show rows from a table",
  "wipe all data - delete all table data with y/n confirm",
  "wipe data from <table> - delete all rows from one table",
  "wipe <table> - drop a table",
  "seed    - insert sample data after admin login",
  "clear   - clear terminal output",
  "cls     - clear terminal output",
];

const PROMPT_TEXT = "root@knull:~$";
const PASSWORD_PROMPT = "password@knull:~$";

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
  prompt: document.querySelector(".prompt"),
};

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

  enqueueOutput(() => appendNode(row));
}

function appendAscii(text) {
  const pre = document.createElement("pre");
  pre.className = "ascii";
  pre.textContent = text;
  return enqueueOutput(() => appendNode(pre));
}

function appendSpacer() {
  const div = document.createElement("div");
  div.className = "spacer";
  return enqueueOutput(() => appendNode(div));
}

function appendTable(title, rows) {
  appendLine(title, "line--muted");

  if (!rows.length) {
    appendLine("(no rows)", "line--muted");
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

  appendLine(formatRow(Object.fromEntries(columns.map((column) => [column, column]))), "line--muted");
  appendLine(widths.map((width) => "-".repeat(width)).join("-+-"), "line--muted");
  rows.forEach((row) => appendLine(formatRow(row)));
}

function appendAppList(apps) {
  appendLine("apps", "line--muted");

  if (!apps.length) {
    appendLine("(no apps)", "line--muted");
    return;
  }

  apps.forEach(appendAppRow);
}

function appendMailGroups(emails) {
  appendLine("mails", "line--muted");

  if (!emails.length) {
    appendLine("(no mails)", "line--muted");
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
  appendLine("enter admin password:", "line--muted");
}

function beginAddFlow() {
  state.flow = { type: "choose-add-target" };
  appendLine("1. apps", "line--muted");
  appendLine("2. mails", "line--muted");
  appendLine("select option number:", "line--muted");
}

function beginBulkAddAppsFlow() {
  state.flow = { type: "add-app-bulk" };
  appendLine("paste apps in this format:", "line--muted");
  appendLine("appname,link,description|appname,link,description", "line--muted");
}

function beginBulkAddMailsFlow() {
  state.flow = { type: "add-mail-bulk" };
  appendLine("paste mail accounts in this format:", "line--muted");
  appendLine("email1@gmail.com,email2@yahoo.com,email3@outlook.com", "line--muted");
  appendLine("or use one email per line. | is also supported.", "line--muted");
  appendLine("tip: use Shift+Enter for a new line before submitting.", "line--muted");
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
  HELP_LINES.forEach((line) => appendLine(line, "line--muted"));
}

function printStatusLines() {
  if (!state.status) {
    appendLine("status unavailable", "line--error");
    return;
  }

  appendLine(
    state.status.dbConnected ? "neon database connected" : "neon database unavailable",
    state.status.dbConnected ? "line--success" : "line--error"
  );
  appendLine(
    state.status.adminAuthenticated ? "admin session unlocked" : "admin commands locked",
    state.status.adminAuthenticated ? "line--success" : "line--muted"
  );
}

function printWelcome() {
  appendAscii(ASCII_LOGO);
  appendLine('type "help" to view commands', "line--muted");
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

async function withLoading(label, action) {
  if (state.loading) {
    return action();
  }

  const line = appendLine(`${label} [   ]`, "line--loading");
  await state.outputQueue;
  const loadingLine = elements.output.lastElementChild;
  const frames = ["[   ]", "[.  ]", "[.. ]", "[...]"];
  let frameIndex = 0;
  const startedAt = Date.now();

  state.loading = {
    timer: setInterval(() => {
      frameIndex = (frameIndex + 1) % frames.length;
      loadingLine.textContent = `${label} ${frames[frameIndex]}`;
      scrollToBottom();
    }, 180),
  };

  setBusy(true);
  await waitForPaint();

  try {
    const result = await action();
    const elapsed = Date.now() - startedAt;
    if (elapsed < 350) {
      await sleep(350 - elapsed);
    }
    clearInterval(state.loading.timer);
    loadingLine.textContent = `${label} [done]`;
    return result;
  } catch (error) {
    const elapsed = Date.now() - startedAt;
    if (elapsed < 350) {
      await sleep(350 - elapsed);
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
  appendLine("select option number:", "line--muted");
}

function normalizeTableName(value) {
  return value.trim().replace(/^<|>$/g, "").trim();
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

  if (command === "wipe all data") {
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
  await withLoading("connecting backend", refreshStatus);
  printWelcome();
  await state.outputQueue;
  resetPrompt();
  elements.input.focus();
}

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
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

elements.input.addEventListener("focus", scrollToBottom);
elements.input.addEventListener("input", () => {
  elements.input.style.height = "auto";
  elements.input.style.height = `${Math.min(elements.input.scrollHeight, 140)}px`;
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

init().catch((error) => {
  console.error(error);
  appendLine("boot failure", "line--error");
});
