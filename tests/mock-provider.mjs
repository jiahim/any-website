// Explicit local UAT preload only. Never imported by application code.
if (process.env.AW_LOCAL_UAT === '1') {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('https://api.siliconflow.cn/')) {
      const html = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>探索海洋</title><style>body{background:#eaf3f3;color:#16404a;font-family:system-ui;padding:48px}h1{font-size:48px}p{max-width:650px;line-height:1.8}a{display:block;margin-top:24px}</style></head><body><h1>探索海洋</h1><p>这是一份本地验收页面，用于验证完整生成、浮标评价和下载交互。模型响应使用固定测试内容，评价数据写入独立的本地数据库。</p><a href="/海洋/珊瑚">继续探索珊瑚世界</a></body></html>';
      const encoder = new TextEncoder();
      return new Response(new ReadableStream({ async start(c) {
        for (const part of [html.slice(0,400), html.slice(400)]) {
          c.enqueue(encoder.encode(`data: ${JSON.stringify({choices:[{delta:{content:part}}]})}\n\n`));
          await new Promise(resolve=>setTimeout(resolve,250));
        }
        c.enqueue(encoder.encode('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'));
        c.close();
      }}), { headers: { 'Content-Type': 'text/event-stream' } });
    }
    return original(input, init);
  };
}
