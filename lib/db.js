/* =========================================================
   JARKET (자켓마트) — Database Module (Neon Postgres)
   - vegas-slots 의 ns_players (잔고) 및 ns_ledger (원장) 직접 연동
   - jk_orders (주문 영수증), jk_inventory (구매 보관함) 관리
   ========================================================= */
import pg from 'pg';

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
    const test = await pool.query('SELECT 1');
    dbAvailable = true;
    console.log('[DB] Neon Postgres connected successfully.');

    // 1. vegas-slots ns_players 테이블 없으면 생성 (독립 실행 대응)
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
      // 신규 플레이어 자동 등록
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
        balance: 10_000_000, // 체험용 1천만 칩
        credit: 600,
        spins: 0,
      });
    }
    return memPlayers.get(uid);
  }
}

/** 장바구니 결제 트랜잭션 */
export async function processCheckout({ uid, userName, items, totalAmount, receiptNo }) {
  if (dbAvailable) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. 잔고 체크 & 잠금
      const { rows } = await client.query(
        'SELECT balance FROM ns_players WHERE id = $1 FOR UPDATE',
        [uid]
      );
      if (!rows.length) throw new Error('플레이어를 찾을 수 없습니다.');
      const currentBalance = rows[0].balance;
      if (currentBalance < totalAmount) {
        throw new Error(`잔고가 부족합니다! (보유: ₩${currentBalance.toLocaleString()} / 필요: ₩${totalAmount.toLocaleString()})`);
      }

      // 2. 잔고 차감
      const newBalRes = await client.query(
        'UPDATE ns_players SET balance = balance - $2 WHERE id = $1 RETURNING balance',
        [uid, totalAmount]
      );
      const balanceAfter = newBalRes.rows[0].balance;

      // 3. 원장 기록
      await client.query(
        'INSERT INTO ns_ledger (player_id, delta, balance_after, reason, ref) VALUES ($1, $2, $3, $4, $5)',
        [uid, -totalAmount, balanceAfter, 'jarket_purchase', receiptNo]
      );

      // 4. 주문 영수증 등록
      const totalItemCount = items.reduce((s, it) => s + it.qty, 0);
      await client.query(
        `INSERT INTO jk_orders (user_id, user_name, receipt_no, total_amount, item_count, items_json)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [uid, userName, receiptNo, totalAmount, totalItemCount, JSON.stringify(items)]
      );

      // 5. 인벤토리 추가 / 수량 누적
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

/** 유저 인벤토리 목록 */
export async function getUserInventory(uid) {
  if (dbAvailable) {
    const { rows } = await pool.query(
      'SELECT * FROM jk_inventory WHERE user_id = $1 ORDER BY last_bought_at DESC',
      [uid]
    );
    return rows;
  } else {
    return Array.from(memInventory.values()).filter(i => i.user_id === uid);
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
