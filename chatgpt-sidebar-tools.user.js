// ==UserScript==
// @name         ChatGPT 原生侧边栏助手
// @namespace    local.chatgpt.sidebar-tools
// @version      2.7.7
// @description  原生对话时间、日期分组、本地收藏分组与右键菜单；不主动发起任何网络请求。
// @author       ahang39
// @homepageURL  https://github.com/ahang39/chatgpt-sidebar-tools
// @supportURL   https://github.com/ahang39/chatgpt-sidebar-tools/issues
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-start
// @grant        none
// @sandbox      raw
// @noframes
// @license      MIT
// ==/UserScript==

(() => {
  'use strict';

  const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
  const GROUPS = ['今天', '昨天', '最近一周', '更多'];
  const PREF_KEY = 'cst:preferences:v1';
  const COLLECTION_PREFIX = 'cst:collections:v1:';

  function collectionData(raw) {
    if (raw === null) return { version: 1, collapsed: false, groups: [{ id: 'later', name: '稍后再看', collapsed: false }], items: [] };
    const fail = () => { throw new Error('收藏数据格式异常，请先备份网站数据；原数据未被覆盖。'); };
    let data;
    try { data = JSON.parse(raw); } catch { fail(); }
    if (data?.version !== 1 || !Array.isArray(data.groups) || !Array.isArray(data.items)) fail();
    if (data.collapsed === undefined) data.collapsed = false;
    if (typeof data.collapsed !== 'boolean') fail();
    const groups = new Set(), items = new Set();
    for (const group of data.groups) {
      if (typeof group?.id !== 'string' || !ID.test(group.id) || groups.has(group.id) || typeof group.name !== 'string' || !group.name.trim() || group.name.length > 60 || typeof group.collapsed !== 'boolean') fail();
      groups.add(group.id);
    }
    for (const item of data.items) {
      if (typeof item?.id !== 'string' || !ID.test(item.id) || items.has(item.id) || typeof item.title !== 'string' || item.title.length > 300 || !Array.isArray(item.groups) || !item.groups.length || new Set(item.groups).size !== item.groups.length || item.groups.some(id => !groups.has(id))) fail();
      items.add(item.id);
    }
    return data;
  }

  function timestamp(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = typeof value === 'number' || /^\d+(\.\d+)?$/.test(value);
    const n = numeric ? Number(value) : Date.parse(value);
    const ms = numeric && n < 1e12 ? n * 1000 : n;
    return Number.isFinite(ms) && ms > 0 && ms <= 8640000000000000 ? ms : null;
  }

  function normalize(item) {
    const id = item?.id ?? item?.conversation_id;
    if (typeof id !== 'string' || !ID.test(id)) return null;
    return {
      id,
      title: typeof item.title === 'string' ? item.title : '未命名对话',
      updated: timestamp(item.update_time),
      created: timestamp(item.create_time),
      archived: item.is_archived === true || item.is_visible === false,
    };
  }

  function pinItems(data) {
    const pins = Array.isArray(data) ? data : data?.items ?? data?.pins;
    if (!Array.isArray(pins)) return [];
    return pins.flatMap(pin => {
      if (pin?.item_type && pin.item_type !== 'conversation') return [];
      const conversation = pin?.item_type === 'conversation' ? pin.item : pin?.conversation ?? pin;
      if (!conversation || typeof conversation !== 'object') return [];
      const item = normalize({ ...conversation, id: conversation.conversation_id ?? conversation.id ?? pin.conversation_id });
      return item && (item.updated || item.created) ? [item] : [];
    });
  }

  function groupFor(ms, now = new Date()) {
    if (!ms) return 3;
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
    const week = new Date(today); week.setDate(week.getDate() - 6);
    return ms >= +today ? 0 : ms >= +yesterday ? 1 : ms >= +week ? 2 : 3;
  }

  function sorted(items) {
    return [...items].filter(x => !x.archived).sort((a, b) =>
      (b.updated ?? b.created ?? 0) - (a.updated ?? a.created ?? 0) || a.id.localeCompare(b.id));
  }

  function conversationId(href) {
    return /\/c\/([a-zA-Z0-9_-]+)(?:[/?#]|$)/.exec(href || '')?.[1] ?? null;
  }

  function relativeTime(ms, now = Date.now()) {
    if (!ms) return '时间未知';
    const seconds = Math.max(0, Math.floor((now - ms) / 1000));
    if (seconds < 60) return '刚刚';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟前`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}小时前`;
    if (seconds < 2592000) return `${Math.floor(seconds / 86400)}天前`;
    if (seconds < 31536000) return `${Math.floor(seconds / 2592000)}个月前`;
    return `${Math.floor(seconds / 31536000)}年前`;
  }

  function sseParser(onData) {
    const limit = 131072;
    let buffer = '', lines = [], size = 0, skip = false, discardLine = false;
    function line(value) {
      if (value.endsWith('\r')) value = value.slice(0, -1);
      if (!value) {
        if (!skip && lines.length) onData(lines.join('\n'));
        lines = []; size = 0; skip = false;
      } else if (!skip && value.startsWith('data:')) {
        const data = value.slice(5).replace(/^ /, '');
        size += data.length + 1;
        if (size > limit) { lines = []; skip = true; }
        else lines.push(data);
      }
    }
    return {
      push(text) {
        buffer += text;
        let end;
        while ((end = buffer.indexOf('\n')) >= 0) {
          if (discardLine) discardLine = false;
          else line(buffer.slice(0, end));
          buffer = buffer.slice(end + 1);
        }
        if (buffer.length > limit) { buffer = ''; lines = []; skip = true; discardLine = true; }
      },
      finish() { if (buffer) line(buffer); line(''); buffer = ''; },
    };
  }

  if (typeof document === 'undefined') {
    if (typeof module !== 'undefined') module.exports = { timestamp, normalize, groupFor, sorted, conversationId, relativeTime, sseParser, pinItems, collectionData };
    return;
  }
  if (window !== window.top || window.__cstInstalled) return;
  Object.defineProperty(window, '__cstInstalled', { value: true });

  let saved;
  try { saved = JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); } catch { saved = {}; }
  const collapsed = GROUPS.map((_, i) => typeof saved?.collapsed?.[i] === 'boolean' ? saved.collapsed[i] : i === 3);
  const records = new Map();
  const activity = new Map(), readers = new Set();
  let cookie = workspace(), account = '', generation = 0, timer = null, currentList = null;
  let collectionPanel = null, collectionSignature = '', collectionEditor = null, menuTarget = null;
  let collectionDrag = null, suppressCollectionClick = null;
  const collectionRowSignatures = new WeakMap();

  function workspace() {
    return document.cookie.split(';').map(x => x.trim()).find(x => x.startsWith('_account=')) || '';
  }
  function updateScope(nextAccount = '') {
    const nextCookie = workspace();
    if (nextCookie !== cookie || (nextAccount && nextAccount !== account)) {
      account = nextCookie !== cookie ? nextAccount : nextAccount || account;
      cookie = nextCookie; generation++; records.clear(); activity.clear();
      collectionPanel?.remove(); collectionPanel = null; collectionSignature = ''; menuTarget = null;
      closeCollectionEditor();
      cancelCollectionDrag();
      for (const reader of readers) void reader.cancel().catch(() => {});
      schedule();
    }
  }
  function schedule() { if (timer === null) timer = setTimeout(paint, 50); }

  function markActivity(id, ms, observed = false) {
    if (typeof id !== 'string' || !ID.test(id) || !ms) return;
    const previous = activity.get(id);
    if (previous && (previous.updated > ms || (previous.updated === ms && !previous.observed))) return;
    if (observed && previous && ms - previous.updated < 1000) return;
    activity.set(id, { updated: ms, observed }); schedule();
  }
  function chatEvents(current) {
    let id = null, serverTime = null, seen = false, failed = false;
    function complete() { if (current() && id && seen && !failed) markActivity(id, serverTime || Date.now(), !serverTime); }
    function event(data, depth = 0) {
      if (!current() || failed || !data || typeof data !== 'object' || depth > 1) return;
      const value = data.v && typeof data.v === 'object' && !Array.isArray(data.v) && !data.p ? data.v : data;
      if (data.error || value.error || data.type === 'error') { failed = true; return; }
      const next = value.conversation_id || data.conversation_id || (data.p === '/conversation_id' ? data.v : null);
      if (typeof next === 'string' && ID.test(next)) {
        if (id && id !== next) return;
        id = next;
      }
      const message = value.message || (data.p === '/message' && typeof data.v === 'object' ? data.v : null);
      const ms = timestamp(value.update_time) ?? timestamp(message?.update_time) ?? timestamp(message?.create_time) ??
        (/^\/message\/(?:update_time|create_time)$/.test(data.p || '') ? timestamp(data.v) : null);
      if (ms) { serverTime = Math.max(serverTime || 0, ms); if (id) markActivity(id, serverTime); }
      if (message && ['assistant', 'user', 'tool'].includes(message.author?.role)) {
        seen = true;
        if (id && !ms && !failed) markActivity(id, Date.now(), true);
      }
      if (data.o === 'patch' && Array.isArray(data.v)) for (const patch of data.v.slice(0, 64)) event(patch, depth + 1);
      if (data.type === 'message_stream_complete') { seen = true; complete(); }
    }
    return {
      data(text) {
        if (text.trim() === '[DONE]') { complete(); return true; }
        try { event(JSON.parse(text)); } catch { /* Non-JSON protocol markers are not metadata. */ }
        return false;
      },
      json: event,
    };
  }
  async function readChatStream(response, current) {
    if (!response.body) return;
    const reader = response.body.getReader(), decoder = new TextDecoder(), events = chatEvents(current);
    let done = false;
    const parser = sseParser(text => { if (!done && events.data(text)) done = true; });
    readers.add(reader);
    try {
      while (current() && !done) {
        const part = await reader.read();
        if (!current()) break;
        if (part.done) { parser.push(decoder.decode()); parser.finish(); break; }
        parser.push(decoder.decode(part.value, { stream: true }));
      }
    } finally {
      readers.delete(reader);
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }

  // Only forward calls that ChatGPT itself makes. Keep its original promise, inputs and response.
  const nativeFetch = window.fetch;
  window.fetch = function(input, init) {
    let kind = '', detailId, requestGeneration, requestCookie;
    try {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
      const method = (init?.method || input?.method || 'GET').toUpperCase();
      if (url.origin === location.origin) {
        if (method === 'GET' && url.pathname === '/backend-api/conversations' && url.searchParams.get('is_archived') !== 'true') kind = 'list';
        if (method === 'GET' && url.pathname === '/backend-api/pins') kind = 'pins';
        detailId = /^\/backend-api\/conversation\/([\w-]+)$/.exec(url.pathname)?.[1];
        if (method === 'GET' && detailId) kind = 'detail';
        if (method === 'POST' && /^\/backend-api\/(?:f\/)?conversation(?:\/resume)?$/.test(url.pathname)) kind = 'chat';
      }
      if (kind) {
        const headers = new Headers(init?.headers ?? input?.headers);
        updateScope(headers.get('chatgpt-account-id') || '');
        requestGeneration = generation; requestCookie = cookie;
      }
    } catch { /* Never change the host request. */ }
    const pending = nativeFetch.apply(this, arguments);
    if (kind) pending.then(response => {
      const current = () => requestGeneration === generation && requestCookie === workspace();
      if (!response.ok || !current()) return;
      const copy = response.clone();
      if (kind === 'chat' && response.headers.get('content-type')?.includes('text/event-stream')) return readChatStream(copy, current);
      return copy.json().then(data => {
        if (!current()) return;
        if (kind === 'list' && Array.isArray(data.items)) {
          for (const raw of data.items) {
            const item = normalize(raw);
            if (item) item.archived ? records.delete(item.id) : records.set(item.id, item);
          }
          schedule();
        } else if (kind === 'pins') {
          for (const item of pinItems(data)) {
            const previous = records.get(item.id);
            if (!previous || (item.updated ?? item.created) >= (previous.updated ?? previous.created ?? 0)) records.set(item.id, item);
          }
          schedule();
        } else if (kind === 'detail' && !data.error) {
          const item = normalize({ ...data, id: detailId });
          if (item) { records.set(item.id, item); schedule(); }
        } else if (kind === 'chat') chatEvents(current).json(data);
      });
    }).catch(() => {});
    return pending;
  };

  function attr(node, name, value) { if (node.getAttribute(name) !== String(value)) node.setAttribute(name, String(value)); }
  function setText(node, value) { if (node.textContent !== value) node.textContent = value; }
  function owned(tag, kind) {
    const node = document.createElement(tag); node.dataset.cstOwned = kind; return node;
  }
  const SECTION = '[class~="group/nav-section"]';
  const RECENTS_SECTION = '[data-app-action-sidebar-section-heading="Recents"]';
  function sectionToggle(section) {
    const heading = section.firstElementChild;
    return heading?.querySelector('button[data-app-action-sidebar-section-toggle]')
      || heading?.querySelector('button[aria-expanded]');
  }
  function findRecentsSection() {
    const native = document.querySelector('nav ' + RECENTS_SECTION);
    const inner = native?.querySelector(':scope > ' + SECTION + ':not([data-cst-owned])');
    if (inner && sectionToggle(inner)) return inner;
    for (const section of document.querySelectorAll('nav ' + SECTION)) {
      if (section.closest('[data-cst-owned]')) continue;
      const toggle = sectionToggle(section);
      const title = toggle?.querySelector('span')?.textContent || toggle?.textContent || '';
      if (/^(最近|近期|聊天|聊天记录|Recent|Recents|Chats|Your chats|Chat history|History)$/i.test(title.trim())) return section;
    }
    return null;
  }
  function findList(section) {
    if (section) {
      const nativeLists = [...section.querySelectorAll('[class~="group/nav-list"], [role="list"], ol, ul')]
        .filter(node => node.closest(SECTION) === section && !node.closest('[data-cst-owned]'));
      const list = nativeLists.find(node => node.matches('[role="list"], ol, ul')) || nativeLists[0];
      if (list) return list;
    }
    const history = document.querySelector('nav #history, aside #history, #history');
    return history && (history.querySelector('ol, [role="list"]') || history);
  }
  function rows(list) {
    return [...list.children].filter(n => !n.hasAttribute('data-cst-owned')).flatMap(wrapper => {
      const link = wrapper.matches('a[href*="/c/"]') ? wrapper : wrapper.querySelector('a[href*="/c/"]');
      const id = link && conversationId(link.getAttribute('href'));
      return id ? [{ id, link, wrapper, shell: link.closest('[data-sidebar-cycle-item], .sidebar-item, [data-testid^="history-item-"]') || wrapper }] : [];
    });
  }
  function clear() {
    for (const row of collectionPanel?.querySelectorAll('.cst-collection-row') || []) collectionRowSignatures.delete(row);
    for (const node of document.querySelectorAll('[data-cst-owned="group"], [data-cst-owned="time"]')) node.remove();
    for (const node of document.querySelectorAll('[data-cst-list], [data-cst-link], [data-cst-shell], [data-cst-row], [data-cst-collapsed], [data-cst-sidebar], [data-cst-collected]')) {
      for (const name of ['data-cst-list', 'data-cst-link', 'data-cst-shell', 'data-cst-row', 'data-cst-collapsed', 'data-cst-sidebar', 'data-cst-collected']) node.removeAttribute(name);
      node.style.removeProperty('--cst-order');
      node.style.removeProperty('--cst-recency-color');
      node.style.removeProperty('--cst-recency-weight');
    }
  }
  function dateFor(row) {
    const item = records.get(row.id);
    return Math.max(item?.updated ?? item?.created ?? 0, activity.get(row.id)?.updated || 0) || null;
  }
  function decorate(row, ms) {
    attr(row.wrapper, 'data-cst-row', row.id); attr(row.shell, 'data-cst-shell', ''); attr(row.link, 'data-cst-link', '');
    let time = row.link.querySelector(':scope > [data-cst-owned="time"]');
    if (!ms) {
      row.link.style.removeProperty('--cst-recency-color'); row.link.style.removeProperty('--cst-recency-weight');
      time?.remove(); return;
    }
    const hours = Math.max(0, (Date.now() - ms) / 3600000);
    const tone = hours < 1 ? 0 : hours < 6 ? 1 : hours < 24 ? 2 : 3;
    row.link.style.setProperty('--cst-recency-color', `var(--cst-tone-${tone})`);
    row.link.style.setProperty('--cst-recency-weight', tone === 0 ? '600' : tone === 1 ? '500' : '400');
    if (!time) { time = owned('time', 'time'); time.className = 'cst-time'; row.link.append(time); }
    setText(time, relativeTime(ms));
    attr(time, 'datetime', new Date(ms).toISOString());
    const live = activity.get(row.id);
    attr(time, 'title', (live?.observed && live.updated === ms ? '本页收到回复的时间：' : '对话时间：') + new Date(ms).toLocaleString('zh-CN', { hour12: false }));
  }
  function chevron() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [name, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(name, value);
    const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', 'm9 18 6-6-6-6'); svg.append(path);
    return svg;
  }
  function mountDisclosure(header, button, title, reference, ...actions) {
    const heading = reference?.closest('[class~="group/nav-section-title"]');
    const nativeHeader = heading && (reference.parentElement !== heading || heading.classList.contains('flex')) ? heading : null;
    const label = document.createElement('span');
    const nativeLabel = reference?.querySelector('span');
    if (nativeLabel) label.className = nativeLabel.className;
    label.textContent = title;

    const nativeIcon = reference?.querySelector('svg.icon-disclosure');
    const icon = nativeIcon?.cloneNode(true) || chevron();
    if (nativeIcon) {
      for (const name of [...icon.classList]) if (name.startsWith('rotate-')) icon.classList.remove(name);
      icon.classList.add('cst-native-disclosure');
    } else {
      icon.classList.add('cst-fallback-disclosure');
    }
    button.className = 'cst-group-toggle';
    if (reference?.className) button.className += ' ' + reference.className;
    if (reference?.style.font) button.style.font = reference.style.font;
    if (reference?.style.color) button.style.color = reference.style.color;
    button.append(label, icon);

    let branch = button;
    if (nativeHeader) {
      header.classList.add('cst-native-heading', ...nativeHeader.classList);
      for (let parent = reference.parentElement; parent !== nativeHeader; parent = parent.parentElement) {
        const wrapper = document.createElement('div');
        wrapper.className = parent.className;
        wrapper.append(branch);
        branch = wrapper;
      }
    }
    header.append(branch);
    if (actions.length) {
      const rail = document.createElement('div');
      const nativeRail = nativeHeader?.lastElementChild;
      rail.className = nativeRail && !nativeRail.contains(reference) ? nativeRail.className : 'cst-heading-actions';
      rail.append(...actions);
      header.append(rail);
    }
  }
  function group(list, index, count, reference) {
    let header = list.querySelector(':scope > [data-cst-owned="group"][data-group="' + index + '"]');
    if (!header) {
      header = owned(/^(UL|OL)$/.test(list.tagName) ? 'li' : 'div', 'group');
      header.className = 'cst-group'; header.dataset.group = index; header.setAttribute('role', 'listitem');
      const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'cst-group-toggle';
      toggle.addEventListener('click', () => {
        collapsed[index] = !collapsed[index];
        try { localStorage.setItem(PREF_KEY, JSON.stringify({ collapsed })); } catch { /* The current page still remembers. */ }
        schedule();
      });
      const counter = document.createElement('span'); counter.className = 'cst-group-count';
      mountDisclosure(header, toggle, GROUPS[index], reference, counter); list.append(header);
    }
    header.hidden = count === 0; header.style.setProperty('--cst-order', index * 1000000);
    const toggle = header.querySelector('button');
    attr(toggle, 'aria-expanded', !collapsed[index]);
    attr(toggle, 'aria-label', (collapsed[index] ? '展开' : '折叠') + GROUPS[index] + '，' + count + ' 个对话');
    setText(header.querySelector('.cst-group-count'), String(count));
  }

  // Wait for the native account header: an unidentified page must not share bookmarks.
  function collectionKey() { return account ? COLLECTION_PREFIX + encodeURIComponent(JSON.stringify([cookie, account])) : null; }
  function readCollections(key) { return collectionData(localStorage.getItem(key)); }
  async function changeCollections(key, change) {
    if (!key || key !== collectionKey()) throw new Error('账号或工作区已变化，请重新打开收藏。');
    if (!navigator.locks) throw new Error('当前浏览器不支持安全的多标签页收藏写入。');
    await navigator.locks.request(key, () => {
      if (key !== collectionKey()) throw new Error('账号或工作区已变化，请重新打开收藏。');
      const data = readCollections(key);
      change(data);
      const text = JSON.stringify(data); collectionData(text);
      localStorage.setItem(key, text);
    });
    collectionSignature = ''; schedule();
  }
  function collectionButton(label, action) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
    button.addEventListener('click', action); return button;
  }
  function collectionIcon(label, path, action) {
    const button = collectionButton('', action);
    const section = findRecentsSection();
    const reference = section?.firstElementChild?.querySelector('button[data-size]:not([aria-haspopup])')
      || document.querySelector('nav button[aria-haspopup="menu"]');
    button.className = (reference?.className || '') + ' cst-collection-icon';
    for (const name of ['data-color', 'data-variant', 'data-uniform', 'data-size']) if (reference?.hasAttribute(name)) button.setAttribute(name, reference.getAttribute(name));
    button.setAttribute('aria-label', label); button.title = label;
    const svg = chevron(); svg.firstElementChild.setAttribute('d', path);
    const inner = reference?.firstElementChild;
    if (inner?.tagName === 'SPAN') {
      const wrapper = document.createElement('span');
      wrapper.className = inner.className;
      wrapper.append(svg);
      button.append(wrapper);
    } else button.append(svg);
    return button;
  }
  function closeCollectionEditor() {
    collectionEditor?.remove(); collectionEditor = null; collectionSignature = ''; schedule();
  }
  function collectionError(message) {
    if (!collectionPanel) return;
    let notice = collectionPanel.querySelector(':scope > .cst-collection-error');
    if (!notice) { notice = document.createElement('p'); notice.className = 'cst-collection-error'; notice.setAttribute('role', 'alert'); collectionPanel.append(notice); }
    notice.textContent = message;
  }
  function editCollections(item = null, group = null, anchor = null) {
    const key = collectionKey();
    if (!key || !collectionPanel?.isConnected) return;
    closeCollectionEditor();
    const editor = owned('div', 'collection-editor'); editor.className = 'cst-collection-editor';
    editor.setAttribute('role', 'group'); editor.setAttribute('aria-label', '收藏分组编辑');
    collectionEditor = editor;
    const form = document.createElement('form');
    const status = document.createElement('p'); status.setAttribute('role', 'alert'); status.className = 'cst-collection-error';
    const nameLabel = document.createElement('label'), name = document.createElement('input');
    name.type = 'text'; name.maxLength = 60; name.value = group?.name || ''; name.required = !item;
    const inputLabel = item ? '新建分组（可选）' : '分组名称';
    name.setAttribute('aria-label', inputLabel); name.placeholder = inputLabel; nameLabel.append(name);
    const choices = document.createElement('fieldset'); choices.className = 'cst-collection-choices';
    const legend = document.createElement('legend'); legend.textContent = item?.title || '选择分组'; choices.append(legend);
    try {
      const data = readCollections(key);
      if (item) for (const entry of data.groups) {
        const label = document.createElement('label'), check = document.createElement('input');
        check.type = 'checkbox'; check.value = entry.id;
        check.checked = data.items.find(x => x.id === item.id)?.groups.includes(entry.id) || false;
        label.append(check, document.createTextNode(entry.name)); choices.append(label);
      }
    } catch (error) { status.textContent = error.message; }
    const actions = document.createElement('div'); actions.className = 'cst-collection-actions';
    const cancel = collectionIcon('取消', 'm18 6-12 12M6 6l12 12', closeCollectionEditor);
    const save = collectionIcon('保存', 'm20 6-11 11-5-5', () => {}); save.type = 'submit';
    actions.append(save, cancel);
    if (group) {
      const remove = collectionIcon('删除分组', 'M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6', async () => {
        if (remove.dataset.confirm !== 'true') {
          remove.dataset.confirm = 'true'; remove.setAttribute('aria-label', '确认删除分组'); remove.title = '确认删除分组';
          status.textContent = '仅移除此分组及其中的收藏关系，不删除 ChatGPT 对话。'; return;
        }
        remove.disabled = true;
        try {
          await changeCollections(key, data => {
            data.groups = data.groups.filter(x => x.id !== group.id);
            for (const entry of data.items) entry.groups = entry.groups.filter(id => id !== group.id);
            data.items = data.items.filter(x => x.groups.length);
          }); closeCollectionEditor();
        } catch (error) { status.textContent = '无法保存：' + error.message; remove.disabled = false; }
      });
      remove.classList.add('cst-collection-delete'); actions.prepend(remove);
    }
    form.addEventListener('submit', async event => {
      event.preventDefault(); save.disabled = true;
      const selected = [...choices.querySelectorAll('input:checked')].map(x => x.value), title = name.value.trim();
      try {
        await changeCollections(key, data => {
          if (!item && !title) throw new Error('请输入分组名称。');
          if (group) {
            const entry = data.groups.find(x => x.id === group.id);
            if (!entry) throw new Error('分组已变化，请重新打开。');
            if (data.groups.some(x => x.id !== group.id && x.name === title)) throw new Error('已存在同名分组。');
            entry.name = title;
          } else if (title) {
            let entry = data.groups.find(x => x.name === title);
            if (!entry) { entry = { id: crypto.randomUUID(), name: title, collapsed: false }; data.groups.push(entry); }
            data.collapsed = false;
            if (item) selected.push(entry.id);
          }
          if (item) {
            if (selected.some(id => !data.groups.some(g => g.id === id))) throw new Error('分组已变化，请重新打开。');
            data.items = data.items.filter(x => x.id !== item.id);
            if (selected.length) data.items.push({ id: item.id, title: item.title, groups: [...new Set(selected)] });
          }
        }); closeCollectionEditor();
      } catch (error) { status.textContent = '无法保存：' + error.message; save.disabled = false; }
    });
    if (item) form.append(choices);
    const inputRow = document.createElement('div'); inputRow.className = 'cst-collection-input-row'; inputRow.append(nameLabel, actions);
    form.append(inputRow, status); editor.append(form);
    const host = anchor?.closest('.cst-collection-row,.cst-collection-heading') || collectionPanel.querySelector('.cst-collection-heading');
    host.after(editor);
    editor.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeCollectionEditor(); } });
    name.focus(); if (group) name.select();
  }
  function nativeCollectionRows(nav) {
    const result = new Map();
    for (const link of nav.querySelectorAll('a[href*="/c/"]')) {
      if (link.closest('[data-cst-owned="collections"]')) continue;
      const id = conversationId(link.getAttribute('href'));
      if (id && !result.has(id)) result.set(id, { id, link, shell: link.closest('[data-sidebar-cycle-item],.sidebar-item,[data-testid^="history-item-"]') || link });
    }
    return result;
  }
  function openCollectionChat(event, id) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !event.target.closest('a[href*="/c/"]')) return;
    event.preventDefault(); event.stopPropagation();
    const source = nativeCollectionRows(collectionPanel.closest('nav,aside')).get(id);
    if (source) { source.link.click(); return; }
    // Unloaded bookmarks have no native Link; notify the page's History router without loading a document.
    const href = '/c/' + id;
    if (location.pathname !== href) {
      history.pushState({ usr: null, key: crypto.randomUUID(), idx: (history.state?.idx || 0) + 1 }, '', href);
      window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
    }
    schedule();
  }
  function renderCollectionRows(nav) {
    if (!nav || !collectionPanel || collectionDrag?.active) return;
    const sources = nativeCollectionRows(nav), template = [...sources.values()].find(row => !row.link.hasAttribute('aria-current')) || sources.values().next().value;
    for (const row of collectionPanel.querySelectorAll('.cst-collection-row')) {
      const id = row.dataset.conversationId, source = sources.get(id), content = row.querySelector('.cst-collection-native');
      const ms = dateFor({ id });
      const title = records.get(id)?.title || row.dataset.title;
      const sourceMarkup = source ? source.shell.outerHTML : JSON.stringify([template?.shell.className, template?.link.className, title, location.pathname]);
      const previous = collectionRowSignatures.get(row);
      if (previous?.sourceMarkup === sourceMarkup) {
        decorate(previous, ms);
        continue;
      }
      let shell, link;
      if (source) {
        shell = source.shell.cloneNode(true);
        // Keep the native title and status rail, but local collection actions have their own handlers.
        for (const node of shell.querySelectorAll('[data-hover-card-open-immediately],button,[data-cst-owned="time"]')) node.remove();
        link = shell.matches('a') ? shell : shell.querySelector('a[href*="/c/"]');
      } else {
        shell = document.createElement('div'); shell.className = template?.shell.className || '';
        link = document.createElement('a'); link.className = template?.link.className || '';
        const titleNode = template?.link.querySelector('[data-thread-title],.native-title')?.cloneNode(false) || document.createElement('span');
        titleNode.textContent = title; link.append(titleNode); shell.append(link);
      }
      for (const node of [shell, ...shell.querySelectorAll('*')]) {
        for (const name of ['id', 'aria-controls', 'aria-describedby', 'aria-labelledby', 'data-sidebar-cycle-item', 'data-testid', 'data-cst-collected', 'data-cst-collapsed', 'data-cst-row', 'data-cst-link', 'data-cst-shell']) node.removeAttribute(name);
      }
      link.href = source?.link.getAttribute('href') || '/c/' + id; link.draggable = false;
      link.style.removeProperty('--cst-recency-color');
      link.style.removeProperty('--cst-recency-weight');
      if (!source && location.pathname === '/c/' + id) link.setAttribute('aria-current', 'page');
      // Ignore native menu changes and local clock updates that do not change the visible row.
      const markup = shell.outerHTML;
      if (previous?.markup === markup) {
        previous.sourceMarkup = sourceMarkup;
        decorate(previous, ms);
        continue;
      }
      const mirror = { id, wrapper: shell, shell, link, sourceMarkup, markup };
      collectionRowSignatures.set(row, mirror);
      decorate(mirror, ms);
      const focused = content.contains(document.activeElement); content.replaceChildren(shell);
      if (focused) link.focus({ preventScroll: true });
    }
  }
  function renderCollections(nav, section, reference) {
    const key = collectionKey();
    if (!nav || !key) { collectionPanel?.remove(); collectionPanel = null; return; }
    if (collectionDrag?.active && collectionPanel?.isConnected) return;
    if (collectionEditor?.isConnected && collectionPanel?.isConnected) return;
    let data, error;
    try { data = readCollections(key); } catch (cause) { error = cause.message; }
    const titles = data?.items.map(x => [x.id, records.get(x.id)?.title || x.title]);
    const signature = JSON.stringify([key, data, titles, error]);
    // Keep the panel outside ChatGPT's collapsible section.
    const nativeSection = section?.closest(RECENTS_SECTION);
    const anchor = nativeSection || section;
    const mount = anchor?.parentElement || nav;
    if (collectionPanel?.parentElement === mount && signature === collectionSignature) return;
    collectionSignature = signature; collectionPanel?.remove();
    const panel = owned('section', 'collections'); panel.className = 'cst-collections'; collectionPanel = panel;
    const nativeLink = nav.querySelector('[data-sidebar-cycle-item] a[href*="/c/"]');
    if (nativeLink) panel.style.font = getComputedStyle(nativeLink).font;
    panel.classList.add('group/nav-section');
    if (nativeSection && nativeSection !== section) panel.classList.add(...nativeSection.classList);
    panel.setAttribute('aria-label', '收藏分组');
    const header = document.createElement('div'); header.className = 'cst-group cst-collection-heading';
    const label = collectionButton('', async () => {
      try { await changeCollections(key, fresh => { fresh.collapsed = !fresh.collapsed; }); }
      catch (cause) { collectionError('无法保存折叠状态：' + cause.message); }
    });
    label.setAttribute('aria-expanded', String(!data?.collapsed));
    label.setAttribute('aria-label', data?.collapsed ? '展开全部收藏' : '折叠全部收藏'); label.disabled = !!error;
    panel.dataset.collapsed = String(!!data?.collapsed);
    const create = collectionIcon('新建收藏分组', 'M12 5v14M5 12h14', () => editCollections()); create.disabled = !!error;
    create.setAttribute('aria-label', '新建收藏分组'); mountDisclosure(header, label, '收藏', reference, create); panel.append(header);
    if (error) { const notice = document.createElement('p'); notice.setAttribute('role', 'alert'); notice.textContent = error; panel.append(notice); }
    const groups = document.createElement('div'); groups.className = 'cst-collection-groups'; groups.hidden = !!data?.collapsed; panel.append(groups);
    for (const group of data?.groups || []) {
      const block = document.createElement('div'); block.className = 'cst-collection-group'; block.dataset.collectionId = group.id;
      const heading = document.createElement('div'); heading.className = 'cst-group cst-collection-heading';
      const entries = data.items.filter(x => x.groups.includes(group.id));
      const toggle = collectionButton('', async () => {
        try { await changeCollections(key, fresh => { const entry = fresh.groups.find(x => x.id === group.id); if (entry) entry.collapsed = !entry.collapsed; }); }
        catch (cause) { collectionError('无法保存折叠状态：' + cause.message); }
      });
      toggle.className = 'cst-group-toggle'; toggle.setAttribute('aria-expanded', String(!group.collapsed));
      toggle.setAttribute('aria-label', (group.collapsed ? '展开' : '折叠') + group.name);
      const count = document.createElement('span'); count.textContent = String(entries.length); count.className = 'cst-group-count';
      const edit = collectionIcon('编辑分组：' + group.name, 'm16 3 5 5-12 12H4v-5ZM14 5l5 5', event => editCollections(null, group, event.currentTarget));
      mountDisclosure(heading, toggle, group.name, reference, count, edit); block.append(heading);
      const links = document.createElement('div'); links.setAttribute('role', 'list'); links.hidden = group.collapsed;
      for (const entry of entries) {
        const row = document.createElement('div'); row.className = 'cst-collection-row'; row.setAttribute('role', 'listitem');
        row.dataset.conversationId = entry.id; row.dataset.title = records.get(entry.id)?.title || entry.title;
        const content = document.createElement('div'); content.className = 'cst-collection-native';
        const actions = document.createElement('div'); actions.className = 'cst-collection-row-actions';
        const adjust = collectionIcon('调整收藏分组：' + row.dataset.title, 'M3 7V5h6l2 2h10v13H3ZM12 10v7M8.5 13.5h7', event => editCollections({ id: entry.id, title: row.dataset.title }, null, event.currentTarget));
        const remove = collectionIcon('从' + group.name + '移除：' + row.dataset.title, 'M6 3h12v18l-6-4-6 4ZM9 9h6', async () => {
          try { await changeCollections(key, fresh => {
            const saved = fresh.items.find(x => x.id === entry.id);
            if (saved) saved.groups = saved.groups.filter(id => id !== group.id);
            fresh.items = fresh.items.filter(x => x.groups.length);
          }); } catch (cause) { collectionError('无法移除收藏：' + cause.message); }
        });
        actions.append(adjust, remove); row.append(content, actions); links.append(row);
        row.addEventListener('click', event => openCollectionChat(event, entry.id));
        row.addEventListener('contextmenu', event => {
          event.preventDefault(); event.stopPropagation(); editCollections({ id: entry.id, title: row.dataset.title }, null, row);
        });
      }
      links.setAttribute('aria-label', group.name); if (!entries.length) heading.title = '拖入对话以收藏';
      block.append(links); groups.append(block);
    }
    if (anchor) anchor.before(panel); else nav.append(panel);
  }
  function rememberMenuTarget(event) {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest('button[aria-haspopup="menu"]');
    const row = button?.closest('[data-sidebar-cycle-item],.sidebar-item,[data-testid^="history-item-"]');
    const link = row?.querySelector('a[href*="/c/"]');
    if (!link || !row.closest('nav,aside,#history')) return;
    const id = conversationId(link.getAttribute('href'));
    if (id) menuTarget = { button, key: collectionKey(), item: { id, title: (link.getAttribute('aria-label') || link.firstElementChild?.textContent || link.textContent).trim().slice(0, 300) || '未命名对话' } };
    schedule();
  }
  function renderCollectionMenu() {
    if (!menuTarget?.key || menuTarget.key !== collectionKey() || !menuTarget.button.isConnected || menuTarget.button.getAttribute('aria-expanded') !== 'true') return;
    const menu = document.getElementById(menuTarget.button.getAttribute('aria-controls'));
    if (!menu || menu.getAttribute('role') !== 'menu' || menu.querySelector('[data-cst-owned="collection-action"]')) return;
    const target = menuTarget.item;
    const action = collectionButton('收藏到分组…', event => {
      event.preventDefault(); event.stopPropagation();
      menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      editCollections(target);
    });
    action.dataset.cstOwned = 'collection-action'; action.setAttribute('role', 'menuitem');
    const reference = menu.querySelector('[role="menuitem"]');
    action.className = (reference?.className || '') + ' cst-collection-menu-action';
    if (reference) {
      const style = getComputedStyle(reference);
      for (const property of ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'padding', 'border-radius', 'height', 'box-sizing', 'display', 'align-items']) action.style.setProperty(property, style.getPropertyValue(property));
    }
    const content = document.createElement('span'); content.className = 'cst-collection-menu-content';
    const icon = chevron(); icon.replaceChildren();
    const path = document.createElementNS(icon.namespaceURI, 'path'); path.setAttribute('d', 'M6 3h12v18l-6-4-6 4Z'); icon.append(path);
    const text = document.createElement('span'); text.textContent = action.textContent;
    content.append(icon, text); action.replaceChildren(content);
    menu.append(action);
    menu.addEventListener('keydown', event => {
      if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
      const entries = [...menu.querySelectorAll('[role="menuitem"]')].filter(node => !node.matches(':disabled,[aria-disabled="true"],[data-disabled]'));
      const index = entries.indexOf(document.activeElement), last = entries.length - 1;
      if (document.activeElement === action || (event.key === 'ArrowDown' && index === last - 1) || (event.key === 'ArrowUp' && index === 0)) {
        event.preventDefault(); event.stopPropagation();
        entries[(index + (event.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length]?.focus();
      }
    }, true);
  }
  function cancelCollectionDrag() {
    if (!collectionDrag) return;
    const { link, draggable, ghost, revealedGroups } = collectionDrag;
    if (draggable === null) link.removeAttribute('draggable'); else link.setAttribute('draggable', draggable);
    if (revealedGroups) revealedGroups.hidden = true;
    ghost?.remove(); collectionDrag = null;
    for (const node of document.querySelectorAll('[data-cst-drop-active]')) node.removeAttribute('data-cst-drop-active');
    schedule();
  }
  function startCollectionDrag(event) {
    if (event.button !== 0 || event.pointerType !== 'mouse' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !collectionKey() || !collectionPanel?.isConnected) return;
    if (!(event.target instanceof Element) || event.target.closest('button,[role="button"],input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="menu"]')) return;
    const row = event.target.closest('[data-sidebar-cycle-item],.sidebar-item,[data-testid^="history-item-"],[data-cst-shell],.cst-collection-row');
    if (!row?.closest('nav,aside,#history')) return;
    const link = row.matches('a[href*="/c/"]') ? row : row.querySelector('a[href*="/c/"]');
    if (!link) return;
    const id = conversationId(link.getAttribute('href')); if (!id) return;
    cancelCollectionDrag();
    collectionDrag = { key: collectionKey(), link, draggable: link.getAttribute('draggable'), id,
      title: (link.getAttribute('aria-label') || link.firstElementChild?.textContent || link.textContent).trim().slice(0, 300) || '未命名对话',
      row, from: link.closest('[data-collection-id]')?.dataset.collectionId || null,
      pointer: event.pointerId, x: event.clientX, y: event.clientY, active: false };
    // Keep native click navigation, but reserve this drag for local collections instead of the host sorter.
    link.draggable = false; event.stopPropagation();
  }
  function moveCollectionDrag(event) {
    const drag = collectionDrag;
    if (!drag || drag.pointer !== event.pointerId) return;
    if (!drag.active && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
    if (!drag.active) {
      drag.active = true; drag.ghost = owned('div', 'collection-drag'); drag.ghost.className = 'cst-collection-drag';
      drag.ghost.textContent = drag.title; drag.ghost.style.font = getComputedStyle(drag.link).font;
      document.body.append(drag.ghost);
    }
    event.preventDefault(); event.stopPropagation();
    drag.ghost.style.left = event.clientX + 14 + 'px'; drag.ghost.style.top = event.clientY + 12 + 'px';
    const over = document.elementFromPoint(event.clientX, event.clientY);
    if (collectionPanel?.dataset.collapsed === 'true' && !drag.revealedGroups &&
        over?.closest('.cst-collections > .cst-collection-heading')) {
      drag.revealedGroups = collectionPanel.querySelector('.cst-collection-groups');
      drag.revealedGroups.hidden = false;
    }
    const block = over?.closest('.cst-collections [data-collection-id]');
    for (const node of document.querySelectorAll('[data-cst-drop-active]')) if (node !== block) node.removeAttribute('data-cst-drop-active');
    if (block) block.setAttribute('data-cst-drop-active', 'true');
  }
  async function finishCollectionDrag(event) {
    const drag = collectionDrag;
    if (!drag || drag.pointer !== event.pointerId) return;
    if (!drag.active) { cancelCollectionDrag(); return; }
    event.preventDefault(); event.stopPropagation();
    let common = drag.row;
    const over = document.elementFromPoint(event.clientX, event.clientY);
    while (common && !common.contains(over)) common = common.parentElement;
    suppressCollectionClick = { row: drag.row, common, until: Date.now() + 300 };
    const target = over?.closest('.cst-collections [data-collection-id]')?.dataset.collectionId;
    cancelCollectionDrag();
    if (!target) return;
    try {
      await changeCollections(drag.key, data => {
        const group = data.groups.find(x => x.id === target);
        if (!group) throw new Error('目标分组已变化，请重新拖入。');
        let item = data.items.find(x => x.id === drag.id);
        if (!item) { item = { id: drag.id, title: drag.title, groups: [] }; data.items.push(item); }
        if (drag.from) item.groups = item.groups.filter(id => id !== drag.from);
        item.groups = [...new Set([...item.groups, target])]; group.collapsed = false;
        if (drag.revealedGroups) data.collapsed = false;
      });
    } catch (error) {
      const status = owned('p', 'collection-drop-error'); status.setAttribute('role', 'alert'); status.textContent = '无法移动收藏：' + error.message;
      collectionPanel?.append(status);
    }
  }
  function paint() {
    timer = null; updateScope();
    observer.disconnect();
    try {
      const section = findRecentsSection();
      const list = findList(section);
      if (list !== currentList) { clear(); currentList = list; }
      const nav = section?.closest('nav') || list?.closest('nav') || list?.closest('aside') || document.querySelector('nav a[href*="/c/"]')?.closest('nav');
      const reference = section && sectionToggle(section);
      if (nav) attr(nav, 'data-cst-sidebar', '');
      if (list) {
      let collected = new Set();
      try { const key = collectionKey(); if (key) collected = new Set(readCollections(key).items.map(item => item.id)); }
      catch { /* Invalid collection storage is shown by renderCollections; keep native rows visible. */ }
      const allRows = rows(list);
      for (const row of allRows) { attr(row.wrapper, 'data-cst-collected', collected.has(row.id)); decorate(row, dateFor(row)); }
      const nativeRows = allRows.filter(row => !collected.has(row.id)), dates = new Map(nativeRows.map(row => [row.id, dateFor(row)]));
      const ready = nativeRows.some(row => !!dates.get(row.id));
      if (ready) {
        attr(list, 'data-cst-list', '');
        const ordered = sorted(nativeRows.map(row => ({ id: row.id, updated: dates.get(row.id), archived: false })));
        const rank = new Map(ordered.map((item, i) => [item.id, i]));
        const counts = GROUPS.map((_, i) => nativeRows.filter(row => groupFor(dates.get(row.id)) === i).length);
        for (let i = 0; i < GROUPS.length; i++) group(list, i, counts[i], reference);
        for (const row of nativeRows) {
          const ms = dates.get(row.id), index = groupFor(ms);
          row.wrapper.style.setProperty('--cst-order', index * 1000000 + rank.get(row.id) + 1);
          attr(row.wrapper, 'data-cst-collapsed', collapsed[index]);
        }
      } else {
        for (const header of list.querySelectorAll(':scope > [data-cst-owned="group"]')) header.remove();
        list.removeAttribute('data-cst-list');
        for (const row of nativeRows) {
          row.wrapper.style.removeProperty('--cst-order'); row.wrapper.removeAttribute('data-cst-collapsed');
        }
      }
      }
      // Pinned timestamps also work when Recents is collapsed or absent.
      if (nav) for (const link of nav.querySelectorAll('a[href*="/c/"]')) {
        if (list?.contains(link) || link.closest('[data-cst-owned="collections"]')) continue;
        const id = conversationId(link.getAttribute('href'));
        const shell = link.closest('[data-sidebar-cycle-item], .sidebar-item, [data-testid^="history-item-"]') || link;
        if (id && shell) { const row = { id, link, shell, wrapper: shell }; decorate(row, dateFor(row)); }
      }
      renderCollections(nav, section, reference); renderCollectionRows(nav); renderCollectionMenu();
    } finally { observe(); }
  }
  const observer = new MutationObserver(mutations => {
    const relevant = mutations.some(m => {
      const node = m.target.nodeType === 1 ? m.target : m.target.parentElement;
      return !node?.closest('[data-cst-owned]') && (node?.closest('aside, nav, #history') ||
        [...m.addedNodes].some(n => n.nodeType === 1 && (n.matches('aside,nav,#history,[role="menu"]') || n.querySelector('aside,nav,#history,[role="menu"]'))));
    });
    if (relevant) schedule();
  });
  function observe() { observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['href', 'aria-label', 'aria-expanded', 'datetime', 'class', 'aria-current', 'aria-busy', 'data-state'] }); }
  function openRowMenu(event) {
    if (event.defaultPrevented || !(event.target instanceof Element)) return;
    const target = event.target;
    if (target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="menu"],[role="menuitem"]')) return;
    const row = target.closest('[data-sidebar-cycle-item],.sidebar-item,[data-testid^="history-item-"]');
    if (!row?.closest('nav,aside,#history')) return;
    const link = row.matches('a[href*="/c/"]') ? row : row.querySelector('a[href*="/c/"]');
    if (!link || !conversationId(link.getAttribute('href'))) return;
    const button = row.querySelector('button[aria-haspopup="menu"]');
    if (!button || button.matches(':disabled,[aria-disabled="true"]')) return;
    event.preventDefault(); event.stopPropagation();
    if (button.getAttribute('aria-expanded') === 'true') return;
    button.focus({ preventScroll: true });
    // Radix triggers open on primary pointerdown; click-only native triggers need click.
    button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, buttons: 1, pointerType: 'mouse', isPrimary: true }));
    button.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0, buttons: 0, pointerType: 'mouse', isPrimary: true }));
    if (button.getAttribute('aria-expanded') !== 'true') button.click();
  }
  function start() {
    const style = owned('style', 'style');
    style.textContent = [
      '[data-cst-sidebar]{--cst-tone-0:#15161a;--cst-tone-1:#3f4552;--cst-tone-2:#5b6372;--cst-tone-3:#6e7079;--cst-muted:var(--text-secondary,#62636b)}',
      ':is(.dark,[data-theme="dark"]) [data-cst-sidebar]{--cst-tone-0:#f5f5fa;--cst-tone-1:#d2d6e1;--cst-tone-2:#b1b7c5;--cst-tone-3:#9699a4;--cst-muted:var(--text-secondary,#b4b4bd)}',
      '[data-cst-list]{display:flex!important;flex-direction:column!important}',
      '[data-cst-list]>*{order:var(--cst-order,5000000)}',
      '[data-cst-list]>[data-cst-collapsed="true"],[data-cst-list]>[data-cst-owned="group"][hidden]{display:none!important}',
      '[data-cst-collected="true"]{display:none!important}',
      '[data-cst-shell]{position:relative}',
      '[data-cst-shell],[data-cst-sidebar] :is([data-sidebar-cycle-item],.sidebar-item):is([href*="/c/"],:has(a[href*="/c/"])){min-height:30px!important;height:30px!important}',
      '[data-cst-link]{display:flex!important;flex:1 1 0%!important;flex-direction:row!important;align-items:center!important;align-self:stretch;gap:10px;min-width:0!important;overflow:hidden}',
      '[data-cst-shell]:is(:hover,:focus-within,[aria-current="page"]) [data-cst-link]>.cst-time,[data-cst-link][aria-current="page"]>.cst-time{color:var(--cst-tone-0)!important}',
      '[data-cst-link]>:not(.cst-time){order:0!important;flex:1 1 0%!important;min-width:0!important;overflow:hidden!important;text-overflow:ellipsis;white-space:nowrap}',
      '[data-cst-link]>.cst-time{order:1!important;flex:0 0 auto!important;margin-inline-start:auto;text-align:end;color:var(--cst-recency-color,var(--cst-muted));font-size:11px;font-weight:var(--cst-recency-weight,400);line-height:20px;font-variant-numeric:tabular-nums;white-space:nowrap}',
      '.cst-group:not(.cst-native-heading){display:flex;align-items:center;gap:7px;min-height:28px;padding:0 9px;color:var(--cst-muted);box-sizing:border-box}',
      '.cst-group:not(.cst-native-heading) .cst-group-toggle{display:flex;align-items:center;gap:4px;flex:1;min-width:0;min-height:28px;padding:2px 0;border:0;border-radius:6px;background:transparent;color:inherit;font:inherit;font-weight:500;text-align:start;cursor:pointer}',
      '.cst-heading-actions{display:flex;align-items:center;gap:4px}',
      '.cst-group-toggle[aria-expanded="false"] .cst-native-disclosure{rotate:-90deg}',
      '.cst-group-toggle .cst-fallback-disclosure{width:12px;height:12px;flex:none}',
      '.cst-group-toggle[aria-expanded="true"] .cst-fallback-disclosure{transform:rotate(90deg)}',
      '.cst-group:not(.cst-native-heading) .cst-group-toggle:focus-visible{outline:2px solid var(--text-primary,currentColor);outline-offset:2px}',
      '.cst-group-count{margin-inline-start:auto;font-size:11px;font-variant-numeric:tabular-nums}',
      '.cst-collections{color:inherit;font:inherit}',
      ':is(.cst-collection-group .cst-collection-heading,.cst-group[data-group]) .cst-group-toggle>span{font-size:.875em}',
      '.cst-collections button,.cst-collection-editor button,.cst-collection-menu-action{cursor:pointer}',
      '.cst-collection-icon:not([data-size]){display:inline-flex;align-items:center;justify-content:center;flex:none;width:24px;height:24px}',
      '.cst-collection-icon:not([data-size]){border:0;background:transparent;padding:4px;border-radius:6px}',
      '.cst-collection-icon svg{width:16px;height:16px;flex:none}',
      '.cst-collection-row{position:relative;display:flex;align-items:center;min-height:30px}',
      '.cst-collection-native{flex:1;min-width:0}',
      '.cst-collection-native>:first-child{width:100%;box-sizing:border-box}',
      '.cst-collections p{margin:4px 9px 8px;color:var(--cst-muted);font-size:12px;line-height:1.5}',
      '.cst-collections [hidden]{display:none!important}',
      '.cst-collections button:not([data-size]):hover{background:var(--sidebar-surface-secondary,rgba(128,128,128,.12))}',
      '.cst-collection-row-actions{position:absolute;z-index:20;inset-inline-end:6px;display:flex;gap:2px;align-items:center;opacity:0;pointer-events:none;background:var(--sidebar-surface-primary,transparent)}',
      '.cst-collection-row:is(:hover,:focus-within)>.cst-collection-row-actions{opacity:1;pointer-events:auto}',
      '.cst-collection-row:is(:hover,:focus-within) [data-cst-link]{padding-inline-end:52px}',
      '.cst-collection-menu-action{display:flex;width:100%;border:0;background:transparent;padding:6px 10px;text-align:start;border-radius:12px;color:inherit}',
      '.cst-collection-menu-content{display:flex;align-items:center;gap:var(--spacing-menu-item-content,6px);width:100%;min-width:0}',
      '.cst-collection-menu-content svg{width:20px;height:20px;flex:none}',
      '.cst-collection-menu-content>span{flex:1;min-width:0;white-space:nowrap}',
      '.cst-collection-menu-action:is(:hover,:focus-visible){background:rgba(128,128,128,.15)}',
      '.cst-collection-editor{margin:4px 8px 8px 26px;min-width:0;color:inherit;font:inherit}',
      '[data-cst-drop-active="true"]{background:var(--sidebar-surface-secondary,rgba(128,128,128,.12));outline:1px solid var(--border-medium,#8a8a92);border-radius:8px}',
      '.cst-collection-drag{position:fixed;z-index:2147483647;pointer-events:none;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:7px 10px;border:1px solid var(--border-medium,#8a8a92);border-radius:8px;background:var(--main-surface-primary,#fff);color:var(--text-primary,#202123);box-shadow:0 5px 16px #0002}',
      ':is(.dark,[data-theme="dark"]) .cst-collection-drag{background:var(--main-surface-primary,#212121);color:var(--text-primary,#ececf1)}',
      '.cst-collection-input-row{display:flex;align-items:center;gap:4px;min-width:0}',
      '.cst-collection-input-row>label{flex:1;min-width:0}',
      '.cst-collection-editor input[type="text"]{box-sizing:border-box;width:100%;min-width:0;padding:5px 7px;border:1px solid var(--border-medium,#8a8a92);border-radius:6px;color:inherit;background:transparent;font:inherit}',
      '.cst-collection-choices{padding:0;border:0;min-width:0;max-height:240px;overflow:auto}',
      '.cst-collection-choices legend{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:8px;color:inherit}',
      '.cst-collection-choices label{display:flex;gap:6px;min-height:28px;align-items:center;overflow-wrap:anywhere}',
      '.cst-collection-choices input{width:16px;height:16px;flex:none;accent-color:var(--text-primary,#34343a)}',
      '.cst-collection-actions{display:flex;gap:2px;flex:none}',
      '.cst-collection-editor .cst-collection-delete{color:#b42318}',
      ':is(.dark,[data-theme="dark"]) .cst-collection-editor .cst-collection-delete{color:#ff9a91}',
      '.cst-collection-error{font-size:12px;line-height:1.5;color:inherit;overflow-wrap:anywhere}',
      '.cst-collection-error:empty{display:none}',
      '.cst-collection-icon:not([data-size]):focus-visible{outline:2px solid currentColor;outline-offset:2px}',
      '.cst-collections button:disabled,.cst-collection-editor button:disabled{opacity:.5;cursor:default}',
      '@media(pointer:coarse){.cst-collection-row-actions{opacity:1;pointer-events:auto}.cst-collection-row [data-cst-link]{padding-inline-end:52px}.cst-collection-row{min-height:36px}.cst-collection-editor input[type="text"]{font-size:16px}}',
      '@media(pointer:coarse){[data-cst-shell],[data-cst-sidebar] :is([data-sidebar-cycle-item],.sidebar-item):is([href*="/c/"],:has(a[href*="/c/"])){min-height:36px!important;height:36px!important}}',
    ].join('\n');
    (document.head || document.documentElement).append(style);
    observe(); schedule();
    document.addEventListener('contextmenu', openRowMenu);
    document.addEventListener('pointerdown', rememberMenuTarget, true);
    document.addEventListener('click', rememberMenuTarget, true);
    // Window capture receives the gesture before any document-level sidebar handlers.
    window.addEventListener('pointerdown', startCollectionDrag, true);
    window.addEventListener('pointermove', moveCollectionDrag, true);
    window.addEventListener('pointerup', finishCollectionDrag, true);
    window.addEventListener('pointercancel', event => {
      if (collectionDrag?.pointer === event.pointerId) cancelCollectionDrag();
    }, true);
    window.addEventListener('dragstart', event => {
      if (collectionDrag?.row.contains(event.target)) event.preventDefault();
    }, true);
    window.addEventListener('blur', cancelCollectionDrag);
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && collectionDrag) { event.preventDefault(); cancelCollectionDrag(); } }, true);
    window.addEventListener('click', event => {
      const suppressed = suppressCollectionClick;
      if (suppressed && Date.now() <= suppressed.until && (suppressed.row.contains(event.target) || suppressed.common === event.target)) {
        event.preventDefault(); event.stopImmediatePropagation(); suppressCollectionClick = null;
      }
    }, true);
    window.addEventListener('storage', event => { if (event.key === collectionKey()) { collectionSignature = ''; schedule(); } });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(); });
    // Local clock display only. No network work is scheduled here or anywhere in this script.
    setInterval(() => { if (!document.hidden) schedule(); }, 30000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();

/* # Third-party notices

Lucide 1.8.0 chevron-right icon
https://lucide.dev/

ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.


---

chevron-right is derived from Feather.

The MIT License (MIT)

Copyright (c) 2013-present Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
