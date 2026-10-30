/* =========================================================
   JARKET (자켓마트) — Frontend Application
   - 이마트 감성 가상 쇼핑몰 & NEON STRIP 슬롯 머니 결제 연동
   ========================================================= */

// ---------- 상태 ----------
let CFG = null;
let token = null;
let user = null;
let balance = 0;
let products = [];
let cart = JSON.parse(localStorage.getItem('jk_cart') || '[]');
let currentCat = 'all';
let currentSort = 'featured';
let soundOn = true;
let lastReceipt = null;

// ---------- 유틸 & 화폐 포맷 ----------
const $ = id => document.getElementById(id);
const won = n => '₩' + Math.max(0, Math.round(n || 0)).toLocaleString('ko-KR');

function toast(text) {
  const container = $('toastContainer');
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = text;
  container.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 300);
  }, 4000);
}

// ---------- Web Audio API 마트 효과음 ----------
let audioCtx;
function playTone(freq, dur = 0.08, type = 'sine', vol = 0.08, delay = 0) {
  if (!soundOn) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const t = audioCtx.currentTime + delay;
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.01);
  } catch (e) {}
}

const sfx = {
  // 바코드 스캔 '삐빅' 소리
  beep: () => playTone(1760, 0.07, 'sine', 0.07),
  // 수량 감소 소리
  pop: () => playTone(600, 0.05, 'triangle', 0.05),
  // 결제 완료 (포스기 찰칵)
  cash: () => {
    [1046, 1318, 1568, 2093].forEach((f, i) => playTone(f, 0.12, 'triangle', 0.08, i * 0.07));
  },
  // 자켓마트 징글 (이마트 느낌 멜로디)
  jingle: () => {
    const notes = [523, 659, 784, 1047, 784, 1047];
    notes.forEach((f, i) => playTone(f, 0.16, 'square', 0.04, i * 0.13));
  }
};

// ---------- API 호출 ----------
async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';

  const res = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || '요청 실패');
  }
  return data;
}

// ---------- 카트 관리 & 동기화 ----------
function saveCart() {
  localStorage.setItem('jk_cart', JSON.stringify(cart));
  renderCart();
  updateHeaderBadges();
}

function addToCart(productId, count = 1) {
  const prod = products.find(p => p.id === productId);
  if (!prod) return;

  const exist = cart.find(item => item.id === productId);
  if (exist) {
    exist.qty = Math.min(999, exist.qty + count);
  } else {
    cart.push({ id: prod.id, qty: count });
  }

  sfx.beep();
  saveCart();
  toast(`🛒 [${prod.name}] 카트에 담겼습니다!`);
}

function updateQty(productId, delta) {
  const item = cart.find(it => it.id === productId);
  if (!item) return;

  item.qty += delta;
  if (item.qty <= 0) {
    cart = cart.filter(it => it.id !== productId);
    sfx.pop();
  } else {
    sfx.beep();
  }
  saveCart();
}

function removeFromCart(productId) {
  cart = cart.filter(it => it.id !== productId);
  sfx.pop();
  saveCart();
}

function updateHeaderBadges() {
  const totalItems = cart.reduce((sum, it) => sum + it.qty, 0);
  const badge = $('cartCountBadge');
  badge.textContent = totalItems;
  badge.classList.toggle('active', totalItems > 0);
}

// ---------- 카트 드로어 렌더링 ----------
function renderCart() {
  const listEl = $('cartItemList');
  const countEl = $('cartItemTotalCount');
  const subtotalEl = $('cartSubtotal');
  const totalEl = $('cartFinalTotal');

  const totalCount = cart.reduce((sum, it) => sum + it.qty, 0);
  countEl.textContent = `${totalCount}개 상품`;

  if (cart.length === 0) {
    listEl.innerHTML = `
      <div class="cart-empty">
        <div class="cart-empty-icon">🛒</div>
        <p>카트가 텅 비어 있습니다.</p>
        <small style="color:#94a3b8">슬롯머신에서 딴 칩으로 마음껏 담아보세요!</small>
      </div>
    `;
    subtotalEl.textContent = won(0);
    totalEl.textContent = won(0);
    return;
  }

  let totalMoney = 0;
  listEl.innerHTML = cart.map(it => {
    const prod = products.find(p => p.id === it.id);
    if (!prod) return '';
    const lineTotal = prod.price * it.qty;
    totalMoney += lineTotal;

    return `
      <div class="cart-item-card">
        <span class="cart-item-icon">${prod.icon}</span>
        <div class="cart-item-details">
          <div class="cart-item-title">${prod.name}</div>
          <div class="cart-item-price">${won(lineTotal)} <small style="color:#94a3b8;font-weight:normal">(${won(prod.price)} / ${prod.unit})</small></div>
        </div>
        <div class="qty-control">
          <button class="qty-btn" onclick="updateQty('${prod.id}', -1)">−</button>
          <span class="qty-num">${it.qty}</span>
          <button class="qty-btn" onclick="updateQty('${prod.id}', 1)">+</button>
        </div>
        <button class="cart-item-delete" onclick="removeFromCart('${prod.id}')" title="삭제">✕</button>
      </div>
    `;
  }).join('');

  subtotalEl.textContent = won(totalMoney);
  totalEl.textContent = won(totalMoney);
}

// ---------- 상품 목록 렌더링 ----------
function renderProducts() {
  const grid = $('productGrid');
  let list = [...products];

  // 1. 카테고리 필터
  if (currentCat !== 'all') {
    list = list.filter(p => p.category === currentCat);
  }

  // 2. 검색어 필터
  const query = $('searchInput').value.trim().toLowerCase();
  if (query) {
    list = list.filter(p => p.name.toLowerCase().includes(query) || p.desc.toLowerCase().includes(query));
  }

  // 3. 정렬
  if (currentSort === 'price-asc') {
    list.sort((a, b) => a.price - b.price);
  } else if (currentSort === 'price-desc') {
    list.sort((a, b) => b.price - a.price);
  } else if (currentSort === 'reviews') {
    list.sort((a, b) => b.reviews - a.reviews);
  }

  $('totalProductCount').textContent = `${list.length}개 상품 진열 중`;

  if (!list.length) {
    grid.innerHTML = `
      <div style="grid-column: 1/-1; text-align:center; padding: 60px 20px; color:#64748b;">
        <h3>일치하는 상품이 없습니다.</h3>
        <p>전단지 상품이나 다른 키워드로 검색해 보세요.</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = list.map(p => `
    <article class="product-card">
      <div class="card-img-wrap">
        <span class="card-badge">${p.badge}</span>
        <span class="card-icon">${p.icon}</span>
        <span class="card-unit">${p.unit}</span>
      </div>
      <div class="card-body">
        <h3 class="card-title">${p.name}</h3>
        <p class="card-desc">${p.desc}</p>
        <div class="card-price-group">
          ${p.originalPrice ? `<div class="orig-price">${won(p.originalPrice)}</div>` : ''}
          <div class="current-price">${won(p.price)}</div>
        </div>
        <div class="card-actions">
          <button class="btn-card btn-add-cart" onclick="addToCart('${p.id}')">🛒 담기</button>
          <button class="btn-card btn-buy-now" onclick="buyNow('${p.id}')">즉시 구매</button>
        </div>
      </div>
    </article>
  `).join('');
}

function buyNow(productId) {
  addToCart(productId, 1);
  openCart();
}

// ---------- 카테고리 탭 렌더링 ----------
function renderCategories() {
  const wrap = $('categoryTabs');
  if (!CFG || !CFG.categories) return;

  wrap.innerHTML = CFG.categories.map(cat => `
    <button class="cat-tab-btn ${currentCat === cat.id ? 'active' : ''}" data-cat="${cat.id}">
      <span>${cat.icon}</span>
      <span>${cat.name}</span>
    </button>
  `).join('');

  wrap.querySelectorAll('.cat-tab-btn').forEach(btn => {
    btn.onclick = () => {
      currentCat = btn.dataset.cat;
      const catObj = CFG.categories.find(c => c.id === currentCat);
      $('currentCategoryTitle').textContent = catObj ? `${catObj.name}` : '전체 상품';
      renderCategories();
      renderProducts();
    };
  });
}

// ---------- 내 정보 & 잔고 로드 ----------
async function loadMyState() {
  if (!token) {
    $('myBalanceDisplay').textContent = won(0);
    $('userNameDisplay').textContent = '로그인';
    $('invCountBadge').textContent = '0';
    return;
  }

  try {
    const data = await api('/api/me');
    user = data.user;
    balance = data.balance;
    $('myBalanceDisplay').textContent = won(balance);
    $('userNameDisplay').textContent = `${user.name}${user.isGuest ? ' (체험)' : ''}`;
    $('invCountBadge').textContent = data.inventoryCount || 0;
  } catch (err) {
    console.warn('Failed to load user state:', err.message);
  }
}

// ---------- 결제 (Checkout) ----------
async function handleCheckout() {
  if (!token) {
    openLoginModal();
    return;
  }

  if (!cart.length) {
    toast('카트가 비어 있습니다!');
    return;
  }

  // 총 금액 계산
  let total = 0;
  cart.forEach(it => {
    const prod = products.find(p => p.id === it.id);
    if (prod) total += prod.price * it.qty;
  });

  if (balance < total) {
    sfx.pop();
    alert(`💸 잔고가 부족합니다!\n\n현재 보유: ${won(balance)}\n결제 필요: ${won(total)}\n부족한 금액: ${won(total - balance)}\n\n🎰 상단 '슬롯머신 바로가기'에서 릴을 돌려 돈을 더 벌어오세요!`);
    return;
  }

  $('checkoutBtn').disabled = true;
  $('checkoutBtn').textContent = '결제 승인 중...';

  try {
    const res = await api('/api/checkout', {
      method: 'POST',
      body: { items: cart }
    });

    sfx.cash();
    lastReceipt = res;
    balance = res.balanceAfter;
    $('myBalanceDisplay').textContent = won(balance);

    // 카트 비우기
    cart = [];
    saveCart();
    closeCart();

    // 감열지 영수증 팝업 표시
    showReceiptModal(res);
    loadMyState();
  } catch (err) {
    alert(err.message || '결제 처리에 실패했습니다.');
  } finally {
    $('checkoutBtn').disabled = false;
    $('checkoutBtn').textContent = '🎰 슬롯 머니로 전액 결제하기';
  }
}

// ---------- 영수증 모달 연출 ----------
function showReceiptModal(order) {
  $('recNo').textContent = order.receiptNo;
  $('recDate').textContent = new Date(order.paidAt).toLocaleString('ko-KR');
  $('recCustomer').textContent = user?.name || '자켓단골손님';

  const tbody = $('recTableBody');
  tbody.innerHTML = order.items.map(it => `
    <tr>
      <td>${it.name}</td>
      <td style="text-align:center;">${it.qty}</td>
      <td style="text-align:right;">${won(it.price)}</td>
      <td style="text-align:right; font-weight:bold;">${won(it.lineTotal)}</td>
    </tr>
  `).join('');

  const vat = Math.round(order.totalAmount / 11);
  const net = order.totalAmount - vat;
  $('recNet').textContent = won(net);
  $('recVat').textContent = won(vat);
  $('recTotal').textContent = won(order.totalAmount);
  $('recBalAfter').textContent = won(order.balanceAfter);

  $('receiptBackdrop').classList.add('show');
}

// ---------- 배송 추적 연출 ----------
function openTrackerModal() {
  $('receiptBackdrop').classList.remove('show');
  const tracker = $('trackerBackdrop');
  tracker.classList.add('show');

  // 단계별 애니메이션
  const s1 = $('step1'), s2 = $('step2'), s3 = $('step3');
  const statusBox = $('deliveryStatusBox');

  s1.classList.add('active');
  s2.classList.remove('active');
  s3.classList.remove('active');
  statusBox.textContent = '📦 [1단계] 자켓마트 직원이 24K 순금 카트를 끌고 매장을 전력 질주하고 있습니다!';

  setTimeout(() => {
    s2.classList.add('active');
    statusBox.textContent = '🚀 [2단계] 배송 기사님이 카트를 타고 고속도로에서 시속 120km로 광속 이동 중입니다!';
  }, 2200);

  setTimeout(() => {
    s3.classList.add('active');
    statusBox.textContent = '🔔 [3단계] 현관문 앞에 안전하게 배송하고 벨 누른 뒤 성공적으로 도망쳤습니다! (배송 완료)';
    sfx.cash();
  }, 4400);
}

// ---------- 내 냉장고 / 인벤토리 모달 ----------
async function openInventoryModal() {
  if (!token) {
    openLoginModal();
    return;
  }

  const backdrop = $('invBackdrop');
  const listEl = $('invList');
  listEl.innerHTML = '<div style="text-align:center;padding:30px;">보관함을 여는 중...</div>';
  backdrop.classList.add('show');

  try {
    const data = await api('/api/inventory');
    if (!data.items || !data.items.length) {
      listEl.innerHTML = `
        <div style="text-align:center;padding:40px;color:#64748b;">
          <div style="font-size:3rem;margin-bottom:10px;">🧊</div>
          <p>아직 구매한 물품이 없습니다.</p>
          <small>슬롯 머신으로 딴 칩으로 매머드 스테이크를 장만해보세요!</small>
        </div>
      `;
      return;
    }

    listEl.innerHTML = data.items.map(it => `
      <div class="inv-item-card">
        <div class="inv-item-left">
          <span class="inv-icon">${it.icon}</span>
          <div>
            <div class="inv-title">${it.name}</div>
            <div class="inv-meta">구매단가: ${won(it.unit_price)} · 최근 구매: ${new Date(it.last_bought_at).toLocaleDateString()}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="inv-badge-qty">${it.quantity}개 보유</span>
          <button class="btn-card" style="padding:6px 10px;font-size:0.75rem;background:#FEF3C7;border:1px solid #F59E0B;" onclick="interactItem('${it.name}')">자랑하기</button>
        </div>
      </div>
    `).join('');
  } catch (err) {
    listEl.innerHTML = `<div style="color:red;padding:20px;">인벤토리 로드 실패: ${err.message}</div>`;
  }
}

function interactItem(name) {
  navigator.clipboard.writeText(`[JARKET 플렉스] 나 슬롯 카지노 머니로 자켓마트에서 [${name}] 구매함! 🛒✨`);
  toast(`🎉 [${name}] 자랑 문구가 클립보드에 복사되었습니다! 친구들에게 공유하세요.`);
}

// ---------- ONEID 로그인 (PKCE) & 게스트 로그인 ----------
const PKCE_KEY = 'jk_pkce';
const AUTH_KEY = 'jk_auth';
const redirectUri = () => location.origin + '/';
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function startOneidLogin() {
  if (!CFG) return;
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = b64url(new Uint8Array(digest));
  const state = b64url(crypto.getRandomValues(new Uint8Array(18)));

  sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state }));
  location.assign(`${CFG.oneidUrl}/login.html?` + new URLSearchParams({
    client_id: CFG.clientId,
    redirect_uri: redirectUri(),
    code_challenge: challenge,
    state,
  }));
}

async function handleOauthCallback() {
  const p = new URLSearchParams(location.search);
  const code = p.get('code');
  if (!code) return;

  const saved = JSON.parse(sessionStorage.getItem(PKCE_KEY) || 'null');
  sessionStorage.removeItem(PKCE_KEY);
  history.replaceState(null, '', '/');

  if (!saved || saved.state !== p.get('state')) {
    toast('로그인 검증에 실패했습니다.');
    return;
  }

  const res = await fetch(`${CFG.oneidUrl}/api/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: CFG.clientId,
      redirect_uri: redirectUri(),
      code,
      code_verifier: saved.verifier
    })
  });

  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.detail || '로그인 실패');

  token = d.access_token;
  localStorage.setItem(AUTH_KEY, token);
  toast('🎉 ONEID 로그인 성공! 슬롯 머니가 연동되었습니다.');
}

async function startGuestLogin() {
  const nickname = $('guestNameInput').value.trim() || '체험손님';
  try {
    const res = await api('/api/guest-login', {
      method: 'POST',
      body: { nickname }
    });
    token = res.token;
    localStorage.setItem(AUTH_KEY, token);
    $('loginBackdrop').classList.remove('show');
    toast(`👋 [${res.user.name}]님 환영합니다! 체험용 칩이 지급되었습니다.`);
    await loadMyState();
  } catch (err) {
    alert(err.message || '게스트 입장 실패');
  }
}

function openLoginModal() {
  $('loginBackdrop').classList.add('show');
}

function openCart() {
  $('cartBackdrop').classList.add('show');
  $('cartDrawer').classList.add('show');
}

function closeCart() {
  $('cartBackdrop').classList.remove('show');
  $('cartDrawer').classList.remove('show');
}

// ---------- 이벤트 리스너 등록 ----------
function setupEvents() {
  // 장바구니 열기/닫기
  $('openCartBtn').onclick = openCart;
  $('closeCartBtn').onclick = closeCart;
  $('cartBackdrop').onclick = closeCart;

  // 인벤토리 열기/닫기
  $('openInventoryBtn').onclick = openInventoryModal;
  $('closeInvBtn').onclick = () => $('invBackdrop').classList.remove('show');
  $('invBackdrop').onclick = e => { if (e.target === $('invBackdrop')) $('invBackdrop').classList.remove('show'); };

  // 결제
  $('checkoutBtn').onclick = handleCheckout;

  // 영수증 모달 액션
  $('closeReceiptBtn').onclick = () => $('receiptBackdrop').classList.remove('show');
  $('trackDeliveryBtn').onclick = openTrackerModal;

  // 배송 모달 액션
  $('closeTrackerBtn').onclick = () => $('trackerBackdrop').classList.remove('show');
  $('trackerOkBtn').onclick = () => {
    $('trackerBackdrop').classList.remove('show');
    openInventoryModal();
  };

  // 로그인 모달
  $('accountBtn').onclick = openLoginModal;
  $('closeLoginBtn').onclick = () => $('loginBackdrop').classList.remove('show');
  $('oneidLoginBtn').onclick = startOneidLogin;
  $('guestLoginBtn').onclick = startGuestLogin;

  // BGM 토글
  $('bgmToggleBtn').onclick = () => {
    soundOn = !soundOn;
    $('bgmToggleBtn').textContent = soundOn ? '🔊 마트 징글' : '🔇 음소거';
    if (soundOn) sfx.jingle();
  };

  // 전단지 퀵 아이템 클릭 시 바로 장바구니 담기
  document.querySelectorAll('.quick-item').forEach(el => {
    el.onclick = () => {
      const id = el.dataset.id;
      addToCart(id, 1);
    };
  });

  // 검색 & 정렬
  $('searchInput').oninput = renderProducts;
  $('sortSelect').onchange = e => {
    currentSort = e.target.value;
    renderProducts();
  };

  // 로고 클릭 시 첫 화면 리셋
  $('brandLogo').onclick = () => {
    currentCat = 'all';
    $('searchInput').value = '';
    renderCategories();
    renderProducts();
    sfx.jingle();
  };
}

// ---------- 초기 부팅 (Boot) ----------
(async function init() {
  try {
    CFG = await (await fetch('/api/config')).json();
    products = await (await fetch('/api/products')).json();
    if (CFG && CFG.slotsUrl) {
      document.querySelectorAll('.slot-quicklink').forEach(el => el.href = CFG.slotsUrl);
    }
    if (CFG && CFG.oneidUrl && $('oneidFooterLink')) {
      $('oneidFooterLink').href = CFG.oneidUrl;
    }
  } catch (err) {
    console.error('Server connect error:', err);
    toast('마트 서버에 연결할 수 없습니다.');
    return;
  }

  // ONEID 콜백 처리
  try {
    await handleOauthCallback();
  } catch (e) {
    console.warn(e.message);
  }

  // 저장된 토큰 로드 (혹은 neonstrip 로그인 토큰 공유 확인)
  token = localStorage.getItem(AUTH_KEY);
  if (!token) {
    // 혹시 같은 도메인에서 vegas-slots 로그인 토큰이 있는지 확인
    const slotAuth = JSON.parse(localStorage.getItem('ns_auth') || 'null');
    if (slotAuth && slotAuth.token) {
      token = slotAuth.token;
      localStorage.setItem(AUTH_KEY, token);
    }
  }

  setupEvents();
  renderCategories();
  renderProducts();
  renderCart();
  updateHeaderBadges();

  await loadMyState();

  // 주기적 잔고 갱신 (슬롯 돌리면서 번 돈 자동 반영)
  setInterval(() => {
    if (token && !document.hidden) loadMyState();
  }, 10_000);
})();
