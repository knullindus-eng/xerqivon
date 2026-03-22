import { createDatabase } from "./db.js";

const ASCII_LOGO = [
  "██╗  ██╗███╗   ██╗██╗   ██╗██╗     ██╗",
  "██║ ██╔╝████╗  ██║██║   ██║██║     ██║",
  "█████╔╝ ██╔██╗ ██║██║   ██║██║     ██║",
  "██╔═██╗ ██║╚██╗██║██║   ██║██║     ██║",
  "██║  ██╗██║ ╚████║╚██████╔╝███████╗███████╗",
  "╚═╝  ╚═╝╚═╝  ╚═══╝ ╚═════╝ ╚══════╝╚══════╝",
].join("\n");

const ADD_MAIL_STEPS = [
  { key: "accountEmail", prompt: "enter gmail account:" },
  { key: "sender", prompt: "enter sender name:" },
  { key: "subject", prompt: "enter mail subject:" },
  { key: "snippet", prompt: "enter short snippet:" },
  { key: "body", prompt: "enter full mail body:" },
];

const ADD_APP_STEPS = [
  { key: "name", prompt: "enter app name:" },
  { key: "link", prompt: "enter download link:" },
  { key: "description", prompt: "enter description:" },
];

const HELP_LINES = [
  "commands",
  "help    - show available commands",
  "add     - add apps or mails with guided prompts",
  "seed    - insert sample data",
  "clear   - clear terminal output",
  "cls     - clear terminal output",
];

const state = {
  database: null,
  flow: null,
};

const elements = {
  output: document.querySelector("#terminal-output"),
  form: document.querySelector("#command-form"),
  input: document.querySelector("#command-input"),
  prompt: document.querySelector(".prompt"),
};

function scrollToBottom() {
  elements.output.scrollTop = elements.output.scrollHeight;
}

function appendNode(node) {
  elements.output.appendChild(node);
  scrollToBottom();
}

function appendLine(text, variant = "") {
  const div = document.createElement("div");
  div.className = variant ? `line ${variant}` : "line";
  div.textContent = text;
  appendNode(div);
}

function appendSpacer() {
  const div = document.createElement("div");
  div.className = "spacer";
  appendNode(div);
}

function appendAscii(text) {
  const pre = document.createElement("pre");
  pre.className = "ascii";
  pre.textContent = text;
  appendNode(pre);
}

function resetPrompt() {
  elements.prompt.textContent = "C:\\Knull>";
}

function clearFlow() {
  state.flow = null;
  resetPrompt();
}

function beginStepFlow(type, steps) {
  state.flow = {
    type,
    steps,
    index: 0,
    answers: {},
  };
  appendLine(steps[0].prompt, "line--muted");
}

async function completeFlow() {
  const { type, answers } = state.flow;

  if (type === "add-app") {
    await state.database.addApp({
      name: answers.name,
      link: answers.link,
      description: answers.description,
    });
    appendLine(`app saved: ${answers.name}`, "line--success");
  }

  if (type === "add-mail") {
    await state.database.addMail({
      accountEmail: answers.accountEmail.trim().toLowerCase(),
      sender: answers.sender,
      subject: answers.subject,
      receivedAt: new Date().toISOString(),
      snippet: answers.snippet,
      body: answers.body,
    });
    appendLine(`mail saved: ${answers.subject}`, "line--success");
  }

  clearFlow();
}

async function submitStepAnswer(value) {
  const currentStep = state.flow.steps[state.flow.index];
  state.flow.answers[currentStep.key] = value;
  state.flow.index += 1;

  if (state.flow.index < state.flow.steps.length) {
    appendLine(state.flow.steps[state.flow.index].prompt, "line--muted");
    return;
  }

  await completeFlow();
}

function beginAddFlow() {
  state.flow = { type: "choose-add-target" };
  appendLine("1. apps", "line--muted");
  appendLine("2. mails", "line--muted");
  appendLine("select option number:", "line--muted");
}

function handleAddChoice(value) {
  if (value === "1") {
    beginStepFlow("add-app", ADD_APP_STEPS);
    return;
  }

  if (value === "2") {
    beginStepFlow("add-mail", ADD_MAIL_STEPS);
    return;
  }

  appendLine("invalid option. select 1 or 2.", "line--error");
  appendLine("select option number:", "line--muted");
}

function printHelp() {
  HELP_LINES.forEach((line, index) => {
    appendLine(line, index === 0 ? "line--muted" : "line--muted");
  });
}

function printWelcome(status) {
  appendAscii(ASCII_LOGO);
  appendLine("personal terminal vault", "line--muted");
  appendLine('type "help" to view commands', "line--muted");

  if (status?.lines?.length) {
    status.lines.forEach((line) => {
      appendLine(line, status.connected ? "line--success" : "line--error");
    });
  } else {
    appendLine("storage status unavailable", "line--error");
  }

  appendSpacer();
}

function clearOutput() {
  elements.output.innerHTML = "";
  printWelcome(state.database?.status);
}

async function runCommand(rawValue) {
  const command = rawValue.trim().toLowerCase();
  if (!command) return;

  if (state.flow?.type === "choose-add-target") {
    handleAddChoice(command);
    return;
  }

  if (state.flow) {
    await submitStepAnswer(rawValue.trim());
    return;
  }

  if (command === "help") {
    printHelp();
    return;
  }

  if (command === "add") {
    beginAddFlow();
    return;
  }

  if (command === "seed") {
    const inserted = await state.database.seed();
    appendLine(
      inserted ? "sample data inserted" : "seed skipped, data already exists",
      inserted ? "line--success" : "line--muted"
    );
    return;
  }

  if (command === "clear" || command === "cls") {
    clearOutput();
    return;
  }

  appendLine(`unknown command: ${rawValue}`, "line--error");
}

async function init() {
  state.database = await createDatabase();
  printWelcome(state.database.status);
  resetPrompt();
  elements.input.focus();
}

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const value = elements.input.value.trim();
  if (!value) return;

  appendLine(`C:\\Knull> ${value}`, "line--command");
  elements.input.value = "";
  await runCommand(value);
  scrollToBottom();
  elements.input.focus();
});

elements.input.addEventListener("focus", scrollToBottom);

init().catch((error) => {
  console.error(error);
  appendLine("boot failure", "line--error");
});
