"""38커뮤니케이션 공모주 화면에서 신규상장일과 일반청약 경쟁률을 읽습니다(보조 출처).

DART 증권발행실적보고서는 납입 뒤에 나오므로, 그 전까지 상장일·일반청약 경쟁률이 비어 있습니다.
38커뮤니케이션은 청약 마감 당일 경쟁률과 거래소 확정 상장일을 먼저 올리므로 그 사이를 채우는 데만 씁니다.
DART 값이 생기면 항상 DART 값을 씁니다.

  - 신규상장 화면(o=nw): 기업명 | 신규상장일(YYYY/MM/DD) | … | 공모가 | …
  - 청약일정 화면(o=k):  종목명 | 공모주일정(YYYY.MM.DD~MM.DD) | 확정공모가 | 희망공모가 | 청약경쟁률(N:1) | 주간사
"""
from __future__ import annotations

import re
from html.parser import HTMLParser

from .kind import name_key as _kind_key


def name_key(name: str) -> str:
    """38 화면의 회사명 꼬리표('(유가)', '(구.옛 사명)' 등)를 떼고 KIND·DART와 같은 규칙으로 정규화합니다."""
    return _kind_key(re.sub(r"\([^)]*\)", "", name or ""))

BASE = "http://www.38.co.kr/html/fund/index.htm"
USER_AGENT = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")


class _Rows(HTMLParser):
    """모든 표의 행을 칸 문자열 목록으로 모읍니다(중첩 표는 안쪽 행이 따로 잡힘)."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.rows, self._row, self._cell = [], None, None

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self._row = []
        elif tag in ("td", "th") and self._row is not None:
            self._cell = []

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self._row is not None and self._cell is not None:
            self._row.append(re.sub(r"\s+", " ", "".join(self._cell)).strip())
            self._cell = None
        elif tag == "tr" and self._row is not None:
            self.rows.append(self._row)
            self._row = None

    def handle_data(self, data):
        if self._cell is not None:
            self._cell.append(data.replace("\xa0", " "))


def _rows(html: str) -> list:
    p = _Rows()
    p.feed(html)
    return p.rows


def _table(rows, head0: str, need: str):
    """머리행 첫 칸이 head0이고 need 칸이 있는 표의 (머리행, 본문 행) — 머리 칸 수와 같은 행만."""
    for i, r in enumerate(rows):
        if r and r[0].replace(" ", "") == head0 and any(need in c.replace(" ", "") for c in r):
            heads = [c.replace(" ", "") for c in r]
            body = []
            for x in rows[i + 1:]:
                if len(x) != len(heads):
                    if body:
                        break
                    continue
                body.append(x)
            return heads, body
    return None, []


def parse_new_listing(html: str) -> list:
    heads, body = _table(_rows(html), "기업명", "신규상장일")
    if not heads:
        return []
    ni, li = 0, next(i for i, h in enumerate(heads) if "신규상장일" in h)
    col = lambda word: next((i for i, h in enumerate(heads) if h.startswith(word)), None)
    oi, si, ci = col("공모가("), col("시초가("), col("첫날종가")

    def num(r, i):
        v = re.sub(r"[^\d]", "", r[i]) if i is not None and i < len(r) else ""
        return int(v) if v else None
    out = []
    for r in body:
        m = re.match(r"(\d{4})[/.\-](\d{1,2})[/.\-](\d{1,2})", r[li])
        name = r[ni].strip()
        if name and m:
            out.append({"name_key": name_key(name), "corp_name": name,
                        "listing_dt": f"{int(m.group(1)):04d}-{int(m.group(2)):02d}-{int(m.group(3)):02d}",
                        "offer_price": num(r, oi), "open_price": num(r, si), "close_d1": num(r, ci)})
    return out


def parse_subscription(html: str) -> list:
    heads, body = _table(_rows(html), "종목명", "청약경쟁률")
    if not heads:
        return []
    si = next(i for i, h in enumerate(heads) if "공모주일정" in h)
    ri = next(i for i, h in enumerate(heads) if "청약경쟁률" in h)
    out = []
    for r in body:
        name = r[0].strip()
        m = re.match(r"(\d{4})\.(\d{1,2})\.(\d{1,2})\s*~\s*(?:(\d{4})\.)?(\d{1,2})\.(\d{1,2})", r[si])
        if not (name and m):
            continue
        y = int(m.group(1))
        start = f"{y:04d}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
        ey = int(m.group(4)) if m.group(4) else (y + 1 if int(m.group(5)) < int(m.group(2)) else y)
        end = f"{ey:04d}-{int(m.group(5)):02d}-{int(m.group(6)):02d}"
        mr = re.match(r"([\d,]+(?:\.\d+)?)\s*:\s*1", r[ri].replace(" ", ""))
        ratio = float(mr.group(1).replace(",", "")) if mr else None
        out.append({"name_key": name_key(name), "corp_name": name, "sub_start": start, "sub_end": end,
                    "retail_ratio": ratio})
    return out


def pair(nw: list, k: list) -> list:
    """신규상장 행과 청약일정 행을 회사·날짜로 짝지어 공모 단위 행으로 만듭니다.
    청약 시작 후 60일 안의 가장 가까운 상장일을 같은 공모로 봅니다(같은 이름의 다른 회사·재상장 구분)."""
    from datetime import date
    out, used = [], set()
    by_name = {}
    for i, r in enumerate(nw):
        by_name.setdefault(r["name_key"], []).append(i)
    for r in k:
        row = dict(r)
        best = None
        for i in by_name.get(r["name_key"], []):
            if i in used:
                continue
            gap = (date.fromisoformat(nw[i]["listing_dt"]) - date.fromisoformat(r["sub_start"])).days
            if 0 <= gap <= 60 and (best is None or gap < best[0]):
                best = (gap, i)
        if best:
            used.add(best[1])
            row.update({c: nw[best[1]][c] for c in ("listing_dt", "offer_price", "open_price", "close_d1")})
        out.append(row)
    out += [dict(nw[i]) for i in range(len(nw)) if i not in used]
    for r in out:
        r["row_key"] = f"{r['name_key']}_{r.get('sub_start') or r.get('listing_dt')}"
    return out


def fetch(session=None, timeout: int = 30, pages: int = 1, pause: float = 1.0) -> tuple[list, dict]:
    """두 화면(각 pages쪽)을 받아 공모 단위로 짝지은 행 목록과 화면별 건수·오류(status)를 돌려줍니다."""
    import time
    import requests
    s = session or requests.Session()
    got, status = {"nw": [], "k": []}, {}
    for key, parse in (("nw", parse_new_listing), ("k", parse_subscription)):
        try:
            for page in range(1, pages + 1):
                resp = s.get(BASE, params={"o": key, "page": page}, headers={"User-Agent": USER_AGENT}, timeout=timeout)
                resp.raise_for_status()
                rows = parse(resp.content.decode("cp949", "replace"))
                got[key] += rows
                if not rows:
                    break
                if page < pages:
                    time.sleep(pause)
            status[key] = len(got[key])
        except Exception as exc:
            status[key] = f"{type(exc).__name__}: {str(exc)[:120]}"
    return pair(got["nw"], got["k"]), status


def save(conn, rows: list, now: str) -> int:
    from . import store
    cols = ("listing_dt", "sub_start", "sub_end", "retail_ratio", "offer_price", "open_price", "close_d1")
    for r in rows:
        old = conn.execute("SELECT * FROM src38 WHERE row_key=?", (r["row_key"],)).fetchone()
        data = {"row_key": r["row_key"], "name_key": r["name_key"], "corp_name": r["corp_name"], "fetched_at": now}
        for c in cols:   # 이번 화면에 없는 칸은 기존 값을 유지
            data[c] = r.get(c) if r.get(c) is not None else (old[c] if old else None)
        store.upsert(conn, "src38", "row_key", data, volatile=("fetched_at",))
    return len(rows)


def lookup(conn, name_keys: list, sub_start: str | None, floor: str, until: str):
    """딜에 맞는 38 행: 청약 시작일이 같은 행 → 없으면 상장일이 floor~until 사이인 행."""
    for k in name_keys:
        if sub_start:
            r = conn.execute("SELECT * FROM src38 WHERE name_key=? AND sub_start=?", (k, sub_start)).fetchone()
            if r:
                return r
        r = conn.execute("SELECT * FROM src38 WHERE name_key=? AND listing_dt>=? AND listing_dt<=? ORDER BY listing_dt LIMIT 1",
                         (k, floor, until)).fetchone()
        if r:
            return r
    return None
