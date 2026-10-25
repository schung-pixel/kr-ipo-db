"""증권신고서 '제3부 Ⅲ. 재무에 관한 사항 – 1. 요약재무정보' 표에서 핵심 재무 수치를 읽습니다.

입력은 lockup.rows_text()가 만든 '행 보존 텍스트'(표 한 행 = 한 줄, 칸은 " | ")입니다.
읽는 항목: 매출액·영업이익·당기순이익(손익), 자산총계·부채총계·자본총계(재무상태). 금액은 원 단위 정수.
연결 재무정보가 있으면 연결을, 없으면 별도를 씁니다. 공모가 산정 부분의 비교회사 요약재무 표는
제목 형식이 달라(대괄호 표제) 읽지 않습니다.
"""
from __future__ import annotations

import re

FIN_VERSION = 1
VIEWER_SECTIONS = ("요약재무정보",)
ITEMS = ("revenue", "op_income", "net_income", "assets", "liabilities", "equity")

# 요약재무정보 제목 줄: "Ⅲ. 재무에 관한 사항 1. 요약재무정보", "1. 요약재무정보", "가. 요약 연결재무정보", "나. 요약 별도재무정보"
_HEAD = re.compile(r"^(?:(?:Ⅲ|III)\s*\.?\s*재무에\s*관한\s*사항\s*)?(?:\d\s*\.|[가-라]\s*\.)?\s*"
                   r"(?:요약\s*(연결|별도|개별)?\s*재무\s*(?:정보|상태|제표)|(연결|별도|개별)\s*요약\s*재무\s*정보)\s*(?:\(.*\))?\s*$")
_SECTION = re.compile(r"(?:Ⅲ|III)\s*\.?\s*재무에\s*관한\s*사항")
_STOP = re.compile(r"^(?:\d\s*\.\s*(?:연결|재무제표|별도|요약|그\s*밖|배당|증권)|[나-마]\s*\.\s*(?:요약|연결|별도)|(?:Ⅳ|IV)\s*\.)")
_UNIT = re.compile(r"단위\s*[:：]?\s*(백만\s*원|천\s*원|억\s*원|원|백만\s*달러|천\s*달러|달러|USD|US\$|\$|백만\s*엔|엔|위안)")
_UNIT_MUL = {"원": 1, "천원": 1_000, "백만원": 1_000_000, "억원": 100_000_000}
_NUM = re.compile(r"^\(?[△▲\-−]?\s*\(?[\d,]+(?:\.\d+)?\)?$")
_DASH = re.compile(r"^[-−–—]$")
_YEAR = re.compile(r"(?<!\d)((?:19|20)\d\d)(?!\d)")
_DATE = re.compile(r"((?:19|20)\d\d)\s*[.년/-]\s*(\d{1,2})\s*[.월/-]?\s*(\d{1,2})?")
_PART = re.compile(r"([1-3])\s*분기|([1-3])\s*Q|반기|상반기")


def _num(cell: str):
    """'1,234' '(1,234)' '△1,234' '-1,234' → 정수, '-' → 0, 숫자가 아니면 None."""
    c = cell.strip().replace(" ", "")
    if _DASH.match(c):
        return 0
    if not _NUM.match(c):
        return None
    neg = c.startswith(("(", "△", "▲", "-", "−")) or c.endswith(")") and "(" in c
    digits = re.sub(r"[^\d.]", "", c)
    if not digits or digits == ".":
        return None
    v = float(digits)
    return -v if neg else v


def _norm(label: str) -> str:
    s = re.sub(r"^\s*(?:\d+\s*\.|\(\d+\)|[가-하]\s*\.|[IVXⅠ-Ⅹ]+\s*\.|[ㆍ·\-•]+)\s*", "", label)
    s = re.sub(r"\(.*?\)|\[|\]|<|>|【|】", "", s)
    return re.sub(r"[\sㆍ·*]", "", s)


def _item(label: str) -> str | None:
    n = _norm(label)
    if n in ("매출액", "매출", "영업수익", "수익", "매출수익", "매출및영업수익"):
        return "revenue"
    if re.fullmatch(r"영업(?:이익|손실|손익)", n):
        return "op_income"
    if re.fullmatch(r"(?:연결)?총?(?:당기|분기|반기|당분기|당반기|당기연결|연결당기)?(?:연결)?순(?:이익|손실|손익)", n):
        return "net_income"
    if n in ("자산총계", "자산합계", "자산총액"):
        return "assets"
    if n in ("부채총계", "부채합계", "부채총액"):
        return "liabilities"
    if n in ("자본총계", "자본합계", "자본총액"):
        return "equity"
    return None


def _cells(line: str) -> list[str]:
    parts = [c.strip() for c in line.split("|")]
    while parts and parts[-1] == "":
        parts.pop()
    return parts


def _data_row(cells: list[str], n: int | None):
    """숫자 칸이 뒤쪽에 n개(또는 n을 모르면 2개 이상) 이어지는 행이면 (라벨, 값 목록)."""
    vals = []
    for c in reversed(cells):
        v = _num(c)
        if v is None:
            break
        vals.append(v)
    vals.reverse()
    if n is not None:
        if len(vals) < n:
            return None
        vals = vals[-n:]
    elif len(vals) < 2:
        return None
    label = " ".join(c for c in cells[: len(cells) - len(vals)] if c)
    if not label:
        return None
    return label, vals


def _merged_rows(cells: list[str]):
    """'매출액 영업이익 당기순이익 | 51,549 10,049 9,101 | ...' 처럼 한 칸에 여러 행이 합쳐진 표를 풉니다.
    라벨은 공백으로 나누되 'ㆍ지배기업 소유주지분'처럼 하위 항목(ㆍ)에 이어지는 낱말은 붙입니다.
    라벨 수와 값 수가 어긋나면 앞에서부터 맞는 데까지만 씁니다."""
    if len(cells) < 3 or not re.search(r"\s", cells[0].strip()) or not re.search(r"[가-힣]{2}", cells[0]):
        return []
    toks = [t for t in re.split(r"\s+", cells[0].strip()) if t]
    labels: list[str] = []
    for t in toks:
        if labels and not re.match(r"^[ㆍ\[\-·]", t) and labels[-1].startswith("ㆍ"):
            labels[-1] += " " + t
        else:
            labels.append(t)
    cols = [[x for x in re.split(r"\s+", c.strip()) if x] for c in cells[1:] if c.strip()]
    if len(labels) < 2 or len(cols) < 2:
        return []
    k = len(cols[0])
    if k < 2 or any(len(c) != k for c in cols):
        return []
    m = min(k, len(labels)) if len(labels) == k else _simple_prefix(labels, k)
    out = []
    for i in range(m):
        vals = [_num(re.sub(r"[원주배%]$", "", c[i])) for c in cols]
        if any(v is None for v in vals):
            continue
        out.append((labels[i], vals))
    return out


def _simple_prefix(labels: list[str], k: int) -> int:
    """라벨 수가 값 수와 다를 때, 낱말 하나짜리 라벨이 이어지는 앞부분까지만 믿습니다."""
    n = 0
    for lab in labels[:k]:
        if " " in lab:
            break
        n += 1
    return n


def _period(text: str, first: bool) -> dict:
    """열 제목들(여러 줄을 이어 붙인 것)에서 연도·분반기·결산월."""
    years = _YEAR.findall(text)
    year = int(years[-1]) if years else None
    q, month = None, None
    dates = [(int(y), int(mo)) for y, mo, _ in _DATE.findall(text) if mo and 1 <= int(mo) <= 12]
    if dates:
        year, month = dates[-1]
    m = _PART.search(text)
    if m:
        q = int(m.group(1) or m.group(2)) if (m.group(1) or m.group(2)) else 2
    elif month in (3, 6, 9) and len(dates) >= 2 and dates[-2][1] == 1 and dates[-2][0] == year:
        q = {3: 1, 6: 2, 9: 3}[month]     # 2024.01.01 ~ 2024.03.31 같은 누적 기간
    elif month in (3, 6, 9) and first and not re.search(r"\d{4}\s*년\s*(?:도|말)?\s*\(?\s*제\s*\d+\s*기\s*(?:말)?\s*\)?\s*$", text.strip()):
        q = {3: 1, 6: 2, 9: 3}[month]
    if q:
        label = f"{year} " + {1: "1분기", 2: "반기", 3: "3분기"}[q]
    elif month and month != 12:
        label = f"{year}.{month:02d}"
    else:
        label = str(year) if year else "?"
    return {"label": label, "year": year, "q": q, "m": month}


_SUBHEAD = re.compile(r"^(?:[가-하]\s*\.|\(\d+\)|\d+\s*[.)])?\s*\S*.{0,30}(?:요약|재무\s*상태|손익|재무\s*정보|재\s*무\s*상\s*태)")
_END = re.compile(r"^\s*(?:\d\s*\.\s*(?:연결\s*재무\s*제표|재무\s*제표|별도\s*재무|요약\s*재무\s*정보\s*이외|그\s*밖의|배당)|(?:Ⅳ|IV)\s*\.)")


def _tables(lines: list[str]):
    """요약재무정보 구간을 한 줄씩 읽어 표 목록을 만듭니다. 표가 바뀌는 지점은 값 칸 수가 달라지거나
    새 제목 행·소제목이 나타날 때입니다. 각 표: basis(연결/별도), unit, periods, items."""
    tables = []
    cur = None
    basis = None
    unit = None
    head: list[list[str]] = []
    boundary = True
    for raw in lines:
        line = raw.strip()
        mu = _UNIT.search(line)
        if mu and not ("|" in line and _data_row(_cells(line), None)):
            unit = re.sub(r"\s", "", mu.group(1))     # 'EPS (단위: 원) | 1,445' 같은 데이터 행의 단위는 무시
        if "|" not in line:
            if line and len(line) < 90 and _SUBHEAD.match(line):
                if "연결" in line:
                    basis = "연결"
                elif re.search(r"별도|개별", line) or re.search(r"요약\s*재무\s*정보", line) and basis == "연결":
                    basis = "별도"
                boundary = True
            continue
        cells = _cells(line)
        rows = _merged_rows(cells)
        if not rows:
            dr = _data_row(cells, None) or _data_row1(cells)
            if dr and not (all(1990 <= abs(v) <= 2100 for v in dr[1]) and not _item(dr[0])):
                rows = [dr]
        if not rows:
            if _is_head(cells):
                head.append(cells)
                head = head[-4:]
                boundary = True
            continue
        n = len(rows[0][1])
        if cur is None or boundary and head or n != cur["n"]:
            if head:
                cols = [""] * n
                for h in head:
                    tail = h[-n:] if len(h) >= n else [""] * (n - len(h)) + h
                    for j in range(n):
                        cols[j] += " " + tail[j]
                periods = [_period(c, j == 0) for j, c in enumerate(cols)]
            elif cur is not None and n == cur["n"]:
                periods = cur["periods"]
            else:
                periods = None
            cur = {"n": n, "basis": basis, "unit": unit, "periods": periods, "items": {}}
            tables.append(cur)
        head = []
        boundary = False
        for lab, vals in rows:
            if len(vals) != cur["n"]:
                continue
            k = _item(lab)
            if k and k not in cur["items"]:
                cur["items"][k] = vals
    return tables


_HEADWORD = re.compile(r"(?:19|20)\d\d|제\s*\d+\s*(?:\(.{0,3}\))?\s*기|분기|반기|설립|기말|당기|전기")


def _is_head(cells: list[str]) -> bool:
    """기간 제목 행인지: 두 칸 이상, 칸마다 짧고, 연도·기수 같은 낱말이 있음."""
    if len(cells) < 2 or any(len(c) > 60 for c in cells):
        return False
    return bool(_HEADWORD.search(" ".join(cells[1:])))


def _data_row1(cells: list[str]):
    """값이 한 칸뿐인 행(설립일 재무 등)."""
    if len(cells) == 2 and cells[0] and _num(cells[1]) is not None:
        return cells[0], [_num(cells[1])]
    return None


def _sort_key(p):
    return (p["year"] or 0, p["q"] or 4, p.get("m") or 12)


def extract_financials(text: str) -> dict | None:
    lines = text.split("\n")
    start = None
    for i, l in enumerate(lines):
        if _SECTION.search(l) and re.search(r"요약\s*(?:연결\s*)?재무", l):
            start = i
            break
    if start is None:
        for i, l in enumerate(lines):
            if re.match(r"^\s*1\s*\.\s*요약\s*(?:연결\s*)?재무\s*정보", l) and len(l) < 60:
                start = i
                break
    if start is None:
        return None
    end = min(len(lines), start + 400)
    for j in range(start + 2, end):
        if "|" not in lines[j] and _END.match(lines[j]):
            end = j
            break
    head = lines[start]
    tabs = _tables(lines[start:end])
    default = "연결" if "연결" in head else None
    by: dict[str, dict] = {}
    vals_max = 0
    for t in tabs:
        b = t["basis"] or default or "별도"
        ok = bool(t["periods"]) and all(p["year"] for p in t["periods"])
        first = by.get(b, {}).get("first")
        if not ok:
            # 기간 제목을 못 읽은 표는 같은 재무정보의 첫 표와 열 수가 같을 때만 그 제목을 빌려 씁니다
            if not first or len(first) != t["n"]:
                continue
            t["periods"] = first
        u = t["unit"]
        a = t["items"].get("assets")
        if a:
            vals_max = max(vals_max, max(abs(v) for v in a))
        g = by.setdefault(b, {"unit": u, "cols": {}, "order": [], "first": None})
        if g["unit"] is None:
            g["unit"] = u
        # 같은 재무정보 안에서 열 수가 같은 표(재무상태표·손익계산서)는 첫 표의 기간 제목을 따릅니다
        if g["first"] is None:
            g["first"] = t["periods"]
        periods = g["first"] if len(g["first"]) == len(t["periods"]) else t["periods"]
        for k, vals in t["items"].items():
            for p, v in zip(periods, vals):
                key = p["label"]
                if key not in g["cols"]:
                    g["cols"][key] = dict(p, v={})
                    g["order"].append(key)
                g["cols"][key]["v"].setdefault(k, v)
    pick = None
    for b in ("연결", "별도"):
        g = by.get(b)
        if g and len({k for c in g["cols"].values() for k in c["v"]}) >= 3:
            pick = b
            break
    if not pick:
        return None
    g = by[pick]
    unit = g["unit"]
    if unit is None and vals_max >= 1e9:
        unit = "원"      # 단위 표기가 빠진 표: 자산이 10억 이상 숫자면 원 단위로 봅니다
    if unit not in _UNIT_MUL:
        return None
    mul = _UNIT_MUL[unit]
    cols = sorted(g["cols"].values(), key=_sort_key, reverse=True)
    out = {"basis": pick, "unit": unit, "periods": [c["label"] for c in cols],
           "years": [c["year"] for c in cols], "q": [c["q"] for c in cols]}
    for k in ITEMS:
        vs = [c["v"].get(k) for c in cols]
        if any(v is not None for v in vs):
            out[k] = [None if v is None else int(round(v * mul)) for v in vs]
    out["check"] = _balance(out)
    return out


def _balance(f: dict) -> bool | None:
    """자산 = 부채 + 자본이 모든 기간에서 1% 안으로 맞는지(셋 다 있을 때만)."""
    a, l, e = f.get("assets"), f.get("liabilities"), f.get("equity")
    if not (a and l and e):
        return None
    for x, y, z in zip(a, l, e):
        if x and y is not None and z is not None and abs(x - (y + z)) > abs(x) * 0.01:
            return False
    return True
