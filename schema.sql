-- 한국 IPO DB 스키마 (1단계: 정형 수집분 + 이후 단계용 테이블 선언)
-- 날짜는 모두 ISO 형식(YYYY-MM-DD) 문자열로 저장합니다.

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- 기업 (DART 기업개황)
CREATE TABLE IF NOT EXISTS company (
  corp_code    TEXT PRIMARY KEY,
  corp_name    TEXT,
  stock_code   TEXT,
  corp_cls     TEXT,          -- Y 유가 / K 코스닥 / N 코넥스 / E 기타
  induty_code  TEXT,
  est_dt       TEXT,
  bio_modality TEXT,          -- 3단계(원문 추출·검수) 이후 채움
  updated_at   TEXT
);

-- 공시 목록 (DART 공시검색, 지분증권 증권신고서 계열)
CREATE TABLE IF NOT EXISTS filing (
  rcept_no            TEXT PRIMARY KEY,
  corp_code           TEXT NOT NULL,
  corp_name           TEXT,
  report_nm           TEXT,
  flr_nm              TEXT,
  rcept_dt            TEXT,
  rm                  TEXT,
  doc_kind            TEXT,   -- reg_equity / prospectus / result / other
  tags                TEXT,   -- 보고서명 앞 [기재정정] 등 표시, 쉼표 구분
  is_amendment        INTEGER DEFAULT 0,
  is_price_fixed      INTEGER DEFAULT 0,
  is_correction_order INTEGER DEFAULT 0,
  estk_status         TEXT,   -- NULL 미조회 / ok / missing
  fetched_at          TEXT
);
CREATE INDEX IF NOT EXISTS idx_filing_corp ON filing (corp_code, rcept_dt);

-- DART 증권신고서 주요정보(지분증권) 원본 응답 (IPO 후보 기업만 보존)
CREATE TABLE IF NOT EXISTS dart_raw (
  corp_code  TEXT PRIMARY KEY,
  endpoint   TEXT,
  payload    TEXT,
  fetched_at TEXT
);

-- 증권신고서 주요정보: 그룹별 파싱 결과 (접수번호 단위)
CREATE TABLE IF NOT EXISTS estk_general (
  rcept_no  TEXT PRIMARY KEY,
  corp_code TEXT,
  sbd       TEXT,   -- 청약기일
  pymd      TEXT,   -- 납입기일
  sband     TEXT,   -- 청약공고일
  asand     TEXT,   -- 배정공고일
  asstd     TEXT,   -- 배정기준일
  rpt_rcpn  TEXT    -- 주요사항보고서 접수번호 (IPO 판별 신호)
);

CREATE TABLE IF NOT EXISTS estk_security (
  rcept_no TEXT NOT NULL,
  row_no   INTEGER NOT NULL,
  stksen   TEXT,    -- 증권의종류
  stkcnt   TEXT,    -- 증권수량
  fv       TEXT,    -- 액면가액
  slprc    TEXT,    -- 모집(매출)가액
  slta     TEXT,    -- 모집(매출)총액
  slmthn   TEXT,    -- 모집(매출)방법
  PRIMARY KEY (rcept_no, row_no)
);

CREATE TABLE IF NOT EXISTS underwriter (
  rcept_no TEXT NOT NULL,
  row_no   INTEGER NOT NULL,
  actsen   TEXT,    -- 인수인구분 (대표주관회사 등)
  actnmn   TEXT,    -- 인수인명
  stksen   TEXT,
  udtcnt   TEXT,    -- 인수수량
  udtamt   TEXT,    -- 인수금액
  udtprc   TEXT,    -- 인수대가
  udtmth   TEXT,    -- 인수방법
  PRIMARY KEY (rcept_no, row_no)
);

CREATE TABLE IF NOT EXISTS use_of_proceeds (
  rcept_no TEXT NOT NULL,
  row_no   INTEGER NOT NULL,
  se       TEXT,
  amt      TEXT,
  PRIMARY KEY (rcept_no, row_no)
);

CREATE TABLE IF NOT EXISTS seller (
  rcept_no   TEXT NOT NULL,
  row_no     INTEGER NOT NULL,
  hdr        TEXT,  -- 보유자
  rl_cmp     TEXT,  -- 회사와의 관계
  bfsl_hdstk TEXT,  -- 매출 전 보유 증권 수
  slstk      TEXT,  -- 매출 증권 수 (구주매출)
  atsl_hdstk TEXT,  -- 매출 후 보유 증권 수
  PRIMARY KEY (rcept_no, row_no)
);

-- 공모 건 (딜): 증권신고서 최초 제출 건 + 이후 정정/확정 건을 묶음
CREATE TABLE IF NOT EXISTS ipo_deal (
  deal_id            TEXT PRIMARY KEY,   -- {corp_code}_{최초 신고서 접수번호}
  corp_code          TEXT NOT NULL,
  first_rcept_no     TEXT,
  first_filing_dt    TEXT,
  latest_rcept_no    TEXT,
  latest_filing_dt   TEXT,
  amendment_count    INTEGER,
  status             TEXT,               -- filed / price_fixed / completed(발행실적보고서 제출) / withdrawn
  is_ipo_candidate   INTEGER,            -- 1 후보 / 0 비후보 / NULL 미확인
  ipo_basis          TEXT,
  listing_type       TEXT,               -- KIND·원문 확인 후 채움 (기술특례 등)
  market             TEXT,               -- KOSDAQ / KOSPI (원문 기준, KIND 예심 시장이 있으면 내보낼 때 그 값 우선)
  offer_price_low    INTEGER,
  offer_price_high   INTEGER,
  filed_price        INTEGER,            -- 신고서 기재 모집가액(estkRs 최신 기재정정 기준, 단일가)
  estk_rcept_no      TEXT,               -- 위 가격·물량의 기준 접수번호
  estk_before_fixing INTEGER,            -- 1이면 발행조건확정 이전 값 (확정 반영 전)
  fixed_rcept_no     TEXT,               -- 마지막 [발행조건확정] 신고서 접수번호
  doc_signal         INTEGER,
  result_rcept_no    TEXT,               -- 증권발행실적보고서 접수번호 (있으면 납입 완료, 상장 예정·완료)
  inst_demand_ratio  REAL,               -- 수요예측 경쟁률
  inst_demand_count  INTEGER,            -- 수요예측 참여 건수
  retail_ratio       REAL,               -- 일반청약 경쟁률
  retail_count       INTEGER,            -- 일반청약 건수            -- 원문에서 공모희망가액·확정공모가액 문구 확인: 1 확인 / 0 없음 / NULL 미조회
  final_price        INTEGER,            -- 확정 공모가: 발행조건확정 신고서 원문에서 추출 (doc_price)
  shares_offered     INTEGER,
  secondary_shares   INTEGER,            -- 구주매출 주식수 합계
  offer_amount       INTEGER,
  lead_underwriters  TEXT,
  co_underwriters    TEXT,
  subscription_raw   TEXT,
  payment_raw        TEXT,
  listing_dt         TEXT,
  demand_start       TEXT,               -- 수요예측 시작일 (원문 공모일정)
  demand_end         TEXT,               -- 수요예측 종료일
  tech_track         TEXT,               -- 코스닥 기술특례 경로 (NULL이면 일반)
  tech_grades        TEXT,               -- 기술평가 등급 (예: 'A, BBB')
  tech_agencies      TEXT,               -- 평가기관
  alt_route          TEXT,               -- 이익미실현 등 기술특례가 아닌 특례 경로
  updated_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_deal_corp ON ipo_deal (corp_code);

-- 공시 원문에서 추출한 희망 밴드·확정가 (접수번호 단위, 값마다 근거 문구 보존)
CREATE TABLE IF NOT EXISTS doc_price (
  rcept_no        TEXT PRIMARY KEY,
  corp_code       TEXT NOT NULL,
  band_low        INTEGER,
  band_high       INTEGER,       -- 스팩 등 단일 희망가는 low = high
  final_price     INTEGER,
  header_amount   INTEGER,       -- 정정신고서 첫머리의 모집 또는 매출금액 (발행조건확정 건에서는 확정 금액)
  header_shares   INTEGER,       -- 같은 첫머리의 모집·매출 주식수 (표기가 없으면 NULL)
  header_evidence TEXT,
  band_evidence   TEXT,
  final_evidence  TEXT,
  n_values        INTEGER,       -- 문서 안에서 서로 다른 후보 값의 최대 개수 (2 이상이면 검수)
  status          TEXT,          -- ok / no_match
  inst_ratio      REAL,          -- 수요예측 경쟁률 (합계, ◯:1)
  inst_count      INTEGER,       -- 수요예측 참여 건수 (합계)
  inst_evidence   TEXT,
  parser_version  INTEGER,
  fetched_at      TEXT
);

-- 증권신고서(발행조건확정 이전 최신본) 원문의 공모일정에서 추출한 수요예측 기일
CREATE TABLE IF NOT EXISTS doc_schedule (
  rcept_no         TEXT PRIMARY KEY,
  corp_code        TEXT NOT NULL,
  demand_start     TEXT,
  demand_end       TEXT,
  demand_evidence  TEXT,
  market           TEXT,         -- KOSDAQ / KOSPI ('코스닥시장'·'유가증권시장' 언급 횟수로 판정)
  market_evidence  TEXT,
  tech_track       TEXT,         -- 코스닥 기술특례 경로: 기술평가 / 사업모델 / 성장성 추천 / 기술특례(추정) / NULL
  tech_evidence    TEXT,
  tech_grades      TEXT,         -- 기술평가 특례: 전문평가기관 2곳 등급 (예: 'A, BBB')
  tech_agencies    TEXT,         -- 같은 순서의 평가기관
  alt_route        TEXT,         -- 기술특례가 아닌 특례 경로: 이익미실현
  tech_hints       TEXT,         -- 검수용: 관련 단어 언급 횟수
  biz_text         TEXT,         -- '사업의 개요' 서술(요약용, 최대 1,500자)
  biz_excerpt      TEXT,         -- 화면용 발췌(2~3문장)
  status           TEXT,         -- ok / no_match (수요예측 기일 기준)
  parser_version   INTEGER,
  fetched_at       TEXT
);

-- KIND 상장법인 목록: 업종·주요제품 (회사명 정규화 키로 DART 회사와 연결)
-- 상장 후 유통가능 물량·보호예수·기관 의무보유확약(투자설명서 원문 추출, 딜 단위로 여러 원문을 합침)
CREATE TABLE IF NOT EXISTS deal_lockup (
    deal_id        TEXT PRIMARY KEY,
    corp_code      TEXT,
    data           TEXT,       -- JSON: listed, float0, schedule, groups, commit, src
    tried          TEXT,       -- 시도한 접수번호(JSON 배열)
    status         TEXT,
    parser_version INTEGER,
    fetched_at     TEXT
);

CREATE TABLE IF NOT EXISTS kind_corp (
  name_key    TEXT PRIMARY KEY,
  corp_name   TEXT,
  stock_code  TEXT,
  market      TEXT,
  industry    TEXT,
  products    TEXT,
  listed_dt   TEXT,
  fetched_at  TEXT
);

-- 증권발행실적보고서 원문에서 추출한 상장일·일반청약 결과
CREATE TABLE IF NOT EXISTS doc_result (
  rcept_no          TEXT PRIMARY KEY,
  corp_code         TEXT NOT NULL,
  listing_dt        TEXT,        -- 상장일(매매개시일), 보고서 제출 시점의 예정일
  listing_evidence  TEXT,
  retail_ratio      REAL,        -- 일반청약 경쟁률 = 청약수량 ÷ 최초 배정수량
  retail_count      INTEGER,     -- 일반청약 건수
  retail_evidence   TEXT,
  parser_version    INTEGER,
  fetched_at        TEXT
);

-- KIND 상장예비심사 현황 (자동 수집 또는 수동 업로드). 회사명 정규화 키로 DART 딜과 연결합니다.
CREATE TABLE IF NOT EXISTS kind_review (
  review_key    TEXT PRIMARY KEY,   -- {name_key}_{청구일}
  name_key      TEXT NOT NULL,
  corp_name     TEXT,
  filed_dt      TEXT,               -- 예심 청구일
  decided_dt    TEXT,               -- 결과 확정(승인)일
  result        TEXT,               -- 승인 / 미승인 / 철회 / 심사중 등 (KIND 표기 그대로)
  market        TEXT,
  listing_type  TEXT,
  sponsor       TEXT,               -- 상장주선인
  industry      TEXT,
  source        TEXT,               -- kind / manual:파일명
  fetched_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_kind_review_name ON kind_review (name_key);

-- 이하 2~4단계에서 채우는 테이블
CREATE TABLE IF NOT EXISTS review (
  deal_id               TEXT PRIMARY KEY,
  prelim_filed_dt       TEXT,
  prelim_approved_dt    TEXT,
  review_days           INTEGER,
  registration_first_dt TEXT,
  registration_amend_cnt INTEGER,
  correction_order      INTEGER
);

CREATE TABLE IF NOT EXISTS tech_eval (
  deal_id       TEXT PRIMARY KEY,
  track         TEXT,
  agency1       TEXT,
  grade1        TEXT,
  agency2       TEXT,
  grade2        TEXT
);

CREATE TABLE IF NOT EXISTS valuation (
  deal_id          TEXT PRIMARY KEY,
  method           TEXT,
  peers            TEXT,
  multiple         REAL,
  base_year        INTEGER,
  discount_years   REAL,
  discount_rate    REAL,
  band_discount    REAL
);

CREATE TABLE IF NOT EXISTS book_building (
  deal_id            TEXT PRIMARY KEY,
  institutions       INTEGER,
  institutional_comp REAL,
  lockup_ratio       REAL,
  above_band_ratio   REAL,
  retail_comp        REAL,
  retail_margin      INTEGER
);

CREATE TABLE IF NOT EXISTS after_market (
  deal_id    TEXT NOT NULL,
  base_date  TEXT NOT NULL,
  horizon    TEXT,
  return_pct REAL,
  PRIMARY KEY (deal_id, base_date)
);

-- 값 단위 출처 추적
CREATE TABLE IF NOT EXISTS field_source (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id       TEXT NOT NULL,
  field_table   TEXT,
  field_name    TEXT,
  value         TEXT,
  rcept_no      TEXT,
  section       TEXT,
  evidence      TEXT,
  method        TEXT,       -- API / derived / LLM / manual
  review_status TEXT,       -- api_verified / pending / confirmed / rejected
  created_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_field_source_deal ON field_source (deal_id);
