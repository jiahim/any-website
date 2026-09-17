import { createHash, randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { VISITOR_COOKIE, UUID, visitorCookieOptions } from './visitorIdentity';
export { UUID } from './visitorIdentity';
export function getVisitor(request: NextRequest) {
  const stored = request.cookies.get(VISITOR_COOKIE)?.value;
  const id = stored && UUID.test(stored) ? stored : randomUUID();
  return { id, hash: createHash('sha256').update(id).digest('hex'), exists: id === stored };
}
export function attachVisitor(response: NextResponse, id: string) {
  response.cookies.set(VISITOR_COOKIE, id, visitorCookieOptions);
  return response;
}
export function isSameOrigin(request: NextRequest) {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false;
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    // Next may normalize nextUrl's hostname internally. Compare the browser's
    // origin with the request Host, not the framework's internal hostname.
    const source = new URL(origin);
    const protocol = request.headers.get('x-forwarded-proto') || request.nextUrl.protocol.replace(':', '');
    return source.host === request.headers.get('host') && source.protocol === `${protocol}:`;
  } catch { return false; }
}
