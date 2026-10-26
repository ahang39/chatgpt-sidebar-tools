// ==UserScript==
// @name         ChatGPT 原生侧边栏助手
// @namespace    local.chatgpt.sidebar-tools
// @version      2.2.0
// @description  原生对话相对时间、可折叠分组与右键菜单快捷操作；不主动发起任何网络请求。
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
    if (typeof module !== 'undefined') module.exports = { timestamp, normalize, groupFor, sorted, conversationId, relativeTime, sseParser, pinItems };
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

  function workspace() {
    return document.cookie.split(';').map(x => x.trim()).find(x => x.startsWith('_account=')) || '';
  }
  function updateScope(nextAccount = '') {
    const nextCookie = workspace();
    if (nextCookie !== cookie || (nextAccount && nextAccount !== account)) {
      cookie = nextCookie; account = nextAccount; generation++; records.clear(); activity.clear();
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
  function findList() {
    for (const section of document.querySelectorAll('nav [class~="group/nav-section"]')) {
      const heading = section.firstElementChild;
      if (!heading?.classList.contains('group/nav-section-title')) continue;
      if (!/^(最近|近期|聊天|聊天记录|Recent|Recents|Chats|Your chats|Chat history|History)$/i.test(heading.querySelector('button[aria-expanded]')?.textContent.trim() || '')) continue;
      const list = section.querySelector('[role="list"]');
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
    for (const node of document.querySelectorAll('[data-cst-owned="group"], [data-cst-owned="time"]')) node.remove();
    for (const node of document.querySelectorAll('[data-cst-list], [data-cst-link], [data-cst-shell], [data-cst-row], [data-cst-collapsed], [data-cst-sidebar]')) {
      for (const name of ['data-cst-list', 'data-cst-link', 'data-cst-shell', 'data-cst-row', 'data-cst-collapsed', 'data-cst-sidebar']) node.removeAttribute(name);
      node.style.removeProperty('--cst-order');
    }
  }
  function dateFor(row) {
    const item = records.get(row.id);
    return Math.max(item?.updated ?? item?.created ?? 0, activity.get(row.id)?.updated || 0) || null;
  }
  function decorate(row, ms) {
    attr(row.wrapper, 'data-cst-row', row.id); attr(row.shell, 'data-cst-shell', ''); attr(row.link, 'data-cst-link', '');
    let time = row.link.querySelector(':scope > [data-cst-owned="time"]');
    if (!ms) { time?.remove(); return; }
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
  function group(list, index, count) {
    let header = list.querySelector(':scope > [data-cst-owned="group"][data-group="' + index + '"]');
    if (!header) {
      header = owned(/^(UL|OL)$/.test(list.tagName) ? 'li' : 'div', 'group');
      header.className = 'cst-group'; header.dataset.group = index; header.setAttribute('role', 'listitem');
      const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'cst-group-toggle';
      const label = document.createElement('span'); label.textContent = GROUPS[index];
      toggle.append(chevron(), label);
      toggle.addEventListener('click', () => {
        collapsed[index] = !collapsed[index];
        try { localStorage.setItem(PREF_KEY, JSON.stringify({ collapsed })); } catch { /* The current page still remembers. */ }
        schedule();
      });
      const counter = document.createElement('span'); counter.className = 'cst-group-count';
      header.append(toggle, counter); list.append(header);
    }
    header.hidden = count === 0; header.style.setProperty('--cst-order', index * 1000000);
    const toggle = header.querySelector('button');
    attr(toggle, 'aria-expanded', !collapsed[index]);
    attr(toggle, 'aria-label', (collapsed[index] ? '展开' : '折叠') + GROUPS[index] + '，' + count + ' 个对话');
    setText(header.querySelector('.cst-group-count'), String(count));
  }
  function paint() {
    timer = null; updateScope();
    observer.disconnect();
    try {
      const list = findList();
      if (list !== currentList) { clear(); currentList = list; }
      const nav = list?.closest('nav') || list?.closest('aside') || document.querySelector('nav a[href*="/c/"]')?.closest('nav');
      if (nav) attr(nav, 'data-cst-sidebar', '');
      if (list) {
      const nativeRows = rows(list), dates = new Map(nativeRows.map(row => [row.id, dateFor(row)]));
      const ready = nativeRows.some(row => !!dates.get(row.id));
      if (ready) {
        attr(list, 'data-cst-list', '');
        const ordered = sorted(nativeRows.map(row => ({ id: row.id, updated: dates.get(row.id), archived: false })));
        const rank = new Map(ordered.map((item, i) => [item.id, i]));
        const counts = GROUPS.map((_, i) => nativeRows.filter(row => groupFor(dates.get(row.id)) === i).length);
        for (let i = 0; i < GROUPS.length; i++) group(list, i, counts[i]);
        for (const row of nativeRows) {
          const ms = dates.get(row.id), index = groupFor(ms);
          decorate(row, ms);
          row.wrapper.style.setProperty('--cst-order', index * 1000000 + rank.get(row.id) + 1);
          attr(row.wrapper, 'data-cst-collapsed', collapsed[index]);
        }
      } else {
        for (const header of list.querySelectorAll(':scope > [data-cst-owned="group"]')) header.remove();
        list.removeAttribute('data-cst-list');
        for (const row of nativeRows) {
          decorate(row, null);
          row.wrapper.style.removeProperty('--cst-order'); row.wrapper.removeAttribute('data-cst-collapsed');
        }
      }
      }
      // Pinned timestamps also work when Recents is collapsed or absent.
      if (nav) for (const link of nav.querySelectorAll('a[href*="/c/"]')) {
        if (list?.contains(link)) continue;
        const id = conversationId(link.getAttribute('href'));
        const shell = link.closest('[data-sidebar-cycle-item], .sidebar-item, [data-testid^="history-item-"]') || link;
        if (id && shell) { const row = { id, link, shell, wrapper: shell }; decorate(row, dateFor(row)); }
      }
    } finally { observe(); }
  }
  const observer = new MutationObserver(mutations => {
    const relevant = mutations.some(m => {
      const node = m.target.nodeType === 1 ? m.target : m.target.parentElement;
      return !node?.closest('[data-cst-owned]') && (node?.closest('aside, nav, #history') ||
        [...m.addedNodes].some(n => n.nodeType === 1 && (n.matches('aside,nav,#history') || n.querySelector('aside,nav,#history'))));
    });
    if (relevant) schedule();
  });
  function observe() { observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['href', 'aria-label', 'aria-expanded', 'datetime'] }); }
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
      '[data-cst-sidebar]{--cst-muted:var(--text-secondary,#62636b)}',
      ':is(.dark,[data-theme="dark"]) [data-cst-sidebar]{--cst-muted:var(--text-secondary,#b4b4bd)}',
      '[data-cst-list]{display:flex!important;flex-direction:column!important}',
      '[data-cst-list]>*{order:var(--cst-order,5000000)}',
      '[data-cst-list]>[data-cst-collapsed="true"],[data-cst-list]>[data-cst-owned="group"][hidden]{display:none!important}',
      '[data-cst-shell]{position:relative}',
      '[data-cst-shell],[data-cst-sidebar] :is([data-sidebar-cycle-item],.sidebar-item):is([href*="/c/"],:has(a[href*="/c/"])){min-height:32px!important;height:32px!important}',
      '[data-cst-link]{display:flex!important;flex:1 1 0%!important;flex-direction:row!important;align-items:center!important;align-self:stretch;gap:10px;min-width:0!important;overflow:hidden}',
      '[data-cst-link]>:not(.cst-time){order:0!important;flex:1 1 0%!important;min-width:0!important;overflow:hidden!important;text-overflow:ellipsis;white-space:nowrap}',
      '[data-cst-link]>.cst-time{order:1!important;flex:0 0 auto!important;margin-inline-start:auto;text-align:end;color:var(--cst-muted);font-size:11px;font-weight:400;line-height:20px;font-variant-numeric:tabular-nums;white-space:nowrap}',
      '.cst-group{display:flex;align-items:center;gap:7px;min-height:28px;margin-top:6px;padding:0 9px;color:var(--cst-muted);font:inherit;font-size:12px}',
      '.cst-group-toggle{display:flex;align-items:center;gap:6px;flex:1;min-width:0;min-height:28px;padding:4px 0;border:0;background:transparent;color:inherit;font:inherit;font-weight:500;text-align:start;cursor:pointer}',
      '.cst-group-toggle svg{width:12px;height:12px;flex:none}',
      '.cst-group-toggle[aria-expanded="true"] svg{transform:rotate(90deg)}',
      '.cst-group-toggle:focus-visible{outline:2px solid var(--text-primary,currentColor);outline-offset:2px;border-radius:4px}',
      '.cst-group-count{margin-inline-start:auto;font-size:11px;font-variant-numeric:tabular-nums}',
      '@media(pointer:coarse){[data-cst-shell],[data-cst-sidebar] :is([data-sidebar-cycle-item],.sidebar-item):is([href*="/c/"],:has(a[href*="/c/"])){min-height:36px!important;height:36px!important}}',
    ].join('\n');
    (document.head || document.documentElement).append(style);
    observe(); schedule();
    document.addEventListener('contextmenu', openRowMenu);
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
