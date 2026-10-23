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


def to_text(zip_bytes: bytes) -> str:
    """document.xml 응답(zip)을 태그를 걷어낸 줄 단위 텍스트로 바꿉니다."""
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
        raw = "\n".join(z.read(n).decode("utf-8", errors="replace")
                        for n in z.namelist() if n.lower().endswith((".xml", ".html", ".htm")))
    raw = re.sub(r"<(?:TR|P|BR|TABLE)[^>]*>", "\n", raw, flags=re.I)
    raw = re.sub(r"</(?:TD|TH|TE|TU)>", " | ", raw, flags=re.I)
    raw = re.sub(r"<[^>]+>", "", raw)
    raw = raw.replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&").replace("&nbsp;", " ")
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
PARSER_VERSION = 3   # 추출 규칙이 바뀌면 올립니다. 이전 버전으로 추출한 원문은 다시 받습니다.

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
