/* =========================================================
   JARKET (자켓마트) — Express Server
   - 포트: 5505
   - ONEID SSO 및 슬롯게임(vegas-slots / neonstrip) 자금 실시간 연동
   - 유저 판매 물품 등록 및 판매 수익금 판매자 카지노 잔고 자동 입금
   ========================================================= */
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

import {
  initSchema, isDbAvailable, getPlayer, processCheckout,
  getUserInventory, getUserOrders, getReceipt,
  createMarketItem, getActiveMarketItems, getSellerMarketItems, cancelMarketItem,
  getAdminStats, getAdminOrders, refundOrderAdmin,
  getAdminMarketItems, deleteMarketItemAdmin, getAdminPlayers, giftPlayerChips
} from './lib/db.js';
import { requireAuth, requireAdmin, ONEID_URL, CLIENT_ID } from './lib/auth.js';
import { CATEGORIES, PRODUCTS } from './lib/products.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 5505);
const SLOTS_URL = (process.env.SLOTS_URL || 'http://localhost:5504').replace(/\/$/, '');

let liveAnnouncement = '📢 [자켓마트 본점] 멸종 매머드 티본 스테이크 3만 년 숙성 완료! 슬롯 잭팟 터진 고객님 우대 매장!';
const soldOutProducts = new Set();

await initSchema();

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// 관리자 콘솔 페이지 라우트
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// ---------- 공개 설정 ----------
app.get('/api/health', (req, res) => res.json({ ok: true, db: isDbAvailable() }));

app.get('/api/config', (req, res) => res.json({
  storeName: 'JARKET 자켓마트 본점',
  slogan: 'Everyday Low Profit, JARKET',
  announcement: liveAnnouncement,
  oneidUrl: (process.env.ONEID_PUBLIC_URL || ONEID_URL).replace(/\/$/, ''),
  clientId: CLIENT_ID,
  slotsUrl: SLOTS_URL,
  categories: CATEGORIES,
}));

// ---------- 상품 목록 (시스템 공식 카탈로그 + 유저 직거래 마켓 통합) ----------
app.get('/api/products', async (req, res) => {
  try {
    const { cat } = req.query;
    const marketItems = await getActiveMarketItems();
    
    // 유저 등록 상품을 표준 포맷으로 변환
    const userProducts = marketItems.map(m => ({
      id: `user_${m.id}`,
      marketItemId: m.id,
      name: m.name,
      category: m.category || 'user',
      price: m.price,
      originalPrice: Math.round(m.price * 1.25),
      badge: m.badge || '개인셀러',
      icon: m.icon || '📦',
      unit: `잔여 ${m.stock}개`,
      desc: m.desc_text || '유저가 직접 등록한 판매 물품입니다.',
      flavor: `🧑‍🌾 판매자: ${m.seller_name} (수익금 100% 판매자 카지노 입금)`,
      rating: 5.0,
      reviews: m.sales_count,
      sellerId: m.seller_id,
      sellerName: m.seller_name,
      stock: m.stock,
      isUserItem: true,
    }));

    const systemProducts = PRODUCTS.map(p => ({
      ...p,
      isSoldOut: soldOutProducts.has(p.id),
      badge: soldOutProducts.has(p.id) ? '일시품절' : p.badge
    }));

    let allItems = [...userProducts, ...systemProducts];

    if (cat && cat !== 'all') {
      if (cat === 'user') {
        allItems = userProducts;
      } else {
        allItems = allItems.filter(p => p.category === cat);
      }
    }

    res.json(allItems);
  } catch (err) {
    console.error('[Products Error]', err);
    res.json(PRODUCTS);
  }
});

// ---------- 유저 판매 물품 등록 API ----------
app.post('/api/market/items', requireAuth, async (req, res) => {
  try {
    const { name, category, icon, price, stock, badge, descText } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ error: '상품명을 입력해주세요.' });
    }
    const numPrice = Number(price);
    if (isNaN(numPrice) || numPrice < 10) {
      return res.status(400).json({ error: '가격은 10칩 이상이어야 합니다.' });
    }
    const numStock = Math.max(1, Math.min(999, parseInt(stock) || 1));

    const item = await createMarketItem({
      sellerId: req.user.id,
      sellerName: req.user.name,
      name: name.trim().slice(0, 30),
      category: category || 'user',
      icon: (icon || '📦').trim().slice(0, 10),
      price: numPrice,
      stock: numStock,
      badge: (badge || '개인판매').trim().slice(0, 15),
      descText: (descText || '').trim().slice(0, 200),
    });

    res.json({ ok: true, item });
  } catch (err) {
    console.error('[Create Market Item Error]', err);
    res.status(400).json({ error: err.message || '물품 등록 실패' });
  }
});

// ---------- 내 판매 등록 목록 및 정산액 조회 ----------
app.get('/api/market/my', requireAuth, async (req, res) => {
  try {
    const items = await getSellerMarketItems(req.user.id);
    const totalEarned = items.reduce((sum, it) => sum + (it.price * it.sales_count), 0);
    res.json({ items, totalEarned });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- 내 판매 물품 판매 취소 ----------
app.post('/api/market/items/:id/cancel', requireAuth, async (req, res) => {
  try {
    const ok = await cancelMarketItem(req.user.id, req.params.id);
    if (!ok) return res.status(404).json({ error: '물품을 찾을 수 없거나 이미 취소되었습니다.' });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- 게스트 간편 시작 ----------
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
  const [inv, orders, myMarketItems] = await Promise.all([
    getUserInventory(req.user.id),
    getUserOrders(req.user.id),
    getSellerMarketItems(req.user.id)
  ]);

  const marketEarnings = myMarketItems.reduce((sum, it) => sum + (it.price * it.sales_count), 0);

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
    marketListingCount: myMarketItems.filter(i => i.is_active).length,
    marketEarnings,
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

    // 유저 등록 상품 목록 가져오기
    const activeMarket = await getActiveMarketItems();

    let totalAmount = 0;
    const validatedItems = [];

    for (const raw of rawItems) {
      let prod = PRODUCTS.find(p => p.id === raw.id);
      let isUser = false;
      let sellerId = null;
      let marketItemId = null;

      if (!prod && String(raw.id).startsWith('user_')) {
        const mId = Number(String(raw.id).replace('user_', ''));
        const mItem = activeMarket.find(m => m.id === mId);
        if (mItem) {
          prod = {
            id: `user_${mItem.id}`,
            name: mItem.name,
            category: mItem.category || 'user',
            icon: mItem.icon,
            unit: `1개`,
            price: mItem.price,
            stock: mItem.stock,
          };
          isUser = true;
          sellerId = mItem.seller_id;
          marketItemId = mItem.id;
        }
      }

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
        lineTotal,
        sellerId,
        marketItemId,
        isUser
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

// ---------- 관리자 (점장실) API ----------
app.get('/api/admin/check', requireAdmin, (req, res) => {
  res.json({ ok: true, user: req.user });
});

app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  try {
    const stats = await getAdminStats();
    res.json({ ok: true, stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/orders', requireAdmin, async (req, res) => {
  try {
    const { search, status, limit, offset } = req.query;
    const result = await getAdminOrders({ search, status, limit, offset });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/orders/:receiptNo/refund', requireAdmin, async (req, res) => {
  try {
    const { receiptNo } = req.params;
    const reason = req.body?.reason || '점장 직권 주문 취소 환불';
    const result = await refundOrderAdmin(receiptNo, reason);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/admin/market/items', requireAdmin, async (req, res) => {
  try {
    const items = await getAdminMarketItems();
    res.json({ ok: true, items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/market/items/:id', requireAdmin, async (req, res) => {
  try {
    const item = await deleteMarketItemAdmin(req.params.id);
    res.json({ ok: true, item });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/admin/players', requireAdmin, async (req, res) => {
  try {
    const players = await getAdminPlayers();
    res.json({ ok: true, players });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/players/:id/gift', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, reason } = req.body;
    const result = await giftPlayerChips(id, amount, reason);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/admin/products', requireAdmin, (req, res) => {
  const prods = PRODUCTS.map(p => ({
    ...p,
    isSoldOut: soldOutProducts.has(p.id)
  }));
  res.json({ ok: true, products: prods });
});

app.post('/api/admin/products/:id/toggle-soldout', requireAdmin, (req, res) => {
  const { id } = req.params;
  const prod = PRODUCTS.find(p => p.id === id);
  if (!prod) return res.status(404).json({ error: '해당 공식 상품을 찾을 수 없습니다.' });

  if (soldOutProducts.has(id)) {
    soldOutProducts.delete(id);
  } else {
    soldOutProducts.add(id);
  }
  res.json({ ok: true, id, isSoldOut: soldOutProducts.has(id) });
});

app.get('/api/admin/announcement', (req, res) => {
  res.json({ ok: true, text: liveAnnouncement });
});

app.post('/api/admin/announcement', requireAdmin, (req, res) => {
  const text = req.body?.text;
  if (!text || !text.trim()) return res.status(400).json({ error: '공지 문구를 입력해주세요.' });
  liveAnnouncement = text.trim();
  res.json({ ok: true, text: liveAnnouncement });
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
