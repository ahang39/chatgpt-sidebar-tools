const { test } = require('node:test');
const assert = require('node:assert/strict');
const { timestamp, normalize, groupFor, sorted, conversationId, relativeTime, sseParser, pinItems } = require('../chatgpt-sidebar-tools.user.js');

test('timestamps support seconds, milliseconds and ISO; unknown dates remain unknown', () => {
  const ms = Date.parse('2026-10-22T01:00:00Z');
  for (const value of [ms, ms / 1000, String(ms / 1000), '2026-10-22T01:00:00Z']) assert.equal(timestamp(value), ms);
  for (const value of [null, undefined, '', NaN, Infinity, 'invalid', -1, 0, 1e20]) assert.equal(timestamp(value), null);
});

test('calendar buckets do not overlap and handle exact midnight boundaries', () => {
  const now = new Date(2026, 9, 22, 15);
  assert.equal(groupFor(+new Date(2026, 9, 22), now), 0);
  assert.equal(groupFor(+new Date(2026, 9, 21, 23, 59, 59), now), 1);
  assert.equal(groupFor(+new Date(2026, 9, 21), now), 1);
  assert.equal(groupFor(+new Date(2026, 9, 20, 23, 59), now), 2);
  assert.equal(groupFor(+new Date(2026, 9, 16), now), 2);
  assert.equal(groupFor(+new Date(2026, 9, 15, 23, 59), now), 3);
  assert.equal(groupFor(null, now), 3);
});

test('calendar buckets survive DST and a year boundary', () => {
  const old = process.env.TZ; process.env.TZ = 'America/New_York';
  try {
    assert.equal(groupFor(+new Date(2026, 2, 8, 0), new Date(2026, 2, 9, 0, 15)), 1);
    assert.equal(groupFor(+new Date(2025, 11, 31, 23, 59), new Date(2026, 0, 1, 0, 15)), 1);
  } finally { if (old === undefined) delete process.env.TZ; else process.env.TZ = old; }
});

test('rename, duplicate titles and sorting keep identity and timestamps', () => {
  const rows = [
    normalize({ id: 'a', title: '相同标题', update_time: 2000 }),
    normalize({ id: 'b', title: '相同标题', update_time: 3000 }),
    normalize({ id: 'c', title: 'archived', update_time: 4000, is_archived: true }),
  ];
  const byId = new Map(rows.map(x => [x.id, x]));
  byId.set('a', normalize({ id: 'a', title: '重命名后的标题', update_time: 2000 }));
  assert.equal(byId.get('a').updated, 2000000);
  assert.deepEqual(sorted(byId.values()).map(x => x.id), ['b', 'a']);
});

test('invalid IDs cannot enter selectors or mutation URLs', () => {
  for (const id of ['a/b', 'x"]', 'a?b', '', '__'.repeat(80), null]) assert.equal(normalize({ id }), null);
  assert.equal(normalize({ conversation_id: 'valid-id_123' }).id, 'valid-id_123');
  assert.equal(conversationId('/g/g-p-abc/c/valid-id_123?x=1'), 'valid-id_123');
  assert.equal(conversationId('/share/abc'), null);
});

test('relative times use compact Chinese labels and handle boundaries and clock skew', () => {
  const now = Date.parse('2026-10-22T10:00:00Z');
  const cases = [[0, '刚刚'], [59, '刚刚'], [60, '1分钟前'], [3599, '59分钟前'], [3600, '1小时前'], [86399, '23小时前'], [86400, '1天前'], [2592000, '1个月前'], [31536000, '1年前']];
  for (const [seconds, label] of cases) assert.equal(relativeTime(now - seconds * 1000, now), label);
  assert.equal(relativeTime(now + 60000, now), '刚刚');
  assert.equal(relativeTime(null, now), '时间未知');
});

test('SSE parsing handles split CRLF, multiple data lines, markers and a final unterminated event', () => {
  const events = [], parser = sseParser(value => events.push(value));
  parser.push('event: message\r\ndata: {"conversation_id":"a",\r');
  parser.push('\ndata: "update_time":123}\r\n\r');
  parser.push('\n: heartbeat\n\ndata: [DONE]\n\ndata: "最后一条"');
  parser.finish();
  assert.deepEqual(events, ['{"conversation_id":"a",\n"update_time":123}', '[DONE]', '"最后一条"']);
});

test('oversized SSE frames are discarded until the next event without retaining their payload', () => {
  const events = [], parser = sseParser(value => events.push(value));
  parser.push('data: ' + 'x'.repeat(140000));
  parser.push('\ndata: same oversized event\n\ndata: {"conversation_id":"safe"}\n\n');
  parser.finish();
  assert.deepEqual(events, ['{"conversation_id":"safe"}']);
});

test('pins use conversation identity and timestamps, never pin creation time', () => {
  const row = { id: 'pin-entry', conversation_id: 'chat-id', update_time: 1800000000 };
  for (const data of [[row], { items: [row] }, { pins: [{ conversation: row }] }]) {
    assert.equal(pinItems(data)[0].id, 'chat-id');
    assert.equal(pinItems(data)[0].updated, 1800000000000);
  }
  assert.deepEqual(pinItems({ pins: [{ conversation_id: 'chat-id', created_at: '2026-10-24T01:00:00Z' }] }), []);
  assert.deepEqual(pinItems(null), []);
});

test('native typed pins read item.update_time, including archived conversations', () => {
  const item = { id: 'chat-id', title: '置顶示例', create_time: '2026-09-03T13:53:55.909964Z', update_time: '2026-10-24T01:52:19.381507Z', is_archived: true };
  const result = pinItems([{ item_type: 'conversation', item, pinned_at: '2026-10-23T03:10:46.349883Z' }]);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, item.id);
  assert.equal(result[0].updated, Date.parse(item.update_time));
  assert.equal(result[0].archived, true);
  assert.deepEqual(pinItems([{ item_type: 'project', item }, { item_type: 'conversation', item: null }]), []);
});
