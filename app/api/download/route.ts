import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { isValidSearchPath } from "@/app/lib/pathFilter";

function response(success: boolean, message: string) {
  return NextResponse.json({ success, message }, { status: 200 });
}

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object") {
      return response(false, "请求参数无效");
    }

    const { path, fileName, byteSize } = body as Record<string, unknown>;
    if (
      typeof path !== "string" ||
      typeof fileName !== "string" ||
      typeof byteSize !== "number" ||
      !Number.isInteger(byteSize) ||
      byteSize < 0
    ) {
      return response(false, "缺少或包含无效的下载参数");
    }

    if (!isValidSearchPath(path)) {
      console.warn(`[bot-filter][download] 非法路径被跳过: path=${path}`);
      return response(true, "路径不符合记录条件（已跳过）");
    }

    const ip = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip");
    const userAgent = request.headers.get("user-agent");

    await prisma.downloadRecord.create({
      data: {
        path,
        fileName,
        byteSize,
        userAgent,
        ip,
      },
    });

    return response(true, "下载记录已保存");
  } catch (error) {
    console.error("记录下载数据错误:", error);
    return response(false, "下载记录保存失败");
  }
}
