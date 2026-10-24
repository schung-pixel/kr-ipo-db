"""상장 후 유통가능 물량·보호예수(의무보유)·기관 의무보유확약을 투자설명서 원문에서 읽습니다.

원문 표를 행 단위로 보존한 텍스트(rows_text)를 씁니다. 셀은 ' | '로, 행은 줄바꿈으로 구분됩니다.
표 양식이 증권사·연도마다 달라 규칙으로 읽고, 읽은 값끼리 맞춰 본 뒤(예: 주주별 매각제한 합계 ≈ 상장주식수 −
상장일 유통가능) 맞지 않는 부분은 비워 둡니다. 확인되지 않은 값을 채워 넣지 않습니다.
"""
from __future__ import annotations

import io
import re
import zipfile

from .doctext import _clean, _decode

LOCKUP_VERSION = 2
# 2019년 이전 원문을 공시 뷰어로 받을 때 읽을 목차(투자위험요소·공모 일반사항)
VIEWER_SECTIONS = ("투자위험요소", "모집또는매출에관한일반사항", "모집 또는 매출에 관한 일반사항", "공모개요")


# ---------------------------------------------------------------- 원문 → 행 보존 텍스트
def rows_text_from_zip(zip_bytes: bytes) -> str:
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
        raw = "\n".join(_decode(z.read(n)) for n in z.namelist() if n.lower().endswith((".xml", ".html", ".htm")))
    return rows_text(raw)


def rows_text(raw: str) -> str:
    """원문 줄바꿈을 걷어내고 표의 행(TR)·문단(P) 단위로만 줄을 나눕니다."""
    raw = re.sub(r"<(?:script|style)[^>]*>.*?</(?:script|style)>", " ", raw, flags=re.I | re.S)
    raw = re.sub(r"[\r\n]+", " ", raw)
    # 셀 안의 문단·줄바꿈은 공백으로(행이 끊기지 않게)
    raw = re.sub(r"(<(TD|TH|TE|TU)\b[^>]*>)(.*?)(</\2>)",
                 lambda m: m.group(1) + re.sub(r"<(?:P|BR)\b[^>]*>|</P>", " ", m.group(3), flags=re.I) + m.group(4),
                 raw, flags=re.I | re.S)
    return _clean(raw)


# ---------------------------------------------------------------- 공통 도우미
def _n(s) -> int | None:
    s = (s or "").strip()
    if not re.fullmatch(r"[\d,]+", s):
        return None
    return int(s.replace(",", ""))


def _pct(s) -> float | None:
    m = re.fullmatch(r"\s*([\d.]+)\s*%?\s*", s or "")
    try:
        return float(m.group(1)) if m else None
    except ValueError:
        return None


def _cells(line: str) -> list[str]:
    cs = [c.strip().replace("　", "").strip() for c in line.split("|")]
    while cs and not cs[-1]:
        cs.pop()
    return cs


_PERIOD = re.compile(r"^(?:상장\s*(?:일로부터|일부터|일\s*기준|후)?\s*)?"
                     r"((?:\d+\s*년)?\s*(?:\d+\s*개월)?|\d+\s*일)\s*(?:간|뒤|후|경과)?$")


def _months(label: str) -> float | None:
    """'2년 6개월' → 30, '15일' → 0.5. 기간이 아니면 None."""
    s = re.sub(r"\s+", "", label or "")
    m = _PERIOD.match(s)
    if not m or not m.group(1):
        return None
    p = m.group(1)
    if p.endswith("일"):
        return round(int(p[:-1]) / 30, 2)
    y = re.search(r"(\d+)년", p)
    mo = re.search(r"(\d+)개월", p)
    if not y and not mo:
        return None
    return (int(y.group(1)) * 12 if y else 0) + (int(mo.group(1)) if mo else 0)


def period_label(months: float) -> str:
    if months < 1:
        return f"{round(months * 30)}일"
    m = int(round(months))
    y, r = divmod(m, 12)
    if y and r:
        return f"{y}년 {r}개월"
    return f"{y}년" if y else f"{r}개월"


# ---------------------------------------------------------------- 상장예정주식수·상장일 유통가능
_LISTED = [
    re.compile(r"상장\s*예정\s*주식\s*수\s*(?:는|은|가|\(주\d?\))?\s*(?:총\s*)?([\d,]{5,})\s*주"),
    re.compile(r"공모\s*후\s*(?:상장\s*예정\s*)?(?:발행\s*)?주식\s*총\s*수\s*(?:는|은)?\s*([\d,]{5,})\s*주"),
]
_FLOAT = [
    # 상장예정주식수 X주 중 (약) Y%에 해당하는 Z주는 상장 직후/상장일부터 …
    (re.compile(r"상장\s*예정\s*주식\s*수\s*([\d,]{5,})\s*주[^.。]{0,80}?중\s*(?:약\s*)?([\d.]+)\s*%\s*에\s*해당하는\s*"
                r"(?:약\s*)?([\d,]{3,})\s*주(?:는|은|가)?\s*(?:상장\s*(?:직후|일|당일)|유통)"), (1, 2, 3)),
    # … 4,112,879주(공모 후 지분율 34.56%)는 상장일부터 매도가 가능
    (re.compile(r"([\d,]{3,})\s*주\s*\(\s*[^()%]{0,25}?([\d.]+)\s*%\s*\)\s*(?:는|은|가|이)?\s*"
                r"상장\s*(?:일부터|일로부터|직후|당일|일\s*당일)\s*(?:시장에서\s*|바로\s*|즉시\s*)*"
                r"(?:매도|유통|매각|출회|거래)(?!\s*(?:될|할|이|가)?\s*수\s*없)(?![^.。]{0,12}(?:없|제한|금지))"), (None, 2, 1)),
    # 상장 직후 … 발행주식총수의 40.64%에 해당하는 2,044,627주
    (re.compile(r"상장\s*(?:직후|일)\s*[^.。]{0,60}?([\d.]+)\s*%\s*에\s*해당하는\s*([\d,]{3,})\s*주"), (None, 1, 2)),
]
_FLOAT_ROW = re.compile(r"^(?:상장\s*일|상장\s*직후|상장\s*당일)\s*(?:유통\s*가능\s*(?:물량|주식\s*수?)?)?\s*\|\s*([\d,]+)\s*(?:주)?\s*\|\s*([\d.]+)\s*%", re.M)


def _listed(text: str) -> tuple[int | None, str | None]:
    best = None
    for p in _LISTED:
        for m in p.finditer(text):
            best = (m, _n(m.group(1)))
    return (best[1], _snip(text, best[0])) if best else (None, None)


_LOCKED_SENT = re.compile(r"상장\s*예정\s*주식\s*수\s*([\d,]{5,})\s*주\s*중\s*(?:약\s*)?([\d,]{3,})\s*주\s*\(\s*([\d.]+)\s*%\s*\)\s*"
                          r"(?:는|은)\s*(?:보호\s*예수|매도\s*금지|매각\s*제한|의무\s*보유|유통\s*제한)")


def _float0(text: str, listed: int | None = None) -> dict | None:
    """상장일 유통가능 물량. 후보가 여럿이면 본문 뒤쪽 것을 쓰되, 상장예정주식수와 비율이 맞지 않는 후보
    (주식수 ÷ 상장주식수와 적힌 비율이 1.5%p 넘게 차이)는 버립니다."""
    cands = []
    for p, (gi, gp, gs) in _FLOAT:
        for m in p.finditer(text):
            sh, pc = _n(m.group(gs)), _pct(m.group(gp))
            if sh and pc and 0 < pc <= 100:
                cands.append((m.start(), {"shares": sh, "pct": pc, "listed": _n(m.group(gi)) if gi else None,
                                          "evidence": _snip(text, m)}))
    for m in _FLOAT_ROW.finditer(text):
        sh, pc = _n(m.group(1)), _pct(m.group(2))
        if sh and pc and 0 < pc <= 100:
            cands.append((m.start(), {"shares": sh, "pct": pc, "listed": None, "evidence": _snip(text, m)}))

    def ok(c):
        base = c["listed"] or listed
        return not base or abs(c["shares"] / base * 100 - c["pct"]) <= 1.5

    good = [c for c in cands if ok(c[1])]
    if good:
        return max(good, key=lambda c: c[0])[1]
    # 직접 적힌 유통가능 물량이 없으면 '상장예정주식수 X주 중 Y주(Z%)는 보호예수…'에서 계산
    ms = list(_LOCKED_SENT.finditer(text))
    if ms:
        m = ms[-1]
        lst, lk = _n(m.group(1)), _n(m.group(2))
        if lst and lk and lk < lst:
            return {"shares": lst - lk, "pct": round((lst - lk) / lst * 100, 2), "listed": lst,
                    "evidence": _snip(text, m), "derived": True}
    return None


def _snip(text: str, m) -> str:
    a, b = max(0, m.start() - 10), min(len(text), m.end() + 10)
    return re.sub(r"\s+", " ", text[a:b]).strip()[:220]


# ---------------------------------------------------------------- 해제 일정(누적 유통가능)
_SCHED_ROW = re.compile(r"^상장\s*(?:후|일로부터|일부터)\s*(\d+\s*년|\d+\s*개월|\d+\s*일)\s*(?:뒤|후|경과\s*후?)?\s*"
                        r"(?:유통\s*가능\s*(?:물량|주식\s*수?)?)?\s*\|\s*([\d,]+)\s*(?:주)?\s*\|\s*([\d.]+)\s*%", re.M)
_SCHED_SENT = re.compile(r"(\d+)\s*(개월|년)\s*(?:후|뒤)\s*:?\s*([\d,]{3,})\s*주\s*\(\s*누적\s*(?:지분율\s*)?([\d.]+)\s*%\s*\)")


def _schedule(text: str) -> list | None:
    blocks, cur, last = [], [], -10
    for m in _SCHED_ROW.finditer(text):
        line_no = text.count("\n", 0, m.start())
        if line_no - last > 2 and cur:
            blocks.append(cur)
            cur = []
        mo = _months(m.group(1))
        if mo is not None:
            cur.append({"months": mo, "shares": _n(m.group(2)), "pct": _pct(m.group(3))})
        last = line_no
    if cur:
        blocks.append(cur)
    if blocks:
        return _mono(blocks[-1])
    sents = list(_SCHED_SENT.finditer(text))
    if sents:
        # 마지막 문단의 연속된 문장만
        tail = [m for m in sents if m.start() >= sents[-1].start() - 600]
        out = [{"months": int(m.group(1)) * (12 if m.group(2) == "년" else 1), "shares": _n(m.group(3)),
                "pct": _pct(m.group(4))} for m in tail]
        return _mono(out)
    return None


def _mono(rows: list) -> list | None:
    seen, out = set(), []
    for r in sorted(rows, key=lambda r: r["months"]):
        if r["months"] in seen or not r["shares"]:
            continue
        if out and r["shares"] < out[-1]["shares"]:
            return None          # 누적이 줄어들면 표를 잘못 읽은 것
        seen.add(r["months"])
        out.append(r)
    return out or None


# ---------------------------------------------------------------- 주주 구분별 매각제한
_HOLDER_HEAD = re.compile(r"구\s*분")
_FLOW = re.compile(r"유통\s*가능")
_LOCKW = re.compile(r"매각\s*제한|매도\s*(?:금지|제한)|보호\s*예수|의무\s*보유|유통\s*제한")
_STOP = re.compile(r"^(?:주\s*\d+\s*\)|\(\s*주\s*\d*\s*\)|※|\*|주\)|\[|【|\(단위|가\.|나\.|다\.|라\.|마\.|\d+\.)")
_IS_PCT = re.compile(r"^-?[\d.]+\s*%$")
_GROUP_LABEL = re.compile(r"최대\s*주주|5\s*%\s*이상|1\s*%\s*(?:이상|미만)|벤처|전문\s*투자자|기타\s*주주|소액|공모\s*주주|"
                          r"우리\s*사주|일반\s*법인|외국|기관|주관|상장\s*주선인|신기술|자기\s*주식|임원|특수\s*관계|"
                          r"투자\s*조합|기존\s*주주|개인|법인\s*주주")


def _category(group: str, row_text: str) -> str:
    t = group + " " + row_text
    if re.search(r"우리\s*사주", t):
        return "우리사주조합"
    if re.search(r"의무\s*인수|상장\s*주선인|주관\s*회?사?\s*(?:의무)?\s*(?:인수|취득)", t):
        return "상장주선인 의무인수"
    if re.search(r"최대\s*주주|특수\s*관계", group) or (
            not _GROUP_LABEL.search(group) and re.search(r"최대\s*주주|특수\s*관계인?", row_text)):
        return "최대주주등"
    if re.search(r"벤처|신기술|창업\s*투자|전문\s*투자자|투자\s*조합|사모\s*투자|펀드|기관", t):
        return "벤처금융·전문투자자"
    return "기타 주주"


def _holder_groups(text: str) -> tuple[list | None, int | None]:
    lines = text.split("\n")
    heads = [i for i, l in enumerate(lines) if _HOLDER_HEAD.search(l) and _LOCKW.search(l) and l.count("|") >= 4
             and (_FLOW.search(l) or re.search(r"주주\s*명|성\s*명|가능\s*여부", l))
             and not re.search(r"부여|행사|가중치|유통보통주식", l)]
    if not heads:
        return None, None
    h = heads[-1]
    head = lines[h]
    hb = " ".join(lines[h:h + 3])
    lq = re.search(r"(?:매각\s*제한|매도\s*금지|보호\s*예수|의무\s*보유|유통\s*제한)\s*(?:물량|주식)", hb)
    fq = re.search(r"유통\s*가능\s*(?:물량|주식)", hb)
    lock_last = not (lq and fq and lq.start() < fq.start())
    rows = []
    for l in lines[h + 1: h + 400]:
        if "|" not in l or _STOP.match(l.strip()):
            if rows:
                break
            continue
        cs = _cells(l)
        if not cs or all(re.fullmatch(r"주식\s*수|지분율|비율|주식수\(주\)|기간|의무.*|자발.*|총.*|", c) for c in cs):
            continue
        rows.append(cs)
    if not rows:
        return None, None
    # '가능여부' 열(유통제한물량/유통가능물량)이 있으면 떼어 내고 행마다 상태로 기억합니다
    norm, status = [], None
    for cs in rows:
        if re.search(r"유통\s*가능\s*(?:물량|주식)", cs[0]):
            status, cs = "free", cs[1:]
        elif re.search(r"유통\s*제한|매각\s*제한|매도\s*(?:금지|제한)|보호\s*예수|의무\s*보유", cs[0]) and len(cs) > 3:
            status, cs = "lock", cs[1:]
        if cs:
            norm.append((cs, status))
    full = max(len(r) for r, _ in norm)
    # 기간 열의 위치(오른쪽에서 몇 번째)를 기간이 적힌 온전한 행에서 배웁니다
    roff = None
    for cs, _ in norm:
        if len(cs) == full:
            for i in range(len(cs) - 1, -1, -1):
                if _months(cs[i]) is not None:
                    roff = len(cs) - i
                    break
        if roff:
            break
    notes = _footnote_periods(lines, h)
    group, period, agg, total_row, after_sub, last_cat = "", None, {}, None, False, None
    for cs, st in norm:
        joined = " ".join(cs)
        is_total = any(re.fullmatch(r"(?:공모\s*후\s*)?(?:합\s*계|총\s*계|계)", c) for c in cs[:2])
        is_sub = any(re.search(r"(?:^|\s)소\s*계$", c) for c in cs[:2])
        if len(cs) >= full - 0 and not is_total and not is_sub and _GROUP_LABEL.search(cs[0]):
            group = cs[0]
        # 기간 셀(오른쪽에서 찾음)
        pidx = None
        for i in range(len(cs) - 1, -1, -1):
            if _months(cs[i]) is not None and not _IS_PCT.match(cs[i]):
                pidx = i
                break
        if pidx is None and roff and len(cs) == full and cs[len(cs) - roff] in ("-", "", "해당없음"):
            pidx = len(cs) - roff           # 기간 칸이 '-'인 온전한 행
        if pidx is not None:
            body = cs[:pidx]
        trailing_dash = 0
        if pidx is None:   # 기간 칸이 빠진 행(위 행과 병합): 마지막 % 셀까지만
            lastp = max((i for i, c in enumerate(cs) if _IS_PCT.match(c)), default=-1)
            body = cs[:lastp + 1]
            trailing_dash = sum(1 for c in cs[lastp + 1:] if c in ("-", ""))
        pairs = []
        for i in range(len(body) - 1):
            v, p = body[i], body[i + 1]
            if (_IS_PCT.match(p) or (p == "-" and v == "-") or (p == "" and _n(v) is not None)) and (v == "-" or _n(v) is not None):
                pairs.append(_n(v) or 0)
        if not pairs and pidx is not None and pidx >= 1 and _n(cs[pidx - 1]) is not None and len(cs) <= 4:
            pairs = [_n(cs[pidx - 1])]      # '336,000 | 3개월' 처럼 지분율 없이 나뉜 행
        if not pairs:
            continue
        lock = pairs[-1] if (lock_last or len(pairs) == 1) else pairs[-2]
        if trailing_dash >= 3 and lock_last:
            lock = 0       # '… | - | - | - | -' : 매각제한 칸까지 비어 있음
        if is_total:
            total_row = lock
            break
        if is_sub:
            after_sub = True
            continue
        if after_sub and re.fullmatch(r"보통주|종류\s*주식|우선주|전환\s*우선주|상환전환우선주", cs[0]):
            continue
        after_sub = False
        if st == "free":
            continue
        if pidx is not None and _months(cs[pidx]) is not None:
            period = _months(cs[pidx])
        elif pidx is None:
            ref = next((notes[k] for k in re.findall(r"주\s*(\d+)\s*\)", joined) if k in notes), None)
            if ref is not None:
                period = ref
        elif pidx is not None:
            period = None if not lock else period
        if not lock:
            continue
        if period is None:
            return None, None          # 기간을 알 수 없는 매각제한 → 표를 믿지 않음
        # 한 주주의 기간별 분할 행(주식수·지분율·기간만 있는 행)은 바로 위 주주의 구분을 따릅니다
        cont = last_cat and (len(cs) <= 4 or _n(cs[0]) is not None)
        cat = last_cat if cont else _category(group, joined)
        last_cat = cat
        key = (cat, period)
        agg[key] = agg.get(key, 0) + lock
    out = [{"category": k[0], "months": k[1], "shares": v} for k, v in agg.items()]
    order = ["최대주주등", "우리사주조합", "상장주선인 의무인수", "벤처금융·전문투자자", "기타 주주"]
    out.sort(key=lambda r: (order.index(r["category"]), -r["months"]))
    return (out or None), total_row


def _footnote_periods(lines: list, h: int) -> dict:
    """표 뒤 각주('주1) … 상장일로부터 1년간 …')에서 각주 번호 → 기간(개월)."""
    out = {}
    for l in lines[h: h + 260]:
        m = re.match(r"^\(?\s*주\s*(\d+)\s*\)\s*\|?\s*(.*)", l.strip())
        if not m or m.group(1) in out:
            continue
        p = re.search(r"상장\s*(?:일로부터|일부터|후|일\s*이후)\s*(\d+\s*년(?:\s*\d+\s*개월)?|\d+\s*개월|\d+\s*일)", m.group(2))
        if p:
            out[m.group(1)] = _months(p.group(1))
    return out


# ---------------------------------------------------------------- 기관 의무보유확약
_COMMIT_ROW = re.compile(r"^\s*(?:\d\s*[.)]\s*)?(미\s*확약|(\d+)\s*(일|개월)\s*(?:이상\s*)?확약)\s*\|")


def _commitment(text: str) -> dict | None:
    lines = text.split("\n")
    blocks, cur = [], []
    for i, l in enumerate(lines):
        if _COMMIT_ROW.match(l):
            cur.append(i)
        elif cur and re.match(r"^\s*(?:확약\s*합\s*계|합\s*계|총\s*(?:참여|신청)[^|]*|계)\s*\|", l):
            cur.append(i)
        elif cur:
            blocks.append(cur)
            cur = []
    if cur:
        blocks.append(cur)
    best = None
    for b in blocks:
        start = b[0]
        ctx = lines[max(0, start - 6): start]
        head = next((l for l in reversed(ctx) if re.search(r"구\s*분", l)), "")
        if not head:
            continue
        sub = " ".join(ctx)
        triplet = "신청가격" in sub or "가격" in sub.split("구")[-1]
        single = re.search(r"참여\s*건수|신청\s*수량", head) and not re.search(r"국내|해외|외국", head)
        has_total = re.search(r"합\s*계\s*\|?\s*$", head.strip()) or re.search(r"\|\s*합\s*계\s*\|", head + "|")
        if not single and not has_total:
            continue
        qcol = None
        if single:
            hc = _cells(head)
            qcol = next((i for i, c in enumerate(hc) if re.search(r"수량", c)), None)
        by, unc, tot, ratio = {}, None, None, None
        for i in b:
            cs = _cells(lines[i])
            if qcol is not None:
                q = _n(cs[qcol]) if qcol < len(cs) else None
            else:
                q = _n(cs[-2] if triplet else cs[-1]) if len(cs) >= 3 else None
                if triplet and q is None and len(cs) >= 3 and _n(cs[-1]) is not None and _pct(cs[-1]) is None:
                    q = None
            m = _COMMIT_ROW.match(lines[i])
            if m:
                if m.group(1).replace(" ", "") == "미확약":
                    unc = q or 0
                else:
                    mo = int(m.group(2)) / 30 if m.group(3) == "일" else int(m.group(2))
                    by[round(mo, 2)] = by.get(round(mo, 2), 0) + (q or 0)
            elif re.match(r"^\s*총\s*(?:참여|신청)", lines[i]):
                pc = [_pct(c.replace("%", "")) for c in cs[1:] if "%" in c]
                if pc:
                    ratio = pc[-1] if qcol is None else (pc[1] if len(pc) > 1 else pc[0])
            elif re.match(r"^\s*합\s*계", lines[i]):
                tot = q
        committed = sum(by.values())
        if not by:
            continue
        total = (committed + unc) if unc is not None else None
        if tot and unc is not None and abs(tot - total) > max(5, tot * 0.002):
            continue        # 합계가 맞지 않으면 열을 잘못 고른 것
        if total is None and tot and single:
            total = None    # 단일표의 합계는 확약 합계일 뿐
        if total:
            ratio = round(committed / total * 100, 2)
        if ratio is None:
            continue
        best = {"ratio": ratio, "committed": committed, "total": total,
                "by": [{"months": k, "qty": v} for k, v in sorted(by.items())]}
    return best


# ---------------------------------------------------------------- 묶음
def extract_lockup(text: str) -> dict:
    listed, listed_ev = _listed(text)
    f0 = _float0(text, listed)
    if f0 and f0.get("listed"):
        listed = f0["listed"]
    sched = _schedule(text)
    groups, total_lock = _holder_groups(text)
    commit = _commitment(text)
    if f0 and not listed and f0["pct"]:
        listed = round(f0["shares"] / f0["pct"] * 100)
    if sched and listed and sched[-1]["shares"] > listed * 1.02:
        sched = None
    # 검증: 주주별 매각제한 합 ≈ 상장주식수 − 상장일 유통가능 (또는 표의 합계 행)
    groups_full = False
    if groups:
        s = sum(g["shares"] for g in groups)
        ref = (listed - f0["shares"]) if (listed and f0) else None
        if ref and abs(s - ref) <= ref * 0.03:
            groups_full = True
        elif not (total_lock and abs(s - total_lock) <= total_lock * 0.01):
            groups = None      # 표의 합계와도 맞지 않으면 버림(표의 합계와만 맞으면 표에 실린 범위로 보여 줌)
    if groups and listed:
        for g in groups:
            g["pct"] = round(g["shares"] / listed * 100, 2)
    # 해제 일정이 없으면 검증된 주주별 내역으로 만듭니다
    if not sched and groups and groups_full and f0 and listed:
        cum, acc = [], f0["shares"]
        for mo in sorted({g["months"] for g in groups}):
            acc += sum(g["shares"] for g in groups if g["months"] == mo)
            cum.append({"months": mo, "shares": acc, "pct": round(acc / listed * 100, 2), "derived": True})
        sched = cum
    if sched and f0 and sched[0]["shares"] < f0["shares"] * 0.98:
        sched = None
    ok = any([f0, sched, groups, commit])
    return {"status": "ok" if ok else "not_found", "listed": listed,
            "float0": {k: f0[k] for k in ("shares", "pct", "evidence")} if f0 else None,
            "schedule": sched, "groups": groups, "groups_full": bool(groups) and groups_full, "commit": commit}


_BUNDLE = ("listed", "float0", "schedule", "groups", "groups_full")


def merge(base: dict, new: dict, rcept_no: str) -> dict:
    """여러 원문의 결과를 합칩니다. 유통물량 묶음(상장주식수·상장일 유통·해제 일정·주주별 내역)과
    확약 비율은 각각 그 값을 가진 가장 최근 원문(접수번호가 큰 쪽)에서 가져옵니다."""
    out = dict(base or {})
    if new.get("float0") or new.get("schedule"):
        if not out.get("src_float") or rcept_no > out["src_float"]:
            for k in _BUNDLE:
                out[k] = new.get(k)
            out["src_float"] = rcept_no
    if new.get("commit"):
        if not out.get("src_commit") or rcept_no > out["src_commit"]:
            out["commit"], out["src_commit"] = new["commit"], rcept_no
    out["status"] = "ok" if (out.get("float0") or out.get("schedule") or out.get("commit")) else "not_found"
    return out
