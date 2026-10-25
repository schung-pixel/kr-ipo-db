"""공시 원문(document.xml)에서 희망공모가 밴드와 확정공모가를 읽습니다.

DART API의 구조화 필드(estkRs)에는 밴드와 확정가가 없어 원문 문구를 규칙으로 추출합니다.
실제 공시로 확인한 문구는 다음과 같습니다.
  희망 밴드  "공모희망가액인 54,500원~66,300원 중 최저가액인 54,500원 기준입니다"
  단일 희망가(스팩) "공모희망가액인 2,000원 기준입니다"
  확정가     "확정공모가액 66,300원 기준입니다", "확정공모가액인13,000원", "확정공모가액을 13,000원으로 최종 결정"
한 문서 안에서 같은 값이 여러 번 반복되므로 가장 많이 나온 값을 채택하고, 서로 다른 값이 섞이면
n_values로 남겨 검수 대상으로 표시합니다.
"""
from __future__ import annotations

import io
import re
import zipfile
from collections import Counter

_BAND_WORDS = r"(?:공모\s*희망\s*가액|희망\s*공모\s*가액|공모\s*희망\s*가격|희망\s*공모\s*가격|희망\s*공모\s*밴드)"
_RANGE = re.compile(_BAND_WORDS + r"[^\d]{0,40}?([\d,]{3,})\s*원?\s*[~∼～\-–]\s*([\d,]{3,})\s*원")
_SINGLE = re.compile(_BAND_WORDS + r"\s*(?:은|는|이|인|:)?\s*(?:(?:금|약)\s*)?([\d,]{3,})\s*원(?!\s*[~∼～\-–]\s*\d)")
_HDR_AMOUNT = re.compile(r"모집\s*또는\s*매출\s*금액\s*:\s*(?:금\s*)?([\d,]{6,})\s*원")
_HDR_SHARES = re.compile(r"모집\s*또는\s*매출\s*증권의\s*종류\s*:[^\d]{0,40}?([\d,]{3,})\s*주")
_FIXED = re.compile(r"확정\s*공모\s*(?:가액|가격)\s*(?:은|는|이|을|를|:|인)?\s*(?:(?:금|약)\s*)?([\d,]{3,})\s*원")


def _decode(b: bytes) -> str:
    """원문 인코딩 판별. 2020~2022년 무렵 원문은 XML 선언이 utf-8이어도 실제로는 EUC-KR(cp949)인 경우가 있습니다."""
    try:
        return b.decode("utf-8")
    except UnicodeDecodeError:
        pass
    try:
        return b.decode("cp949")
    except UnicodeDecodeError:
        u, c = b.decode("utf-8", errors="replace"), b.decode("cp949", errors="replace")
        return u if u.count("\ufffd") <= c.count("\ufffd") else c


def to_text(zip_bytes: bytes) -> str:
    """document.xml 응답(zip)을 태그를 걷어낸 줄 단위 텍스트로 바꿉니다."""
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
        raw = "\n".join(_decode(z.read(n))
                        for n in z.namelist() if n.lower().endswith((".xml", ".html", ".htm")))
    return _clean(raw)


def html_to_text(html: str) -> str:
    """DART 공시 뷰어(report/viewer.do) HTML을 같은 형식의 텍스트로 바꿉니다. 2019년 이전 원문은
    OpenDART document.xml이 '014 파일이 존재하지 않습니다'로 응답하므로 뷰어 화면으로 대신 받습니다."""
    html = re.sub(r"<(?:script|style)[^>]*>.*?</(?:script|style)>", " ", html, flags=re.I | re.S)
    return _clean(html)


def _clean(raw: str) -> str:
    raw = re.sub(r"<(?:TR|P|BR|TABLE)[^>]*>", "\n", raw, flags=re.I)
    raw = re.sub(r"</(?:TD|TH|TE|TU)>", " | ", raw, flags=re.I)
    raw = re.sub(r"<[^>]+>", "", raw)
    raw = raw.replace("&cr;", " ").replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&").replace("&nbsp;", " ")
    raw = re.sub(r"[ \t ]+", " ", raw)
    return re.sub(r"\s*\n\s*", "\n", raw)


def _num(s: str) -> int | None:
    digits = re.sub(r"\D", "", s)
    return int(digits) if digits else None


def _evidence(text: str, m: re.Match) -> str:
    a, b = max(0, m.start() - 24), min(len(text), m.end() + 30)
    snip = re.sub(r"\s+", " ", text[a:b]).strip()
    if a > 0 and " " in snip[:14]:      # 단어 중간에서 시작하면 첫 토막을 버립니다
        snip = snip.split(" ", 1)[1]
    return snip


def extract_prices(text: str) -> dict:
    """{band_low, band_high, final_price, header_amount, header_shares, *_evidence, n_values, status}.

    band는 범위 문구가 있으면 그 값을, 없으면 단일 희망가(스팩 등)를 low=high로 둡니다.
    """
    out = {"band_low": None, "band_high": None, "final_price": None,
           "band_evidence": None, "final_evidence": None, "n_values": 0}
    n_values = 0

    ranges = [(m, (_num(m.group(1)), _num(m.group(2)))) for m in _RANGE.finditer(text)]
    ranges = [(m, v) for m, v in ranges if v[0] and v[1] and v[0] <= v[1]]
    if ranges:
        best, _ = Counter(v for _, v in ranges).most_common(1)[0]
        out["band_low"], out["band_high"] = best
        out["band_evidence"] = _evidence(text, next(m for m, v in ranges if v == best))
        n_values = max(n_values, len({v for _, v in ranges}))
    else:
        singles = [(m, _num(m.group(1))) for m in _SINGLE.finditer(text)]
        singles = [(m, v) for m, v in singles if v]
        if singles:
            best, _ = Counter(v for _, v in singles).most_common(1)[0]
            out["band_low"] = out["band_high"] = best
            out["band_evidence"] = _evidence(text, next(m for m, v in singles if v == best))
            n_values = max(n_values, len({v for _, v in singles}))

    fixed = [(m, _num(m.group(1))) for m in _FIXED.finditer(text)]
    fixed = [(m, v) for m, v in fixed if v]
    if fixed:
        best, _ = Counter(v for _, v in fixed).most_common(1)[0]
        out["final_price"] = best
        out["final_evidence"] = _evidence(text, next(m for m, v in fixed if v == best))
        n_values = max(n_values, len({v for _, v in fixed}))

    # 정정신고서 첫머리의 "모집 또는 매출금액", 증권 종류 옆 주식수. 발행조건확정 건에서는 확정 값입니다.
    am = _HDR_AMOUNT.search(text)
    sh = _HDR_SHARES.search(text)
    out["header_amount"] = _num(am.group(1)) if am else None
    out["header_shares"] = _num(sh.group(1)) if sh else None
    out["header_evidence"] = _evidence(text, am) if am else None

    out["n_values"] = n_values
    out["status"] = "ok" if (out["band_low"] or out["final_price"]) else "no_match"
    return out


# ---------------------------------------------------------------- 2차 추출: 수요예측·청약·상장일
PARSER_VERSION = 4   # 추출 규칙이 바뀌면 올립니다. 이전 버전으로 추출한 원문은 다시 받습니다.

_NUM = re.compile(r"^[\d,]+(?:\.\d+)?$")


def _row_values(text: str, start: int, limit: int = 40) -> list:
    """'라벨 | a | b | ... |' 형태의 표 행에서 라벨 뒤 칸 값을 숫자로 읽습니다(‘-’는 None)."""
    vals = []
    for cell in text[start:start + 1200].split("|")[1:limit + 1]:
        c = cell.strip().replace(" ", "")
        if c in ("-", "—", ""):
            if c == "" and vals:
                break
            vals.append(None)
            continue
        c = c.replace(":1", "")
        if not _NUM.match(c):
            break
        vals.append(float(c.replace(",", "")))
    return vals


def extract_demand(text: str) -> dict:
    """발행조건확정 신고서의 '수요예측 참여내역' 표에서 합계 참여 건수와 경쟁률을 읽습니다."""
    out = {"inst_ratio": None, "inst_count": None, "inst_evidence": None}
    for anchor in ("수요예측 참여내역", "수요예측 결과"):
        i = text.find(anchor)
        while i >= 0:
            seg_end = i + 4000
            # 머리 칸에 각주가 붙는 서식이 있습니다: "경쟁률 주2)", "경쟁률(주2)", "경쟁률주2)"
            m_ratio = re.search(r"\n\s*경쟁률\s*(?:\(?\s*주\s*\d+\s*\)|\([^)]*\))?\s*\|", text[i:seg_end])
            if m_ratio:
                vals = [v for v in _row_values(text, i + m_ratio.end() - 1) if v is not None]
                if vals:
                    out["inst_ratio"] = round(vals[-1], 2)
                    m_cnt = re.search(r"\n\s*(?:참여\s*)?건수\s*(?:\(?\s*주\s*\d+\s*\))?\s*\|", text[i:i + m_ratio.start()])
                    if m_cnt:
                        cnt = [v for v in _row_values(text, i + m_cnt.end() - 1) if v is not None]
                        out["inst_count"] = int(cnt[-1]) if cnt else None
                    a = i + m_ratio.start()
                    out["inst_evidence"] = re.sub(r"\s+", " ", text[a:a + 120]).strip()
                    return out
            i = text.find(anchor, i + len(anchor))
    # 표가 없으면 본문 문구("경쟁률 1,145.40 : 1", "1,145.40대 1")
    m = re.search(r"수요예측[^\n]{0,60}?경쟁률[^\d\n]{0,20}([\d,]+(?:\.\d+)?)\s*(?::\s*1|대\s*1)", text)
    if m:
        out["inst_ratio"] = round(float(m.group(1).replace(",", "")), 2)
        out["inst_evidence"] = _evidence(text, m)
    return out


_LISTING = re.compile(r"상장일\s*(?:\(\s*매매\s*개시일\s*\))?\s*[:：]?\s*(\d{4})\s*[년.\-]\s*(\d{1,2})\s*[월.\-]\s*(\d{1,2})")


def extract_result(text: str) -> dict:
    """증권발행실적보고서: 상장(매매개시)일, 일반청약 경쟁률(청약수량 ÷ 최초 배정수량), 청약 건수."""
    out = {"listing_dt": None, "listing_evidence": None, "retail_ratio": None,
           "retail_count": None, "retail_evidence": None}
    m = _LISTING.search(text)
    if m:
        out["listing_dt"] = f"{int(m.group(1)):04d}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
        out["listing_evidence"] = _evidence(text, m)
    i = text.find("청약 및 배정현황")
    if i < 0:
        i = text.find("청약 및 배정 현황")
    if i >= 0:
        m2 = re.search(r"\n\s*일반\s*(?:투자자|청약자)\s*\|", text[i:i + 6000])
        if m2:
            vals = _row_values(text, i + m2.end() - 1)
            # 칸 순서: 최초배정 수량·비율, 청약 건수·수량·금액·비율, 최종배정 건수·수량·금액·비율
            a = i + m2.start()
            out["retail_evidence"] = re.sub(r"\s+", " ", text[a:a + 140]).strip()
            v = vals + [None] * (11 - len(vals))
            alloc, cnt, qty, amt, f_qty, f_amt = v[0], v[2], v[3], v[4], v[7], v[8]
            price = f_amt / f_qty if f_amt and f_qty else None

            def unit_ok(q):       # 청약금액 ÷ 수량이 확정가 또는 증거금(확정가의 50%)과 맞는지
                if not (q and amt and price):
                    return price is None and bool(q)
                u = amt / q
                return any(abs(u - p) <= p * 0.01 for p in (price, price / 2))
            if alloc and unit_ok(qty):
                out["retail_ratio"] = round(qty / alloc, 2)
                out["retail_count"] = int(cnt) if cnt else None
            elif alloc and unit_ok(cnt):
                # 건수·수량 칸이 서로 바뀌어 기재된 공시: 금액으로 확인되는 칸을 청약수량으로 씁니다.
                out["retail_ratio"] = round(cnt / alloc, 2)
                out["retail_count"] = int(v[6]) if v[6] else None
                out["retail_evidence"] += " (건수·수량 칸 바뀜, 금액으로 확인)"
            else:
                out["retail_evidence"] += " (청약수량이 금액과 맞지 않아 비움)"
    return out


# ---------------------------------------------------------------- 수요예측 기일
# 증권신고서(정정 포함) '공모일정' 표: "수요예측 일시 | [국내 |] 2025년 04월 17일(목) ~ [2025년] 04월 23일(수)".
# [발행조건확정] 신고서에는 이 표가 없으므로 확정 직전의 신고서에서 읽습니다.
SCHEDULE_VERSION = 7   # 7: 단수평가·재평가 / 6: 사업의 개요 / 5: 원문 인코딩(cp949)·공시 뷰어 대체 / 2: 상장 시장·기술특례 구분 / 3: 기술평가 등급·평가기관 / 4: 이익미실현 경로
_DATE = r"(\d{4})\s*(?:년|[.\-/])\s*(\d{1,2})\s*(?:월|[.\-/])\s*(\d{1,2})\s*일?"
_DEMAND = re.compile(
    r"수요\s*예측\s*(?:일시|일자|기간|기일|일정|일)\s*(?:\([^)]{0,10}\))?\s*\|(?:\s*국내\s*\|)?\s*" + _DATE +
    r"(?:\s*\([^)]{0,4}\))?(?:\s*[~∼～\-–]\s*(?:(\d{4})\s*(?:년|[.\-/])\s*)?(\d{1,2})\s*(?:월|[.\-/])\s*(\d{1,2})\s*일?)?")


def extract_schedule(text: str) -> dict:
    """수요예측 시작·종료일. 못 찾으면 None 값과 status=no_match."""
    from datetime import date
    for m in _DEMAND.finditer(text):
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        try:
            start = date(y, mo, d)
            if m.group(5):
                ey = int(m.group(4)) if m.group(4) else (y + 1 if int(m.group(5)) < mo else y)
                end = date(ey, int(m.group(5)), int(m.group(6)))
            else:
                end = start
        except ValueError:
            continue
        if not (0 <= (end - start).days <= 31):
            continue
        return {"demand_start": start.isoformat(), "demand_end": end.isoformat(),
                "demand_evidence": _evidence(text, m), "status": "ok"}
    return {"demand_start": None, "demand_end": None, "demand_evidence": None, "status": "no_match"}


# ---------------------------------------------------------------- 상장 시장·기술특례 구분
# 신고서에는 「코스닥시장 상장규정」 인용(기술성장기업 의무보유 1년 등)이 거의 모든 건에 들어 있으므로,
# '기술성장기업' 단어 자체가 아니라 회사가 자신의 상장 경로를 밝힌 문장만 근거로 삼습니다.
_MKT_KQ = re.compile(r"코스닥\s*시장")
_MKT_KS = re.compile(r"유가증권\s*시장")
_TECH_RULES = [   # (경로, 패턴) — 앞의 것이 우선
    ("성장성 추천", re.compile(r"(?:상장\s*주선인|대표\s*주관\s*회사|주관\s*회사)(?:의|가|으로부터|로부터)?\s*[^|.]{0,30}?성장성\s*추천[^|.]{0,40}?(?:받|통해|적용|활용|이용)"
                               r"|성장성\s*추천\s*(?:특례|제도|요건)?\s*(?:을|를|에\s*의해|에\s*따라)?\s*(?:적용|받아|받은|통해|활용|이용)\s*[^|.]{0,40}?상장")),
    ("기술평가", re.compile(r"기술\s*성장\s*기업\s*(?:에\s*대한\s*|의\s*)?(?:상장\s*)?특례\s*(?:를|을)?\s*(?:적용|활용|이용)"
                            r"|기술\s*성장\s*특례\s*(?:를|을)?\s*(?:적용|활용|이용)"
                            r"|전문\s*평가\s*기관[^|]{0,250}?(?:AA|A|BBB)\s*등급"
                            r"|당사(?:는|가)\s*[^.|]{0,40}?기술\s*특례")),
]
_TECH_WEAK = re.compile(r"기술\s*특례\s*상장\s*기업[^|]{0,40}?(?:평가액|할인율|공모가)|특례\s*상장\s*기업\s*\(\s*기술\s*특례")
_TECH_NEG = re.compile(r"일반\s*상장\s*법인의?\s*(?:희망\s*공모가\s*)?(?:평가액|공모가)\s*대비\s*할인율")
# 이익미실현(테슬라) 요건: 기술특례가 아니므로 코스닥 일반으로 두고 경로만 따로 기록합니다.
_UNPROFIT = re.compile(r"이익\s*미실현\s*기업\s*(?:의\s*)?(?:상장\s*)?(?:요건|특례)[^.|]{0,40}?(?:적용|받)"
                       r"|당사는\s*(?:[^.|]{0,20})?이익\s*미실현\s*기업으로서"
                       r"|\(\s*이익\s*미실현\s*기업의\s*상장\s*\)\s*에\s*관한\s*요건을\s*적용")
_BIZMODEL = re.compile(r"사업\s*모델\s*(?:특례|평가)")


_GRADE = r"(AAA|AA|A|BBB|BB|B)(?![A-Za-z])"
_ANCHOR = re.compile(r"전문\s*평가|기술\s*평가|평가\s*기관")
_ORG = r"(?:\d\s*개\s*)?(?:사|기관)"
_RATING_PATS = [   # (형태, 패턴) — 두 기관 등급을 먼저, 한 등급(단수평가 등)은 마지막에
    ("pair", re.compile(_GRADE + r"\s*등급\s*(?:을|를)?\s*,?\s*(?:다른|나머지)\s*" + _ORG + r"\s*(?:에게|에|으로부터|로부터)?\s*" + _GRADE + r"\s*등급")),
    ("pair", re.compile(r"(?:각각\s*)?" + _GRADE + r"\s*(?:등급)?\s*(?:,|및|과|와|/)\s*" + _GRADE + r"\s*등급")),
    ("both", re.compile(r"(?:2\s*개\s*(?:사|기관)\s*(?:모두)?\s*(?:에게|으로부터|로부터)?\s*(?:모두\s*)?|모두\s*(?:로부터\s*)?)" + _GRADE + r"\s*등급")),
    ("single", re.compile(_GRADE + r"\s*등급\s*(?:을|를|의)")),
]
_RATING = _RATING_PATS[1][1]   # 하위 호환용


_AGENCIES = ("기술보증기금", "나이스디앤비", "NICE디앤비", "한국기술신용평가", "한국평가데이터", "한국기업데이터", "이크레더블",
             "한국산업기술기획평가원", "한국과학기술정보연구원", "한국보건산업진흥원", "한국발명진흥회", "정보통신산업진흥원",
             "한국생명공학연구원", "농업기술실용화재단", "한국농업기술진흥원", "해양수산과학기술진흥원", "한국에너지기술평가원",
             "연구개발특구진흥재단", "한국환경산업기술원", "한국방송통신전파진흥원", "SCI평가정보", "나이스평가정보",
             "한국건설기술연구원", "한국식품연구원", "정보통신기획평가원", "한국콘텐츠진흥원", "한국로봇산업진흥원",
             "NICE평가정보", "한국산업기술진흥원", "정보통신정책연구원", "한국인터넷진흥원", "한국과학기술연구원")


# 단수평가(1개 기관 A 이상으로 요건 충족: 코넥스 상장법인·시장평가 우수기업·소부장 전문기업 등)와 재평가
_SINGLE_EVAL = [
    re.compile(r"(?:1\s*개|한\s*개|1\s*곳|한\s*곳)\s*(?:의)?\s*(?:전문\s*)?평가\s*기관[^.。|]{0,60}?" + _GRADE +
               r"\s*등급\s*(?:을|를)?\s*(?:받|획득|통보)"),
    re.compile(r"(?:전문\s*)?평가\s*기관\s*(?:1\s*곳|1\s*개(?:\s*기관)?|한\s*곳)[^.。|]{0,60}?" + _GRADE +
               r"\s*등급\s*(?:을|를)?\s*(?:받|획득|통보)"),
    re.compile(r"단수\s*(?:기술\s*)?평가[^.。|]{0,80}?" + _GRADE + r"\s*등급\s*(?:을|를)?\s*(?:받|획득|통보)"),
]
_REEVAL = re.compile(r"재\s*평가[^.。|]{0,150}?" + _GRADE + r"\s*(?:등급)?\s*(?:,|및|과|와|/)\s*" + _GRADE +
                     r"\s*등급\s*(?:을|를)?\s*(?:획득|받|통보)")
_SINGLE_BASIS = (("코넥스", r"코넥스"), ("시장평가 우수기업", r"시장\s*평가\s*우수"),
                 ("소부장 전문기업", r"소재\s*[·ㆍ,]?\s*부품\s*[·ㆍ,]?\s*장비|소부장"))


def _tech_mode(text: str):
    """(방식, 등급, 위치): 단수평가면 ('단수평가(근거)', 'A', pos), 재평가면 ('재평가', 'A, A', pos)."""
    m = _REEVAL.search(text)
    if m:
        return "재평가", f"{m.group(1)}, {m.group(2)}", m.start()
    for p in _SINGLE_EVAL:
        m = p.search(text)
        if m:
            win = text[max(0, m.start() - 400): m.end() + 200]
            basis = next((k for k, pat in _SINGLE_BASIS if re.search(pat, win)), None)
            return ("단수평가(" + basis + ")" if basis else "단수평가"), m.group(1), m.start()
    return None, None, None


def extract_rating(text: str) -> dict:
    """기술평가 특례: 전문평가기관 등급(예: 'A, BBB', 단수평가는 'A')과 평가기관. 신용평가 등급은 제외합니다.
    재평가를 받은 경우 재평가 등급을, 단수평가로 요건을 채운 경우 그 방식(tech_mode)을 함께 돌려줍니다."""
    mode, mgrades, mpos = _tech_mode(text)
    base = _extract_rating(text)
    if mode == "재평가":
        out = _rating_out(text, mpos, mpos + 200, mgrades)
        out["tech_mode"] = "재평가"
        return out
    if mode:
        g = [x.strip() for x in (base["tech_grades"] or "").split(",") if x.strip()]
        two_orgs = len([x for x in (base.get("tech_agencies") or "").split(",") if x.strip()]) >= 2
        # 두 기관(기관명 둘)이 매긴 등급에 단수평가 등급이 들어 있을 때만 둘 다 둡니다(예: A·BB 중 A로 충족)
        if mgrades not in g or len(g) < 2 or not two_orgs:
            base = _rating_out(text, mpos, mpos + 200, mgrades)
        base["tech_mode"] = mode
        return base
    base["tech_mode"] = None
    return base


def _extract_rating(text: str) -> dict:
    single = None
    for a in _ANCHOR.finditer(text):
        win = text[a.start():a.start() + 360]
        flat = win.replace(" ", "")
        if "신용평가등급" in flat or "신용등급" in flat or "채무불이행" in flat:
            continue
        for kind, pat in _RATING_PATS:
            m = pat.search(win)
            if not m:
                continue
            g = [x for x in m.groups() if x]
            if re.match(r"\s*(?:이상|이상의|이상을)", win[m.end():m.end() + 6]) or (
                    kind == "both" and "이상" in win[m.end():m.end() + 22]):
                continue          # 'A등급 및 BBB등급 이상' 같은 요건 설명은 받은 등급이 아님
            if kind == "single":
                if single is None:
                    single = (a.start() + m.start(), a.start() + m.end(), g[0], a.start())
                continue
            grades = [g[0], g[0]] if kind == "both" else g[:2]
            return _rating_out(text, a.start(), a.start() + m.end(), ", ".join(grades))
    if single:
        return _rating_out(text, single[3], single[1], single[2])
    return {"tech_grades": None, "tech_agencies": None, "rating_evidence": None}


def _rating_out(text: str, start: int, end: int, grades: str) -> dict:
    ctx = text[max(0, start - 200):end]
    found = sorted((ctx.find(a), a) for a in _AGENCIES if a in ctx)
    names = []
    for _, a in found:
        if a not in names:
            names.append(a)
    ev = re.sub(r"\s+", " ", text[start:end]).strip()
    return {"tech_grades": grades, "tech_agencies": ", ".join(names[:2]) or None, "rating_evidence": ev[:300]}


def extract_profile(text: str) -> dict:
    """상장 시장(KOSDAQ/KOSPI)과 코스닥 기술특례(기술성장기업) 여부를 근거 문구와 함께 돌려줍니다."""
    kq, ks = len(_MKT_KQ.findall(text)), len(_MKT_KS.findall(text))
    market = None
    if kq or ks:
        market = "KOSPI" if ks > kq else "KOSDAQ"
    hints = {k: len(re.findall(v, text)) for k, v in (
        ("기술성장기업", r"기술\s*성장\s*기업"), ("기술특례", r"기술\s*특례"), ("성장성추천", r"성장성\s*추천"),
        ("전문평가기관", r"전문\s*평가\s*기관"), ("특례상장기업", r"특례\s*상장\s*기업"), ("일반상장법인", r"일반\s*상장\s*법인"),
        ("이익미실현", r"이익\s*미실현"))}
    out = {"market": market, "market_evidence": f"'코스닥시장' {kq}회, '유가증권시장' {ks}회" if market else None,
           "tech_track": None, "tech_evidence": None, "tech_grades": None, "tech_agencies": None, "tech_mode": None,
           "alt_route": None,
           "tech_hints": ", ".join(f"{k} {v}" for k, v in hints.items() if v) or None}
    if market != "KOSDAQ" or re.search(r"기업\s*인수\s*목적", text[:3000]):
        return out
    rating = extract_rating(text)
    out.update(tech_grades=rating["tech_grades"], tech_agencies=rating["tech_agencies"], tech_mode=rating.get("tech_mode"))
    for track, pat in _TECH_RULES:
        m = pat.search(text)
        if m:
            if track == "기술평가" and _BIZMODEL.search(text[max(0, m.start() - 300):m.end() + 300]):
                track = "사업모델"
            out.update(tech_track=track, tech_evidence=_evidence(text, m))
            return out
    if rating["tech_grades"]:   # 경로 서술은 못 찾았지만 전문평가기관 등급이 있으면 기술평가 특례
        out.update(tech_track="기술평가", tech_evidence=rating["rating_evidence"])
        return out
    m = _UNPROFIT.search(text)
    if m:
        out.update(alt_route="이익미실현", tech_evidence=_evidence(text, m))
        return out
    m = _TECH_WEAK.search(text)
    if m and not _TECH_NEG.search(text):
        out.update(tech_track="기술특례(추정)", tech_evidence=_evidence(text, m) + " [공모가 할인율 비교군 기준]")
    return out


# ---------------------------------------------------------------- 사업의 개요
# '제2부 발행인에 관한 사항 - II. 사업의 내용 - 1. 사업의 개요'의 서술 문단을 읽습니다. 목차·참조 문구와
# 용어 해설 표(셀 구분자 '|')는 건너뛰고, 요약용 원문(최대 1,500자)과 화면용 발췌(2~3문장)를 돌려줍니다.
_BIZ_HEAD = re.compile(r"(?:\d\s*\.\s*)?사업의\s*개요|(?:[ⅡII]+\s*\.\s*)?사업의\s*내용|회사의\s*현황")
_SENT_END = re.compile(r"(?<=니다)\.\s*|(?<=[다음함됨])\.(?=\s|$)")
_SUBJ = re.compile(r"(?:당\s?사|동사|본사|㈜\s?[^\s은는]{1,20}|\(주\)\s?[^\s은는]{1,20}|[가-힣A-Za-z0-9]{2,20}\s?주식회사)(?:는|은)\s")
_INTRO = re.compile(r"설립|기업입니다|회사입니다|업체입니다|영위|전문|개발|생산|제조|공급|제공|판매")


def _narrative(seg: str, limit: int) -> str:
    """서술 문장만: 표 칸(|)·용어 해설(종결어미 없는 줄)·각주는 버립니다."""
    out = []
    for line in seg.split("\n"):
        line = line.strip()
        if not line or line.count("|") >= 2 or "니다" not in line:
            continue
        if re.match(r"^\(?\s*(?:주\s*\d|단위|출처|※)", line):
            continue
        out.append(line.replace(" |", "").strip())
        if sum(len(x) for x in out) >= limit:
            break
    return " ".join(out)[:limit]


def extract_business(text: str) -> dict:
    """'사업의 개요' 서술에서 요약용 원문(최대 1,500자)과 화면용 발췌(2~3문장)."""
    cands = []
    for m in _BIZ_HEAD.finditer(text):
        body = _narrative(text[m.end():m.end() + 8000], 1800)
        if len(re.findall(r"[가-힣]{2,}", body)) < 12:
            continue
        sm = _SUBJ.search(body)
        # 회사가 주어인 소개 문장('당사는 … 설립/영위/개발…')으로 시작하는 문단을 우선합니다.
        good = sm is not None and sm.start() < 500 and _INTRO.search(body[sm.start():sm.start() + 200]) is not None
        numbered = text[max(0, m.start() - 3):m.start() + 2].strip()[:1].isdigit() or bool(re.match(r"\d", m.group(0)))
        cands.append(((0 if good else 1, 0 if numbered else 1, -len(body)), body, sm.start() if good else 0))
    if not cands:
        return {"biz_text": None, "biz_excerpt": None}
    cands.sort(key=lambda c: c[0])
    _, body, start = cands[0]
    body = body[start:][:1500]
    sents = [x.strip() for x in _SENT_END.split(body) if x and x.strip()]
    excerpt = ""
    for x in sents:
        x = x.rstrip(".") + "."
        if excerpt and len(excerpt) + len(x) > 330:
            break
        excerpt += x + " "
        if excerpt.count(". ") >= 3:
            break
    return {"biz_text": body, "biz_excerpt": excerpt.strip() or None}


def extract_listing_info(text: str) -> dict:
    """확정 전 신고서 한 건에서 읽는 값: 수요예측 기일 + 상장 시장·기술특례 + 사업의 개요."""
    return {**extract_schedule(text), **extract_profile(text), **extract_business(text)}
