const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const script = fs.readFileSync(path.join(__dirname, '../chatgpt-sidebar-tools.user.js'), 'utf8');
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

const fixture = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
body{margin:0;font-family:system-ui;color:#202123;background:#fff} aside{width:280px;height:100vh;overflow:auto;background:#f9f9f9}nav{padding:12px} .group\\/nav-section-title{padding:8px} [role=list]{display:flex;flex-direction:column} .sidebar-item{position:relative;padding:0 9px;height:36px;display:flex;align-items:center;gap:8px}a{color:inherit;text-decoration:none;flex:1;min-width:0}.native-title{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}button{font:inherit}main{position:absolute;left:320px;top:50px}.dark body{color:#ececf1;background:#212121}.dark aside{background:#171717}.dark button{color:inherit;background:transparent;border:0}.dark textarea{color:#ececf1;background:#303030}
</style></head><body><aside><nav aria-label="聊天记录">
<button id="new-chat">新聊天</button>
<section class="group/nav-section"><div class="group/nav-section-title"><button aria-expanded="true">置顶</button></div><div role="list"><div role="listitem"><div class="sidebar-item" data-sidebar-cycle-item><a href="/c/pinned"><span class="native-title">置顶示例</span></a><button aria-label="聊天操作">菜单</button></div></div></div></section>
<section class="group/nav-section"><div class="group/nav-section-title"><button aria-expanded="true">项目</button></div><div role="list"><div>项目示例</div></div></section>
<section class="group/nav-section"><div class="group/nav-section-title"><button aria-expanded="true">最近</button></div><div><div role="list" id="native-list">
<div role="listitem" id="native-a"><div class="sidebar-item" data-sidebar-cycle-item><a href="/c/a" aria-label="同名标题"><span class="native-title">同名标题</span></a><button aria-label="聊天操作" id="native-menu">菜单</button></div></div>
<div role="listitem" id="native-b"><div class="sidebar-item" data-sidebar-cycle-item><a href="/c/b" aria-label="同名标题"><span class="native-title">同名标题</span></a><button aria-label="聊天操作">菜单</button></div></div>
<div role="listitem" id="native-week"><div class="sidebar-item" data-sidebar-cycle-item><a href="/c/week"><span class="native-title">本周讨论</span></a></div></div>
<div role="listitem" id="native-old"><div class="sidebar-item" data-sidebar-cycle-item><a href="/c/old" aria-label="旧对话"><span class="native-title">旧对话</span></a></div></div>
<div id="sentinel"></div>
</div></div></section></nav></aside><main><h1>ChatGPT 侧边栏助手 · 测试预览</h1><p>所有会话和接口均为本地模拟数据。</p><textarea id="composer" placeholder="消息草稿"></textarea></main>
<script>document.querySelector('#native-menu').onclick=()=>document.body.dataset.nativeMenu='works';
</script>
</body></html>`;

function sample() {
  const now = new Date(); now.setHours(12, 30, 0, 0);
  const day = days => { const d = new Date(now); d.setDate(d.getDate() - days); return d.toISOString(); };
  return [
    { id: 'a', title: '同名标题', update_time: day(0) },
    { id: 'b', title: '同名标题', update_time: day(1) },
    { id: 'week', title: '本周讨论', update_time: day(3) },
    { id: 'old', title: '旧对话', update_time: day(20) },
    { id: 'pinned', title: '置顶示例', update_time: day(0), is_starred: true },
  ];
}

async function nativeList(page, { offset = 0, account = 'workspace-a', archived = false, suffix = '' } = {}) {
  return page.evaluate(async function(args) {
    const pending = fetch('/backend-api/conversations?offset=' + args.offset + '&limit=100&is_archived=' + args.archived + args.suffix, {
      headers: { 'chatgpt-account-id': args.account, 'X-Native-Fixture': 'yes' },
    });
    window.samePromise = pending === window.nativePending;
    const response = await pending;
    const data = await response.json();
    window.nativeResponse = data;
    return { status: response.status, data: data };
  }, { offset, account, archived, suffix });
}
async function setup({ items = sample(), nativeRequest = true, listStatus = 200, clock = false, lateInstall = false } = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Shanghai' });
  if (clock) await page.clock.install({ time: new Date() });
  const state = { items, listStatus, requests: [], details: {} }, errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: fixture });
    state.requests.push({ path: url.pathname, query: url.search, method: request.method(), native: request.headers()['x-native-fixture'] });
    if (url.pathname === '/backend-api/conversations') {
      const offset = Number(url.searchParams.get('offset') || 0);
      return route.fulfill({ status: state.listStatus, json: { items: state.items.slice(offset, offset + 100), total: state.items.length } });
    }
    const id = /^\/backend-api\/conversation\/([\w-]+)$/.exec(url.pathname)?.[1];
    if (id && state.details[id]) return route.fulfill({ json: state.details[id] });
    return route.fulfill({ status: 404, json: {} });
  });
  const hostTrace = "window.hostFetchCalls=0;const hostFetch=window.fetch;window.fetch=function(){window.hostFetchCalls++;if(window.fixtureChatResponse){const response=window.fixtureChatResponse;window.fixtureChatResponse=null;window.nativePending=Promise.resolve(response);}else window.nativePending=hostFetch.apply(this,arguments);return window.nativePending;};\n";
  await page.addInitScript({ content: hostTrace + (lateInstall ? '' : script) });
  await page.goto('https://chatgpt.com/');
  if (nativeRequest) state.response = await nativeList(page);
  if (lateInstall) await page.addScriptTag({ content: script });
  if (clock) await page.clock.runFor(300);
  if (nativeRequest && listStatus === 200 && items.length && !lateInstall) await page.waitForFunction(() => !!document.querySelector('.cst-time'));
  return { page, state, errors };
}
async function settle(page, clock = false) {
  if (clock) await page.clock.runFor(300);
  else await page.waitForTimeout(150);
}
function assertNativeOnly(state, count) {
  assert.equal(state.requests.length, count, JSON.stringify(state.requests));
  assert.ok(state.requests.every(r => r.native === 'yes' && r.path === '/backend-api/conversations' && r.method === 'GET'));
}

async function nativeChat(page, { path = '/backend-api/f/conversation', status = 200, key = 'chat' } = {}) {
  return page.evaluate(async options => {
    window.chatControllers ||= {}; window.chatBodies ||= {}; window.chatFinished ||= {};
    const stream = new ReadableStream({ start(controller) { window.chatControllers[options.key] = controller; } });
    window.fixtureChatResponse = new Response(stream, { status: options.status, headers: { 'content-type': 'text/event-stream' } });
    const pending = fetch(options.path, { method: 'POST', headers: { 'chatgpt-account-id': 'workspace-a', 'X-Native-Fixture': 'yes' }, body: '{"native":"fixture"}' });
    window.sameChatPromise = pending === window.nativePending;
    window.chatBodies[options.key] = pending.then(response => response.text()).then(text => { window.chatFinished[options.key] = true; return text; });
    return (await pending).status;
  }, { path, status, key });
}
async function feedChat(page, text, { key = 'chat', close = false, splitBytes = false } = {}) {
  await page.evaluate(options => {
    const controller = window.chatControllers[options.key], bytes = new TextEncoder().encode(options.text);
    if (options.splitBytes) for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
    else controller.enqueue(bytes);
    if (options.close) controller.close();
  }, { text, key, close, splitBytes });
}

test('right-click opens each sidebar conversation native menu without navigation or added requests', async () => {
  const { page, state, errors } = await setup({ nativeRequest: false });
  try {
    await page.evaluate(() => {
      for (const row of document.querySelectorAll('[data-sidebar-cycle-item]')) {
        const button = row.querySelector('button');
        if (!button) continue;
        button.setAttribute('aria-haspopup', 'menu'); button.setAttribute('aria-expanded', 'false');
        const open = event => {
          if (event.type === 'pointerdown' && event.button !== 0) return;
          button.setAttribute('aria-expanded', 'true');
          document.body.dataset.menuFor = row.querySelector('a').getAttribute('href');
          document.body.dataset.opens = String(Number(document.body.dataset.opens || 0) + 1);
        };
        button.onclick = row.querySelector('a').getAttribute('href') === '/c/pinned' ? open : null;
        if (!button.onclick) button.addEventListener('pointerdown', open);
      }
    });
    await page.locator('#native-a .native-title').click({ button: 'right' });
    assert.equal(await page.locator('body').getAttribute('data-menu-for'), '/c/a');
    assert.equal(await page.locator('body').getAttribute('data-opens'), '1');
    await page.locator('#native-a a').click({ button: 'right' });
    assert.equal(await page.locator('body').getAttribute('data-opens'), '1', 'an open menu must not toggle closed');
    await page.locator('a[href="/c/pinned"] .native-title').click({ button: 'right' });
    assert.equal(await page.locator('body').getAttribute('data-menu-for'), '/c/pinned');
    assert.equal(await page.locator('body').getAttribute('data-opens'), '2');
    assert.equal(page.url(), 'https://chatgpt.com/');
    assert.equal(await page.evaluate(() => window.hostFetchCalls), 0);
    assert.deepEqual(state.requests, []);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('right-click elsewhere, editable rows and unavailable menu buttons keep browser defaults', async () => {
  const { page, state } = await setup();
  try {
    const results = await page.evaluate(() => {
      const button = document.querySelector('#native-menu');
      button.setAttribute('aria-haspopup', 'menu');
      const input = document.createElement('input'); document.querySelector('#native-a a').append(input);
      const outside = document.createElement('div'); outside.className = 'sidebar-item';
      outside.innerHTML = '<a href="/c/body-chat">正文链接</a><button aria-haspopup="menu">菜单</button>';
      document.querySelector('main').append(outside);
      const menu = document.createElement('div'); menu.setAttribute('role', 'menu'); document.body.append(menu);
      const dispatch = target => target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));
      const untouched = ['#composer', 'main h1', '#new-chat', '.cst-group-toggle', 'nav section:nth-of-type(2)', '#native-week a'].map(selector => dispatch(document.querySelector(selector)));
      untouched.push(dispatch(input), dispatch(outside.querySelector('a')), dispatch(menu));
      button.disabled = true; untouched.push(dispatch(document.querySelector('#native-a a')));
      button.disabled = false; button.setAttribute('aria-disabled', 'true'); untouched.push(dispatch(document.querySelector('#native-a a')));
      button.removeAttribute('aria-disabled');
      const prevented = new MouseEvent('contextmenu', { bubbles: true, cancelable: true }); prevented.preventDefault();
      document.querySelector('#native-a a').dispatchEvent(prevented);
      return { untouched, menuOpened: document.body.dataset.nativeMenu };
    });
    assert.ok(results.untouched.every(Boolean), 'unrelated context menus must not be cancelled');
    assert.equal(results.menuOpened, undefined);
    assertNativeOnly(state, 1);
  } finally { await page.close(); }
});

test('an ongoing native chat stream updates the old row immediately without another list request', async () => {
  const { page, state, errors } = await setup();
  try {
    const ms = Math.floor(Date.now() / 1000) * 1000;
    const frame = 'data: ' + JSON.stringify({ conversation_id: 'old', message: { id: 'reply', author: { role: 'assistant' }, create_time: ms / 1000, update_time: null, content: { parts: ['原生回复'] } } }) + '\r\n\r\n';
    assert.equal(await nativeChat(page, { path: '/backend-api/conversation' }), 200);
    await feedChat(page, frame, { splitBytes: true });
    await page.waitForFunction(expected => document.querySelector('#native-old time')?.getAttribute('datetime') === expected, new Date(ms).toISOString());
    assert.equal(await page.locator('#native-old .cst-time').textContent(), '刚刚');
    assert.equal(await page.locator('#native-old').isVisible(), true);
    assert.equal(await page.locator('.cst-group[data-group="3"]').isVisible(), false);
    assert.equal(await page.evaluate(() => !!window.chatFinished.chat), false, 'timestamps must update before the response finishes');
    assert.equal(await page.evaluate(() => window.sameChatPromise), true);
    await feedChat(page, 'data: [DONE]\n\n', { close: true });
    assert.equal(await page.evaluate(() => window.chatBodies.chat), frame + 'data: [DONE]\n\n');
    assert.equal(await page.evaluate(() => window.hostFetchCalls), 2);
    assertNativeOnly(state, 1);
    await nativeList(page); await settle(page);
    assert.equal(await page.locator('#native-old time').getAttribute('datetime'), new Date(ms).toISOString(), 'a stale list response must not undo live activity');
    assertNativeOnly(state, 2);
    assert.equal(await page.evaluate(() => window.hostFetchCalls), 3);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('delta-encoded native replies and timestamp patches update only their own conversation', async () => {
  const { page, state } = await setup();
  try {
    const beforeA = await page.locator('#native-a time').getAttribute('datetime');
    const start = Math.floor(Date.now() / 1000) - 60, end = start + 50;
    await nativeChat(page);
    const frames = [
      'event: delta_encoding\ndata: "v1"\n\n',
      'data: ' + JSON.stringify({ p: '', o: 'add', v: { conversation_id: 'b', message: { id: 'reply-b', author: { role: 'assistant' }, create_time: start } } }) + '\n\n',
      'data: ' + JSON.stringify({ o: 'patch', v: [{ p: '/message/update_time', o: 'replace', v: end }] }) + '\n\n',
      'data: {malformed}\n\ndata: ' + JSON.stringify({ p: '/message/content/parts/0', o: 'append', v: '更多回复' }) + '\n\n',
      'data: ' + JSON.stringify({ type: 'message_stream_complete', conversation_id: 'b' }) + '\n\ndata: [DONE]\n\n',
    ].join('');
    await feedChat(page, frames, { close: true });
    await page.waitForFunction(expected => document.querySelector('#native-b time')?.getAttribute('datetime') === expected, new Date(end * 1000).toISOString());
    assert.equal(await page.locator('#native-a time').getAttribute('datetime'), beforeA);
    assert.equal(await page.evaluate(() => window.chatBodies.chat), frames);
    assert.equal(await page.evaluate(() => window.hostFetchCalls), 2);
    assertNativeOnly(state, 1);
  } finally { await page.close(); }
});

test('replies without server timestamps use an explicitly labelled local receipt time', async () => {
  const { page, state } = await setup();
  try {
    await nativeChat(page);
    const frame = 'data: ' + JSON.stringify({ conversation_id: 'old', message: { id: 'no-time', author: { role: 'assistant' }, create_time: null, update_time: null } }) + '\n\n';
    await feedChat(page, frame + 'data: [DONE]\n\n', { close: true });
    await page.waitForFunction(() => document.querySelector('#native-old time')?.getAttribute('title').startsWith('本页收到回复的时间'));
    assert.equal(await page.locator('#native-old .cst-time').textContent(), '刚刚');
    assert.ok(Math.abs(Date.now() - Date.parse(await page.locator('#native-old time').getAttribute('datetime'))) < 5000);
    assert.equal(await page.evaluate(() => window.hostFetchCalls), 2);
    assertNativeOnly(state, 1);
  } finally { await page.close(); }
});

test('existing native detail responses update timestamps without treating opening a chat as new activity', async () => {
  const { page, state } = await setup();
  try {
    const ms = Date.now() - 300000;
    state.details.old = { conversation_id: 'old', update_time: new Date(ms).toISOString(), mapping: {} };
    const result = await page.evaluate(async () => (await fetch('/backend-api/conversation/old', { headers: { 'chatgpt-account-id': 'workspace-a', 'X-Native-Fixture': 'yes' } })).json());
    assert.equal(result.update_time, new Date(ms).toISOString());
    await page.waitForFunction(expected => document.querySelector('#native-old time')?.getAttribute('datetime') === expected, new Date(ms).toISOString());
    assert.equal((await page.locator('#native-old time').getAttribute('title')).startsWith('对话时间'), true);
    assert.equal(state.requests.length, 2);
    assert.deepEqual(state.requests.map(x => x.path), ['/backend-api/conversations', '/backend-api/conversation/old']);
    assert.equal(await page.evaluate(() => window.hostFetchCalls), 2);
  } finally { await page.close(); }
});

test('failed native chat requests and error events cannot mark a conversation as recently updated', async () => {
  for (const status of [429, 200]) {
    const { page, state } = await setup();
    try {
      const before = await page.locator('#native-old time').getAttribute('datetime');
      assert.equal(await nativeChat(page, { status }), status);
      const frames = 'data: ' + JSON.stringify({ conversation_id: 'old', error: { message: 'fixture failure' } }) + '\n\ndata: ' + JSON.stringify({ type: 'message_stream_complete', conversation_id: 'old' }) + '\n\ndata: [DONE]\n\n';
      await feedChat(page, frames, { close: true });
      assert.equal(await page.evaluate(() => window.chatBodies.chat), frames);
      await settle(page);
      assert.equal(await page.locator('#native-old time').getAttribute('datetime'), before);
      assert.equal(await page.evaluate(() => window.hostFetchCalls), 2);
      assertNativeOnly(state, 1);
    } finally { await page.close(); }
  }
});

test('a new native conversation learns its ID from the reply rather than the currently open URL', async () => {
  const { page, state } = await setup();
  try {
    await nativeChat(page);
    const ms = Math.floor(Date.now() / 1000) * 1000;
    const frames = 'data: ' + JSON.stringify({ conversation_id: 'new-chat-id', message: { id: 'new-reply', author: { role: 'assistant' }, create_time: ms / 1000 } }) + '\n\ndata: [DONE]\n\n';
    await feedChat(page, frames, { close: true });
    await page.evaluate(() => {
      const row = document.createElement('div'); row.id = 'native-new-chat';
      row.innerHTML = '<div class="sidebar-item"><a href="/c/new-chat-id">新对话</a></div>';
      document.querySelector('#native-list').append(row);
    });
    await page.waitForFunction(expected => document.querySelector('#native-new-chat time')?.getAttribute('datetime') === expected, new Date(ms).toISOString());
    assert.equal(await page.evaluate(() => window.hostFetchCalls), 2);
    assertNativeOnly(state, 1);
    assert.equal(await page.locator('[data-cst-owned="row"]').count(), 0);
  } finally { await page.close(); }
});

test('switching workspace detaches the passive stream reader without cancelling the original response', async () => {
  const { page, state, errors } = await setup();
  try {
    await nativeChat(page);
    const first = 'data: ' + JSON.stringify({ conversation_id: 'old', message: { id: 'old-scope', author: { role: 'assistant' }, create_time: Date.now() / 1000 } }) + '\n\n';
    await feedChat(page, first);
    await page.waitForFunction(() => document.querySelector('#native-old .cst-time')?.textContent === '刚刚');
    await nativeList(page, { account: 'workspace-b' }); await settle(page);
    const before = await page.locator('#native-old time').getAttribute('datetime');
    const tail = 'data: ' + JSON.stringify({ p: '/message/update_time', o: 'replace', v: Date.now() / 1000 + 100 }) + '\n\ndata: [DONE]\n\n';
    await feedChat(page, tail, { close: true });
    assert.equal(await page.evaluate(() => window.chatBodies.chat), first + tail);
    await settle(page);
    assert.equal(await page.locator('#native-old time').getAttribute('datetime'), before);
    assert.equal(await page.evaluate(() => window.hostFetchCalls), 3);
    assertNativeOnly(state, 2);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('no native list request means zero script requests, even after an hour and page events', async () => {
  const { page, state, errors } = await setup({ nativeRequest: false, clock: true });
  try {
    await page.clock.fastForward(3600000); await settle(page, true);
    await page.evaluate(() => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('online'));
      window.dispatchEvent(new PopStateEvent('popstate'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await settle(page, true);
    assert.equal(await page.evaluate(() => window.hostFetchCalls), 0);
    assertNativeOnly(state, 0);
    assert.equal(await page.locator('.cst-time, .cst-group, .cst-tools, .cst-check, .cst-status, .cst-more, .cst-dialog').count(), 0);
    assert.equal(await page.locator('#native-a').isVisible(), true);
    assert.equal(await page.locator('#native-old').isVisible(), true);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('native pins responses annotate pinned chats even when Recents is absent, with no added requests', async () => {
  const { page, state, errors } = await setup({ nativeRequest: false });
  try {
    const ms = Date.now() - 3600000;
    await page.route('**/backend-api/pins', route => route.fulfill({ json: [{ item_type: 'conversation', item: { id: 'pinned', title: '置顶示例', create_time: '2026-09-03T13:53:55.909964Z', update_time: new Date(ms).toISOString(), is_archived: true, is_starred: true }, pinned_at: '2026-10-23T03:10:46.349883Z' }] }));
    await page.evaluate(() => document.querySelector('#native-list').closest('section').remove());
    await page.evaluate(async () => (await fetch('/backend-api/pins', { headers: { 'chatgpt-account-id': 'workspace-a' } })).json());
    const pin = page.locator('a[href="/c/pinned"]');
    await page.waitForFunction(() => !!document.querySelector('a[href="/c/pinned"] .cst-time'));
    assert.equal(await pin.locator('time').getAttribute('datetime'), new Date(ms).toISOString());
    assert.equal(await pin.locator('time').textContent(), '1小时前');
    assert.equal(await page.evaluate(() => window.hostFetchCalls), 1);
    assert.equal(state.requests.length, 0);
    assert.equal(await page.locator('.cst-tools, .cst-group').count(), 0);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('a single native response supplies relative times, nonempty groups and native menus without extra traffic', async () => {
  const items = sample(); items[0].update_time = new Date(Date.now() - 3600000).toISOString();
  const { page, state, errors } = await setup({ items, clock: true });
  try {
    assertNativeOnly(state, 1);
    assert.equal(await page.evaluate(() => window.samePromise), true);
    assert.deepEqual(await page.evaluate(() => window.nativeResponse.items.map(x => x.id)), items.map(x => x.id));
    assert.deepEqual(await page.locator('.cst-group-count').allTextContents(), ['1', '1', '1', '1']);
    assert.equal(await page.locator('#native-a .cst-time').textContent(), '1小时前');
    assert.notEqual(await page.locator('#native-a time').getAttribute('datetime'), await page.locator('#native-b time').getAttribute('datetime'));
    await page.locator('#native-menu').click();
    assert.equal(await page.locator('body').getAttribute('data-native-menu'), 'works');
    assert.equal(await page.locator('#native-a').evaluate(n => n.parentElement.id), 'native-list');
    assert.equal(await page.locator('input, .cst-tools, .cst-status, .cst-dialog, .cst-more, [data-cst-owned="row"]').count(), 0);
    assert.equal(await page.locator('#native-old').isVisible(), false);
    await page.clock.fastForward(3600000); await settle(page, true);
    assert.equal(await page.locator('#native-a .cst-time').textContent(), '2小时前');
    assertNativeOnly(state, 1);
    assert.equal(await page.evaluate(() => window.hostFetchCalls), 1);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('a native 429 stays unchanged and never triggers a retry, login probe or cooldown toolbar', async () => {
  const { page, state, errors } = await setup({ listStatus: 429, clock: true });
  try {
    assertNativeOnly(state, 1);
    assert.equal(state.response.status, 429);
    assert.equal(await page.evaluate(() => window.nativeResponse.items.length), state.items.length);
    await page.clock.fastForward(7200000); await settle(page, true);
    assertNativeOnly(state, 1);
    assert.equal(await page.evaluate(() => window.hostFetchCalls), 1);
    assert.equal(await page.locator('[data-cst-owned="group"], .cst-time, .cst-tools, .cst-status').count(), 0);
    assert.equal(await page.locator('#native-old').isVisible(), true);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('late installation leaves cached rows alone until ChatGPT itself supplies metadata', async () => {
  const { page, state } = await setup({ lateInstall: true, clock: true });
  try {
    await page.clock.fastForward(3600000); await settle(page, true);
    assertNativeOnly(state, 1);
    assert.equal(await page.locator('.cst-time, .cst-group').count(), 0);
    await nativeList(page); await settle(page, true);
    assertNativeOnly(state, 2);
    assert.equal(await page.locator('#native-a .cst-time').count(), 1);
  } finally { await page.close(); }
});

test('group collapse preferences survive reload and hidden empty groups without a settings panel', async () => {
  const { page, state } = await setup();
  try {
    for (let i = 0; i < 4; i++) await page.locator('.cst-group[data-group="' + i + '"] button').click();
    await settle(page);
    const expected = ['false', 'false', 'false', 'true'];
    assert.deepEqual(await page.locator('.cst-group-toggle').evaluateAll(nodes => nodes.map(n => n.getAttribute('aria-expanded'))), expected);
    assertNativeOnly(state, 1);
    await page.reload(); await settle(page);
    assertNativeOnly(state, 1, 'page reload alone must not fetch metadata');
    await nativeList(page);
    await page.waitForFunction(() => document.querySelectorAll('.cst-group').length === 4);
    assert.deepEqual(await page.locator('.cst-group-toggle').evaluateAll(nodes => nodes.map(n => n.getAttribute('aria-expanded'))), expected);
    await page.evaluate(() => document.querySelector('#native-b').remove());
    await settle(page);
    assert.equal(await page.locator('.cst-group[data-group="1"]').isVisible(), false);
    await page.evaluate(() => {
      const row = document.createElement('div'); row.id = 'native-b';
      row.innerHTML = '<div class="sidebar-item"><a href="/c/b"><span class="native-title">同名标题</span></a></div>';
      document.querySelector('#native-list').append(row);
    });
    await settle(page);
    assert.equal(await page.locator('.cst-group[data-group="1"]').isVisible(), true);
    assert.equal(await page.locator('.cst-group[data-group="1"] button').getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator('#native-b').isVisible(), false);
    assertNativeOnly(state, 2);
  } finally { await page.close(); }
});

test('rename and native node recycling cannot attach another conversation timestamp', async () => {
  const { page, state } = await setup();
  try {
    const original = await page.locator('#native-a time').getAttribute('datetime');
    await page.evaluate(() => { document.querySelector('#native-a .native-title').textContent = '改名后的对话'; });
    await settle(page);
    assert.equal(await page.locator('#native-a time').getAttribute('datetime'), original);
    await page.evaluate(() => { document.querySelector('#native-a a').href = '/c/recycled'; });
    await settle(page);
    assert.equal(await page.locator('#native-a .cst-time').count(), 0);
    const updated = new Date(Date.now() - 7200000).toISOString();
    state.items = [{ id: 'recycled', title: '另一个对话', update_time: updated }, ...state.items];
    await nativeList(page);
    await page.waitForFunction(() => !!document.querySelector('#native-a .cst-time'));
    assert.equal(await page.locator('#native-a time').getAttribute('datetime'), updated);
    assertNativeOnly(state, 2);
  } finally { await page.close(); }
});

test('native pagination only annotates rows the host renders and never creates or requests another page', async () => {
  const items = [...sample(), ...Array.from({ length: 200 }, (_, i) => ({ id: 'older-' + i, title: '旧对话 ' + i, update_time: new Date(Date.now() - 30 * 86400000).toISOString() }))];
  const { page, state } = await setup({ items, clock: true });
  try {
    assertNativeOnly(state, 1);
    assert.equal(await page.locator('[data-cst-owned="row"]').count(), 0);
    const result = await nativeList(page, { offset: 100 });
    assert.equal(result.data.items.length, 100);
    const item = result.data.items[0];
    await page.evaluate(function(item) {
      const row = document.createElement('div'); row.id = 'native-page-two';
      const shell = document.createElement('div'); shell.className = 'sidebar-item';
      const link = document.createElement('a'); link.href = '/c/' + item.id; link.textContent = item.title;
      shell.append(link); row.append(shell); document.querySelector('#native-list').append(row);
    }, item);
    await settle(page, true);
    assert.equal(await page.locator('#native-page-two .cst-time').count(), 1);
    await page.clock.fastForward(3600000); await settle(page, true);
    assertNativeOnly(state, 2);
    assert.deepEqual(state.requests.map(x => new URLSearchParams(x.query).get('offset')), ['0', '100']);
  } finally { await page.close(); }
});

test('archived list responses are forwarded but cannot overwrite visible conversation times', async () => {
  const { page, state } = await setup();
  try {
    const before = await page.locator('#native-a time').getAttribute('datetime');
    state.items = [{ id: 'a', update_time: '2020-01-01T00:00:00Z' }];
    await nativeList(page, { archived: true }); await settle(page);
    assert.equal(await page.locator('#native-a time').getAttribute('datetime'), before);
    assertNativeOnly(state, 2);
  } finally { await page.close(); }
});

test('workspace switches ignore late metadata from an earlier native request', async () => {
  const { page, state, errors } = await setup();
  try {
    let release; const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/backend-api/conversations?*stale=1*', async route => {
      await gate;
      await route.fulfill({ json: { items: [{ id: 'b', update_time: '2020-01-01T00:00:00Z' }] } });
    });
    const observed = page.waitForRequest('**/*stale=1*');
    await page.evaluate(() => { window.pendingStale = fetch('/backend-api/conversations?offset=0&stale=1', { headers: { 'chatgpt-account-id': 'workspace-a' } }); });
    await observed;
    state.items.find(x => x.id === 'b').update_time = new Date(Date.now() - 3600000).toISOString();
    await nativeList(page, { account: 'workspace-b' }); await settle(page);
    const fresh = await page.locator('#native-b time').getAttribute('datetime');
    release(); await page.evaluate(() => window.pendingStale); await settle(page);
    assert.equal(await page.locator('#native-b time').getAttribute('datetime'), fresh);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('an empty native sidebar has no empty headers, notices, buttons or active requests', async () => {
  const { page, state } = await setup({ items: [], nativeRequest: false, clock: true });
  try {
    await page.evaluate(() => { document.querySelector('#native-list').replaceChildren(); });
    await nativeList(page); await settle(page, true);
    await page.clock.fastForward(3600000); await settle(page, true);
    assert.equal(await page.locator('.cst-group, .cst-time, .cst-tools, .cst-status').count(), 0);
    assertNativeOnly(state, 1);
  } finally { await page.close(); }
});

test('time stays right-aligned after native title replacement in recent and pinned rows', async () => {
  const { page, state, errors } = await setup();
  try {
    await page.evaluate(() => {
      for (const link of document.querySelectorAll('#native-a a, a[href="/c/pinned"]')) {
        const title = link.querySelector('.native-title');
        const replacement = title.cloneNode(true); replacement.textContent = '原生重新生成的长标题';
        title.remove(); link.append(replacement);
      }
    });
    await settle(page);
    for (const selector of ['#native-a a', 'a[href="/c/pinned"]']) {
      const aligned = await page.locator(selector).evaluate(link => {
        const title = link.querySelector('.native-title').getBoundingClientRect(), timeNode = link.querySelector('.cst-time'), time = timeNode.getBoundingClientRect();
        return title.right <= time.left && Math.abs((title.top + title.height / 2) - (time.top + time.height / 2)) < 1 && getComputedStyle(timeNode).textAlign === 'end';
      });
      assert.equal(aligned, true);
    }
    assert.equal(await page.locator('#native-a .sidebar-item').evaluate(n => n.getBoundingClientRect().height), 32);
    if (process.env.SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true });
      await page.locator('aside').screenshot({ path: path.join(process.env.SCREENSHOT_DIR, 'sidebar-passive-light.png') });
      await page.evaluate(() => document.documentElement.classList.add('dark'));
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator('aside').screenshot({ path: path.join(process.env.SCREENSHOT_DIR, 'sidebar-passive-dark.png') });
    }
    assertNativeOnly(state, 1);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
