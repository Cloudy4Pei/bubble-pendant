// npm test  (node --test test/values.test.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const BP = require('../bubble-pendant.js');

const at = (month, day, hour) => new Date(2026, month - 1, day, hour, 0, 0);

test('normalize: defaults, clamping, empty presets, id cleanup', () => {
  const d = BP.normalize();
  assert.equal(d.presets.length, 3);
  assert.equal(d.period, 3.5); assert.equal(d.look.w, 0.59);
  const c = BP.normalize({ scale: 99, amplitude: -1, period: 'x', look: { w: 9, bg: 'red', ink: '#ABCDEF' }, presets: [
    { id: 'a', user: '汪。', assistant: '乖。' }, { id: 'a', user: '一二三四五六七八九十' }, { id: '<x>', user: ' ', assistant: '' },
  ] });
  assert.equal(c.scale, 1.6); assert.equal(c.amplitude, 0); assert.equal(c.period, 3.5);
  assert.equal(c.look.w, 1.6); assert.equal(c.look.bg, '#fbfaff'); assert.equal(c.look.ink, '#abcdef');
  assert.equal(c.presets.length, 2);
  assert.notEqual(c.presets[0].id, c.presets[1].id);
  assert.equal(Array.from(c.presets[1].user).length, BP.TEXT_MAX);
});

test('presets: special date, night flag and per-side style are cleaned', () => {
  const [p] = BP.normalize({ presets: [{ user: '一', date: '5月20日', night: 'yes', style: { user: { w: 0.8, text: 9, junk: 1 }, assistant: {} } }] }).presets;
  assert.equal(p.date, '05-20');
  assert.equal(p.night, undefined, 'only `true` counts');
  assert.deepEqual(p.style, { user: { w: 0.8, text: 2 } });
  assert.equal(BP.cleanDate('2/30'), '');
  assert.equal(BP.cleanDate('02/29'), '02-29');
});

test('isVertical: 2–3 CJK characters only', () => {
  assert.equal(BP.isVertical('汪。'), true);
  assert.equal(BP.isVertical('笨蛋。'), true);
  assert.equal(BP.isVertical('？'), false);
  assert.equal(BP.isVertical('ʊ_ʊ'), false);
  assert.equal(BP.isVertical('今天也想你'), false);
});

test('pick: special date wins that day only; night presets at night only', () => {
  const sets = [
    { id: 'a', user: '汪。', assistant: '乖。', enabled: true },
    { id: 'b', user: '？', assistant: '。', enabled: true },
    { id: 'love', user: '纪念日', assistant: '爱你', enabled: true, date: '05-20' },
    { id: 'zz', user: '困', assistant: '晚安', enabled: true, night: true },
  ];
  for (const r of [0, 0.5, 0.99]) {
    assert.equal(BP.pick(sets, null, { random: () => r, now: at(5, 20, 14) }).id, 'love');
    assert.notEqual(BP.pick(sets, null, { random: () => r, now: at(5, 21, 14) }).id, 'love');
    assert.notEqual(BP.pick(sets, null, { random: () => r, now: at(3, 1, 14) }).id, 'zz');
  }
  assert.equal(BP.pick(sets, null, { random: () => 0.5, now: at(3, 1, 2) }).id, 'zz');
  assert.equal(BP.isNight(at(1, 1, 23), 22, 6), true);
  assert.equal(BP.isNight(at(1, 1, 7), 22, 6), false);
  assert.equal(BP.isNight(at(1, 1, 3), 5, 5), false);
  assert.equal(BP.pick([sets[3]], null, { now: at(3, 1, 14) }).id, 'zz', 'only night presets left → still used');
});

test('lookVars: shared look + one side override', () => {
  const vars = BP.lookVars({ w: 0.7 }, { w: 1.1 });
  assert.equal(vars['--_w'], '1.1'); assert.equal(vars['--_size'], '10.25px'); assert.equal(vars['--_tail-w'], '0.22');
});

test('controller: visit stays fixed, avoids repeating the last pick', async () => {
  const storage = BP.memoryAdapter();
  const c = BP.create({ storage, now: () => at(3, 1, 14) });
  await c.ready;
  const first = c.startVisit();
  assert.equal(c.current.id, first.id);
  for (let i = 0; i < 30; i++) {
    const prev = c.current.id;
    assert.notEqual(c.startVisit().id, prev);
  }
});

test('controller: CRUD, enable/disable, JSON round trip, custom storage', async () => {
  const storage = BP.memoryAdapter();
  const c = BP.create({ storage, now: () => at(3, 1, 14) });
  await c.ready;
  const p = await c.addPreset({ user: '困。', assistant: '晚安。' });
  await c.updatePreset(p.id, { assistant: '睡吧。', date: '3-1', style: { assistant: { text: 1.2 } } });
  assert.equal(c.config.presets.at(-1).date, '03-01');
  assert.equal(c.startVisit().assistant, '睡吧。', 'today is its date');
  assert.equal(c.textFor('user'), '困。');
  await c.updatePreset(p.id, { date: '' });
  for (const item of c.config.presets) if (item.id !== p.id) await c.setPresetEnabled(item.id, false);
  assert.equal(c.startVisit().id, p.id);
  await c.set({ look: { w: 0.8 }, nightFrom: 22 });
  assert.equal(c.config.look.w, 0.8); assert.equal(c.config.look.h, 0.72); assert.equal(c.config.nightFrom, 22);
  const json = c.exportJSON();
  assert.equal(storage.load().presets.length, 4);
  const other = BP.create({ storage: BP.memoryAdapter() });
  await other.importJSON(json);
  assert.equal(other.config.presets.length, 4);
  assert.deepEqual(other.config.presets[3].style, { assistant: { text: 1.2 } });
  await other.importJSON([{ user: '？', assistant: '。' }], { merge: true });
  assert.equal(other.config.presets.length, 5);
  await c.removePreset(p.id);
  assert.equal(c.current, null);
  await c.set({ enabled: false });
  assert.equal(c.startVisit(), null);
});

test('AI note tag: parse the last tag, ignore code, strip for display', () => {
  assert.deepEqual(BP.parseTag('好。<pendant user="困" assistant="快睡"/>'), { user: '困', assistant: '快睡' });
  assert.deepEqual(BP.parseTag('<pendant user="a"/> then <pendant assistant="b">'), { user: '', assistant: 'b' });
  assert.equal(BP.parseTag('```<pendant user="x"/>``` <think><pendant user="y"/></think>'), null);
  assert.equal(BP.stripTags('晚安。<pendant user="困"/>'), '晚安。');
  assert.equal(BP.stripTags('晚安。<pend'), '晚安。', 'half-written tag hidden while streaming');
  assert.equal(BP.stripTags('`<pendant user="x"/>`'), '`<pendant user="x"/>`', 'code stays as is');
});

test('AI note: used once on the next visit, 4 characters max, waits on a special date', async () => {
  let today = at(3, 1, 14);
  const storage = BP.memoryAdapter();
  const c = BP.create({ storage, now: () => today, random: () => 0 });
  await c.ready;
  const shown = await c.takeReply('嗯。<pendant assistant="想你了想你了"/>');
  assert.equal(shown, '嗯。');
  assert.equal(c.config.note.assistant, '想你了想');
  assert.equal(storage.load().note.assistant, '想你了想');
  const visit = c.startVisit();
  assert.equal(visit.assistant, '想你了想'); assert.ok(visit.user, 'the other side stays random');
  assert.equal(c.textFor('assistant'), '想你了想');
  assert.equal(c.config.note, undefined); assert.equal(storage.load().note, undefined);
  assert.notEqual(c.startVisit().assistant, '想你了想');
  await c.addPreset({ user: '纪念日', assistant: '爱你', date: '03-01' });
  await c.leaveNote({ user: '嘿' });
  assert.equal(c.startVisit().user, '纪念日', 'special date wins');
  assert.equal(c.config.note.user, '嘿', 'note kept for later');
  today = at(3, 2, 14);
  assert.equal(c.startVisit().user, '嘿');
});
