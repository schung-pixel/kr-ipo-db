"""공시 목록과 증권신고서 응답을 해석하는 순수 함수 모음."""
from __future__ import annotations

import re
from datetime import date, timedelta
from typing import Iterator

_PREFIX = re.compile(r"^\s*((?:\[[^\]]+\]\s*)+)")
AMEND_TAGS = {"기재정정", "첨부정정", "첨부추가"}
ORDER_TAGS = {"정정명령부과", "정정제출요구"}


def classify(report_nm: str | None) -> dict:
    """보고서명에서 문서 종류와 정정·발행조건확정 여부를 판별합니다."""
    name = (report_nm or "").strip()
    m = _PREFIX.match(name)
    tags = re.findall(r"\[([^\]]+)\]", m.group(1)) if m else []
    base = name[m.end():].strip() if m else name
    # 해외기업 상장은 주식예탁증서(KDR)로 공모하므로 '증권신고서(증권예탁증권)'도 같은 공모 신고서로 봅니다.
    if base.startswith("증권신고서(지분증권)") or base.startswith("증권신고서(증권예탁증권)"):
        kind = "reg_equity"
    elif "투자설명서" in base:
        kind = "prospectus"
    elif "증권발행실적보고서" in base:
        kind = "result"
    else:
        kind = "other"
    tagset = set(tags)
    return {
        "doc_kind": kind,
        "tags": ",".join(tags),
        "is_amendment": int(bool(AMEND_TAGS & tagset)),
        "is_price_fixed": int("발행조건확정" in tagset),
        "is_correction_order": int(bool(ORDER_TAGS & tagset)),
    }


def to_int(value) -> int | None:
    """'9,999,999,999' 형태 문자열을 정수로. 숫자가 아니면 None."""
    if value is None:
        return None
    s = re.sub(r"[,\s]", "", str(value))
    return int(s) if re.fullmatch(r"-?\d+", s) else None


def extract_ints(value) -> list[int]:
    """문자열 안의 모든 정수(천 단위 쉼표 허용)를 순서대로 반환."""
    return [int(x.replace(",", "")) for x in re.findall(r"\d[\d,]*", str(value or ""))]


def price_range(value) -> tuple[int, int] | None:
    """모집가액 문자열에서 (하단, 상단)을 추출. 숫자가 1개면 단일가, 2개면 밴드, 그 외 None."""
    nums = extract_ints(value)
    if len(nums) == 1:
        return nums[0], nums[0]
    if len(nums) == 2:
        return min(nums), max(nums)
    return None


def iso_date(yyyymmdd: str | None) -> str | None:
    s = (yyyymmdd or "").strip()
    if re.fullmatch(r"\d{8}", s):
        return f"{s[:4]}-{s[4:6]}-{s[6:]}"
    return None


def windows(bgn: date, end: date, span_days: int = 80) -> Iterator[tuple[date, date]]:
    """corp_code 없는 공시검색의 3개월 제한을 피하기 위해 기간을 나눕니다."""
    cur = bgn
    while cur <= end:
        stop = min(cur + timedelta(days=span_days - 1), end)
        yield cur, stop
        cur = stop + timedelta(days=1)
