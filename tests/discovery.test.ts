import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWithinAge, rankSearches, normalizeSearchPath, selectSuggestions, parseSocialHotSearches, interleaveSocialSearches } from '../app/lib/discovery.ts';
const now = new Date('2026-09-14T12:00:00Z');
const ago = (days: number) => new Date(now.getTime() - days * 86400000);
test('all history participates with a 30 day half life and latest visitor only', () => {
  const rows = rankSearches([
    { path: '猫', userHash: 'a', createdAt: ago(30) },
    { path: '猫', userHash: 'a', createdAt: ago(60) },
    { path: '狗', userHash: 'b', createdAt: ago(0) },
    { path: '旧词', userHash: 'c', createdAt: ago(90) },
  ], [], [], now);
  assert.deepEqual(rows.map(x => x.path), ['狗', '猫', '旧词']);
  assert.equal(rows[1].score, 0.5);
  assert.equal(rows[2].score, 0.125);
});
test('seed cannot enter without activity; blocked and placeholder paths excluded', () => {
  const rows = rankSearches(['demo', 'test', '正常词', '已删除'].map(path => ({path,userHash:'a',createdAt:now})), [], ['已删除'], now);
  assert.deepEqual(rows.map(x=>x.path), ['正常词']);
});
test('quality is neutral without votes, smoothed, and capped per visitor', () => {
  const logs = [{path:'猫',userHash:'u',createdAt:now}];
  const vote = {path:'猫',visitorHash:'u',value:1,createdAt:now};
  const once = rankSearches(logs,[vote],[],now)[0].score;
  const repeated = rankSearches(logs,Array(20).fill(vote),[],now)[0].score;
  assert.equal(once,repeated);
  assert.ok(once > 1 && once < 1.02);
  assert.equal(rankSearches(logs,[{...vote,value:0}],[],now)[0].score,1);
  assert.ok(rankSearches(logs,[{...vote,value:-1}],[],now)[0].score < 1);
});
test('normalization preserves distinct paths and handles bad input', () => {
  assert.equal(normalizeSearchPath('/%E7%8C%AB/'), '猫');
  assert.equal(normalizeSearchPath('猫/品种'), '猫/品种');
  for (const x of [null, {}, '%ZZ', 'https://bad.com', '../foo', 'test', '乱码�']) assert.equal(normalizeSearchPath(x), null);
});
test('social search keeps short terms and named works, skips headlines and invalid paths', () => {
  const payload = {
    status: 'cache',
    items: [
      { title: '白小纯口碑反转' },
      { title: '《黑神话：悟空》发布预告' },
      { title: '#台风#' },
      { title: '台风' },
      { title: 'BLG战胜T1' },
      { title: '小米四款车全部上榜' },
      { title: '透过关键词解码进博会' },
      { title: '太原下雪了' },
      { title: '韩国人如何评价BLG战胜T1' },
      { title: 'https://example.com/猫' },
      { title: '../猫' },
      { title: '猫/品种' },
      { title: '第一波演示内容。' },
      { title: 123 },
      null,
    ],
  };
  assert.deepEqual(parseSocialHotSearches(payload, 'weibo'), [
    { path: '白小纯', source: 'weibo' },
    { path: '黑神话:悟空', source: 'weibo' },
    { path: '台风', source: 'weibo' },
  ]);
  assert.throws(() => parseSocialHotSearches({ status: 'error', items: payload.items }, 'weibo'));
  assert.throws(() => parseSocialHotSearches({ status: 'success', items: [] }, 'weibo'));
});

test('three social sources take turns before the display limit and tolerate an empty source', () => {
  const feeds = [
    [{ path: '极光', source: 'weibo' as const }, { path: '远山', source: 'weibo' as const }],
    [{ path: '极光', source: 'bilibili' as const }, { path: '东方Project', source: 'bilibili' as const }],
    [{ path: '赛博朋克', source: 'douyin' as const }, { path: '雪国', source: 'douyin' as const }],
  ];
  assert.deepEqual(interleaveSocialSearches(feeds).map(row => row.source), [
    'weibo', 'bilibili', 'douyin', 'weibo', 'bilibili', 'douyin',
  ]);
  assert.deepEqual(selectSuggestions(interleaveSocialSearches(feeds), 4).map(row => row.path), [
    '极光', '赛博朋克', '远山', '东方Project',
  ]);
  assert.deepEqual(interleaveSocialSearches([[], feeds[1], feeds[2]]).map(row => row.source), [
    'bilibili', 'douyin', 'bilibili', 'douyin',
  ]);
});
test('website and social lists preserve independent order and never fill each other', () => {
  const local = Array.from({length:12},(_,i)=>({path:`站内${i}`,source:'local' as const,score:12-i}));
  const external = [{path:'站内0',source:'weibo' as const},{path:'外部词',source:'weibo' as const}];
  assert.deepEqual(selectSuggestions(local,12),local);
  assert.deepEqual(selectSuggestions(external,12),external);
  assert.deepEqual(selectSuggestions([],12),[]);
  assert.deepEqual(selectSuggestions([...external,...external],12),external);
});

test('cache expires at exactly 24 hours; future and corrupt dates are rejected', () => {
  assert.equal(isWithinAge(ago(1),86400000,now.getTime()),false);
  assert.equal(isWithinAge(ago(0.99),86400000,now.getTime()),true);
  assert.equal(isWithinAge(ago(-1),86400000,now.getTime()),false);
  assert.equal(isWithinAge(new Date('invalid'),86400000,now.getTime()),false);
});
test('encoded and slash variants for the same visitor do not add heat', () => {
  const result = rankSearches([
    {path:'猫',userHash:'one',createdAt:now},
    {path:'/%E7%8C%AB/',userHash:'one',createdAt:now},
  ],[],[],now);
  assert.equal(result.length,1); assert.equal(result[0].score,1);
});

test('historic feedback remains effective and invalid or future timestamps do not rank', () => {
  const logs = [{path:'老词',userHash:'u',createdAt:ago(60)}];
  const neutral = rankSearches(logs,[],[],now)[0].score;
  assert.ok(rankSearches(logs,[{path:'老词',visitorHash:'v',value:1,createdAt:ago(90)}],[],now)[0].score > neutral);
  const invalid = [{path:'未来词',userHash:'u',createdAt:ago(-1)},{path:'无效日期',userHash:'u',createdAt:new Date('invalid')}];
  assert.deepEqual(rankSearches(invalid,[],[],now),[]);
});
