const STORAGE_KEY = "taskwise.mobile.v1";
const VIEWS = new Set(["dashboard", "tasks", "calendar", "settings"]);
let startupError = null;
let state;
try {
  state = loadState();
} catch (error) {
  state = { users: [], tasks: [], darkMode: false };
  startupError = error;
}
let activeUserId = null;
let currentView = "dashboard";
let calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let selectedCalendarDate = toDateKey(new Date());
let toastTimer;

const authView = document.querySelector("#auth-view");
const app = document.querySelector("#app");
const viewRoot = document.querySelector("#view-root");
const taskDialog = document.querySelector("#task-dialog");
const taskForm = document.querySelector("#task-form");
const loginForm = document.querySelector("#login-form");
const registerForm = document.querySelector("#register-form");

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { users: [], tasks: [], darkMode: false };
  const parsed = JSON.parse(raw);
  if (!parsed || !Array.isArray(parsed.users) || !Array.isArray(parsed.tasks)) {
    throw new Error("Saved TaskWise data is invalid. Clear this site's browser data to start over.");
  }
  return { users: parsed.users, tasks: parsed.tasks, darkMode: Boolean(parsed.darkMode) };
}

function updateState(mutator) {
  const next = JSON.parse(JSON.stringify(state));
  mutator(next);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  state.users = next.users;
  state.tasks = next.tasks;
  state.darkMode = next.darkMode;
}

function user() {
  return state.users.find((item) => item.id === activeUserId) || null;
}

function tasksForUser() {
  return state.tasks.filter((task) => task.userId === activeUserId);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDeadline(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDeadline(value, options = { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) {
  const date = parseDeadline(value);
  return date ? new Intl.DateTimeFormat(undefined, options).format(date) : "No deadline";
}

function statusClass(status) {
  if (status === "Completed") return "status-completed";
  if (status === "In Progress") return "status-progress";
  return "status-pending";
}

function priorityClass(priority) {
  return ({ High: "priority-high", Medium: "priority-medium", Low: "priority-low" })[priority] || "priority-medium";
}

function priorityRank(priority) {
  return ({ High: 3, Medium: 2, Low: 1 })[priority] || 0;
}

function taskSort(a, b) {
  const rank = priorityRank(b.priority) - priorityRank(a.priority);
  if (rank) return rank;
  return (parseDeadline(a.deadline)?.getTime() ?? Infinity) - (parseDeadline(b.deadline)?.getTime() ?? Infinity);
}

function setAuthMode(mode) {
  const registering = mode === "register";
  loginForm.hidden = registering;
  registerForm.hidden = !registering;
  document.querySelector("#auth-title").textContent = registering ? "Create your account" : "Welcome back";
  document.querySelector("#auth-description").textContent = registering
    ? "Set up your personal TaskWise workspace."
    : "Sign in to pick up where you left off.";
  document.querySelector("#auth-switch-prompt").textContent = registering ? "Already have an account?" : "New to TaskWise?";
  document.querySelector("#auth-switch").textContent = registering ? "Sign in" : "Create an account";
  document.querySelector("#login-error").textContent = "";
  document.querySelector("#register-error").textContent = "";
}

function showAuth() {
  activeUserId = null;
  app.hidden = true;
  authView.hidden = false;
  setAuthMode("login");
  document.querySelector("#login-username").focus();
}

function showApp() {
  const currentUser = user();
  if (!currentUser) {
    showAuth();
    return;
  }
  authView.hidden = true;
  app.hidden = false;
  document.body.classList.toggle("dark", state.darkMode);
  document.querySelector("#sidebar-name").textContent = currentUser.name || currentUser.username;
  document.querySelector("#sidebar-username").textContent = `@${currentUser.username}`;
  const initials = (currentUser.name || currentUser.username).trim().charAt(0).toUpperCase() || "T";
  document.querySelector("#sidebar-avatar").textContent = initials;
  document.querySelector("#topbar-avatar").textContent = initials;
  document.querySelector("#topbar-date").textContent = new Intl.DateTimeFormat(undefined, {
    weekday: "short", month: "short", day: "numeric"
  }).format(new Date());
  renderView();
}

function setView(view) {
  if (!VIEWS.has(view)) return;
  currentView = view;
  renderView();
  viewRoot.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderView() {
  const renderers = { dashboard: renderDashboard, tasks: renderTasks, calendar: renderCalendar, settings: renderSettings };
  viewRoot.innerHTML = renderers[currentView]();
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === currentView);
    if (button.classList.contains("nav-link")) {
      button.setAttribute("aria-current", button.dataset.view === currentView ? "page" : "false");
    }
  });
  document.body.classList.toggle("dark", state.darkMode);
}

function pageHeading(eyebrow, title, description, action = "") {
  return `<div class="page-heading"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p>${description}</p></div>${action}</div>`;
}

function taskRow(task) {
  const done = task.status === "Completed";
  return `<div class="task-row">
    <button class="task-check ${done ? "done" : ""}" data-action="toggle-task" data-id="${escapeHtml(task.id)}" aria-label="${done ? "Reopen" : "Complete"} ${escapeHtml(task.name)}">${done ? "✓" : ""}</button>
    <div class="task-row-copy"><strong>${escapeHtml(task.name)}</strong><small>${escapeHtml(task.status)}</small></div>
    <div class="task-row-side"><span class="priority ${priorityClass(task.priority)}">${escapeHtml(task.priority)}</span><span class="task-date">${escapeHtml(formatDeadline(task.deadline))}</span></div>
  </div>`;
}

function taskCard(task) {
  const done = task.status === "Completed";
  const description = task.description ? `<p>${escapeHtml(task.description)}</p>` : "";
  return `<article class="task-card">
    <div class="task-card-top">
      <button class="task-check ${done ? "done" : ""}" data-action="toggle-task" data-id="${escapeHtml(task.id)}" aria-label="${done ? "Reopen" : "Complete"} ${escapeHtml(task.name)}">${done ? "✓" : ""}</button>
      <div class="task-card-title"><h3>${escapeHtml(task.name)}</h3>${description}</div>
      <div class="task-menu"><button class="small-action" data-action="edit-task" data-id="${escapeHtml(task.id)}" aria-label="Edit ${escapeHtml(task.name)}">Edit</button><button class="small-action" data-action="delete-task" data-id="${escapeHtml(task.id)}" aria-label="Delete ${escapeHtml(task.name)}">Delete</button></div>
    </div>
    <div class="task-card-meta">
      <span class="priority ${priorityClass(task.priority)}">${escapeHtml(task.priority)} priority</span>
      <span class="status-pill ${statusClass(task.status)}">${escapeHtml(task.status)}</span>
      <span class="task-date">${escapeHtml(formatDeadline(task.deadline))}</span>
    </div>
  </article>`;
}

function renderDashboard() {
  const tasks = tasksForUser();
  const now = new Date();
  const pending = tasks.filter((task) => task.status === "Pending").length;
  const inProgress = tasks.filter((task) => task.status === "In Progress").length;
  const completed = tasks.filter((task) => task.status === "Completed").length;
  const active = tasks.filter((task) => task.status !== "Completed");
  const overdue = active.filter((task) => parseDeadline(task.deadline) && parseDeadline(task.deadline) < now).length;
  const dueToday = active.filter((task) => {
    const deadline = parseDeadline(task.deadline);
    return deadline && toDateKey(deadline) === toDateKey(now) && deadline >= now;
  }).length;
  const upcoming = active.filter((task) => parseDeadline(task.deadline)).sort((a, b) => parseDeadline(a.deadline) - parseDeadline(b.deadline)).slice(0, 5);
  const nextTask = upcoming.find((task) => parseDeadline(task.deadline) >= now);
  const currentUser = user();
  const greetingName = (currentUser.name || currentUser.username).trim().split(/\s+/)[0];
  const focusMessage = tasks.length === 0
    ? "You’re ready to start. Add your first task and choose a deadline."
    : overdue
      ? `You have ${overdue} overdue task${overdue === 1 ? "" : "s"}. Review these first.`
      : dueToday
        ? `Focus on your ${dueToday} task${dueToday === 1 ? "" : "s"} due today. You’ve got this!`
        : "You’re on track. Check your next deadline and update task progress.";
  const stats = [
    ["Total tasks", tasks.length, "▤"], ["Pending", pending, "◷"],
    ["In progress", inProgress, "↗"], ["Completed", completed, "✓"]
  ].map(([label, count, icon]) => `<article class="stat-card"><div class="stat-top"><span>${label}</span><span class="stat-icon">${icon}</span></div><strong class="stat-value">${count}</strong></article>`).join("");
  return `${pageHeading("YOUR WORKSPACE", `Good ${timeGreeting()}, ${escapeHtml(greetingName)}.`, "Here’s a little overview of what’s on your plate.", `<div class="heading-actions"><button class="button button-primary" data-action="new-task">＋ New task</button></div>`)}
    <section class="stats-grid" aria-label="Task summary">${stats}</section>
    <div class="dashboard-grid">
      <section class="panel"><div class="panel-head"><div><h2>Tasks to focus on</h2><p>Your next few deadlines</p></div><button class="panel-link" data-view="tasks">View all</button></div>
        <div class="task-list">${upcoming.length ? upcoming.map(taskRow).join("") : `<div class="empty-state">No deadlines yet. Add a task to get started.</div>`}</div>
      </section>
      <section class="focus-card"><p class="eyebrow">DAILY FOCUS</p><h2>${escapeHtml(focusMessage)}</h2><p>${nextTask ? `Next deadline: ${escapeHtml(nextTask.name)} · ${escapeHtml(formatDeadline(nextTask.deadline))}` : "Set a deadline on a task to keep your plans in view."}</p>
        <div class="focus-metrics"><div><strong>${dueToday}</strong><small>Due today</small></div><div><strong>${overdue}</strong><small>Overdue</small></div></div>
      </section>
    </div>
    <section class="panel upcoming-panel"><div class="panel-head"><div><h2>Quick progress</h2><p>Mark a task complete right here</p></div></div>
      <div class="task-list">${tasks.filter((task) => task.status !== "Completed").sort(taskSort).slice(0, 4).map(taskRow).join("") || `<div class="empty-state">You’re all caught up. Enjoy the breathing room.</div>`}</div>
    </section>`;
}

function timeGreeting() {
  const hour = new Date().getHours();
  return hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
}

function renderTasks() {
  const action = `<div class="heading-actions"><button class="button button-primary" data-action="new-task">＋ New task</button></div>`;
  const allTasks = tasksForUser().sort(taskSort);
  return `${pageHeading("STAY ON TRACK", "My tasks", `${allTasks.length} task${allTasks.length === 1 ? "" : "s"} in your personal workspace.`, action)}
    <div class="toolbar">
      <input class="search-input" id="task-search" type="search" placeholder="Search tasks…" aria-label="Search tasks">
      <select class="filter-select" id="status-filter" aria-label="Filter by status"><option value="">All statuses</option><option>Pending</option><option>In Progress</option><option>Completed</option></select>
      <select class="filter-select" id="priority-filter" aria-label="Filter by priority"><option value="">All priorities</option><option>High</option><option>Medium</option><option>Low</option></select>
    </div>
    <section id="task-card-list" class="task-cards">${allTasks.length ? allTasks.map(taskCard).join("") : `<div class="panel empty-state">No tasks yet. Create your first task to get started.</div>`}</section>`;
}

function filteredTaskCards() {
  const query = document.querySelector("#task-search").value.trim().toLowerCase();
  const status = document.querySelector("#status-filter").value;
  const priority = document.querySelector("#priority-filter").value;
  const tasks = tasksForUser().filter((task) => {
    const text = `${task.name} ${task.description} ${task.priority} ${task.status}`.toLowerCase();
    return (!query || text.includes(query)) && (!status || task.status === status) && (!priority || task.priority === priority);
  }).sort(taskSort);
  const list = document.querySelector("#task-card-list");
  list.innerHTML = tasks.length ? tasks.map(taskCard).join("") : `<div class="panel empty-state">No tasks match those filters.</div>`;
}

function renderCalendar() {
  const monthName = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(calendarMonth);
  const firstDay = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
  const gridStart = new Date(firstDay.getFullYear(), firstDay.getMonth(), 1 - firstDay.getDay());
  const deadlines = tasksForUser().filter((task) => task.status !== "Completed" && parseDeadline(task.deadline));
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => `<span class="calendar-weekday">${day}</span>`).join("");
  const days = Array.from({ length: 42 }, (_, index) => {
    const day = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index);
    const key = toDateKey(day);
    const hasTasks = deadlines.some((task) => toDateKey(parseDeadline(task.deadline)) === key);
    const classes = ["calendar-day", day.getMonth() !== calendarMonth.getMonth() ? "outside" : "", key === toDateKey(new Date()) ? "today" : "", key === selectedCalendarDate ? "selected" : ""].filter(Boolean).join(" ");
    return `<button class="${classes}" data-action="select-day" data-date="${key}" aria-label="${escapeHtml(new Intl.DateTimeFormat(undefined, { dateStyle: "full" }).format(day))}${hasTasks ? ", tasks due" : ""}">${day.getDate()}${hasTasks ? `<span class="calendar-dot"></span>` : ""}</button>`;
  }).join("");
  const chosenDate = new Date(`${selectedCalendarDate}T12:00:00`);
  const selectedTasks = deadlines.filter((task) => toDateKey(parseDeadline(task.deadline)) === selectedCalendarDate).sort((a, b) => parseDeadline(a.deadline) - parseDeadline(b.deadline));
  const chosenLabel = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(chosenDate);
  return `${pageHeading("PLAN AHEAD", "Calendar", "A clear view of the deadlines you’ve set.")}
    <div class="calendar-toolbar"><h2>${escapeHtml(monthName)}</h2><div class="calendar-nav"><button class="icon-button" data-action="calendar-month" data-offset="-1" aria-label="Previous month">‹</button><button class="icon-button" data-action="calendar-month" data-offset="1" aria-label="Next month">›</button></div></div>
    <div class="calendar-layout"><section class="panel calendar-card"><div class="calendar-grid">${dayNames}${days}</div></section>
      <section class="panel"><div class="selected-date"><h2>${escapeHtml(chosenLabel)}</h2><p>${selectedTasks.length} task${selectedTasks.length === 1 ? "" : "s"} due</p></div>
        <div class="task-list">${selectedTasks.length ? selectedTasks.map(taskRow).join("") : `<div class="empty-state">Nothing due on this day.</div>`}</div>
      </section></div>`;
}

function renderSettings() {
  const currentUser = user();
  return `${pageHeading("YOUR PREFERENCES", "Settings", "Manage your profile and make TaskWise feel like yours.")}
    <div class="settings-layout">
      <section class="settings-card"><h2>Profile information</h2><p>These details are saved only in this browser.</p>
        <form id="settings-form" class="settings-form">
          <label for="settings-name">Full name</label><input id="settings-name" name="name" maxlength="80" value="${escapeHtml(currentUser.name)}">
          <label for="settings-username">Username</label><input id="settings-username" name="username" maxlength="40" value="${escapeHtml(currentUser.username)}" required>
          <label for="settings-age">Age <span class="optional">(optional)</span></label><input id="settings-age" name="age" type="number" min="1" max="120" value="${currentUser.age || ""}">
          <p id="settings-error" class="form-error" role="alert"></p>
          <button class="button button-primary" type="submit">Save profile</button>
        </form>
      </section>
      <section class="settings-card"><h2>Appearance</h2><p>Choose the look that works best for you.</p>
        <label class="toggle-row"><span>Dark mode<small>Use a darker palette across TaskWise.</small></span><input id="dark-mode-toggle" type="checkbox" ${state.darkMode ? "checked" : ""} aria-label="Enable dark mode"></label>
        <h2 style="margin-top:20px">About your data</h2><p class="device-note">Your account and tasks are stored on this device in this browser only. They are not synced with the desktop app, backed up online, or shared with other devices.</p>
        <button class="button button-quiet settings-signout" data-action="logout">Sign out</button>
      </section>
    </div>`;
}

function openTaskDialog(taskId = "") {
  const task = taskId ? tasksForUser().find((item) => item.id === taskId) : null;
  if (taskId && !task) return;
  taskForm.reset();
  document.querySelector("#task-error").textContent = "";
  document.querySelector("#task-dialog-title").textContent = task ? "Edit task" : "New task";
  document.querySelector("#task-id").value = task?.id || "";
  document.querySelector("#task-name").value = task?.name || "";
  document.querySelector("#task-description").value = task?.description || "";
  document.querySelector("#task-priority").value = task?.priority || "Medium";
  document.querySelector("#task-status").value = task?.status || "Pending";
  document.querySelector("#task-deadline").value = task?.deadline || "";
  taskDialog.showModal();
  document.querySelector("#task-name").focus();
}

function toggleTask(id) {
  const target = tasksForUser().find((task) => task.id === id);
  if (!target) return;
  const status = target.status === "Completed" ? "Pending" : "Completed";
  updateState((next) => {
    const task = next.tasks.find((item) => item.id === id && item.userId === activeUserId);
    if (task) task.status = status;
  });
  renderView();
  showToast(status === "Completed" ? "Task completed." : "Task moved back to pending.");
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 2600);
}

function passwordHash(password, salt) {
  const bytes = Uint8Array.from(atob(salt), (character) => character.charCodeAt(0));
  return crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"])
    .then((key) => crypto.subtle.deriveBits({ name: "PBKDF2", salt: bytes, iterations: 120000, hash: "SHA-256" }, key, 256))
    .then((bits) => Array.from(new Uint8Array(bits), (byte) => byte.toString(16).padStart(2, "0")).join(""));
}

function randomSalt() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

function validPassword(password) {
  return password.length >= 4 && /[A-Z]/.test(password) && /[a-z]/.test(password) &&
    /[0-9]/.test(password) && /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password);
}

function handleAppClick(event) {
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) {
    event.preventDefault();
    setView(viewButton.dataset.view);
    return;
  }
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const { action, id } = button.dataset;
  if (action === "new-task") openTaskDialog();
  if (action === "edit-task") openTaskDialog(id);
  if (action === "toggle-task") {
    try { toggleTask(id); } catch (error) { showToast(`Could not save task: ${error.message}`); }
  }
  if (action === "delete-task") {
    const task = tasksForUser().find((item) => item.id === id);
    if (!task || !window.confirm(`Delete “${task.name}”? This cannot be undone.`)) return;
    try {
      updateState((next) => { next.tasks = next.tasks.filter((item) => item.id !== id || item.userId !== activeUserId); });
      renderView();
      showToast("Task deleted.");
    } catch (error) { showToast(`Could not delete task: ${error.message}`); }
  }
  if (action === "close-dialog") taskDialog.close();
  if (action === "calendar-month") {
    calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + Number(button.dataset.offset), 1);
    renderView();
  }
  if (action === "select-day") {
    selectedCalendarDate = button.dataset.date;
    calendarMonth = new Date(`${selectedCalendarDate}T12:00:00`);
    calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
    renderView();
  }
  if (action === "logout") showAuth();
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const errorLabel = document.querySelector("#login-error");
  errorLabel.textContent = "";
  const username = loginForm.elements.username.value.trim();
  const password = loginForm.elements.password.value;
  try {
    const account = state.users.find((item) => item.username.toLowerCase() === username.toLowerCase());
    if (!account) throw new Error("No local account was found with that username.");
    if (await passwordHash(password, account.salt) !== account.passwordHash) throw new Error("Incorrect password.");
    activeUserId = account.id;
    loginForm.reset();
    showApp();
  } catch (error) {
    errorLabel.textContent = error.message || "Could not sign in. Please try again.";
  }
});

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const errorLabel = document.querySelector("#register-error");
  errorLabel.textContent = "";
  const name = registerForm.elements.name.value.trim();
  const username = registerForm.elements.username.value.trim();
  const password = registerForm.elements.password.value;
  const confirm = registerForm.elements.confirm.value;
  try {
    if (!username) throw new Error("Username is required.");
    if (state.users.some((item) => item.username.toLowerCase() === username.toLowerCase())) throw new Error("That username already exists on this device.");
    if (!validPassword(password)) throw new Error("Use at least 4 characters with uppercase, lowercase, a number, and a symbol.");
    if (password !== confirm) throw new Error("Passwords do not match.");
    const salt = randomSalt();
    const account = { id: crypto.randomUUID(), name, username, age: 0, salt, passwordHash: await passwordHash(password, salt) };
    updateState((next) => { next.users.push(account); });
    activeUserId = account.id;
    registerForm.reset();
    showApp();
    showToast("Your local TaskWise account is ready.");
  } catch (error) {
    errorLabel.textContent = error.message || "Could not create your account.";
  }
});

taskForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const errorLabel = document.querySelector("#task-error");
  errorLabel.textContent = "";
  const id = taskForm.elements.id.value;
  const name = taskForm.elements.name.value.trim();
  const deadline = taskForm.elements.deadline.value;
  if (!name) {
    errorLabel.textContent = "Task name is required.";
    return;
  }
  if (deadline && !parseDeadline(deadline)) {
    errorLabel.textContent = "Enter a valid deadline.";
    return;
  }
  try {
    const task = {
      id: id || crypto.randomUUID(),
      userId: activeUserId,
      name,
      description: taskForm.elements.description.value.trim(),
      priority: taskForm.elements.priority.value,
      status: taskForm.elements.status.value,
      deadline
    };
    updateState((next) => {
      const index = next.tasks.findIndex((item) => item.id === id && item.userId === activeUserId);
      if (index >= 0) next.tasks[index] = task;
      else next.tasks.push(task);
    });
    taskDialog.close();
    renderView();
    showToast(id ? "Task updated." : "Task created.");
  } catch (error) {
    errorLabel.textContent = `Could not save task: ${error.message}`;
  }
});

document.addEventListener("submit", (event) => {
  if (event.target.id !== "settings-form") return;
  event.preventDefault();
  const errorLabel = document.querySelector("#settings-error");
  errorLabel.textContent = "";
  const name = event.target.elements.name.value.trim();
  const username = event.target.elements.username.value.trim();
  const ageValue = event.target.elements.age.value;
  const age = ageValue ? Number(ageValue) : 0;
  if (!username) {
    errorLabel.textContent = "Username is required.";
    return;
  }
  if (ageValue && (!Number.isInteger(age) || age < 1 || age > 120)) {
    errorLabel.textContent = "Enter an age from 1 to 120.";
    return;
  }
  if (state.users.some((item) => item.id !== activeUserId && item.username.toLowerCase() === username.toLowerCase())) {
    errorLabel.textContent = "That username is already used on this device.";
    return;
  }
  try {
    updateState((next) => {
      const account = next.users.find((item) => item.id === activeUserId);
      if (account) Object.assign(account, { name, username, age });
    });
    showApp();
    showToast("Profile saved.");
  } catch (error) {
    errorLabel.textContent = `Could not save profile: ${error.message}`;
  }
});

document.addEventListener("change", (event) => {
  if (event.target.id === "dark-mode-toggle") {
    try {
      updateState((next) => { next.darkMode = event.target.checked; });
      document.body.classList.toggle("dark", state.darkMode);
      renderView();
    } catch (error) {
      event.target.checked = !event.target.checked;
      showToast(`Could not save appearance: ${error.message}`);
    }
  }
  if (event.target.id === "status-filter" || event.target.id === "priority-filter") filteredTaskCards();
});

document.addEventListener("input", (event) => {
  if (event.target.id === "task-search") filteredTaskCards();
});

document.querySelector("#auth-switch").addEventListener("click", () => {
  setAuthMode(registerForm.hidden ? "register" : "login");
});
document.addEventListener("click", (event) => {
  if (event.target.closest("[data-view], [data-action]")) handleAppClick(event);
});

if (startupError) {
  authView.innerHTML = `<section class="auth-card"><h1>TaskWise data could not be read</h1><p class="muted">${escapeHtml(startupError.message)} The saved data was not changed.</p></section>`;
} else if (!globalThis.crypto?.subtle || !globalThis.crypto?.randomUUID) {
  authView.innerHTML = `<section class="auth-card"><h1>Secure browser required</h1><p class="muted">TaskWise needs a modern browser with Web Crypto enabled. Open this site over HTTPS in Safari or a recent browser.</p></section>`;
} else {
  showAuth();
}

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((error) => {
      console.error("TaskWise offline support could not be enabled.", error);
    });
  });
}
