"""KIND(kind.krx.co.kr) 상장예비심사 기업 현황 수집.

주의: KRX 홈페이지 이용약관은 자동화 수단을 이용한 무단 수집·복제·배포를 금지합니다(제10조, 제12조).
이 모듈은 사용자 판단에 따라 하루 1회, 요청 몇 건으로 제한해 호출합니다. KRX 허락 없이 공개 배포하지 마십시오.

화면 호출 규칙은 같은 계열 KIND 화면(공모기업 진행현황 pubofrprogcom.do → searchPubofrProgComSub /
pubofrprogcom_sub, 신규상장 listingcompany.do → searchListingTypeSub / listingtype_sub)과 같다고 보고
예비심사 화면(listinvstgcom.do)을 searchListInvstgCorpSub / listinvstgcom_sub로 부릅니다.
이 수집 환경에서는 KIND 접속이 막혀 실제 응답으로 검증하지 못했으므로, 표의 열은 이름 키워드로 찾고
행을 하나도 못 읽으면 원문을 저장해 원인을 확인할 수 있게 합니다.

수동 보완: KIND 화면에서 내려받은 엑셀(.xls는 HTML 표, .xlsx, .csv)을 data/kind/ 에 두면 함께 읽습니다.
"""
from __future__ import annotations

import csv
import io
import json
import re
import zipfile
from datetime import date, timedelta
from html.parser import HTMLParser
from pathlib import Path

BASE = "https://kind.krx.co.kr"
PATH = "listinvstg/listinvstgcom.do"
USER_AGENT = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
APPROVAL_VALID_DAYS = 183   # 예심 승인 효력(통상 결과 통지 후 6개월). 지나면 미신고 승인 건은 표시하지 않습니다.

CORP_FORM = re.compile(r"\(주\)|㈜|\(유\)|\(재\)|\(사\)|주식회사|유한회사|유한책임회사|\bco\.?,?\s*ltd\.?|\binc\.?|\bcorp\.?", re.I)


def name_key(name: str) -> str:
    """회사명 정규화: 법인 형태 표기·공백·기호를 지우고 소문자로. DART와 KIND 회사명 연결에 씁니다."""
    n = CORP_FORM.sub("", name or "")
    n = re.sub(r"[\s·\.\-_,()（）\[\]]+", "", n)
    return n.lower()


# ---------------------------------------------------------------- HTML 표 파서
class _TableParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables, self._t, self._row, self._cell, self._in_cell = [], None, None, None, False

    def handle_starttag(self, tag, attrs):
        if tag == "table":
            self._t = []
        elif tag == "tr" and self._t is not None:
            self._row = []
        elif tag in ("td", "th") and self._row is not None:
            self._cell, self._in_cell = [], True
            title = dict(attrs).get("title")
            if title:
                self._cell.append(("title", title))

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self._row is not None and self._cell is not None:
            titles = [v for k, v in self._cell if k == "title"]
            text = re.sub(r"\s+", " ", "".join(v for k, v in self._cell if k == "text")).strip()
            self._row.append(text or (titles[0].strip() if titles else ""))
            self._cell, self._in_cell = None, False
        elif tag == "tr" and self._t is not None and self._row is not None:
            if self._row:
                self._t.append(self._row)
            self._row = None
        elif tag == "table" and self._t is not None:
            self.tables.append(self._t)
            self._t = None

    def handle_data(self, data):
        if self._in_cell and self._cell is not None:
            self._cell.append(("text", data))


COLS = {   # 표 머리글 키워드 → 내부 필드
    "corp_name": ("회사명", "기업명", "법인명"),
    "filed_dt": ("청구일", "신청일", "접수일"),
    "decided_dt": ("승인일", "결과확정일", "확정일", "결과일", "심사결과일", "통보일"),
    "result": ("심사결과", "결과", "진행상황", "상태"),
    "market": ("시장", "시장구분"),
    "listing_type": ("상장유형", "상장구분", "유형"),
    "sponsor": ("상장주선인", "주선인", "대표주관", "주관사"),
    "industry": ("업종",),
}


def _map_header(header: list) -> dict:
    out = {}
    for i, h in enumerate(header):
        h2 = h.replace(" ", "")
        for field, keys in COLS.items():
            if field in out:
                continue
            # '결과'는 '결과확정일' 같은 날짜 열과 겹치므로 날짜 필드를 먼저 확정합니다.
            if any(k in h2 for k in keys):
                if field == "result" and "일" in h2:
                    continue
                out[field] = i
                break
    return out


def _iso(s: str) -> str | None:
    m = re.search(r"(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})", s or "")
    return f"{int(m.group(1)):04d}-{int(m.group(2)):02d}-{int(m.group(3)):02d}" if m else None


def parse_rows(rows: list) -> list:
    """머리글 행을 찾아 dict 목록으로 바꿉니다. 회사명 열이 없으면 빈 목록."""
    for hi, header in enumerate(rows[:5]):
        cmap = _map_header(header)
        if "corp_name" in cmap and ("filed_dt" in cmap or "result" in cmap):
            out = []
            for r in rows[hi + 1:]:
                if len(r) < len(header) - 1:
                    continue
                get = lambda f: r[cmap[f]].strip() if f in cmap and cmap[f] < len(r) else ""
                name = get("corp_name")
                if not name or name in ("조회된 결과값이 없습니다.", "검색결과가 없습니다."):
                    continue
                out.append({
                    "corp_name": name, "name_key": name_key(name),
                    "filed_dt": _iso(get("filed_dt")), "decided_dt": _iso(get("decided_dt")),
                    "result": get("result") or None, "market": get("market") or None,
                    "listing_type": get("listing_type") or None, "sponsor": get("sponsor") or None,
                    "industry": get("industry") or None,
                })
            return out
    return []


def parse_html(html: str) -> list:
    p = _TableParser()
    p.feed(html)
    best = []
    for t in p.tables:
        rows = parse_rows(t)
        if len(rows) > len(best):
            best = rows
    return best


def parse_file(path: Path) -> list:
    """수동 업로드 파일. KIND 엑셀(.xls)은 실제로 HTML 표인 경우가 많습니다."""
    raw = path.read_bytes()
    suffix = path.suffix.lower()
    if suffix == ".xlsx" or raw[:2] == b"PK":
        return parse_rows(_xlsx_rows(raw))
    if suffix == ".csv":
        text = _decode(raw)
        return parse_rows([row for row in csv.reader(io.StringIO(text))])
    return parse_html(_decode(raw))


def _decode(raw: bytes) -> str:
    for enc in ("utf-8-sig", "cp949", "euc-kr"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def _xlsx_rows(raw: bytes) -> list:
    """의존성 없이 .xlsx 첫 시트를 읽습니다(문자열·숫자 셀)."""
    z = zipfile.ZipFile(io.BytesIO(raw))
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        xml = z.read("xl/sharedStrings.xml").decode("utf-8")
        for si in re.findall(r"<si>(.*?)</si>", xml, re.S):
            shared.append("".join(re.findall(r"<t[^>]*>(.*?)</t>", si, re.S)))
    sheet = sorted(n for n in z.namelist() if n.startswith("xl/worksheets/sheet"))[0]
    xml = z.read(sheet).decode("utf-8")
    rows = []
    for row in re.findall(r"<row[^>]*>(.*?)</row>", xml, re.S):
        cells = []
        for attrs, body in re.findall(r"<c([^>]*)>(.*?)</c>", row, re.S):
            v = re.search(r"<v>(.*?)</v>", body, re.S)
            t = re.search(r'\bt="(\w+)"', attrs)
            val = v.group(1) if v else "".join(re.findall(r"<t[^>]*>(.*?)</t>", body, re.S))
            if t and t.group(1) == "s" and v:
                val = shared[int(val)]
            cells.append(val)
        rows.append(cells)
    return rows


# ---------------------------------------------------------------- 수집
def fetch(session=None, today: date | None = None, lookback_days: int = 400, timeout: int = 30) -> tuple[list, str]:
    """KIND 예비심사 목록(최근 lookback_days 청구분)을 한 번에 받아 (행 목록, 원문)을 돌려줍니다."""
    import requests
    s = session or requests.Session()
    today = today or date.today()
    data = {
        "method": "searchListInvstgCorpSub", "forward": "listinvstgcom_sub",
        "currentPageSize": "3000", "pageIndex": "1", "orderMode": "1", "orderStat": "D",
        "searchMode": "", "searchCorpName": "", "marketType": "",
        "fromDate": (today - timedelta(days=lookback_days)).isoformat(), "toDate": today.isoformat(),
    }
    headers = {"User-Agent": USER_AGENT, "Referer": f"{BASE}/{PATH}?method=searchListInvstgCorpMain"}
    if session is None:   # 목록 화면을 먼저 열어 세션 쿠키를 받습니다.
        try:
            s.get(f"{BASE}/{PATH}", params={"method": "searchListInvstgCorpMain"},
                  headers={"User-Agent": USER_AGENT}, timeout=timeout)
        except Exception:
            pass
    resp = s.post(f"{BASE}/{PATH}", data=data, headers=headers, timeout=timeout)
    resp.raise_for_status()
    resp.encoding = resp.encoding or "utf-8"
    html = resp.text
    return parse_html(html), html


def is_approved(row: dict) -> bool:
    r = (row.get("result") or "")
    return "승인" in r and "미승인" not in r


# ---------------------------------------------------------------- 저장·연결
def save_rows(conn, rows: list, source: str, now: str) -> int:
    from . import store
    n = 0
    for r in rows:
        if not r.get("name_key"):
            continue
        key = f"{r['name_key']}_{r.get('filed_dt') or 'na'}"
        store.upsert(conn, "kind_review", "review_key", {
            "review_key": key, "name_key": r["name_key"], "corp_name": r["corp_name"],
            "filed_dt": r.get("filed_dt"), "decided_dt": r.get("decided_dt"), "result": r.get("result"),
            "market": r.get("market"), "listing_type": r.get("listing_type"), "sponsor": r.get("sponsor"),
            "industry": r.get("industry"), "source": source, "fetched_at": now,
        }, volatile=("fetched_at", "source"))
        n += 1
    return n


def load_manual(conn, folder: Path, now: str, log=print) -> int:
    n = 0
    for p in sorted(folder.glob("*")):
        if p.suffix.lower() not in (".xls", ".xlsx", ".csv", ".html", ".htm") or p.name.startswith("_"):
            continue
        rows = parse_file(p)
        log(f"KIND 수동 파일 {p.name}: {len(rows)}건")
        n += save_rows(conn, rows, f"manual:{p.name}", now)
    return n


def pending_approvals(conn, deals: list, today: date) -> list:
    """승인됐지만 아직 증권신고서(DART 딜)가 없는 회사. 승인 후 APPROVAL_VALID_DAYS 이내만."""
    dart_keys = {}
    for d in deals:
        dart_keys.setdefault(name_key(d.get("corp_name") or ""), []).append(d)
    out = []
    for r in conn.execute("SELECT * FROM kind_review ORDER BY COALESCE(decided_dt, filed_dt) DESC"):
        r = dict(r)
        if not is_approved(r):
            continue
        ref = r.get("decided_dt") or r.get("filed_dt")
        if not ref or (today - date.fromisoformat(ref)).days > APPROVAL_VALID_DAYS:
            continue
        # 승인(또는 청구) 이후 같은 회사의 증권신고서가 있으면 이미 딜 목록에 있으므로 제외
        later = [d for d in dart_keys.get(r["name_key"], []) if d["first_filing_dt"] >= (r.get("filed_dt") or ref)]
        if later:
            continue
        out.append(r)
    return out


def review_for(conn, corp_name: str, first_filing_dt: str) -> dict | None:
    """DART 딜에 붙일 예심 정보: 같은 회사의 청구 중 신고서 제출 이전 가장 최근 건."""
    k = name_key(corp_name)
    row = conn.execute(
        "SELECT * FROM kind_review WHERE name_key=? AND (filed_dt IS NULL OR filed_dt <= ?) "
        "ORDER BY filed_dt DESC LIMIT 1", (k, first_filing_dt)).fetchone()
    return dict(row) if row else None


def dump_debug(html: str, folder: Path) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    p = folder / "_last_response.html"
    p.write_text(html, encoding="utf-8")
    return p
