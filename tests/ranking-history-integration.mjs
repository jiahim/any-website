// Only run against the dedicated local UAT database/server.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
const url = new URL(process.env.POSTGRES_PRISMA_URL);
assert.equal(url.hostname,'127.0.0.1');
assert.equal(url.port,'55439');
assert.equal(url.pathname,'/aw_hot_search');
const prisma = new PrismaClient();
const path = '历史加权验收';
const userHash = 'history-uat-'+Date.now();
const createdAt = new Date(Date.now()-120*86400000);
let row;
try {
  row = await prisma.userSearchLog.create({data:{path,userHash,date:createdAt.toISOString().slice(0,10),createdAt}});
  execFileSync(process.execPath,['scripts/cleanup-logs.js'],{env:process.env,stdio:'pipe'});
  assert.ok(await prisma.userSearchLog.findUnique({where:{id:row.id}}),'cleanup must retain historical activity');
  const response = await fetch('http://127.0.0.1:3147/api/trending?source=website&limit=20');
  assert.equal(response.status,200);
  const {data} = await response.json();
  assert.ok(data.some(item=>item.path===path && item.source==='local'),'120-day-old activity must remain eligible');
  console.log('PASS: cleanup retains historical activity and API ranks a 120-day-old search');
} finally {
  if(row) await prisma.userSearchLog.delete({where:{id:row.id}});
  await prisma.$disconnect();
}
