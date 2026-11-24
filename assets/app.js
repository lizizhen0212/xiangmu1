'use strict';

/* ============================================================
   学习工作台
   模块 A · 日历（月视图 + 当天备忘）
   模块 C · 事件与到期提醒（多档提醒 + 补发 + 系统通知）
   纯静态、零依赖、localStorage，无后端
   ============================================================ */

const MEMO_KEY = 'study-calendar:memos:v1';
const EVENT_KEY = 'study-calendar:events:v1';
const SETTING_KEY = 'study-calendar:settings:v1';

const BASE_TITLE = '学习工作台 · 日历';
const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六'];
const AUTOSAVE_DELAY = 350;
const TICK_MS = 20000;
const MISSED_WINDOW_MS = 2 * 60 * 60 * 1000;
const DEFAULT_OFFSETS = [720, 180, 60, 30];
const OFFSET_LABEL = { 720: '12 小时', 180: '3 小时', 60: '1 小时', 30: '30 分钟' };

/* ---------------- DOM ---------------- */

const dom = {
  monthLabel: document.getElementById('monthLabel'),
  monthMeta: document.getElementById('monthMeta'),
  grid: document.getElementById('grid'),
  emptyHint: document.getElementById('emptyHint'),
  panel: document.getElementById('panel'),
  panelDate: document.getElementById('panelDate'),
  memo: document.getElementById('memo'),
  saveHint: document.getElementById('saveHint'),
  scrim: document.getElementById('scrim'),
  notice: document.getElementById('notice'),
  noticeText: document.getElementById('noticeText'),
  noticeClose: document.getElementById('noticeClose'),
  toasts: document.getElementById('toasts'),
  agendaList: document.getElementById('agendaList'),
  addEventBtn: document.getElementById('addEventBtn'),
  eventForm: document.getElementById('eventForm'),
  evtTitle: document.getElementById('evtTitle'),
  evtDue: document.getElementById('evtDue'),
  formError: document.getElementById('formError'),
  evtCancel: document.getElementById('evtCancel'),
  notifyBtn: document.getElementById('notifyBtn'),
  offsetInputs: Array.from(document.querySelectorAll('.offsets input[type="checkbox"]')),
};

/* ---------------- 状态 ---------------- */

const state = {
  view: firstOfMonth(new Date()),
  selected: null,
};

let memos = readJSON(MEMO_KEY, {});
let events = normalizeEvents(readJSON(EVENT_KEY, {}));
let settings = Object.assign(
  { defaultOffsets: DEFAULT_OFFSETS.slice(), notifyEnabled: false },
  readJSON(SETTING_KEY, {})
);

let saveTimer = null;
let unread = 0;

/* ---------------- 存储 ---------------- */

function readJSON(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const value = JSON.parse(raw);
    return value && typeof value === 'object' ? value : fallback;
  } catch (err) {
    console.warn('读取 ' + key + ' 失败，按空数据启动', err);
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn('保存 ' + key + ' 失败', err);
  }
}

function normalizeEvents(raw) {
  const out = {};
  Object.keys(raw).forEach((id) => {
    const e = raw[id];
    if (!e || typeof e !== 'object' || !Number.isFinite(e.dueAt)) return;
    out[id] = {
      id,
      title: typeof e.title === 'string' ? e.title : '未命名事件',
      dueAt: e.dueAt,
      createdAt: Number.isFinite(e.createdAt) ? e.createdAt : Date.now(),
      done: Boolean(e.done),
      offsets: Array.isArray(e.offsets) ? e.offsets.filter((m) => Number.isFinite(m)) : [],
      fired: e.fired && typeof e.fired === 'object' ? e.fired : {},
    };
  });
  return out;
}

function persistEvents() {
  writeJSON(EVENT_KEY, events);
}

/* ---------------- 日期工具 ---------------- */

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function firstOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function todayKey() {
  return toKey(new Date());
}

function fmtDateTime(ts) {
  const d = new Date(ts);
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function fmtDayCn(ts) {
  const d = new Date(ts);
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

function eventDateKey(evt) {
  return toKey(new Date(evt.dueAt));
}

/* ---------------- 备忘 ---------------- */

function hasMemo(key) {
  const value = memos[key];
  return typeof value === 'string' && value.trim() !== '';
}

function countMemosIn(year, month) {
  const prefix = `${year}-${pad2(month + 1)}-`;
  return Object.keys(memos).filter((k) => k.startsWith(prefix) && hasMemo(k)).length;
}

/* ---------------- 事件查询 ---------------- */

function eventsOnDay(key) {
  return Object.values(events)
    .filter((e) => eventDateKey(e) === key)
    .sort((a, b) => a.dueAt - b.dueAt);
}

function pendingCountsIn(year, month) {
  const counts = {};
  Object.values(events).forEach((e) => {
    if (e.done) return;
    const d = new Date(e.dueAt);
    if (d.getFullYear() !== year || d.getMonth() !== month) return;
    const key = toKey(d);
    counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
}

function countEventsIn(year, month) {
  return Object.values(events).filter((e) => {
    const d = new Date(e.dueAt);
    return d.getFullYear() === year && d.getMonth() === month;
  }).length;
}

/* ---------------- 日历渲染 ---------------- */

function render() {
  const year = state.view.getFullYear();
  const month = state.view.getMonth();
  const today = todayKey();
  const counts = pendingCountsIn(year, month);

  dom.monthLabel.textContent = `${year} 年 ${month + 1} 月`;

  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7; // 周一 = 0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cellCount = Math.ceil((offset + daysInMonth) / 7) * 7;

  const frag = document.createDocumentFragment();

  for (let i = 0; i < cellCount; i += 1) {
    const date = new Date(year, month, 1 - offset + i);
    const key = toKey(date);

    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'day';
    cell.dataset.date = key;
    cell.setAttribute(
      'aria-label',
      `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 周${WEEKDAY_CN[date.getDay()]}`
    );

    if (date.getMonth() !== month) cell.classList.add('is-outside');
    if (key === today) cell.classList.add('is-today');
    if (key === state.selected) cell.classList.add('is-selected');

    const num = document.createElement('span');
    num.className = 'day__num';
    num.textContent = String(date.getDate());
    cell.appendChild(num);

    if (hasMemo(key)) {
      const dot = document.createElement('span');
      dot.className = 'day__dot';
      cell.appendChild(dot);
    }

    if (counts[key]) {
      const badge = document.createElement('span');
      badge.className = 'day__count';
      badge.textContent = String(counts[key]);
      cell.appendChild(badge);
    }

    frag.appendChild(cell);
  }

  dom.grid.replaceChildren(frag);
  updateMonthMeta();
}

function updateMonthMeta() {
  const year = state.view.getFullYear();
  const month = state.view.getMonth();
  const memoCount = countMemosIn(year, month);
  const evtCount = countEventsIn(year, month);

  const parts = [];
  if (memoCount) parts.push(`${memoCount} 条备忘`);
  if (evtCount) parts.push(`${evtCount} 个事件`);
  dom.monthMeta.textContent = parts.length ? `本月 ${parts.join(' · ')}` : '';
  dom.emptyHint.hidden = memoCount > 0 || evtCount > 0;
}

function updateDayVisual(key) {
  const cell = dom.grid.querySelector(`.day[data-date="${key}"]`);
  if (cell) {
    const dot = cell.querySelector('.day__dot');
    const shouldShow = hasMemo(key);
    if (shouldShow && !dot) {
      const newDot = document.createElement('span');
      newDot.className = 'day__dot';
      cell.appendChild(newDot);
    } else if (!shouldShow && dot) {
      dot.remove();
    }
  }
  updateMonthMeta();
}

/* ---------------- 面板 ---------------- */

function openPanel(key) {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);

  if (date.getFullYear() !== state.view.getFullYear() || date.getMonth() !== state.view.getMonth()) {
    state.view = firstOfMonth(date);
  }

  state.selected = key;

  const isToday = key === todayKey();
  dom.panelDate.textContent =
    `${m} 月 ${d} 日 · 周${WEEKDAY_CN[date.getDay()]}${isToday ? ' · 今天' : ''}`;
  dom.memo.value = memos[key] || '';
  dom.saveHint.textContent = '输入即自动保存';

  closeEventForm();
  render();
  renderAgenda();

  dom.panel.classList.add('is-open');
  dom.panel.setAttribute('aria-hidden', 'false');
  dom.panel.inert = false;
  dom.scrim.hidden = false;
  document.body.classList.add('has-panel');

  dom.memo.focus({ preventScroll: true });
}

function closePanel() {
  flushSave();
  state.selected = null;
  closeEventForm();

  dom.panel.classList.remove('is-open');
  dom.panel.setAttribute('aria-hidden', 'true');
  dom.panel.inert = true;
  dom.scrim.hidden = true;
  document.body.classList.remove('has-panel');

  render();
}

/* ---------------- 备忘保存 ---------------- */

function saveNow() {
  if (!state.selected) return;

  const key = state.selected;
  const value = dom.memo.value;

  if (value.trim() === '') delete memos[key];
  else memos[key] = value;

  writeJSON(MEMO_KEY, memos);
  updateDayVisual(key);

  const now = new Date();
  dom.saveHint.textContent = `已保存 ${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveNow();
  }, AUTOSAVE_DELAY);
}

function flushSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
    saveNow();
  }
}

/* ---------------- 事件列表渲染 ---------------- */

function buildEventItem(evt) {
  const li = document.createElement('li');
  li.className = 'agenda__item agenda__item--event' + (evt.done ? ' is-done' : '');
  li.dataset.id = evt.id;

  const check = document.createElement('button');
  check.type = 'button';
  check.className = 'evt-check';
  check.dataset.action = 'toggle';
  check.setAttribute('aria-pressed', String(Boolean(evt.done)));
  check.setAttribute('aria-label', evt.done ? '标记为未完成' : '标记为已完成');

  const main = document.createElement('div');
  main.className = 'evt-main';

  const title = document.createElement('p');
  title.className = 'evt-title';
  title.textContent = evt.title;

  const meta = document.createElement('p');
  meta.className = 'evt-meta';
  const offsetText = evt.offsets.length
    ? evt.offsets.map((m) => OFFSET_LABEL[m] || m + ' 分钟').join(' / ')
    : '不提醒';
  meta.textContent = `${fmtDateTime(evt.dueAt)} 截止 · ${offsetText}`;

  main.append(title, meta);

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'evt-del';
  del.dataset.action = 'delete';
  del.textContent = '✕';
  del.setAttribute('aria-label', '删除事件');

  li.append(check, main, del);
  return li;
}

function renderAgenda() {
  if (!state.selected) {
    dom.agendaList.replaceChildren();
    return;
  }

  const list = eventsOnDay(state.selected);
  if (!list.length) {
    const li = document.createElement('li');
    li.className = 'agenda__item agenda__item--muted';
    li.textContent = '这一天还没有事件。';
    dom.agendaList.replaceChildren(li);
    return;
  }

  dom.agendaList.replaceChildren(...list.map(buildEventItem));
}

/* ---------------- 事件表单 ---------------- */

function openEventForm() {
  if (!state.selected) return;

  dom.evtTitle.value = '';
  dom.evtDue.value = `${state.selected}T23:59`;
  dom.formError.hidden = true;
  dom.formError.textContent = '';

  const defaults = Array.isArray(settings.defaultOffsets) ? settings.defaultOffsets : DEFAULT_OFFSETS;
  dom.offsetInputs.forEach((input) => {
    input.checked = defaults.includes(Number(input.value));
  });

  updateNotifyButton();
  dom.eventForm.hidden = false;
  dom.addEventBtn.hidden = true;
  dom.evtTitle.focus({ preventScroll: true });

  if (typeof dom.eventForm.scrollIntoView === 'function') {
    dom.eventForm.scrollIntoView({ block: 'nearest' });
  } else {
    dom.panel.scrollTop = dom.panel.scrollHeight;
  }
}

function closeEventForm() {
  dom.eventForm.hidden = true;
  dom.addEventBtn.hidden = false;
  dom.formError.hidden = true;
}

function readCheckedOffsets() {
  return dom.offsetInputs
    .filter((input) => input.checked)
    .map((input) => Number(input.value))
    .sort((a, b) => b - a);
}

function showFormError(message) {
  dom.formError.textContent = message;
  dom.formError.hidden = false;
}

function markTriggersAlreadyPast(evt, now) {
  evt.offsets.forEach((m) => {
    if (evt.fired[m]) return;
    if (evt.dueAt - m * 60000 <= now) evt.fired[m] = now;
  });
}

function submitEvent(event) {
  event.preventDefault();

  const title = dom.evtTitle.value.trim();
  const dueValue = dom.evtDue.value;

  if (!title) {
    showFormError('先写个标题吧');
    return;
  }
  if (!dueValue) {
    showFormError('选一个截止时间');
    return;
  }

  const dueAt = new Date(dueValue).getTime();
  if (!Number.isFinite(dueAt)) {
    showFormError('截止时间格式不对');
    return;
  }

  const now = Date.now();
  const id = 'evt_' + now.toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  const evt = {
    id,
    title,
    dueAt,
    createdAt: now,
    done: false,
    offsets: readCheckedOffsets(),
    fired: {},
  };
  markTriggersAlreadyPast(evt, now);

  events[id] = evt;
  persistEvents();

  if (evt.offsets.length) {
    settings.defaultOffsets = evt.offsets.slice();
    writeJSON(SETTING_KEY, settings);
  }

  closeEventForm();
  renderAgenda();
  render();

  const targetDay = eventDateKey(evt);
  if (targetDay !== state.selected) {
    flash(`已保存到 ${fmtDayCn(evt.dueAt)}`);
  }
}

function toggleEvent(id) {
  const evt = events[id];
  if (!evt) return;
  evt.done = !evt.done;
  persistEvents();
  renderAgenda();
  render();
}

function removeEvent(id) {
  if (!events[id]) return;
  delete events[id];
  persistEvents();
  renderAgenda();
  render();
}

/* ---------------- 通知与提示条 ---------------- */

function bumpUnread() {
  unread += 1;
  document.title = `(${unread}) ${BASE_TITLE}`;
}

function addToast({ title, meta, info = false, autoCloseMs = 0 }) {
  const el = document.createElement('div');
  el.className = 'toast' + (info ? ' toast--info' : '');

  const t = document.createElement('p');
  t.className = 'toast__title';
  t.textContent = title;

  const m = document.createElement('p');
  m.className = 'toast__meta';
  m.textContent = meta;

  const actions = document.createElement('div');
  actions.className = 'toast__actions';

  const ok = document.createElement('button');
  ok.type = 'button';
  ok.className = 'btn btn--mini';
  ok.textContent = '知道了';
  ok.addEventListener('click', () => el.remove());

  actions.appendChild(ok);
  el.append(t, m, actions);
  dom.toasts.appendChild(el);

  if (autoCloseMs > 0) setTimeout(() => el.remove(), autoCloseMs);
  return el;
}

function flash(message) {
  addToast({ title: message, meta: '', info: true, autoCloseMs: 2600 });
}

function notifyDesktop(evt, label) {
  if (!settings.notifyEnabled) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    new Notification('学习工作台 · 提醒', {
      body: `${evt.title}\n${label}后到期（${fmtDateTime(evt.dueAt)}）`,
      tag: `${evt.id}:${label}`,
    });
  } catch (err) {
    console.warn('系统通知发送失败', err);
  }
}

function updateNotifyButton() {
  const supported = 'Notification' in window;
  const granted = supported && Notification.permission === 'granted';
  dom.notifyBtn.hidden = !supported || granted;
  dom.notifyBtn.textContent = '开启系统通知（可选）';
}

/* ---------------- 提醒引擎 ---------------- */

function humanRemaining(dueAt) {
  const diff = dueAt - Date.now();
  const minutes = Math.round(Math.abs(diff) / 60000);
  const span = minutes < 60 ? `${minutes} 分钟` : `${Math.floor(minutes / 60)} 小时`;
  if (diff >= 0) return `${minutes < 1 ? '不到 1 分钟' : span}后到期`;
  return `已超时 ${minutes < 1 ? '不到 1 分钟' : span}`;
}

function fireReminder(evt, minutes) {
  const label = OFFSET_LABEL[minutes] || `${minutes} 分钟`;
  addToast({
    title: `⏰ ${evt.title}`,
    meta: `${humanRemaining(evt.dueAt)} · ${fmtDateTime(evt.dueAt)} 截止`,
  });
  bumpUnread();
  notifyDesktop(evt, label);
}

function showMissedNotice(missed) {
  const names = missed.slice(0, 2).map((item) => `${item.evt.title}（${item.label}前）`);
  const more = missed.length > 2 ? ` 等 ${missed.length} 条` : '';
  dom.noticeText.textContent = `有 ${missed.length} 条提醒已过期：${names.join('、')}${more}`;
  dom.notice.hidden = false;
}

function runReminderTick() {
  const now = Date.now();
  let changed = false;
  const missed = [];

  Object.values(events).forEach((evt) => {
    if (evt.done) return;
    evt.offsets.forEach((minutes) => {
      if (evt.fired[minutes]) return;
      const triggerAt = evt.dueAt - minutes * 60000;
      if (now < triggerAt) return;

      evt.fired[minutes] = now;
      changed = true;

      if (now - triggerAt <= MISSED_WINDOW_MS) {
        fireReminder(evt, minutes);
      } else {
        missed.push({ evt, label: OFFSET_LABEL[minutes] || `${minutes} 分钟` });
      }
    });
  });

  if (changed) persistEvents();
  if (missed.length) showMissedNotice(missed);
  return missed.length;
}

/* ---------------- 事件绑定 ---------------- */

dom.grid.addEventListener('click', (event) => {
  const cell = event.target.closest('.day');
  if (!cell) return;
  openPanel(cell.dataset.date);
});

dom.memo.addEventListener('input', scheduleSave);
dom.memo.addEventListener('blur', flushSave);

dom.agendaList.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-action]');
  if (!btn) return;
  const item = btn.closest('.agenda__item--event');
  if (!item) return;
  if (btn.dataset.action === 'toggle') toggleEvent(item.dataset.id);
  else if (btn.dataset.action === 'delete') removeEvent(item.dataset.id);
});

dom.addEventBtn.addEventListener('click', openEventForm);
dom.evtCancel.addEventListener('click', closeEventForm);
dom.eventForm.addEventListener('submit', submitEvent);

dom.notifyBtn.addEventListener('click', () => {
  if (!('Notification' in window)) return;
  Notification.requestPermission().then((permission) => {
    if (permission === 'granted') {
      settings.notifyEnabled = true;
      writeJSON(SETTING_KEY, settings);
      dom.notifyBtn.hidden = true;
      flash('已开启系统通知');
    } else {
      dom.notifyBtn.textContent = '系统通知被拒绝，只能用页面内提醒';
    }
  });
});

dom.noticeClose.addEventListener('click', () => {
  dom.notice.hidden = true;
});

document.getElementById('prevBtn').addEventListener('click', () => {
  state.view = new Date(state.view.getFullYear(), state.view.getMonth() - 1, 1);
  render();
});

document.getElementById('nextBtn').addEventListener('click', () => {
  state.view = new Date(state.view.getFullYear(), state.view.getMonth() + 1, 1);
  render();
});

document.getElementById('todayBtn').addEventListener('click', () => {
  state.view = firstOfMonth(new Date());
  openPanel(todayKey());
});

document.getElementById('closeBtn').addEventListener('click', closePanel);
dom.scrim.addEventListener('click', closePanel);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.selected) closePanel();
});

window.addEventListener('focus', () => {
  unread = 0;
  document.title = BASE_TITLE;
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) runReminderTick();
});

window.addEventListener('storage', (event) => {
  if (event.key === MEMO_KEY) {
    memos = readJSON(MEMO_KEY, {});
    render();
    if (state.selected) dom.memo.value = memos[state.selected] || '';
  }
  if (event.key === EVENT_KEY) {
    events = normalizeEvents(readJSON(EVENT_KEY, {}));
    render();
    if (state.selected) renderAgenda();
  }
});

/* ---------------- 启动 ---------------- */

dom.panel.inert = true;
render();
setInterval(runReminderTick, TICK_MS);
runReminderTick();
