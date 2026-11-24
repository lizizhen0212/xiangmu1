'use strict';

/* ============================================================
   模块 A · 学习日历（issue #2）
   月视图 + 当天备忘 + 当天汇总占位
   数据存 localStorage，无后端
   ============================================================ */

const STORAGE_KEY = 'study-calendar:memos:v1';
const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六'];
const AUTOSAVE_DELAY = 350;

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
};

const state = {
  view: firstOfMonth(new Date()), // 当前显示的月份（当月 1 号）
  selected: null,                 // 选中的日期 'YYYY-MM-DD'
};

let memos = loadMemos();
let saveTimer = null;

/* ---------------- 存储 ---------------- */

function loadMemos() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch (err) {
    console.warn('读取本地备忘失败，已按空数据启动', err);
    return {};
  }
}

function persist() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(memos));
  } catch (err) {
    console.warn('保存失败，浏览器可能禁用了本地存储', err);
  }
}

function hasMemo(key) {
  const value = memos[key];
  return typeof value === 'string' && value.trim() !== '';
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

function countMemosIn(year, month) {
  const prefix = `${year}-${pad2(month + 1)}-`;
  return Object.keys(memos).filter((k) => k.startsWith(prefix) && hasMemo(k)).length;
}

/* ---------------- 渲染 ---------------- */

function render() {
  const year = state.view.getFullYear();
  const month = state.view.getMonth();
  const today = todayKey();

  dom.monthLabel.textContent = `${year} 年 ${month + 1} 月`;

  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;              // 周一 = 0
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

    frag.appendChild(cell);
  }

  dom.grid.replaceChildren(frag);
  updateMonthMeta();
}

function updateMonthMeta() {
  const count = countMemosIn(state.view.getFullYear(), state.view.getMonth());
  dom.monthMeta.textContent = count > 0 ? `本月 ${count} 条备忘` : '';
  dom.emptyHint.hidden = count > 0;
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

  // 点了相邻月份的日期格子 → 视图先跟着翻过去
  if (date.getFullYear() !== state.view.getFullYear() || date.getMonth() !== state.view.getMonth()) {
    state.view = firstOfMonth(date);
  }

  state.selected = key;

  const isToday = key === todayKey();
  dom.panelDate.textContent =
    `${m} 月 ${d} 日 · 周${WEEKDAY_CN[date.getDay()]}${isToday ? ' · 今天' : ''}`;
  dom.memo.value = memos[key] || '';
  dom.saveHint.textContent = '输入即自动保存';

  render();

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

  dom.panel.classList.remove('is-open');
  dom.panel.setAttribute('aria-hidden', 'true');
  dom.panel.inert = true;
  dom.scrim.hidden = true;
  document.body.classList.remove('has-panel');

  render();
}

/* ---------------- 保存 ---------------- */

function saveNow() {
  if (!state.selected) return;

  const key = state.selected;
  const value = dom.memo.value;

  if (value.trim() === '') {
    delete memos[key];
  } else {
    memos[key] = value;
  }

  persist();
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

/* ---------------- 事件绑定 ---------------- */

dom.grid.addEventListener('click', (event) => {
  const cell = event.target.closest('.day');
  if (!cell) return;
  openPanel(cell.dataset.date);
});

dom.memo.addEventListener('input', scheduleSave);
dom.memo.addEventListener('blur', flushSave);

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

/* 其它标签页改了数据时同步过来 */
window.addEventListener('storage', (event) => {
  if (event.key !== STORAGE_KEY) return;
  memos = loadMemos();
  render();
  if (state.selected) dom.memo.value = memos[state.selected] || '';
});

/* ---------------- 启动 ---------------- */

dom.panel.inert = true;
render();
