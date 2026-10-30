/* =========================================================
   JARKET (자켓마트) — Express Server
   - 포트: 5505
   - ONEID SSO 및 슬롯게임(vegas-slots / neonstrip) 자금 실시간 연동
   ========================================================= */
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

import { initSchema, isDbAvailable, getPlayer, processCheckout, getUserInventory, getUserOrders, getReceipt } from './lib/db.js';
import { requireAuth, ONEID_URL, CLIENT_ID } from './lib/auth.js';
import { CATEGORIES, PRODUCTS } from './lib/products.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 5505);
const SLOTS_URL = (process.env.SLOTS_URL || 'http://localhost:5504').replace(/\/$/, '');

await initSchema();

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- 공개 설정 ----------
app.get('/api/health', (req, res) => res.json({ ok: true, db: isDbAvailable() }));

app.get('/api/config', (req, res) => res.json({
  storeName: 'JARKET 자켓마트 본점',
  slogan: 'Everyday Low Profit, JARKET',
  oneidUrl: (process.env.ONEID_PUBLIC_URL || ONEID_URL).replace(/\/$/, ''),
  clientId: CLIENT_ID,
  slotsUrl: SLOTS_URL,
  categories: CATEGORIES,
}));

// ---------- 상품 목록 ----------
app.get('/api/products', (req, res) => {
  const { cat } = req.query;
  if (cat && cat !== 'all') {
    return res.json(PRODUCTS.filter(p => p.category === cat));
  }
  res.json(PRODUCTS);
});

// ---------- 게스트 간편 시작 (ONEID 없이 로컬 테스트 가능) ----------
app.post('/api/guest-login', async (req, res) => {
  const nickname = (req.body?.nickname || '슬롯단골손님').trim().slice(0, 15);
  const guestId = 'guest_' + Math.random().toString(36).slice(2, 10);
  const token = `${guestId}_${encodeURIComponent(nickname)}`;
  const player = await getPlayer(guestId, nickname);
  res.json({ token, user: { id: player.id, name: player.name, isGuest: true }, balance: player.balance });
});

// ---------- 유저 내 정보 & 잔고 ----------
app.get('/api/me', requireAuth, async (req, res) => {
  const p = await getPlayer(req.user.id, req.user.name);
  const [inv, orders] = await Promise.all([
    getUserInventory(req.user.id),
    getUserOrders(req.user.id)
  ]);

  res.json({
    user: {
      id: p.id,
      name: p.name,
      credit: p.credit,
      spins: p.spins,
      isGuest: req.user.isGuest,
    },
    balance: p.balance,
    inventoryCount: inv.reduce((sum, it) => sum + it.quantity, 0),
    orderCount: orders.length,
    dbConnected: isDbAvailable(),
  });
});

// ---------- 인벤토리 (내 장바구니/냉장고) ----------
app.get('/api/inventory', requireAuth, async (req, res) => {
  const items = await getUserInventory(req.user.id);
  res.json({ items });
});

// ---------- 주문 내역 ----------
app.get('/api/orders', requireAuth, async (req, res) => {
  const orders = await getUserOrders(req.user.id);
  res.json({ orders });
});

// ---------- 영수증 단건 조회 ----------
app.get('/api/receipt/:no', async (req, res) => {
  const receipt = await getReceipt(req.params.no);
  if (!receipt) return res.status(404).json({ error: '영수증을 찾을 수 없습니다.' });
  res.json(receipt);
});

// ---------- 결제 (Checkout) ----------
app.post('/api/checkout', requireAuth, async (req, res) => {
  try {
    const rawItems = req.body?.items;
    if (!Array.isArray(rawItems) || !rawItems.length) {
      return res.status(400).json({ error: '장바구니가 비어 있습니다.' });
    }

    // 카탈로그 검증 및 금액 산출
    let totalAmount = 0;
    const validatedItems = [];

    for (const raw of rawItems) {
      const prod = PRODUCTS.find(p => p.id === raw.id);
      if (!prod) continue;
      const qty = Math.max(1, Math.min(999, parseInt(raw.qty) || 1));
      const lineTotal = prod.price * qty;
      totalAmount += lineTotal;

      validatedItems.push({
        id: prod.id,
        name: prod.name,
        category: prod.category,
        icon: prod.icon,
        unit: prod.unit,
        price: prod.price,
        qty,
        lineTotal
      });
    }

    if (!validatedItems.length) {
      return res.status(400).json({ error: '유효한 상품이 없습니다.' });
    }

    // 영수증 번호 생성 (JK-YYYYMMDD-XXXXX)
    const d = new Date();
    const dateStr = d.toISOString().slice(0, 10).replace(/-/g, '');
    const randPart = Math.random().toString(36).slice(2, 7).toUpperCase();
    const receiptNo = `JK-${dateStr}-${randPart}`;

    const { balanceAfter } = await processCheckout({
      uid: req.user.id,
      userName: req.user.name,
      items: validatedItems,
      totalAmount,
      receiptNo
    });

    res.json({
      ok: true,
      receiptNo,
      balanceAfter,
      totalAmount,
      items: validatedItems,
      paidAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Checkout Error]', err);
    res.status(400).json({ error: err.message || '결제 중 오류가 발생했습니다.' });
  }
});

// ---------- 404 및 에러 처리 ----------
app.use('/api', (req, res) => res.status(404).json({ error: 'API 경로가 존재하지 않습니다.' }));

app.use((err, req, res, next) => {
  console.error('[Server Error]', err);
  res.status(500).json({ error: err.message || '서버 오류' });
});

// ---------- 서버 시작 ----------
const server = http.createServer(app);
server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🛒 JARKET (자켓마트) 본점 서버 시작!`);
  console.log(`📍 주소: http://localhost:${PORT}`);
  console.log(`🎰 슬롯게임 연동: ${SLOTS_URL}`);
  console.log(`🔑 ONEID 연동: ${ONEID_URL}`);
  console.log(`💾 DB 모드: ${isDbAvailable() ? 'Neon Postgres (실시간 연동)' : 'Local Memory'}`);
  console.log(`======================================================\n`);
});
