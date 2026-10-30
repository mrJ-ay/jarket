/* =========================================================
   JARKET (자켓마트) — 인증 모듈 (ONEID SSO & Guest 지원)
   ========================================================= */
import { getPlayer } from './db.js';

export const ONEID_URL = (process.env.ONEID_URL || 'http://localhost:8000').replace(/\/$/, '');
export const CLIENT_ID = process.env.ONEID_CLIENT_ID || 'jarket';

const CACHE_MS = 60_000;
const cache = new Map(); // token -> { user, until }

export class AuthError extends Error {
  constructor(msg, status = 401) { super(msg); this.status = status; }
}

function decodePayload(token) {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  } catch { return null; }
}

export async function verifyToken(token) {
  if (!token) throw new AuthError('로그인이 필요합니다.');

  // 1. 게스트 모드 토큰 지원 (체험용)
  if (token.startsWith('guest_')) {
    const parts = token.split('_');
    const guestId = parts.slice(0, 2).join('_');
    const guestName = decodeURIComponent(parts[2] || '익명의단골손님');
    const player = await getPlayer(guestId, guestName);
    return { id: player.id, name: player.name, isGuest: true };
  }

  // 2. 캐시 확인
  const hit = cache.get(token);
  if (hit && hit.until > Date.now()) return hit.user;

  // 3. ONEID 검증
  let res;
  try {
    res = await fetch(`${ONEID_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` }
    });
  } catch (err) {
    // ONEID 서버 오프라인일 때 토큰 payload 파싱하여 유연하게 허용
    const p = decodePayload(token);
    if (p && p.sub) {
      const uid = String(p.sub);
      const name = String(p.nickname || p.username || 'ONEID손님').slice(0, 20);
      const player = await getPlayer(uid, name);
      return { id: player.id, name: player.name, isOffline: true };
    }
    throw new AuthError('ONEID 인증 서버에 연결할 수 없습니다.', 503);
  }

  if (!res.ok) {
    cache.delete(token);
    const body = await res.json().catch(() => ({}));
    throw new AuthError(body.detail || '로그인이 만료되었습니다.', res.status === 403 ? 403 : 401);
  }

  const me = await res.json();
  const isAdmin = me.role === 'admin' || me.is_admin === true || me.username === 'Jae' || me.nickname === 'Jae';
  const user = {
    id: String(me.id),
    name: String(me.nickname || me.username || '자켓회원').slice(0, 20),
    username: me.username,
    role: me.role,
    isAdmin,
    isGuest: false
  };

  await getPlayer(user.id, user.name);
  const until = Date.now() + CACHE_MS;
  cache.set(token, { user, until });
  return user;
}

export function bearer(req) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return null;
  return h.slice(7).trim();
}

export async function requireAuth(req, res, next) {
  try {
    const token = bearer(req);
    req.user = await verifyToken(token);
    next();
  } catch (err) {
    res.status(err.status || 401).json({ error: err.message || '인증 오류' });
  }
}

export const ADMIN_PIN = process.env.ADMIN_PIN || '7777';

export function checkAdminAuth(req) {
  const pin = req.headers['x-admin-pin'] || req.query.admin_pin || req.body?.admin_pin;
  if (pin && String(pin).trim() === ADMIN_PIN) {
    return { id: 'admin_master', name: '총괄점장', isAdmin: true };
  }
  return null;
}

export async function requireAdmin(req, res, next) {
  const pinUser = checkAdminAuth(req);
  if (pinUser) {
    req.user = pinUser;
    return next();
  }

  try {
    const token = bearer(req);
    if (!token) {
      return res.status(401).json({ error: '점장실(관리자) 인증이 필요합니다. (점장 마스터 PIN 또는 ONEID 관리자)' });
    }
    const user = await verifyToken(token);
    if (user.isAdmin || user.name === 'Jae' || user.username === 'Jae' || user.role === 'admin') {
      req.user = user;
      return next();
    }
    return res.status(403).json({ error: '점장실(관리자) 접근 권한이 없습니다.' });
  } catch (err) {
    return res.status(401).json({ error: err.message || '관리자 인증 실패' });
  }
}

