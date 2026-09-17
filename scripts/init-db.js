import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🚀 开始初始化数据库...');
  
  try {
    // 检查数据库连接
    await prisma.$connect();
    console.log('✅ 数据库连接成功');
    
    // 检查是否已有数据
    const existingCount = await prisma.trendingSearch.count();
    
    if (existingCount > 0) {
      console.log(`📊 数据库中已有 ${existingCount} 条热门搜索记录`);
      return;
    }
    
    // 生产初始化不再注入虚拟搜索次数，推荐仅从真实日志生成。
    console.log('✅ 数据库连接正常，无需填充热门搜索示例');
    console.log('🎉 数据库初始化完成！');
    
  } catch (error) {
    console.error('❌ 数据库初始化失败:', error);
    
    if (error.code === 'P1001') {
      console.log('💡 提示: 请检查数据库连接配置是否正确');
      console.log('💡 确保 .env 文件中的 POSTGRES_PRISMA_URL 和 POSTGRES_URL_NON_POOLING 配置正确');
    }
    
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });