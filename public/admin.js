/* =========================================================
   JARKET (자켓마트) — 점장실 백오피스 관리자 프론트엔드 (admin.js)
   ========================================================= */

// State
let adminPin = sessionStorage.getItem('jarket_admin_pin') || '';
let oneidToken = localStorage.getItem('oneid_token') || sessionStorage.getItem('oneid_token') || '';
let currentTab = 'dashboard';
let statsData = null;
let ordersList = [];
let marketItemsList = [];
let productsList = [];
let playersList = [];

// DOM Elements
const lockScreen = document.getElementById('lockScreen');
const adminWrapper = document.getElementById('adminWrapper');
const pinForm = document.getElementById('pinForm');
const pinInput = document.getElementById('pinInput');
const lockError = document.getElementById('lockError');
const oneidAdminBtn = document.getElementById('oneidAdminBtn');
const adminNameDisplay = document.getElementById('adminNameDisplay');
const adminLogoutBtn = document.getElementById('adminLogoutBtn');
const refreshAllBtn = document.getElementById('refreshAllBtn');
const navTabs = document.querySelectorAll('.nav-tab');
const tabPanes = document.querySelectorAll('.tab-pane');

// Modals
const receiptModal = document.getElementById('receiptModal');
const receiptModalBody = document.getElementById('receiptModalBody');
const closeReceiptModalBtn = document.getElementById('closeReceiptModalBtn');

const giftModal = document.getElementById('giftModal');
const giftForm = document.getElementById('giftForm');
const giftTargetName = document.getElementById('giftTargetName');
const giftTargetId = document.getElementById('giftTargetId');
const giftAmountInput = document.getElementById('giftAmountInput');
const giftReasonInput = document.getElementById('giftReasonInput');
const closeGiftModalBtn = document.getElementById('closeGiftModalBtn');
const cancelGiftBtn = document.getElementById('cancelGiftBtn');

// Toast
function showToast(msg, type = 'info') {
  const wrap = document.getElementById('adminToastWrap');
  if (!wrap) return;
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  wrap.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    t.style.transform = 'translateY(10px)';
    t.style.transition = 'all 0.3s ease';
    setTimeout(() => t.remove(), 300);
  }, 3500);
}

// Headers helper
function getAuthHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (adminPin) h['x-admin-pin'] = adminPin;
  if (oneidToken) h['Authorization'] = `Bearer ${oneidToken}`;
  return h;
}

// 1. 초기 인증 체크
async function checkAuth() {
  if (!adminPin && !oneidToken) {
    showLockScreen();
    return;
  }

  try {
    const res = await fetch('/api/admin/check', {
      headers: getAuthHeaders()
    });
    if (res.ok) {
      const data = await res.json();
      adminNameDisplay.textContent = data.user?.name || '총괄점장';
      unlockAdmin();
    } else {
      showLockScreen();
    }
  } catch (err) {
    showLockScreen();
  }
}

function showLockScreen() {
  lockScreen.style.display = 'flex';
  adminWrapper.style.display = 'none';
}

function unlockAdmin() {
  lockScreen.style.display = 'none';
  adminWrapper.style.display = 'block';
  loadCurrentTab();
}

// PIN 로그인 제출
pinForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const pin = pinInput.value.trim();
  if (!pin) return;

  lockError.textContent = '인증 확인 중...';
  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin })
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      adminPin = pin;
      sessionStorage.setItem('jarket_admin_pin', pin);
      lockError.textContent = '';
      adminNameDisplay.textContent = data.user?.name || '총괄점장';
      unlockAdmin();
      showToast('점장실에 로그인되었습니다.', 'success');
    } else {
      lockError.textContent = data.error || 'PIN 번호가 일치하지 않습니다.';
    }
  } catch (err) {
    lockError.textContent = '서버 연결 실패';
  }
});

// ONEID 로그인 버튼
oneidAdminBtn.addEventListener('click', async () => {
  try {
    const confRes = await fetch('/api/config');
    const conf = await confRes.json();
    const returnUrl = encodeURIComponent(window.location.origin + '/admin');
    window.location.href = `${conf.oneidUrl}/login?client_id=${conf.clientId || 'jarket'}&redirect_uri=${returnUrl}`;
  } catch {
    window.location.href = 'https://oneid-icvq.onrender.com';
  }
});

// 로그아웃
adminLogoutBtn.addEventListener('click', () => {
  sessionStorage.removeItem('jarket_admin_pin');
  adminPin = '';
  showToast('점장실에서 로그아웃되었습니다.');
  showLockScreen();
});

// 2. 탭 전환
navTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab;
    switchTab(target);
  });
});

function switchTab(tabId) {
  currentTab = tabId;
  navTabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tabId));
  tabPanes.forEach(p => p.classList.toggle('active', p.id === `pane-${tabId}`));
  loadCurrentTab();
}

document.getElementById('gotoOrdersTabBtn')?.addEventListener('click', () => switchTab('orders'));

// 새로고침 버튼
refreshAllBtn.addEventListener('click', () => {
  loadCurrentTab(true);
  showToast('데이터를 새로고침했습니다.');
});

// 3. 탭별 데이터 로더
function loadCurrentTab(force = false) {
  if (currentTab === 'dashboard') loadDashboard();
  else if (currentTab === 'orders') loadOrders();
  else if (currentTab === 'market') loadMarket();
  else if (currentTab === 'operations') loadOperations();
  else if (currentTab === 'players') loadPlayers();
}

// --- [대시보드 로드] ---
async function loadDashboard() {
  try {
    const [statsRes, annRes, ordersRes] = await Promise.all([
      fetch('/api/admin/stats', { headers: getAuthHeaders() }),
      fetch('/api/admin/announcement'),
      fetch('/api/admin/orders?limit=5', { headers: getAuthHeaders() })
    ]);

    if (statsRes.ok) {
      const data = await statsRes.json();
      statsData = data.stats;
      document.getElementById('statRevenue').textContent = `$${(statsData.totalRevenue || 0).toLocaleString()}`;
      document.getElementById('statOrders').textContent = `${(statsData.totalOrders || 0).toLocaleString()}건`;
      document.getElementById('statAvgOrder').textContent = `$${(statsData.avgOrderAmount || 0).toLocaleString()}`;
      document.getElementById('statBuyers').textContent = `${(statsData.uniqueBuyers || 0).toLocaleString()}명`;
      document.getElementById('statTotalPlayers').textContent = `${(statsData.totalPlayers || 0).toLocaleString()}`;
      document.getElementById('statMarketItems').textContent = `${(statsData.totalMarketItems || 0).toLocaleString()}개`;
      document.getElementById('statActiveMarket').textContent = `${(statsData.activeMarketItems || 0).toLocaleString()}`;
      document.getElementById('statMarketSales').textContent = `${(statsData.totalMarketSales || 0).toLocaleString()}`;

      document.getElementById('tabOrdersCount').textContent = statsData.totalOrders || 0;
      document.getElementById('tabMarketCount').textContent = statsData.activeMarketItems || 0;
    }

    if (annRes.ok) {
      const ann = await annRes.json();
      document.getElementById('quickAnnouncementInput').value = ann.text || '';
    }

    if (ordersRes.ok) {
      const odata = await ordersRes.json();
      renderRecentOrders(odata.orders || []);
    }
  } catch (err) {
    console.error(err);
  }
}

function renderRecentOrders(orders) {
  const container = document.getElementById('recentOrdersList');
  if (!orders.length) {
    container.innerHTML = '<p class="empty-hint">아직 접수된 주문 영수증이 없습니다.</p>';
    return;
  }

  container.innerHTML = orders.map(o => `
    <div class="feed-item">
      <div class="feed-left">
        <span class="feed-no">${o.receipt_no}</span>
        <span class="feed-buyer">고객: ${escapeHtml(o.user_name)} (품목 ${o.item_count}개)</span>
      </div>
      <div class="feed-right">
        <span class="feed-price">$${Number(o.total_amount).toLocaleString()}</span>
        <div class="feed-time">${formatDate(o.created_at)}</div>
      </div>
    </div>
  `).join('');
}

// 전광판 저장
document.getElementById('saveAnnouncementBtn')?.addEventListener('click', async () => {
  const text = document.getElementById('quickAnnouncementInput').value.trim();
  if (!text) return alert('전광판 문구를 입력해주세요.');

  try {
    const res = await fetch('/api/admin/announcement', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ text })
    });
    if (res.ok) {
      showToast('전광판 문구가 즉시 갱신되었습니다!', 'success');
    } else {
      const err = await res.json();
      alert(err.error || '저장 실패');
    }
  } catch (err) {
    alert('전광판 업데이트 오류');
  }
});

// --- [주문 관리 로드] ---
async function loadOrders() {
  const status = document.getElementById('orderStatusFilter')?.value || 'all';
  const search = document.getElementById('orderSearchInput')?.value.trim() || '';

  try {
    const res = await fetch(`/api/admin/orders?status=${encodeURIComponent(status)}&search=${encodeURIComponent(search)}&limit=100`, {
      headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error('주문 조회 실패');
    const data = await res.json();
    ordersList = data.orders || [];
    renderOrdersTable(ordersList);
    document.getElementById('tabOrdersCount').textContent = data.totalCount || ordersList.length;
  } catch (err) {
    console.error(err);
  }
}

document.getElementById('searchOrdersBtn')?.addEventListener('click', loadOrders);
document.getElementById('orderStatusFilter')?.addEventListener('change', loadOrders);
document.getElementById('orderSearchInput')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loadOrders();
});

function renderOrdersTable(orders) {
  const tbody = document.getElementById('ordersTableBody');
  if (!orders.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-cell">검색 조건에 일치하는 주문 내역이 없습니다.</td></tr>';
    return;
  }

  tbody.innerHTML = orders.map(o => {
    const items = typeof o.items_json === 'string' ? JSON.parse(o.items_json) : (o.items_json || []);
    const itemsSummary = items.map(i => `${i.icon || '📦'} ${i.name} (${i.qty}개)`).join(', ');
    const isRefunded = o.status === 'refunded';

    return `
      <tr>
        <td class="mono"><b>${o.receipt_no}</b></td>
        <td><b>${escapeHtml(o.user_name)}</b><br><small class="mono" style="color:#666;">${o.user_id.slice(0, 8)}...</small></td>
        <td style="max-width:280px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(itemsSummary)}">
          ${escapeHtml(itemsSummary)}
        </td>
        <td>${o.item_count}개</td>
        <td class="mono" style="color:var(--admin-yellow); font-weight:800;">$${Number(o.total_amount).toLocaleString()}</td>
        <td style="font-size:0.78rem; color:#888;">${formatDate(o.created_at)}</td>
        <td>
          <span class="status-badge ${isRefunded ? 'refunded' : 'completed'}">
            ${isRefunded ? '🚨 환불 완료' : '✅ 결제 완료'}
          </span>
        </td>
        <td>
          <button class="btn-tbl btn-tbl-view" onclick="viewReceiptDetail('${o.receipt_no}')">영수증</button>
          ${!isRefunded ? `<button class="btn-tbl btn-tbl-refund" onclick="triggerRefund('${o.receipt_no}', ${o.total_amount}, '${escapeHtml(o.user_name)}')">전액 환불</button>` : ''}
        </td>
      </tr>
    `;
  }).join('');
}

// 주문 환불 실행
window.triggerRefund = async function(receiptNo, amount, userName) {
  if (!confirm(`[긴급] 정말로 주문 ${receiptNo}을 취소하고,\n고객 [${userName}]님의 카지노 지갑으로 $${amount.toLocaleString()} 칩을 즉시 전액 환불하시겠습니까?`)) {
    return;
  }

  try {
    const res = await fetch(`/api/admin/orders/${receiptNo}/refund`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ reason: '점장 직권 주문 취소 환불' })
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      showToast(`주문 ${receiptNo}이 취소되고 카지노 칩 $${amount.toLocaleString()}이 전액 환불되었습니다!`, 'success');
      loadOrders();
      loadDashboard();
    } else {
      alert(data.error || '환불 처리에 실패했습니다.');
    }
  } catch (err) {
    alert('환불 요청 중 오류가 발생했습니다.');
  }
};

// 영수증 상세 모달 열기
window.viewReceiptDetail = function(receiptNo) {
  const o = ordersList.find(x => x.receipt_no === receiptNo);
  if (!o) return;

  const items = typeof o.items_json === 'string' ? JSON.parse(o.items_json) : (o.items_json || []);

  receiptModalBody.innerHTML = `
    <div style="background:#FFF; color:#000; padding:20px; font-family:monospace; border-radius:6px; box-shadow:0 4px 10px rgba(0,0,0,0.3);">
      <div style="text-align:center; border-bottom:1px dashed #999; padding-bottom:10px; margin-bottom:10px;">
        <h3 style="margin:0; font-size:18px;">[ 자 켓 마 트 ]</h3>
        <small>JARKET HYPERMARKET (점장실 사본)</small>
      </div>
      <div>영수증번호: <b>${o.receipt_no}</b></div>
      <div>주문일시: ${formatDate(o.created_at)}</div>
      <div>주문고객: ${escapeHtml(o.user_name)} (ID: ${o.user_id})</div>
      <div>상태: <b style="color:${o.status === 'refunded' ? 'red' : 'green'};">${o.status === 'refunded' ? '환불완료 (CHIP REFUNDED)' : '정상결제 (COMPLETED)'}</b></div>
      <div style="border-bottom:1px dashed #999; margin:10px 0;"></div>
      <table style="width:100%; font-size:12px; border-collapse:collapse;">
        <thead>
          <tr style="border-bottom:1px solid #ccc;">
            <th style="text-align:left;">품목</th>
            <th style="text-align:center;">수량</th>
            <th style="text-align:right;">금액</th>
          </tr>
        </thead>
        <tbody>
          ${items.map(it => `
            <tr>
              <td>${it.icon || ''} ${it.name}</td>
              <td style="text-align:center;">${it.qty}</td>
              <td style="text-align:right;">$${(it.lineTotal || (it.price * it.qty)).toLocaleString()}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <div style="border-bottom:1px dashed #999; margin:10px 0;"></div>
      <div style="display:flex; justify-content:space-between; font-size:16px; font-weight:bold;">
        <span>합계 금액:</span>
        <span>$${Number(o.total_amount).toLocaleString()}</span>
      </div>
    </div>
  `;
  receiptModal.style.display = 'flex';
};

closeReceiptModalBtn?.addEventListener('click', () => {
  receiptModal.style.display = 'none';
});

// --- [유저 마켓 관리 로드] ---
async function loadMarket() {
  try {
    const res = await fetch('/api/admin/market/items', { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('마켓 매물 조회 실패');
    const data = await res.json();
    marketItemsList = data.items || [];
    renderMarketTable(marketItemsList);
    document.getElementById('tabMarketCount').textContent = marketItemsList.filter(m => m.is_active).length;
  } catch (err) {
    console.error(err);
  }
}

document.getElementById('refreshMarketBtn')?.addEventListener('click', loadMarket);

function renderMarketTable(items) {
  const tbody = document.getElementById('marketTableBody');
  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty-cell">등록된 유저 판매 매물이 없습니다.</td></tr>';
    return;
  }

  tbody.innerHTML = items.map(m => `
    <tr>
      <td class="mono">#${m.id}</td>
      <td style="font-size:1.5rem;">${m.icon || '📦'}</td>
      <td>
        <b>${escapeHtml(m.name)}</b>
        <div style="font-size:0.75rem; color:#888;">${escapeHtml(m.desc_text || '')}</div>
      </td>
      <td>
        <b>${escapeHtml(m.seller_name)}</b><br>
        <small class="mono" style="color:#666;">${m.seller_id.slice(0, 8)}...</small>
      </td>
      <td class="mono" style="color:var(--admin-yellow); font-weight:700;">$${Number(m.price).toLocaleString()}</td>
      <td>${m.stock}개</td>
      <td>${m.sales_count}건</td>
      <td>
        <span class="status-badge ${m.is_active ? 'active' : 'inactive'}">
          ${m.is_active ? '🟢 판매중' : '⚪ 판매종료'}
        </span>
      </td>
      <td style="font-size:0.78rem; color:#888;">${formatDate(m.created_at)}</td>
      <td>
        ${m.is_active ? `<button class="btn-tbl btn-tbl-del" onclick="deleteMarketItem(${m.id}, '${escapeHtml(m.name)}')">강제 철거</button>` : '<span style="color:#666; font-size:0.75rem;">철거됨</span>'}
      </td>
    </tr>
  `).join('');
}

window.deleteMarketItem = async function(id, name) {
  if (!confirm(`[경고] 유저 판매 매물 [${name}]을 즉시 강제 철거/삭제하시겠습니까?`)) return;

  try {
    const res = await fetch(`/api/admin/market/items/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    if (res.ok) {
      showToast(`매물 #${id} [${name}]이 철거되었습니다.`, 'success');
      loadMarket();
    } else {
      const err = await res.json();
      alert(err.error || '철거 실패');
    }
  } catch (err) {
    alert('삭제 요청 오류');
  }
};

// --- [상품 / 전광판 운영 로드] ---
async function loadOperations() {
  try {
    const res = await fetch('/api/admin/products', { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('공식 상품 조회 실패');
    const data = await res.json();
    productsList = data.products || [];
    renderProductsTable(productsList);
  } catch (err) {
    console.error(err);
  }
}

function renderProductsTable(products) {
  const tbody = document.getElementById('productsTableBody');
  if (!products.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-cell">공식 상품 목록을 불러올 수 없습니다.</td></tr>';
    return;
  }

  tbody.innerHTML = products.map(p => `
    <tr>
      <td class="mono" style="color:#888;">${p.id}</td>
      <td style="font-size:1.6rem;">${p.icon || '🛒'}</td>
      <td>
        <b>${p.name}</b>
        <div style="font-size:0.75rem; color:#888;">${p.desc || ''}</div>
      </td>
      <td><span class="status-badge active">${p.category}</span></td>
      <td class="mono" style="color:var(--admin-yellow); font-weight:800;">$${Number(p.price).toLocaleString()}</td>
      <td style="font-size:0.8rem; color:#AAA;">${p.unit || ''}</td>
      <td><span class="status-badge" style="background:#333; color:#DDD;">${p.badge || '기본'}</span></td>
      <td>
        <span class="status-badge ${p.isSoldOut ? 'refunded' : 'completed'}">
          ${p.isSoldOut ? '🚨 일시 품절' : '🟢 정상 판매중'}
        </span>
      </td>
      <td>
        <button class="toggle-btn ${p.isSoldOut ? 'sold-out' : 'in-stock'}" onclick="toggleProductSoldOut('${p.id}', ${p.isSoldOut})">
          ${p.isSoldOut ? '판매 재개' : '품절 처리'}
        </button>
      </td>
    </tr>
  `).join('');
}

window.toggleProductSoldOut = async function(id, currentSoldOut) {
  try {
    const res = await fetch(`/api/admin/products/${id}/toggle-soldout`, {
      method: 'POST',
      headers: getAuthHeaders()
    });
    if (res.ok) {
      const data = await res.json();
      showToast(`상품 [${id}] 상태가 ${data.isSoldOut ? '품절' : '판매중'}으로 변경되었습니다.`, 'success');
      loadOperations();
    } else {
      alert('상태 변경 실패');
    }
  } catch (err) {
    alert('상품 스위치 오류');
  }
};

// --- [카지노 고객 잔고 관리 로드] ---
async function loadPlayers() {
  try {
    const res = await fetch('/api/admin/players', { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('고객 목록 조회 실패');
    const data = await res.json();
    playersList = data.players || [];
    renderPlayersTable(playersList);
  } catch (err) {
    console.error(err);
  }
}

document.getElementById('refreshPlayersBtn')?.addEventListener('click', loadPlayers);

function renderPlayersTable(players) {
  const tbody = document.getElementById('playersTableBody');
  if (!players.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">등록된 카지노 고객이 없습니다.</td></tr>';
    return;
  }

  tbody.innerHTML = players.map(p => `
    <tr>
      <td class="mono" style="font-size:0.75rem; color:#888;">${p.id}</td>
      <td><b>${escapeHtml(p.name)}</b></td>
      <td class="mono" style="color:var(--admin-yellow); font-size:1.1rem; font-weight:900;">$${Number(p.balance || 0).toLocaleString()}</td>
      <td style="font-size:0.78rem; color:#888;">${p.last_seen ? formatDate(p.last_seen) : '-'}</td>
      <td>
        <button class="btn-tbl btn-tbl-gift" onclick="openGiftModal('${p.id}', '${escapeHtml(p.name)}')">🎁 칩 지원금 지급</button>
      </td>
    </tr>
  `).join('');
}

// 칩 지급 모달
window.openGiftModal = function(id, name) {
  giftTargetId.value = id;
  giftTargetName.value = `${name} (${id.slice(0, 8)}...)`;
  giftAmountInput.value = '100';
  giftReasonInput.value = '자켓마트 단골 우대 특별 지원금';
  giftModal.style.display = 'flex';
};

closeGiftModalBtn?.addEventListener('click', () => giftModal.style.display = 'none');
cancelGiftBtn?.addEventListener('click', () => giftModal.style.display = 'none');

giftForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = giftTargetId.value;
  const amount = Number(giftAmountInput.value);
  const reason = giftReasonInput.value.trim() || '점장 특별 지원금';

  if (!amount || amount <= 0) return alert('금액을 올바르게 입력해주세요.');

  try {
    const res = await fetch(`/api/admin/players/${id}/gift`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ amount, reason })
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      showToast(`고객에게 $${amount.toLocaleString()} 칩이 성공적으로 지급되었습니다! (현재 잔고: $${data.balanceAfter.toLocaleString()})`, 'success');
      giftModal.style.display = 'none';
      loadPlayers();
    } else {
      alert(data.error || '지급 실패');
    }
  } catch (err) {
    alert('칩 지급 처리 오류');
  }
});

// 유틸리티
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDate(isoStr) {
  if (!isoStr) return '-';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return isoStr;
  return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

// 초기 실행
checkAuth();
