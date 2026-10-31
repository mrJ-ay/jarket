/* =========================================================
   JARKET (자켓마트) — Database Module (Neon Postgres)
   - vegas-slots 의 ns_players (잔고) 및 ns_ledger (원장) 직접 연동
   - jk_orders (주문 영수증), jk_inventory (구매 보관함) 관리
   - jk_market_items (유저 직접 판매 마켓 & 판매 수익 카지노 자동 입금)
   ========================================================= */
import pg from 'pg';
import { getProductSkill } from './products.js';

pg.types.setTypeParser(20, v => Number(v)); // BIGINT -> number
pg.types.setTypeParser(1700, v => parseFloat(v)); // NUMERIC -> number

let pool = null;
let dbAvailable = false;

if (process.env.DATABASE_URL) {
  try {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    pool.on('error', e => console.error('[DB] Postgres Pool Error:', e.message));
  } catch (err) {
    console.warn('[DB] Failed to init pool:', err.message);
  }
}

// 로컬 게스트/인메모리 폴백 (DB가 오프라인이거나 개발 모드일 때)
const memPlayers = new Map();
const memOrders = [];
const memInventory = new Map(); // uid:itemId -> record
const memMarketItems = []; // 유저 등록 물품

export async function q(text, params = []) {
  if (!pool) throw new Error('Database pool not initialized');
  return pool.query(text, params);
}

export async function initSchema() {
  if (!pool) {
    console.log('[DB] No DATABASE_URL found. Running in Local Memory Mode.');
    return;
  }
  try {
    await pool.query('SELECT 1');
    dbAvailable = true;
    console.log('[DB] Neon Postgres connected successfully.');

    // 1. vegas-slots ns_players 테이블
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ns_players (
        id               TEXT PRIMARY KEY,
        name             TEXT NOT NULL,
        balance          BIGINT NOT NULL DEFAULT 1000 CHECK (balance >= 0),
        credit           INTEGER NOT NULL DEFAULT 500,
        spins            INTEGER NOT NULL DEFAULT 0,
        bankruptcies     INTEGER NOT NULL DEFAULT 0,
        last_bankrupt_at TIMESTAMPTZ,
        npc_blacklist    TEXT[] NOT NULL DEFAULT '{}',
        created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_seen        TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS ns_ledger (
        id            BIGSERIAL PRIMARY KEY,
        player_id     TEXT NOT NULL,
        delta         BIGINT NOT NULL,
        balance_after BIGINT NOT NULL,
        reason        TEXT NOT NULL,
        ref           TEXT,
        at            TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      -- 2. JARKET 주문 영수증 테이블
      CREATE TABLE IF NOT EXISTS jk_orders (
        id           BIGSERIAL PRIMARY KEY,
        user_id      TEXT NOT NULL,
        user_name    TEXT NOT NULL,
        receipt_no   TEXT NOT NULL UNIQUE,
        total_amount BIGINT NOT NULL,
        item_count   INTEGER NOT NULL,
        items_json   JSONB NOT NULL,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS jk_orders_user_idx ON jk_orders (user_id, created_at DESC);

      -- 3. JARKET 구매품 보관함 (인벤토리)
      CREATE TABLE IF NOT EXISTS jk_inventory (
        id             BIGSERIAL PRIMARY KEY,
        user_id        TEXT NOT NULL,
        item_id        TEXT NOT NULL,
        name           TEXT NOT NULL,
        category       TEXT NOT NULL,
        icon           TEXT NOT NULL,
        unit_price     BIGINT NOT NULL,
        quantity       INTEGER NOT NULL DEFAULT 1,
        last_bought_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(user_id, item_id)
      );
      CREATE INDEX IF NOT EXISTS jk_inventory_user_idx ON jk_inventory (user_id);

      -- 4. 유저 직접 판매 등록 물품
      CREATE TABLE IF NOT EXISTS jk_market_items (
        id             BIGSERIAL PRIMARY KEY,
        seller_id      TEXT NOT NULL,
        seller_name    TEXT NOT NULL,
        name           TEXT NOT NULL,
        category       TEXT NOT NULL DEFAULT 'user',
        icon           TEXT NOT NULL DEFAULT '📦',
        price          BIGINT NOT NULL CHECK (price > 0),
        stock          INTEGER NOT NULL DEFAULT 1 CHECK (stock >= 0),
        badge          TEXT NOT NULL DEFAULT '개인판매',
        desc_text      TEXT NOT NULL,
        sales_count    INTEGER NOT NULL DEFAULT 0,
        is_active      BOOLEAN NOT NULL DEFAULT true,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS jk_market_items_active_idx ON jk_market_items (is_active, created_at DESC);

      -- jk_orders 주문 상태 및 환불 일시 컬럼 보강
      ALTER TABLE jk_orders ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'completed';
      ALTER TABLE jk_orders ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;
    `);
    console.log('[DB] JARKET tables initialized.');
  } catch (err) {
    console.warn('[DB] Connection check failed, switching to memory mode:', err.message);
    dbAvailable = false;
  }
}

export function isDbAvailable() {
  return dbAvailable;
}

/** 플레이어 잔고 조회 (없으면 기본 생성) */
export async function getPlayer(uid, fallbackName = '자켓단골손님') {
  if (dbAvailable) {
    let res = await pool.query('SELECT * FROM ns_players WHERE id = $1', [uid]);
    if (!res.rows.length) {
      await pool.query(
        `INSERT INTO ns_players (id, name, balance) VALUES ($1, $2, 1000000)
         ON CONFLICT (id) DO UPDATE SET last_seen = now()`,
        [uid, fallbackName]
      );
      res = await pool.query('SELECT * FROM ns_players WHERE id = $1', [uid]);
    }
    return res.rows[0];
  } else {
    if (!memPlayers.has(uid)) {
      memPlayers.set(uid, {
        id: uid,
        name: fallbackName,
        balance: 10_000_000,
        credit: 600,
        spins: 0,
      });
    }
    return memPlayers.get(uid);
  }
}

/** 유저 판매 물품 등록 */
export async function createMarketItem({ sellerId, sellerName, name, category = 'user', icon = '📦', price, stock = 1, badge = '개인판매', descText = '' }) {
  price = Math.max(10, Math.round(price));
  stock = Math.max(1, Math.min(9999, parseInt(stock) || 1));

  if (dbAvailable) {
    const { rows } = await pool.query(
      `INSERT INTO jk_market_items (seller_id, seller_name, name, category, icon, price, stock, badge, desc_text, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
       RETURNING *`,
      [sellerId, sellerName, name, category, icon, price, stock, badge, descText]
    );
    return rows[0];
  } else {
    const item = {
      id: memMarketItems.length + 1,
      seller_id: sellerId,
      seller_name: sellerName,
      name,
      category,
      icon,
      price,
      stock,
      badge,
      desc_text: descText,
      sales_count: 0,
      is_active: true,
      created_at: new Date().toISOString()
    };
    memMarketItems.unshift(item);
    return item;
  }
}

/** 활성화된 유저 판매 물품 목록 조회 */
export async function getActiveMarketItems() {
  if (dbAvailable) {
    const { rows } = await pool.query(
      `SELECT * FROM jk_market_items WHERE is_active = true AND stock > 0 ORDER BY created_at DESC LIMIT 100`
    );
    return rows;
  } else {
    return memMarketItems.filter(i => i.is_active && i.stock > 0);
  }
}

/** 특정 유저의 등록 물품 목록 */
export async function getSellerMarketItems(sellerId) {
  if (dbAvailable) {
    const { rows } = await pool.query(
      `SELECT * FROM jk_market_items WHERE seller_id = $1 ORDER BY created_at DESC`,
      [sellerId]
    );
    return rows;
  } else {
    return memMarketItems.filter(i => i.seller_id === sellerId);
  }
}

/** 유저 판매 물품 판매 취소/내리기 */
export async function cancelMarketItem(sellerId, itemId) {
  if (dbAvailable) {
    const { rowCount } = await pool.query(
      `UPDATE jk_market_items SET is_active = false WHERE id = $1 AND seller_id = $2`,
      [itemId, sellerId]
    );
    return rowCount > 0;
  } else {
    const item = memMarketItems.find(i => i.id === Number(itemId) && i.seller_id === sellerId);
    if (item) {
      item.is_active = false;
      return true;
    }
    return false;
  }
}

/** 장바구니 결제 트랜잭션 (유저 판매 물품 구매 시 판매자 카지노 잔고로 즉시 입금) */
export async function processCheckout({ uid, userName, items, totalAmount, receiptNo }) {
  if (dbAvailable) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. 구매자 잔고 체크 & 잠금
      const { rows } = await client.query(
        'SELECT balance FROM ns_players WHERE id = $1 FOR UPDATE',
        [uid]
      );
      if (!rows.length) throw new Error('구매자 정보를 찾을 수 없습니다.');
      const currentBalance = rows[0].balance;
      if (currentBalance < totalAmount) {
        throw new Error(`잔고가 부족합니다! (보유: ₩${currentBalance.toLocaleString()} / 필요: ₩${totalAmount.toLocaleString()})`);
      }

      // 2. 구매자 잔고 차감
      const newBalRes = await client.query(
        'UPDATE ns_players SET balance = balance - $2 WHERE id = $1 RETURNING balance',
        [uid, totalAmount]
      );
      const balanceAfter = newBalRes.rows[0].balance;

      // 3. 구매자 원장 기록
      await client.query(
        'INSERT INTO ns_ledger (player_id, delta, balance_after, reason, ref) VALUES ($1, $2, $3, $4, $5)',
        [uid, -totalAmount, balanceAfter, 'jarket_purchase', receiptNo]
      );

      // 4. 유저 판매 물품 정산: 각 물품의 판매자 카지노 잔고로 즉시 입금!
      for (const it of items) {
        if (it.sellerId) {
          if (it.sellerId === uid) {
            throw new Error(`본인이 등록한 판매 물품([${it.name}])은 직접 구매할 수 없습니다.`);
          }
          const lineEarnings = it.price * it.qty;

          // 재고 차감 및 판매 카운트 증가
          const mItemRes = await client.query(
            `UPDATE jk_market_items
             SET stock = stock - $1, sales_count = sales_count + $1, is_active = (stock - $1 > 0)
             WHERE id = $2 AND stock >= $1 AND is_active = true
             RETURNING *`,
            [it.qty, it.marketItemId]
          );
          if (!mItemRes.rows.length) {
            throw new Error(`[${it.name}] 상품의 재고가 부족하거나 판매가 종료되었습니다.`);
          }

          // 판매자 카지노 잔고 입금 (ns_players)
          const sellerRes = await client.query(
            `UPDATE ns_players SET balance = balance + $1 WHERE id = $2 RETURNING balance`,
            [lineEarnings, it.sellerId]
          );
          const sellerBalAfter = sellerRes.rows[0]?.balance || lineEarnings;

          // 판매자 원장 기록 (ns_ledger)
          await client.query(
            `INSERT INTO ns_ledger (player_id, delta, balance_after, reason, ref)
             VALUES ($1, $2, $3, 'jarket_sale_revenue', $4)`,
            [it.sellerId, lineEarnings, sellerBalAfter, receiptNo]
          );
        }
      }

      // 5. 주문 영수증 등록
      const totalItemCount = items.reduce((s, it) => s + it.qty, 0);
      await client.query(
        `INSERT INTO jk_orders (user_id, user_name, receipt_no, total_amount, item_count, items_json)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [uid, userName, receiptNo, totalAmount, totalItemCount, JSON.stringify(items)]
      );

      // 6. 구매자 인벤토리 추가
      for (const it of items) {
        await client.query(
          `INSERT INTO jk_inventory (user_id, item_id, name, category, icon, unit_price, quantity, last_bought_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, now())
           ON CONFLICT (user_id, item_id)
           DO UPDATE SET quantity = jk_inventory.quantity + EXCLUDED.quantity, last_bought_at = now()`,
          [uid, it.id, it.name, it.category, it.icon, it.price, it.qty]
        );
      }

      await client.query('COMMIT');
      return { balanceAfter, receiptNo };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } else {
    // 메모리 모드
    const p = await getPlayer(uid, userName);
    if (p.balance < totalAmount) {
      throw new Error(`잔고가 부족합니다! (보유: ₩${p.balance.toLocaleString()} / 필요: ₩${totalAmount.toLocaleString()})`);
    }
    p.balance -= totalAmount;

    for (const it of items) {
      if (it.sellerId) {
        if (it.sellerId === uid) throw new Error(`본인이 등록한 물품([${it.name}])은 구매할 수 없습니다.`);
        const mItem = memMarketItems.find(m => m.id === Number(it.marketItemId));
        if (!mItem || mItem.stock < it.qty || !mItem.is_active) {
          throw new Error(`[${it.name}] 상품의 재고가 부족합니다.`);
        }
        mItem.stock -= it.qty;
        mItem.sales_count += it.qty;
        if (mItem.stock <= 0) mItem.is_active = false;

        // 판매자 카지노 잔고 지급
        const seller = await getPlayer(it.sellerId);
        seller.balance += it.price * it.qty;
      }
    }

    const totalItemCount = items.reduce((s, it) => s + it.qty, 0);
    const order = {
      id: memOrders.length + 1,
      user_id: uid,
      user_name: userName,
      receipt_no: receiptNo,
      total_amount: totalAmount,
      item_count: totalItemCount,
      items_json: items,
      created_at: new Date().toISOString(),
    };
    memOrders.unshift(order);

    for (const it of items) {
      const key = `${uid}:${it.id}`;
      if (memInventory.has(key)) {
        const exist = memInventory.get(key);
        exist.quantity += it.qty;
        exist.last_bought_at = new Date().toISOString();
      } else {
        memInventory.set(key, {
          user_id: uid,
          item_id: it.id,
          name: it.name,
          category: it.category,
          icon: it.icon,
          unit_price: it.price,
          quantity: it.qty,
          last_bought_at: new Date().toISOString(),
        });
      }
    }

    return { balanceAfter: p.balance, receiptNo };
  }
}

/** 유저 인벤토리 목록 (각 아이템별 스킬 정보 포함) */
export async function getUserInventory(uid) {
  if (dbAvailable) {
    const { rows } = await pool.query(
      'SELECT * FROM jk_inventory WHERE user_id = $1 ORDER BY last_bought_at DESC',
      [uid]
    );
    return rows.map(r => ({
      ...r,
      skill: getProductSkill(r)
    }));
  } else {
    return Array.from(memInventory.values())
      .filter(i => i.user_id === uid)
      .map(i => ({
        ...i,
        skill: getProductSkill(i)
      }));
  }
}

/** 아이템 고유 스킬 사용 (인벤토리 수량 1 차감 및 카지노 잔고 페이백 & 특수 효과) */
export async function useInventoryItem({ uid, userName, itemId }) {
  if (dbAvailable) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. 인벤토리 내 해당 아이템 존재 여부 및 수량 확인 (행 잠금)
      const { rows } = await client.query(
        'SELECT * FROM jk_inventory WHERE user_id = $1 AND item_id = $2 FOR UPDATE',
        [uid, itemId]
      );
      if (!rows.length || rows[0].quantity <= 0) {
        throw new Error('보관함에 해당 아이템이 없거나 이미 모두 소진되었습니다.');
      }
      const invItem = rows[0];

      // 2. 스킬 정보 추출
      const skill = getProductSkill(invItem);
      if (!skill) {
        throw new Error('해당 아이템에는 사용할 수 있는 스킬이 없습니다.');
      }

      // 3. 인벤토리 수량 1 차감 (1개면 삭제, 2개 이상이면 감소)
      if (invItem.quantity > 1) {
        await client.query(
          'UPDATE jk_inventory SET quantity = quantity - 1 WHERE user_id = $1 AND item_id = $2',
          [uid, itemId]
        );
      } else {
        await client.query(
          'DELETE FROM jk_inventory WHERE user_id = $1 AND item_id = $2',
          [uid, itemId]
        );
      }

      // 4. 스킬 보상 계산 (minReward ~ maxReward 랜덤 정수)
      const min = skill.minReward || 1;
      const max = Math.max(min, skill.maxReward || min);
      const reward = Math.floor(Math.random() * (max - min + 1)) + min;

      // 5. 카지노 잔고 지급 및 원장 기록
      const newBalRes = await client.query(
        'UPDATE ns_players SET balance = balance + $1 WHERE id = $2 RETURNING balance',
        [reward, uid]
      );
      const balanceAfter = newBalRes.rows[0]?.balance;

      await client.query(
        `INSERT INTO ns_ledger (player_id, delta, balance_after, reason, ref)
         VALUES ($1, $2, $3, 'jarket_item_skill', $4)`,
        [uid, reward, balanceAfter, `${itemId}:${skill.id}`]
      );

      await client.query('COMMIT');
      return {
        ok: true,
        itemId,
        itemName: invItem.name,
        icon: invItem.icon,
        skill,
        reward,
        balanceAfter,
        remainingQty: invItem.quantity - 1,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } else {
    // 로컬 메모리 모드
    const key = `${uid}:${itemId}`;
    const exist = memInventory.get(key);
    if (!exist || exist.quantity <= 0) {
      throw new Error('보관함에 해당 아이템이 없습니다.');
    }

    const skill = getProductSkill(exist);
    if (!skill) throw new Error('해당 아이템에는 스킬이 없습니다.');

    exist.quantity -= 1;
    if (exist.quantity <= 0) {
      memInventory.delete(key);
    }

    const min = skill.minReward || 1;
    const max = Math.max(min, skill.maxReward || min);
    const reward = Math.floor(Math.random() * (max - min + 1)) + min;

    const p = await getPlayer(uid, userName);
    p.balance += reward;

    return {
      ok: true,
      itemId,
      itemName: exist.name,
      icon: exist.icon,
      skill,
      reward,
      balanceAfter: p.balance,
      remainingQty: exist.quantity,
    };
  }
}

/** 보유한 모든 인벤토리 아이템 스킬 동시 발동! */
export async function useAllInventoryItems({ uid, userName }) {
  if (dbAvailable) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows } = await client.query(
        'SELECT * FROM jk_inventory WHERE user_id = $1 AND quantity > 0 FOR UPDATE',
        [uid]
      );
      if (!rows.length) {
        throw new Error('보관함에 사용할 수 있는 아이템이 없습니다.');
      }

      let totalReward = 0;
      const triggeredSkills = [];

      for (const item of rows) {
        const skill = getProductSkill(item);
        if (!skill) continue;

        // 수량 1개 차감
        if (item.quantity > 1) {
          await client.query(
            'UPDATE jk_inventory SET quantity = quantity - 1 WHERE user_id = $1 AND item_id = $2',
            [uid, item.item_id]
          );
        } else {
          await client.query(
            'DELETE FROM jk_inventory WHERE user_id = $1 AND item_id = $2',
            [uid, item.item_id]
          );
        }

        const min = skill.minReward || 5;
        const max = Math.max(min, skill.maxReward || min * 2);
        const reward = Math.floor(Math.random() * (max - min + 1)) + min;
        totalReward += reward;

        triggeredSkills.push({
          itemId: item.item_id,
          name: item.name,
          icon: item.icon,
          skillName: skill.name,
          badge: skill.badge,
          reward
        });
      }

      const newBalRes = await client.query(
        'UPDATE ns_players SET balance = balance + $1 WHERE id = $2 RETURNING balance',
        [totalReward, uid]
      );
      const balanceAfter = newBalRes.rows[0]?.balance;

      await client.query(
        `INSERT INTO ns_ledger (player_id, delta, balance_after, reason, ref)
         VALUES ($1, $2, $3, 'jarket_combo_skills', $4)`,
        [uid, totalReward, balanceAfter, `combo_${triggeredSkills.length}_items`]
      );

      await client.query('COMMIT');
      return {
        ok: true,
        comboCount: triggeredSkills.length,
        totalReward,
        balanceAfter,
        triggeredSkills
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } else {
    // 메모리 모드
    const userItems = Array.from(memInventory.values()).filter(i => i.user_id === uid && i.quantity > 0);
    if (!userItems.length) throw new Error('보관함에 아이템이 없습니다.');

    let totalReward = 0;
    const triggeredSkills = [];

    for (const item of userItems) {
      const skill = getProductSkill(item);
      item.quantity -= 1;
      if (item.quantity <= 0) {
        memInventory.delete(`${uid}:${item.item_id}`);
      }

      const min = skill?.minReward || 5;
      const max = Math.max(min, skill?.maxReward || min * 2);
      const reward = Math.floor(Math.random() * (max - min + 1)) + min;
      totalReward += reward;

      triggeredSkills.push({
        itemId: item.item_id,
        name: item.name,
        icon: item.icon,
        skillName: skill?.name || '스킬',
        badge: skill?.badge || '스킬',
        reward
      });
    }

    const p = await getPlayer(uid, userName);
    p.balance += totalReward;

    return {
      ok: true,
      comboCount: triggeredSkills.length,
      totalReward,
      balanceAfter: p.balance,
      triggeredSkills
    };
  }
}

/** 유저 주문 영수증 내역 */
export async function getUserOrders(uid) {
  if (dbAvailable) {
    const { rows } = await pool.query(
      'SELECT * FROM jk_orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20',
      [uid]
    );
    return rows;
  } else {
    return memOrders.filter(o => o.user_id === uid);
  }
}

/** 특정 영수증 번호로 조회 */
export async function getReceipt(receiptNo) {
  if (dbAvailable) {
    const { rows } = await pool.query('SELECT * FROM jk_orders WHERE receipt_no = $1', [receiptNo]);
    return rows[0] || null;
  } else {
    return memOrders.find(o => o.receipt_no === receiptNo) || null;
  }
}

/* =========================================================
   관리자 (점장실) 기능
   ========================================================= */

/** 관리자: 매출 및 영업 요약 통계 */
export async function getAdminStats() {
  if (dbAvailable) {
    const ordersRes = await pool.query(`
      SELECT
        COUNT(*)::int AS total_orders,
        COALESCE(SUM(CASE WHEN status != 'refunded' THEN total_amount ELSE 0 END), 0)::bigint AS total_revenue,
        COUNT(DISTINCT user_id)::int AS unique_buyers,
        COALESCE(AVG(CASE WHEN status != 'refunded' THEN total_amount ELSE NULL END), 0)::int AS avg_order_amount
      FROM jk_orders
    `);
    const marketRes = await pool.query(`
      SELECT
        COUNT(*)::int AS total_market_items,
        COUNT(CASE WHEN is_active THEN 1 END)::int AS active_market_items,
        COALESCE(SUM(sales_count), 0)::int AS total_market_sales
      FROM jk_market_items
    `);
    const playersRes = await pool.query(`
      SELECT COUNT(*)::int AS total_players FROM ns_players
    `);

    return {
      totalOrders: ordersRes.rows[0].total_orders,
      totalRevenue: ordersRes.rows[0].total_revenue,
      uniqueBuyers: ordersRes.rows[0].unique_buyers,
      avgOrderAmount: ordersRes.rows[0].avg_order_amount,
      totalMarketItems: marketRes.rows[0].total_market_items,
      activeMarketItems: marketRes.rows[0].active_market_items,
      totalMarketSales: marketRes.rows[0].total_market_sales,
      totalPlayers: playersRes.rows[0].total_players,
    };
  } else {
    const validOrders = memOrders.filter(o => o.status !== 'refunded');
    return {
      totalOrders: memOrders.length,
      totalRevenue: validOrders.reduce((s, o) => s + (o.total_amount || 0), 0),
      uniqueBuyers: new Set(memOrders.map(o => o.user_id)).size,
      avgOrderAmount: validOrders.length ? Math.round(validOrders.reduce((s, o) => s + (o.total_amount || 0), 0) / validOrders.length) : 0,
      totalMarketItems: memMarketItems.length,
      activeMarketItems: memMarketItems.filter(m => m.is_active).length,
      totalMarketSales: memMarketItems.reduce((s, m) => s + (m.sales_count || 0), 0),
      totalPlayers: memPlayers.size,
    };
  }
}

/** 관리자: 전체 주문 내역 목록 (필터/검색 지원) */
export async function getAdminOrders({ search = '', status = 'all', limit = 50, offset = 0 } = {}) {
  limit = Math.min(100, Math.max(1, Number(limit) || 50));
  offset = Math.max(0, Number(offset) || 0);

  if (dbAvailable) {
    const whereClauses = [];
    const params = [];
    let idx = 1;

    if (status && status !== 'all') {
      whereClauses.push(`status = $${idx++}`);
      params.push(status);
    }
    if (search && search.trim()) {
      whereClauses.push(`(receipt_no ILIKE $${idx} OR user_name ILIKE $${idx} OR user_id ILIKE $${idx})`);
      params.push(`%${search.trim()}%`);
      idx++;
    }

    const whereStr = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const countRes = await pool.query(`SELECT COUNT(*)::int AS count FROM jk_orders ${whereStr}`, params);
    const totalCount = countRes.rows[0].count;

    const dataRes = await pool.query(
      `SELECT * FROM jk_orders ${whereStr} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limit, offset]
    );

    return { orders: dataRes.rows, totalCount, limit, offset };
  } else {
    let list = memOrders;
    if (status && status !== 'all') list = list.filter(o => o.status === status);
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(o =>
        (o.receipt_no && o.receipt_no.toLowerCase().includes(q)) ||
        (o.user_name && o.user_name.toLowerCase().includes(q))
      );
    }
    return {
      orders: list.slice(offset, offset + limit),
      totalCount: list.length,
      limit,
      offset
    };
  }
}

/** 관리자: 주문 취소 및 구매자 카지노 잔고 즉시 전액 환불 */
export async function refundOrderAdmin(receiptNo, reason = '점장 직권 주문 취소 환불') {
  if (dbAvailable) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT * FROM jk_orders WHERE receipt_no = $1 FOR UPDATE', [receiptNo]);
      if (!rows.length) throw new Error('해당 주문 영수증을 찾을 수 없습니다.');
      const order = rows[0];
      if (order.status === 'refunded') throw new Error('이미 환불 처리된 주문입니다.');

      // 1. 구매자 잔고 환불
      const balRes = await client.query(
        'UPDATE ns_players SET balance = balance + $1 WHERE id = $2 RETURNING balance',
        [order.total_amount, order.user_id]
      );
      const balanceAfter = balRes.rows[0]?.balance || 0;

      // 2. 카지노 거래 원장 기록 (ns_ledger)
      await client.query(
        `INSERT INTO ns_ledger (player_id, delta, balance_after, reason, ref)
         VALUES ($1, $2, $3, 'jarket_order_refund', $4)`,
        [order.user_id, order.total_amount, balanceAfter, receiptNo]
      );

      // 3. 주문 상태 변경
      const updatedOrder = await client.query(
        `UPDATE jk_orders SET status = 'refunded', refunded_at = now() WHERE receipt_no = $1 RETURNING *`,
        [receiptNo]
      );

      await client.query('COMMIT');
      return { ok: true, order: updatedOrder.rows[0], refundedAmount: order.total_amount };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } else {
    const order = memOrders.find(o => o.receipt_no === receiptNo);
    if (!order) throw new Error('해당 주문을 찾을 수 없습니다.');
    if (order.status === 'refunded') throw new Error('이미 환불된 주문입니다.');
    order.status = 'refunded';
    order.refunded_at = new Date().toISOString();
    const p = memPlayers.get(order.user_id);
    if (p) p.balance += order.total_amount;
    return { ok: true, order, refundedAmount: order.total_amount };
  }
}

/** 관리자: 전체 유저 마켓 매물 목록 (활성/비활성 포함) */
export async function getAdminMarketItems() {
  if (dbAvailable) {
    const { rows } = await pool.query(
      'SELECT * FROM jk_market_items ORDER BY created_at DESC LIMIT 100'
    );
    return rows;
  } else {
    return memMarketItems;
  }
}

/** 관리자: 유저 마켓 매물 강제 철거/삭제 */
export async function deleteMarketItemAdmin(itemId) {
  if (dbAvailable) {
    const { rows } = await pool.query(
      'UPDATE jk_market_items SET is_active = false WHERE id = $1 RETURNING *',
      [itemId]
    );
    if (!rows.length) throw new Error('해당 매물을 찾을 수 없습니다.');
    return rows[0];
  } else {
    const item = memMarketItems.find(m => m.id === Number(itemId));
    if (!item) throw new Error('해당 매물을 찾을 수 없습니다.');
    item.is_active = false;
    return item;
  }
}

/** 관리자: 고객 명단 및 잔고/접속 현황 */
export async function getAdminPlayers() {
  if (dbAvailable) {
    const { rows } = await pool.query(
      'SELECT id, name, balance, last_seen FROM ns_players ORDER BY last_seen DESC NULLS LAST LIMIT 50'
    );
    return rows;
  } else {
    return Array.from(memPlayers.values());
  }
}

/** 관리자: 점장 특권 보너스 칩 지급 */
export async function giftPlayerChips(playerId, amount, reason = '점장 특별 지원금') {
  amount = Math.round(Number(amount));
  if (!amount || amount <= 0) throw new Error('지급할 칩 금액을 0보다 큰 숫자로 입력해주세요.');

  if (dbAvailable) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT * FROM ns_players WHERE id = $1 FOR UPDATE', [playerId]);
      if (!rows.length) throw new Error('해당 플레이어를 찾을 수 없습니다.');
      const balRes = await client.query(
        'UPDATE ns_players SET balance = balance + $1 WHERE id = $2 RETURNING balance',
        [amount, playerId]
      );
      const balanceAfter = balRes.rows[0].balance;
      await client.query(
        `INSERT INTO ns_ledger (player_id, delta, balance_after, reason, ref)
         VALUES ($1, $2, $3, 'jarket_admin_gift', $4)`,
        [playerId, amount, balanceAfter, reason]
      );
      await client.query('COMMIT');
      return { ok: true, playerId, balanceAfter, amount };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } else {
    const p = memPlayers.get(playerId);
    if (!p) throw new Error('해당 플레이어를 찾을 수 없습니다.');
    p.balance += amount;
    return { ok: true, playerId, balanceAfter: p.balance, amount };
  }
}
