import { writeFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';

const [id, output] = process.argv.slice(2);
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id ?? '')) {
  console.error('用法  pnpm feedback:export <反馈 ID> [输出文件]');
  process.exit(1);
}

const prisma = new PrismaClient();
try {
  const feedback = await prisma.siteFeedback.findUnique({
    where: { id },
    select: { screenshotBytes: true, screenshotMimeType: true },
  });
  if (!feedback?.screenshotBytes) {
    console.error('这条反馈没有截图，或记录不存在');
    process.exitCode = 1;
  } else {
    const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
    const filename = output ?? `screenshot-${id}.${extension[feedback.screenshotMimeType]}`;
    await writeFile(filename, feedback.screenshotBytes, { flag: 'wx', mode: 0o600 });
    console.log(`已导出 ${filename}`);
  }
} catch (error) {
  console.error(error?.code === 'EEXIST' ? '输出文件已存在，请选择另一个路径' : '截图导出失败');
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
