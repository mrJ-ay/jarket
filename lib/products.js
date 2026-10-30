/* =========================================================
   JARKET (자켓마트) — 상품 카탈로그 (Products Catalog)
   - 이마트 스타일의 신선식품, 델리, 노브랜드(노머니), 일렉트로, VVIP 탕진 상품
   ========================================================= */

export const CATEGORIES = [
  { id: 'all', name: '전체 상품', icon: '🛒' },
  { id: 'user', name: '🥕 당근 장터 (유저 판매)', icon: '🥕' },
  { id: 'fresh', name: '신선 · 정육 · 수산', icon: '🥩' },
  { id: 'deli', name: '델리 · 즉석조리', icon: '🍕' },
  { id: 'nobrand', name: 'No Money (가성비)', icon: '🟡' },
  { id: 'electro', name: '자켓트로 디지털 가전', icon: '⚡' },
  { id: 'flex', name: 'VVIP 잭팟 플렉스', icon: '💎' },
];

export const PRODUCTS = [
  // --- [신선 / 정육 / 수산] ---
  {
    id: 'pork_belly',
    name: '한돈 암퇘지 삼겹살 (600g)',
    category: 'fresh',
    price: 18500,
    originalPrice: 24000,
    badge: '금주전단특가',
    icon: '🥓',
    unit: '1팩 (600g)',
    desc: '불판에 올리면 지글지글 소리가 예술. 슬롯머신 연패의 슬픔을 한 번에 녹여주는 국민 힐링 육즙.',
    flavor: '※ 파채, 쌈장 가상 증정 포함',
    rating: 4.9,
    reviews: 1420
  },
  {
    id: 'hanwoo_1plus',
    name: '횡성 1++ 순금 한우 등심 세트 (1.2kg)',
    category: 'fresh',
    price: 18000000,
    originalPrice: 25000000,
    badge: '마감세일 28%',
    icon: '🥩',
    unit: '1세트',
    desc: '마블링 사이사이에 24K 식용 금박이 박혀있는 회장님 전용 한우. 씹기도 전에 입 안에서 증발합니다.',
    flavor: '※ 금가루 참기름 소금장 기본 동봉',
    rating: 5.0,
    reviews: 89
  },
  {
    id: 'mammoth_tbone',
    name: '신선 멸종 매머드 티본 스테이크 (해동)',
    category: 'fresh',
    price: 850000000,
    originalPrice: 1200000000,
    badge: '빙하기직송',
    icon: '🍖',
    unit: '1대 (약 80kg)',
    desc: '시베리아 3만 년 영구동토층에서 발견 즉시 급랭! 원시 인류가 사냥했던 거친 빙하기의 야생 맛 그대로.',
    flavor: '※ 해동에만 7일 소요되니 장기 숙성 권장',
    rating: 4.8,
    reviews: 12
  },
  {
    id: 'aurora_salmon',
    name: '노르웨이 대왕 오로라 연어 (원물 1미)',
    category: 'fresh',
    price: 450000,
    originalPrice: 580000,
    badge: '항공직송',
    icon: '🐟',
    unit: '1마리 (12kg)',
    desc: '오로라를 보고 자란 북극해 연어. 회 뜨다 지쳐서 싱크대 앞에서 기절할 수도 있는 압도적인 체급.',
    flavor: '※ 와사비 간장 1L 사은품 증정',
    rating: 4.9,
    reviews: 320
  },
  {
    id: 'shine_muscat',
    name: '에메랄드 알알이 샤인머스캣 (4송이)',
    category: 'fresh',
    price: 38000,
    originalPrice: 49000,
    badge: '1+1기획',
    icon: '🍇',
    unit: '1박스 (2kg)',
    desc: '껍질째 씹으면 망고 향 단물이 폭발. 슬롯 돌리면서 한 손으로 집어먹기 가장 좋은 과일 1위.',
    flavor: '※ 당도 18브릭스 보장 (안 달면 환불 불가)',
    rating: 4.7,
    reviews: 840
  },

  // --- [델리 / 즉석조리] ---
  {
    id: 'jarket_pizza',
    name: '지름 2M 점보 자켓 콤비네이션 피자',
    category: 'deli',
    price: 3500000,
    originalPrice: 4200000,
    badge: 'MD강력추천',
    icon: '🍕',
    unit: '1판 (지름 200cm)',
    desc: '엘리베이터에 들어가지 않아 창문으로 사다리차 배달됩니다. 성인 남성 20명이 둘러앉아도 남는 크기.',
    flavor: '※ 핫소스 300개, 파마산 치즈가루 1통 포함',
    rating: 4.9,
    reviews: 620
  },
  {
    id: 'dangdang_chicken',
    name: '당당 통닭 50마리 바삭 타워',
    category: 'deli',
    price: 1200000,
    originalPrice: 1500000,
    badge: '줄서서사는맛',
    icon: '🍗',
    unit: '50마리 1세트',
    desc: '갓 튀겨 바삭한 황금 치킨 50마리를 피라미드처럼 쌓아올렸습니다. 집안에 치킨 냄새가 2주간 빠지지 않습니다.',
    flavor: '※ 치킨무 50팩, 양념소스 2리터 통 증정',
    rating: 5.0,
    reviews: 1102
  },
  {
    id: 'mega_sushi',
    name: '자켓 초밥 100피스 셰프 메가 플래터',
    category: 'deli',
    price: 2500000,
    originalPrice: 3000000,
    badge: '당일조리',
    icon: '🍣',
    unit: '100피스 (2단 원형 용기)',
    desc: '광어, 참치 뱃살, 연어, 단새우, 성게알 등 자켓 일식 조리장이 4시간 동안 쉬지 않고 쥔 명품 스시 모음.',
    flavor: '※ 락교와 초생강은 덤이 아닙니다, 작품입니다',
    rating: 4.9,
    reviews: 450
  },

  // --- [No Money (노머니) - 노브랜드 패러디] ---
  {
    id: 'nm_tissue',
    name: 'No Money 3겹 엠보싱 롤화장지 (30롤)',
    category: 'nobrand',
    price: 49000,
    originalPrice: 70000,
    badge: '국민가성비',
    icon: '🧻',
    unit: '30롤 (팩)',
    desc: '브랜드가 아니다, 탕진이다. 슬롯머신 릴이 꽝 나왔을 때 흐르는 눈물을 자극 없이 부드럽게 흡수합니다.',
    flavor: '※ 무형광, 100% 천연 펄프 느낌의 가상 화장지',
    rating: 5.0,
    reviews: 4310
  },
  {
    id: 'nm_water',
    name: 'No Money 맑은 샘물 2L (6병 번들)',
    category: 'nobrand',
    price: 12000,
    originalPrice: 18000,
    badge: '최저가도전',
    icon: '💧',
    unit: '2L x 6병',
    desc: '올인당하고 가슴이 팍팍 답답할 때 벌컥벌컥 원샷하면 속이 뻥 뚫리는 기적의 가상 암반수.',
    flavor: '※ 지하 300m 암반 대수층의 시원함',
    rating: 4.8,
    reviews: 2190
  },
  {
    id: 'nm_cookie_tub',
    name: 'No Money 버터쿠키 노란 버킷 (대용량)',
    category: 'nobrand',
    price: 85000,
    originalPrice: 110000,
    badge: '인간사료',
    icon: '🍪',
    unit: '1버킷 (400개입)',
    desc: '뚜껑을 여는 순간 달콤한 버터 향과 함께 슬롯 돌릴 때 무의식적으로 집어먹어 어느덧 바닥을 보게 되는 마성의 과자.',
    flavor: '※ 바삭함 보존제 가상 첨가',
    rating: 4.9,
    reviews: 1890
  },
  {
    id: 'nm_gold_cookie',
    name: 'No Money 24K 순금 버터쿠키 세트',
    category: 'nobrand',
    price: 300000000,
    originalPrice: 350000000,
    badge: '노머니하이엔드',
    icon: '🪙',
    unit: '순금 500g (10개입)',
    desc: '모양은 영락없는 싼마이 버터링이지만, 재질은 99.9% 순금. 한 입 베어 물었다간 치과비 3백만 원 당첨!',
    flavor: '※ 장식장 보관용 / 금괴 대용 화폐 가능',
    rating: 5.0,
    reviews: 31
  },

  // --- [자켓트로 가전 / 일렉트로 패러디] ---
  {
    id: 'gaming_fridge',
    name: '자켓트로 RGB 게이밍 냉동고 (144Hz)',
    category: 'electro',
    price: 35000000,
    originalPrice: 42000000,
    badge: '게이머필수',
    icon: '🧊',
    unit: '1대 (양문형 850L)',
    desc: '냉동실 문을 열면 1,680만 컬러 RGB LED가 화려하게 점등되며 냉동 만두가 프레임 드랍 없이 급랭됩니다.',
    flavor: '※ 레이저 크로마 RGB 싱크 호환',
    rating: 4.9,
    reviews: 77
  },
  {
    id: 'real_slot_machine',
    name: 'NEON STRIP 오리지널 슬롯머신 1대',
    category: 'electro',
    price: 150000000,
    originalPrice: 180000000,
    badge: '본사정품',
    icon: '🎰',
    unit: '1대 (무게 120kg)',
    desc: '실제 라스베가스 네온스트립에서 압류해 온 슬롯머신 실물! 거실에 두고 레버를 직접 당기며 홈 카지노 운영 가능.',
    flavor: '※ 실물 동전 배출구 및 네온 전구 완비',
    rating: 5.0,
    reviews: 45
  },
  {
    id: 'tv_200inch',
    name: '200인치 16K 자켓 울트라 OLED 벽걸이 TV',
    category: 'electro',
    price: 80000000,
    originalPrice: 95000000,
    badge: '벽지대체용',
    icon: '📺',
    unit: '1대 (무료벽면공사)',
    desc: '거실 벽 전체를 화면으로 채워버리는 대형 디스플레이. 슬롯 릴 돌아가는 체리 심볼이 사람 머리통만 하게 보입니다.',
    flavor: '※ 전기세는 책임지지 않습니다',
    rating: 4.8,
    reviews: 64
  },

  // --- [VVIP 잭팟 플렉스] ---
  {
    id: 'flex_gold_cart',
    name: '24K 순금 쇼핑카트 (탑승 가능, 60km/h)',
    category: 'flex',
    price: 1500000000,
    originalPrice: 2000000000,
    badge: '황제전용',
    icon: '🛒',
    unit: '1대 (번호판 포함)',
    desc: '자켓마트 매장 안에서 시속 60km로 코너링할 수 있는 엔진 달린 24K 순금 카트. 바퀴에는 최고급 서스펜션 장착.',
    flavor: '※ 매장 내 주차비 평생 면제 스티커 부착',
    rating: 5.0,
    reviews: 8
  },
  {
    id: 'flex_island',
    name: '남태평양 자켓 프라이빗 에메랄드 섬 영구 분양권',
    category: 'flex',
    price: 10000000000,
    originalPrice: 15000000000,
    badge: '지구은퇴용',
    icon: '🏝️',
    unit: '1섬 (면적 50만 평)',
    desc: '슬롯 잭팟으로 인생 역전한 당신을 위한 파라다이스. 야자수 그늘 아래서 칵테일 마시며 평생 낮잠만 잘 수 있는 개인 섬.',
    flavor: '※ 자켓 전용 헬리패드 및 셰프 상주',
    rating: 5.0,
    reviews: 3
  },
  {
    id: 'flex_mars_ship',
    name: '자켓 우주선 편도 승선권 (화성 1호점 개점식 참석용)',
    category: 'flex',
    price: 50000000000,
    originalPrice: 70000000000,
    badge: '우주한정판',
    icon: '🚀',
    unit: '1석 (퍼스트 클래스)',
    desc: '더 이상 지구에서 살 물건이 없는 초갑부 전용. 화성에 오픈 예정인 자켓마트 화성점 오픈 컷팅식에 참석하는 편도 티켓.',
    flavor: '※ 화성 대기권 진입 시 무료 팝콘 제공',
    rating: 5.0,
    reviews: 1
  }
];
