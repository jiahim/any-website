import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function cleanupOldLogs() {
  console.log('🧹 开始清理过期的用户搜索日志...');
  
  try {
    // 热词排名依赖历史 UserSearchLog，不再按 30 天删除。
    // SearchRecord 含原始 IP/UA，继续采用原有 90 天保留期。
    // 可选：清理过期的搜索记录（保留更长时间，比如90天）
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    
    const oldSearchRecords = await prisma.searchRecord.deleteMany({
      where: {
        createdAt: {
          lt: ninetyDaysAgo
        }
      }
    });
    
    console.log(`✅ 成功删除 ${oldSearchRecords.count} 条过期搜索记录`);
    console.log('🎉 清理完成！');
    
  } catch (error) {
    console.error('❌ 清理失败:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

cleanupOldLogs()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });