"""SQLite 저장·딜 집계. 같은 입력을 다시 넣어도 결과가 바뀌지 않도록(멱등) 작성했습니다."""
from __future__ import annotations

import json
import sqlite3
from datetime import date, datetime
from pathlib import Path

from .parse import classify, iso_date, price_range, to_int

SCHEMA_PATH = Path(__file__).resolve().parent.parent / "schema.sql"

# 증권신고서 주요정보 응답 그룹 → 처리 방식
KNOWN_GROUPS = {"일반사항", "증권의종류", "인수인정보", "자금의사용목적",
                "매출인에관한사항", "일반청약자환매청구권"}


def connect(path: str) -> sqlite3.Connection:
    if path != ":memory:":
        Path(path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    # src38 첫 구조(name_key 기본키)는 같은 이름의 다른 공모를 덮어써서 바꿨습니다. 보조 출처라 다시 받으면 됩니다.
    if conn.execute("SELECT 1 FROM sqlite_master WHERE name='src38'").fetchone() and \
            "row_key" not in {r[1] for r in conn.execute("PRAGMA table_info(src38)")}:
        conn.execute("DROP TABLE src38")
    conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    _ensure_columns(conn)
    return conn


# 스키마 변경 시 기존 DB(덤프 복원본)에도 열을 추가합니다.
ADDED_COLUMNS = {"doc_price": [("header_amount", "INTEGER"), ("header_shares", "INTEGER"),
                               ("header_evidence", "TEXT"), ("inst_ratio", "REAL"),
                               ("inst_count", "INTEGER"), ("inst_evidence", "TEXT"),
                               ("parser_version", "INTEGER")],
                 "ipo_deal": [("filed_price", "INTEGER"), ("estk_rcept_no", "TEXT"),
                              ("estk_before_fixing", "INTEGER"), ("fixed_rcept_no", "TEXT"),
                              ("doc_signal", "INTEGER"), ("result_rcept_no", "TEXT"),
                              ("inst_demand_ratio", "REAL"), ("inst_demand_count", "INTEGER"),
                              ("retail_ratio", "REAL"), ("retail_count", "INTEGER"),
                              ("demand_start", "TEXT"), ("demand_end", "TEXT"),
                              ("tech_track", "TEXT"), ("tech_grades", "TEXT"), ("tech_agencies", "TEXT"),
                              ("alt_route", "TEXT"), ("tech_mode", "TEXT")],
                 "doc_schedule": [("market", "TEXT"), ("market_evidence", "TEXT"),
                                  ("tech_track", "TEXT"), ("tech_evidence", "TEXT"),
                                  ("tech_hints", "TEXT"), ("tech_grades", "TEXT"), ("tech_agencies", "TEXT"),
                                  ("alt_route", "TEXT"), ("biz_text", "TEXT"), ("biz_excerpt", "TEXT"),
                                  ("tech_mode", "TEXT")]}


def _ensure_columns(conn) -> None:
    for table, cols in ADDED_COLUMNS.items():
        have = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}
        for name, typ in cols:
            if name not in have:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {typ}")


def upsert(conn, table: str, key: str, data: dict, volatile: tuple = ()) -> None:
    """내용이 실제로 바뀐 경우에만 갱신합니다(타임스탬프만 달라진 경우는 건너뜀)."""
    cols = list(data)
    updates = [c for c in cols if c != key]
    set_clause = ", ".join(f"{c}=excluded.{c}" for c in updates)
    compare = [c for c in updates if c not in volatile]
    where = " OR ".join(f"{table}.{c} IS NOT excluded.{c}" for c in compare) or "0"
    sql = (f"INSERT INTO {table} ({','.join(cols)}) VALUES ({','.join('?' * len(cols))}) "
           f"ON CONFLICT({key}) DO UPDATE SET {set_clause} WHERE {where}")
    conn.execute(sql, [data[c] for c in cols])


def set_meta(conn, key: str, value: str) -> None:
    upsert(conn, "meta", "key", {"key": key, "value": value})


def get_meta(conn, key: str) -> str | None:
    row = conn.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
    return row["value"] if row else None


# ---------------------------------------------------------------- 공시 목록
def save_filing(conn, row: dict, now: str) -> None:
    info = classify(row.get("report_nm"))
    upsert(conn, "filing", "rcept_no", {
        "rcept_no": row["rcept_no"],
        "corp_code": row.get("corp_code"),
        "corp_name": row.get("corp_name"),
        "report_nm": row.get("report_nm"),
        "flr_nm": row.get("flr_nm"),
        "rcept_dt": iso_date(row.get("rcept_dt")),
        "rm": row.get("rm"),
        **info,
        "fetched_at": now,
    }, volatile=("fetched_at",))


# ---------------------------------------------------------------- 증권신고서 주요정보
def save_estk(conn, corp_code: str, payload: dict, now: str, endpoint: str = "estkRs") -> tuple[set, list]:
    """estkRs 응답을 그룹별로 저장. (확인된 접수번호 집합, 알 수 없는 그룹 제목)을 반환."""
    seen, unknown = set(), []
    groups = payload.get("group") or []
    for g in groups:
        for row in g.get("list") or []:
            if row.get("rcept_no"):
                seen.add(row["rcept_no"])
    for rcept in seen:
        for table in ("estk_security", "underwriter", "use_of_proceeds", "seller"):
            conn.execute(f"DELETE FROM {table} WHERE rcept_no=?", (rcept,))

    for g in groups:
        title = g.get("title")
        if title not in KNOWN_GROUPS:
            unknown.append(title)
            continue
        for i, row in enumerate(g.get("list") or []):
            rcept = row.get("rcept_no")
            if not rcept:
                continue
            if title == "일반사항":
                upsert(conn, "estk_general", "rcept_no", {
                    "rcept_no": rcept, "corp_code": corp_code,
                    **{k: row.get(k) for k in ("sbd", "pymd", "sband", "asand", "asstd", "rpt_rcpn")},
                })
            elif title == "증권의종류":
                _insert(conn, "estk_security", rcept, i, row,
                        ("stksen", "stkcnt", "fv", "slprc", "slta", "slmthn"))
            elif title == "인수인정보":
                _insert(conn, "underwriter", rcept, i, row,
                        ("actsen", "actnmn", "stksen", "udtcnt", "udtamt", "udtprc", "udtmth"))
            elif title == "자금의사용목적":
                _insert(conn, "use_of_proceeds", rcept, i, row, ("se", "amt"))
            elif title == "매출인에관한사항":
                _insert(conn, "seller", rcept, i, row,
                        ("hdr", "rl_cmp", "bfsl_hdstk", "slstk", "atsl_hdstk"))

    upsert(conn, "dart_raw", "corp_code",
           {"corp_code": corp_code, "endpoint": endpoint,
            "payload": json.dumps(payload, ensure_ascii=False, sort_keys=True),
            "fetched_at": now}, volatile=("fetched_at",))
    return seen, unknown


def _insert(conn, table, rcept, row_no, row, fields) -> None:
    cols = ["rcept_no", "row_no", *fields]
    conn.execute(f"INSERT OR REPLACE INTO {table} ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})",
                 [rcept, row_no, *[row.get(f) for f in fields]])


# ---------------------------------------------------------------- 기업
def needs_company_refresh(conn, corp_code: str, today: str, stale_days: int = 30) -> bool:
    row = conn.execute("SELECT stock_code, updated_at FROM company WHERE corp_code=?",
                       (corp_code,)).fetchone()
    if row is None:
        return True
    if row["stock_code"]:
        return False
    last = (row["updated_at"] or "")[:10]
    if not last:
        return True
    return (datetime.fromisoformat(today) - datetime.fromisoformat(last)).days >= stale_days


def save_company(conn, corp_code: str, data: dict, now: str) -> None:
    upsert(conn, "company", "corp_code", {
        "corp_code": corp_code,
        "corp_name": data.get("corp_name"),
        "stock_code": (data.get("stock_code") or "").strip() or None,
        "corp_cls": data.get("corp_cls"),
        "induty_code": data.get("induty_code"),
        "est_dt": iso_date(data.get("est_dt")),
        "updated_at": now,
    }, volatile=("updated_at",))


# ---------------------------------------------------------------- 딜 집계
def _sec_row(conn, rcept_no):
    rows = conn.execute("SELECT * FROM estk_security WHERE rcept_no=? ORDER BY row_no",
                        (rcept_no,)).fetchall()
    for r in rows:
        if "보통" in (r["stksen"] or ""):
            return r
    return rows[0] if rows else None


def _names(rows, keyword):
    seen = []
    for r in rows:
        if keyword in (r["actsen"] or "") and r["actnmn"] and r["actnmn"] not in seen:
            seen.append(r["actnmn"])
    return ", ".join(seen) or None


def _group(conn):
    """(deal_id → 증권신고서 목록, deal_id → 구간 안의 모든 C001 공시).

    태그 없는 신고서가 새 딜을 시작합니다. 철회신고서가 나온 뒤의 신고서는 [첨부추가] 등 태그가 붙어 있어도
    새 딜(재신고)로 봅니다. [첨부추가] 신고서는 증권발행실적보고서 뒤에 나오거나 앞 신고서와 180일 넘게
    떨어져 있으면 새 딜로 봅니다(예: 비상장 공모를 마친 회사가 이듬해 IPO 신고서를 [첨부추가]로 낸 경우).
    """
    filings = conn.execute("SELECT * FROM filing ORDER BY corp_code, rcept_no").fetchall()
    reg: dict[str, list] = {}
    alls: dict[str, list] = {}
    current: dict[str, str] = {}
    closed: set = set()
    last_dt: dict[str, str] = {}
    done: set = set()
    for f in filings:
        corp = f["corp_code"]
        if f["doc_kind"] == "reg_equity":
            # 앞 신고서와 180일 넘게 떨어진 신고서는 태그가 붙어 있어도 새 딜로 봅니다
            # (예: 비상장 공모를 마친 회사가 1년 뒤 IPO 신고서를 [첨부추가]로 제출한 경우).
            fresh = "첨부추가" in (f["report_nm"] or "")
            gap = fresh and corp in last_dt and (date.fromisoformat(f["rcept_dt"]) - date.fromisoformat(last_dt[corp])).days > 180
            last_dt[corp] = f["rcept_dt"]
            if not f["tags"] or corp not in current or corp in closed or gap or (fresh and corp in done):
                current[corp] = f"{corp}_{f['rcept_no']}"
                reg[current[corp]], alls[current[corp]] = [], []
                closed.discard(corp)
                done.discard(corp)
            reg[current[corp]].append(f)
            alls[current[corp]].append(f)
        elif corp in current:
            alls[current[corp]].append(f)
            if "철회신고서" in (f["report_nm"] or ""):
                closed.add(corp)
            elif f["doc_kind"] == "result" and not (f["tags"] or ""):
                done.add(corp)         # 증권발행실적보고서 뒤의 [첨부추가] 신고서는 새 공모로 봅니다
    return reg, alls


def group_deals(conn) -> dict:
    """deal_id → 증권신고서 계열 공시 목록."""
    return _group(conn)[0]


def _check_listing(listing_dt: str, report_dt: str) -> str:
    """상장일이 보고서 접수일보다 앞서고 연도만 1년 틀린 경우(공시 오기) 연도를 보정합니다."""
    from datetime import date
    try:
        ld, rd = date.fromisoformat(listing_dt), date.fromisoformat(report_dt)
    except (TypeError, ValueError):
        return listing_dt
    if ld < rd:
        try:
            fixed = ld.replace(year=ld.year + 1)
        except ValueError:
            return listing_dt
        if 0 <= (fixed - rd).days <= 45:
            return fixed.isoformat()
    return listing_dt


def _kind_listed(conn, corp_name: str, rcept_no: str, corp_code: str | None = None) -> int | None:
    """KIND 상장법인 목록의 상장일 − 신고서 접수일(일). 회사명으로 찾고, 사명이 바뀐 회사는 종목코드로 찾습니다.
    목록에 없으면 None."""
    from .kind import name_key
    try:
        row = conn.execute("SELECT listed_dt FROM kind_corp WHERE name_key=?", (name_key(corp_name or ""),)).fetchone()
        if not row and corp_code:
            sc = conn.execute("SELECT stock_code FROM company WHERE corp_code=?", (corp_code,)).fetchone()
            if sc and (sc["stock_code"] or "").strip():
                row = conn.execute("SELECT listed_dt FROM kind_corp WHERE stock_code=?", (sc["stock_code"].strip(),)).fetchone()
    except Exception:
        return None
    if not row or not row["listed_dt"]:
        return None
    try:
        return (date.fromisoformat(row["listed_dt"]) - date(int(rcept_no[:4]), int(rcept_no[4:6]), int(rcept_no[6:8]))).days
    except ValueError:
        return None


def rebuild_deals(conn, now: str) -> int:
    """filing·estk_* 테이블에서 ipo_deal, review, field_source를 다시 계산합니다."""
    deals, spans = _group(conn)

    for deal_id, fl in deals.items():
        first, latest = fl[0], fl[-1]
        span = spans[deal_id]

        # estkRs는 딜당 마지막 [기재정정] 건 한 행만 돌려주므로, 주요정보가 있는 건 중
        # 가장 이른 건으로 후보를 판별하고 가장 늦은 건을 가격·물량의 기준으로 삼습니다.
        with_estk = [f for f in fl if conn.execute(
            "SELECT 1 FROM estk_general WHERE rcept_no=?", (f["rcept_no"],)).fetchone()]
        # KIND 상장법인 목록의 상장일: 신고 뒤에 상장했으면 이 공모는 신규상장(또는 그 시도)입니다
        kd = _kind_listed(conn, first["corp_name"], first["rcept_no"], first["corp_code"])
        if not with_estk:
            if kd is not None and -5 <= kd <= 200:
                cand, basis = 1, f"KIND 상장일 대조(신고 {kd}일 뒤 상장), 증권신고서 주요정보 미확인"
            else:
                cand, basis = None, "증권신고서 주요정보 미확인"
        else:
            g = conn.execute("SELECT rpt_rcpn, asstd FROM estk_general WHERE rcept_no=?",
                             (with_estk[0]["rcept_no"],)).fetchone()
            no_assign = (g["asstd"] or "-").strip() in ("", "-")   # 배정기준일 없음: 주주배정 증자가 아님
            ref = with_estk[0]["rcept_no"]
            if (g["rpt_rcpn"] or "").strip() in ("", "-"):
                cand, basis = 1, f"주요사항보고서 미선행(rpt_rcpn 없음), KIND 대조 필요 [{ref}]"
            elif kd is not None and -5 <= kd <= 200:
                # 비상장이어도 사업보고서 제출대상 회사는 주요사항보고서를 먼저 냅니다(LG에너지솔루션·신라젠 등)
                cand, basis = 1, f"주요사항보고서 선행이나 신고 {kd}일 뒤 KIND 상장 [{ref}]"
            elif kd is not None and kd > 200 and no_assign and any(f["doc_kind"] == "result" for f in span):
                # 발행실적보고서까지 냈는데 상장은 200일 넘게 뒤: 상장 전 비상장 공모(유상증자)로 봅니다
                cand, basis = 0, f"주요사항보고서 선행·발행 완료 후 {kd}일 뒤 상장, 상장 전 공모(유상증자)로 추정 [{ref}]"
            elif kd is not None and kd > 200 and no_assign:
                cand, basis = 1, f"주요사항보고서 선행·배정기준일 없음, {kd}일 뒤 상장(이전 공모 시도) [{ref}]"
            else:
                cand, basis = 0, f"주요사항보고서 선행(rpt_rcpn 있음), 유상증자 등으로 추정 [{ref}]"

        # 가격: 숫자 1개면 신고서 기재가(filed_price), 2개면 희망밴드.
        # 발행조건확정 건에 자체 주요정보 행이 있는 경우에만 확정가로 인정합니다.
        fixed = [f for f in fl if f["is_price_fixed"]]
        final_price = band = filed_price = None
        ev_final = ev_band = ev_filed = None
        for f in fixed[-1:]:
            row = _sec_row(conn, f["rcept_no"])
            pr = price_range(row["slprc"]) if row else None
            if pr and pr[0] == pr[1]:
                final_price, ev_final = pr[0], (f["rcept_no"], row["slprc"])
        # 원문 추출값(doc_price). [발행조건확정]이 여러 건이면 확정가가 읽힌 가장 최근 건을 씁니다.
        fixed_no = fixed[-1]["rcept_no"] if fixed else None
        marks = ",".join("?" for _ in fl)
        dps = {r["rcept_no"]: r for r in conn.execute(
            f"SELECT * FROM doc_price WHERE rcept_no IN ({marks})", [f["rcept_no"] for f in fl])}
        ok = lambda f: dps.get(f["rcept_no"]) is not None and dps[f["rcept_no"]]["status"] == "ok"
        doc_signal = None if not dps else int(any(r["status"] == "ok" for r in dps.values()))
        best = next((f for f in reversed(fixed) if ok(f) and dps[f["rcept_no"]]["final_price"]), None)
        doc_src = (best or (fixed[-1] if fixed else latest))["rcept_no"]
        band_f = next((f for f in ([best] if best else []) + list(reversed(fixed)) + [latest]
                       if f and ok(f) and dps[f["rcept_no"]]["band_low"]), None)
        doc_band = doc_final = None
        doc_amt = doc_shr = None
        if band_f:
            r = dps[band_f["rcept_no"]]
            doc_band = (r["band_low"], r["band_high"])
            ev_band = (band_f["rcept_no"], r["band_evidence"])
        if best:
            r = dps[best["rcept_no"]]
            final_price, ev_final = r["final_price"], (best["rcept_no"], r["final_evidence"])
            doc_final = True
            doc_amt, doc_shr = r["header_amount"], r["header_shares"]
        dp = dps.get(doc_src)
        inst_f = next((f for f in ([best] if best else []) + list(reversed(fixed))
                       if f and ok(f) and dps[f["rcept_no"]]["inst_ratio"]), None)
        inst_ratio = inst_count = ev_inst = None
        if inst_f:
            r = dps[inst_f["rcept_no"]]
            inst_ratio, inst_count = r["inst_ratio"], r["inst_count"]
            ev_inst = (inst_f["rcept_no"], r["inst_evidence"])

        # 수요예측 기일: 발행조건확정 이전 신고서 중 가장 최근에 읽힌 값
        demand_start = demand_end = ev_demand = None
        market = tech_track = ev_market = ev_tech = tech_grades = tech_agencies = alt_route = tech_mode = None
        for f in reversed([f for f in fl if not f["is_price_fixed"]]):
            ds = conn.execute("SELECT * FROM doc_schedule WHERE rcept_no=?", (f["rcept_no"],)).fetchone()
            if not ds:
                continue
            if demand_start is None and ds["status"] == "ok":
                demand_start, demand_end = ds["demand_start"], ds["demand_end"]
                ev_demand = (f["rcept_no"], ds["demand_evidence"])
            if market is None and ds["market"]:
                market, tech_track = ds["market"], ds["tech_track"]
                tech_grades, tech_agencies, alt_route = ds["tech_grades"], ds["tech_agencies"], ds["alt_route"]
                tech_mode = ds["tech_mode"] if "tech_mode" in ds.keys() else None
                ev_market = (f["rcept_no"], ds["market_evidence"])
                ev_tech = (f["rcept_no"], ds["tech_evidence"])

        # 증권발행실적보고서: 상장일·일반청약 (정정본이 있으면 가장 최근 보고서)
        results = [f for f in span if f["doc_kind"] == "result"]
        result_no = results[-1]["rcept_no"] if results else None
        listing_dt = retail_ratio = retail_count = ev_list = ev_retail = None
        for f in reversed(results):
            dr = conn.execute("SELECT * FROM doc_result WHERE rcept_no=?", (f["rcept_no"],)).fetchone()
            if not dr:
                continue
            if listing_dt is None and dr["listing_dt"]:
                listing_dt, ev_list = _check_listing(dr["listing_dt"], f["rcept_dt"]), (f["rcept_no"], dr["listing_evidence"])
                if listing_dt != dr["listing_dt"]:
                    ev_list = (f["rcept_no"], f"{dr['listing_evidence']} (연도 오기로 보고 {listing_dt}로 보정)")
            if retail_ratio is None and dr["retail_ratio"]:
                retail_ratio, retail_count = dr["retail_ratio"], dr["retail_count"]
                ev_retail = (f["rcept_no"], dr["retail_evidence"])

        # 원문에서 상장일을 못 읽었으면 KIND 상장법인 목록의 상장일(신고 후 200일 안)을 씁니다
        if listing_dt is None and results and kd is not None and 0 <= kd <= 200:
            from datetime import timedelta as _td
            r0 = first["rcept_no"]
            listing_dt = (date(int(r0[:4]), int(r0[4:6]), int(r0[6:8])) + _td(days=kd)).isoformat()
            ev_list = (results[-1]["rcept_no"], "KIND 상장법인 목록 상장일")

        src = with_estk[-1] if with_estk else None
        estk_no = src["rcept_no"] if src else None
        before_fixing = None
        if src:
            row = _sec_row(conn, src["rcept_no"])
            pr = price_range(row["slprc"]) if row else None
            if pr and pr[0] == pr[1]:
                filed_price, ev_filed = pr[0], (src["rcept_no"], row["slprc"])
            elif pr and not doc_band:
                band, ev_band = pr, (src["rcept_no"], row["slprc"])
            before_fixing = int(any(fl.index(x) > fl.index(src) for x in fixed))

        # 물량·금액: 같은 기준 건. 발행조건확정 이전 값일 수 있어 estk_before_fixing으로 표시합니다.
        shares = amount = None
        ev_qty = None
        if src:
            row = _sec_row(conn, src["rcept_no"])
            if row and (to_int(row["stkcnt"]) is not None or to_int(row["slta"]) is not None):
                shares, amount = to_int(row["stkcnt"]), to_int(row["slta"])
                ev_qty = (src["rcept_no"], f"stkcnt={row['stkcnt']}, slta={row['slta']}")
        ev_shares = ev_amount = ev_qty
        if doc_shr:
            shares, ev_shares = doc_shr, (doc_src, dp["header_evidence"])
        # 확정 금액: 머리말 금액이 확정가×주식수와 맞으면 그대로, 어긋나거나 없으면 확정가×주식수로 계산합니다
        # (머리말을 정정 전 값으로 둔 공시가 있어 확정가와 맞지 않는 경우가 있습니다).
        if doc_final and doc_shr:
            expected = doc_shr * final_price
            if doc_amt and abs(doc_amt - expected) <= max(1000, expected * 0.001):
                amount, ev_amount = doc_amt, (doc_src, dp["header_evidence"])
            else:
                amount = expected
                ev_amount = (doc_src, f"확정가 {final_price:,}원 × {doc_shr:,}주 계산 (머리말 금액 "
                             f"{'없음' if not doc_amt else f'{doc_amt:,}원 불일치'})")
                doc_amt = True
        elif doc_amt:
            amount, ev_amount = doc_amt, (doc_src, dp["header_evidence"])
        secondary = ev_sec = None
        lead = co = None
        subs = pay = None
        for f in reversed(fl):
            if secondary is None:
                srows = conn.execute("SELECT slstk FROM seller WHERE rcept_no=?",
                                     (f["rcept_no"],)).fetchall()
                vals = [to_int(r["slstk"]) for r in srows if to_int(r["slstk"]) is not None]
                if vals:
                    secondary, ev_sec = sum(vals), (f["rcept_no"], f"매출증권수 {len(vals)}건 합계")
            if lead is None and co is None:
                urows = conn.execute("SELECT * FROM underwriter WHERE rcept_no=? ORDER BY row_no",
                                     (f["rcept_no"],)).fetchall()
                if urows:
                    lead, co = _names(urows, "대표"), _names(urows, "공동")
            if subs is None:
                gen = conn.execute("SELECT sbd, pymd FROM estk_general WHERE rcept_no=?",
                                   (f["rcept_no"],)).fetchone()
                if gen and (gen["sbd"] or gen["pymd"]):
                    subs, pay = gen["sbd"], gen["pymd"]

        if cand == 1 and doc_signal == 0:
            basis += " · 원문에 공모희망가액·확정공모가액 문구 없음(유상증자 등 가능성)"
        if doc_band:
            band = doc_band
        # 상태: 발행실적보고서가 있으면 완료, 철회신고서가 있거나 마지막 신고서가 철회(간주)면 철회.
        # (rm의 '철'은 그 공시 한 건이 철회된 표시라 딜 전체의 철회 여부로 쓰지 않습니다.)
        withdrawn = any("철회신고서" in (f["report_nm"] or "") for f in span) or "철" in (latest["rm"] or "")
        status = ("completed" if results else "withdrawn" if withdrawn
                  else "price_fixed" if fixed else "filed")

        upsert(conn, "ipo_deal", "deal_id", {
            "deal_id": deal_id, "corp_code": first["corp_code"],
            "first_rcept_no": first["rcept_no"], "first_filing_dt": first["rcept_dt"],
            "latest_rcept_no": latest["rcept_no"], "latest_filing_dt": latest["rcept_dt"],
            "amendment_count": sum("기재정정" in (x["report_nm"] or "") for x in fl), "status": status,
            "is_ipo_candidate": cand, "ipo_basis": basis,
            "offer_price_low": band[0] if band else None,
            "offer_price_high": band[1] if band else None,
            "filed_price": filed_price, "estk_rcept_no": estk_no,
            "estk_before_fixing": before_fixing, "fixed_rcept_no": fixed_no, "doc_signal": doc_signal,
            "final_price": final_price, "shares_offered": shares,
            "secondary_shares": secondary, "offer_amount": amount,
            "lead_underwriters": lead, "co_underwriters": co,
            "subscription_raw": subs, "payment_raw": pay, "listing_dt": listing_dt,
            "demand_start": demand_start, "demand_end": demand_end,
            "market": market, "tech_track": tech_track,
            "tech_grades": tech_grades, "tech_agencies": tech_agencies, "alt_route": alt_route, "tech_mode": tech_mode,
            "result_rcept_no": result_no, "inst_demand_ratio": inst_ratio,
            "inst_demand_count": inst_count, "retail_ratio": retail_ratio,
            "retail_count": retail_count, "updated_at": now,
        }, volatile=("updated_at",))

        upsert(conn, "review", "deal_id", {
            "deal_id": deal_id, "registration_first_dt": first["rcept_dt"],
            "registration_amend_cnt": len(fl) - 1,
            "correction_order": int(any(f["is_correction_order"] for f in fl)),
        })

        _replace_sources(conn, deal_id, now, [
            ("ipo_deal", "offer_price_low", band[0] if band else None, ev_band,
             "원문" if doc_band else "증권의종류", "DOC" if doc_band else "API"),
            ("ipo_deal", "offer_price_high", band[1] if band else None, ev_band,
             "원문" if doc_band else "증권의종류", "DOC" if doc_band else "API"),
            ("ipo_deal", "filed_price", filed_price, ev_filed, "증권의종류"),
            ("ipo_deal", "final_price", final_price, ev_final,
             "원문" if doc_final else "증권의종류", "DOC" if doc_final else "API"),
            ("ipo_deal", "shares_offered", shares, ev_shares,
             "원문" if doc_shr else "증권의종류", "DOC" if doc_shr else "API"),
            ("ipo_deal", "offer_amount", amount, ev_amount,
             "원문" if doc_amt else "증권의종류", "DOC" if doc_amt else "API"),
            ("ipo_deal", "secondary_shares", secondary, ev_sec, "매출인에관한사항"),
            ("ipo_deal", "lead_underwriters", lead, (latest["rcept_no"], lead), "인수인정보"),
            ("ipo_deal", "inst_demand_ratio", inst_ratio, ev_inst, "원문(수요예측 결과)", "DOC"),
            ("ipo_deal", "retail_ratio", retail_ratio, ev_retail, "원문(청약 및 배정현황)", "DOC"),
            ("ipo_deal", "listing_dt", listing_dt, ev_list, "원문(증권교부일 등)", "DOC"),
            ("ipo_deal", "demand_start", demand_start, ev_demand, "원문(공모일정)", "DOC"),
            ("ipo_deal", "market", market, ev_market, "원문(시장 언급 횟수)", "DOC"),
            ("ipo_deal", "tech_track", tech_track, ev_tech, "원문(상장 경로 서술)", "DOC"),
            ("ipo_deal", "tech_grades", tech_grades, ev_tech if tech_grades else None, "원문(전문평가기관 등급)", "DOC"),
            ("ipo_deal", "alt_route", alt_route, ev_tech if alt_route else None, "원문(상장 요건 서술)", "DOC"),
        ])
    # 최초 신고서가 뒤늦게 확인되어 딜 식별자가 바뀐 경우 이전(고아) 딜을 정리합니다.
    stale = [r["deal_id"] for r in conn.execute("SELECT deal_id FROM ipo_deal")
             if r["deal_id"] not in deals]
    for deal_id in stale:
        for table in ("ipo_deal", "review", "field_source"):
            conn.execute(f"DELETE FROM {table} WHERE deal_id=?", (deal_id,))
    return len(deals)


def _replace_sources(conn, deal_id, now, items) -> None:
    """항목: (table, field, value, (rcept_no, evidence), section[, method]). method 기본값은 API."""
    new = []
    for item in items:
        table, field, value, ev, section = item[:5]
        method = item[5] if len(item) > 5 else "API"
        if value is None or ev is None:
            continue
        status = "api_verified" if method == "API" else "auto_extracted"
        new.append((table, field, str(value), ev[0], section, ev[1], method, status))
    old = [tuple(r) for r in conn.execute(
        "SELECT field_table, field_name, value, rcept_no, section, evidence, method, review_status "
        "FROM field_source WHERE deal_id=? AND method IN ('API','DOC') ORDER BY id", (deal_id,))]
    if sorted(map(str, old)) == sorted(map(str, new)):
        return
    conn.execute("DELETE FROM field_source WHERE deal_id=? AND method IN ('API','DOC')", (deal_id,))
    conn.executemany(
        "INSERT INTO field_source (deal_id, field_table, field_name, value, rcept_no, section, "
        "evidence, method, review_status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        [(deal_id, *row, now) for row in new])


def doc_plan(conn) -> list:
    """원문 추출 계획: [(corp_code, [rcept_no, ...])]. 후보 딜마다 시도할 순서대로 담습니다.

    확정된 딜은 [발행조건확정] 신고서를 최근 것부터(확정가가 읽힐 때까지), 그 외는 최신 신고서 한 건입니다.
    """
    plan = []
    cands = {r["deal_id"] for r in conn.execute("SELECT deal_id FROM ipo_deal WHERE is_ipo_candidate=1")}
    first_dt = {r["deal_id"]: r["first_filing_dt"] for r in conn.execute(
        "SELECT deal_id, first_filing_dt FROM ipo_deal")}
    for deal_id, fl in sorted(group_deals(conn).items(), key=lambda kv: first_dt.get(kv[0], ""), reverse=True):
        if deal_id not in cands:
            continue
        fixed = [f["rcept_no"] for f in reversed(fl) if f["is_price_fixed"]]
        plan.append((fl[0]["corp_code"], fixed or [fl[-1]["rcept_no"]], bool(fixed)))
    return plan


def schedule_plan(conn) -> list:
    """수요예측 기일 추출 계획: [(corp_code, [rcept_no, ...])]. 후보 딜마다 발행조건확정 이전 신고서를
    최근 것부터 최대 3건, 이미 값이 읽힌 딜이나 시도가 끝난 접수번호는 건너뜁니다."""
    from .doctext import SCHEDULE_VERSION
    done = {r["rcept_no"]: r for r in conn.execute(
        "SELECT rcept_no, status, parser_version, tech_track, tech_grades FROM doc_schedule")}
    cands = {r["deal_id"]: r["first_filing_dt"] for r in conn.execute(
        "SELECT deal_id, first_filing_dt FROM ipo_deal WHERE is_ipo_candidate=1")}
    plan = []
    for deal_id, fl in sorted(group_deals(conn).items(), key=lambda kv: cands.get(kv[0], ""), reverse=True):
        if deal_id not in cands:
            continue
        pre = [f["rcept_no"] for f in reversed(fl) if not f["is_price_fixed"]][:3]
        def fresh(no):
            if no not in done:
                return False
            r, pv = done[no], done[no]["parser_version"] or 0
            if pv >= SCHEDULE_VERSION:
                return True
            # v7(단수평가·재평가)은 기술특례 관련 문서만 다시 읽습니다
            techy = bool(r["tech_track"]) or bool(r["tech_grades"])
            return pv >= 6 and not techy
        # 가장 최근 신고서(정정 포함)를 아직 안 읽었으면 반드시 읽습니다. 일정 변경 정정이 나오면
        # 예전 신고서의 수요예측 기일이 그대로 남는 문제를 막습니다.
        if pre and not fresh(pre[0]):
            todo = [no for no in pre if not fresh(no)]
            plan.append((fl[0]["corp_code"], todo))
            continue
        if any(fresh(no) and done[no]["status"] == "ok" for no in pre):
            continue
        todo = [no for no in pre if not fresh(no)]
        if todo:
            plan.append((fl[0]["corp_code"], todo))
    return plan


def save_doc_schedule(conn, rcept_no: str, corp_code: str, parsed: dict, now: str) -> None:
    from .doctext import SCHEDULE_VERSION
    upsert(conn, "doc_schedule", "rcept_no", {
        "rcept_no": rcept_no, "corp_code": corp_code, "demand_start": parsed["demand_start"],
        "demand_end": parsed["demand_end"], "demand_evidence": parsed["demand_evidence"],
        "market": parsed.get("market"), "market_evidence": parsed.get("market_evidence"),
        "tech_track": parsed.get("tech_track"), "tech_evidence": parsed.get("tech_evidence"),
        "tech_hints": parsed.get("tech_hints"), "tech_grades": parsed.get("tech_grades"),
        "tech_agencies": parsed.get("tech_agencies"), "alt_route": parsed.get("alt_route"),
        "tech_mode": parsed.get("tech_mode"),
        "biz_text": parsed.get("biz_text"), "biz_excerpt": parsed.get("biz_excerpt"),
        "status": parsed["status"], "parser_version": SCHEDULE_VERSION, "fetched_at": now},
        volatile=("fetched_at",))


def lockup_plan(conn, min_year: str = "2020") -> list:
    """유통물량·보호예수 추출 계획: [(deal_id, corp_code, [rcept_no, ...], priced)]. priced: 공모가 확정 여부.

    딜마다 투자설명서(최근→과거), 이어서 증권신고서(최근→과거) 순서로 최대 4건. 이미 시도한 건은 빼고,
    상장이 끝나 확약 비율까지 읽힌 딜이나 새 공시가 없는 딜은 건너뜁니다. min_year 이전 딜은 제외합니다
    (2019년 이전 원문은 OpenDART가 주지 않아 공시 뷰어로 따로 받습니다).
    """
    import json as _json
    from .lockup import LOCKUP_VERSION
    cands = {r["deal_id"]: r for r in conn.execute(
        "SELECT d.deal_id, d.corp_code, d.first_filing_dt, d.status, COALESCE(c.corp_name, f.corp_name) AS corp_name "
        "FROM ipo_deal d LEFT JOIN company c USING (corp_code) LEFT JOIN filing f ON f.rcept_no = d.first_rcept_no "
        "WHERE d.is_ipo_candidate=1 AND COALESCE(d.doc_signal, 1) != 0")}
    done = {r["deal_id"]: r for r in conn.execute("SELECT deal_id, tried, status, parser_version, data FROM deal_lockup")}
    # v5 → v6: 상장예정주식수가 이미 있는 행은 다시 읽지 않고 버전만 올립니다(없는 행만 새 규칙으로 다시 읽음)
    for r in list(done.values()):
        if (r["parser_version"] or 0) == 5:
            dd = _json.loads(r["data"] or "{}")
            if dd.get("listed"):
                dd["listed_any"] = dd["listed"]
                dd["src_listed"] = dd.get("src_float")
                conn.execute("UPDATE deal_lockup SET parser_version=?, data=? WHERE deal_id=?",
                             (LOCKUP_VERSION, _json.dumps(dd, ensure_ascii=False, sort_keys=True), r["deal_id"]))
    # v6 → v7(시점별 표 양식·날짜로 정해진 기간·'주주명' 머리행 등 보완): 상장일 유통·해제 일정·검증된 주주별 내역이
    # 모두 있는 행은 버전만 올리고, 하나라도 빠진 행만 새 규칙으로 처음부터 다시 읽습니다
    for r in list(done.values()):
        if (r["parser_version"] or 0) == 6:
            dd = _json.loads(r["data"] or "{}")
            if dd.get("float0") and dd.get("schedule") and dd.get("groups") and dd.get("groups_full"):
                conn.execute("UPDATE deal_lockup SET parser_version=? WHERE deal_id=?", (LOCKUP_VERSION, r["deal_id"]))
    conn.commit()
    done = {r["deal_id"]: r for r in conn.execute("SELECT deal_id, tried, status, parser_version, data FROM deal_lockup")}
    alls = _group(conn)[1]
    plan = []
    for deal_id, c in sorted(cands.items(), key=lambda kv: kv[1]["first_filing_dt"] or "", reverse=True):
        if (c["first_filing_dt"] or "") < min_year or deal_id not in alls:
            continue
        fl = alls[deal_id]
        # 같은 회사의 이후 유상증자 신고서·투자설명서가 딜에 붙는 경우가 있어, 최초 신고 후 200일 안의 공시만 씁니다
        from datetime import date as _d, timedelta as _td
        f0 = fl[0]["rcept_no"]
        cut = (_d(int(f0[:4]), int(f0[4:6]), int(f0[6:8])) + _td(days=200)).strftime("%Y%m%d")
        win = [f for f in fl if f["rcept_no"][:8] <= cut]
        order = [f["rcept_no"] for f in reversed(win) if f["doc_kind"] == "prospectus"] + \
                [f["rcept_no"] for f in reversed(win) if f["doc_kind"] == "reg_equity"]
        order = order[:4]
        if not order:
            continue
        d = done.get(deal_id)
        if d and (d["parser_version"] or 0) >= LOCKUP_VERSION:
            tried = set(_json.loads(d["tried"] or "[]"))
            data = _json.loads(d["data"] or "{}")
            spac = "기업인수목적" in (c["corp_name"] or "") or "스팩" in (c["corp_name"] or "")
            priced = c["status"] in ("price_fixed", "completed")
            complete = bool(data.get("float0") or data.get("listed_any")) and (
                bool(data.get("commit")) or spac or not priced or len(tried & set(order)) >= 2)
            if order[0] in tried and (complete or all(no in tried for no in order)):
                continue
            plan.append((deal_id, c["corp_code"], order, c["status"] in ("price_fixed", "completed")))
        else:
            plan.append((deal_id, c["corp_code"], order, c["status"] in ("price_fixed", "completed")))
    return plan


def save_deal_lockup(conn, deal_id: str, corp_code: str, data: dict, tried: list, now: str) -> None:
    import json as _json
    from .lockup import LOCKUP_VERSION
    upsert(conn, "deal_lockup", "deal_id", {
        "deal_id": deal_id, "corp_code": corp_code, "data": _json.dumps(data, ensure_ascii=False, sort_keys=True),
        "tried": _json.dumps(sorted(set(tried))), "status": data.get("status"),
        "parser_version": LOCKUP_VERSION, "fetched_at": now}, volatile=("fetched_at",))


def fin_plan(conn, min_year: str = "2020", max_year: str | None = None) -> list:
    """요약재무정보 추출 계획: [(deal_id, corp_code, [rcept_no, ...])].

    전문이 실린 원문만 씁니다: 투자설명서(최근→과거), 이어서 증권신고서(최근→과거, [발행조건확정]은
    바뀐 부분만 실려 제외) 순서로 최대 3건. 스팩은 건너뜁니다. 이미 읽은 딜은 더 새 원문이 나왔을 때만
    그 원문 한 건을 다시 봅니다.
    """
    import json as _json
    from datetime import date as _d, timedelta as _td
    from .financials import FIN_VERSION
    cands = {r["deal_id"]: r for r in conn.execute(
        "SELECT d.deal_id, d.corp_code, d.first_filing_dt, COALESCE(c.corp_name, f.corp_name) AS corp_name "
        "FROM ipo_deal d LEFT JOIN company c USING (corp_code) LEFT JOIN filing f ON f.rcept_no = d.first_rcept_no "
        "WHERE d.is_ipo_candidate=1 AND COALESCE(d.doc_signal, 1) != 0")}
    done = {r["deal_id"]: r for r in conn.execute("SELECT deal_id, tried, parser_version, data FROM deal_fin")}
    alls = _group(conn)[1]
    plan = []
    for deal_id, c in sorted(cands.items(), key=lambda kv: kv[1]["first_filing_dt"] or "", reverse=True):
        if (c["first_filing_dt"] or "") < min_year or deal_id not in alls:
            continue
        if max_year and (c["first_filing_dt"] or "")[:4] > max_year:
            continue
        nm = c["corp_name"] or ""
        if "기업인수목적" in nm or "스팩" in nm:
            continue
        fl = alls[deal_id]
        f0 = fl[0]["rcept_no"]
        cut = (_d(int(f0[:4]), int(f0[4:6]), int(f0[6:8])) + _td(days=200)).strftime("%Y%m%d")
        win = [f for f in fl if f["rcept_no"][:8] <= cut]
        order = [f["rcept_no"] for f in reversed(win) if f["doc_kind"] == "prospectus"] + \
                [f["rcept_no"] for f in reversed(win) if f["doc_kind"] == "reg_equity"
                 and "발행조건확정" not in (f["report_nm"] or "")]
        order = order[:3]
        if not order:
            continue
        d = done.get(deal_id)
        data = _json.loads(d["data"] or "{}") if d else {}
        # 이미 읽은 딜은 규칙 버전이 올라도 다시 받지 않고(새 원문이 나올 때만), 못 읽은 딜만 새 규칙으로 다시 봅니다
        if d and ((d["parser_version"] or 0) >= FIN_VERSION or data.get("periods")):
            tried = set(_json.loads(d["tried"] or "[]"))
            if data.get("periods"):
                if data.get("src") == order[0] or order[0] in tried:
                    continue
                order = order[:1]
            elif all(no in tried for no in order):
                continue
        plan.append((deal_id, c["corp_code"], order))
    return plan


def save_deal_fin(conn, deal_id: str, corp_code: str, data: dict, tried: list, now: str) -> None:
    import json as _json
    from .financials import FIN_VERSION
    upsert(conn, "deal_fin", "deal_id", {
        "deal_id": deal_id, "corp_code": corp_code, "data": _json.dumps(data, ensure_ascii=False, sort_keys=True),
        "tried": _json.dumps(sorted(set(tried))), "status": "ok" if data.get("periods") else "not_found",
        "parser_version": FIN_VERSION, "fetched_at": now}, volatile=("fetched_at",))


def val_plan(conn, min_year: str = "2016", max_year: str | None = None) -> list:
    """공모가 산정 근거 추출 계획: [(deal_id, corp_code, [rcept_no, ...])].

    전문이 실린 증권신고서만 씁니다([발행조건확정]·첨부 정정 제외): 가장 최근 신고서 → 최초 신고서 순서.
    스팩은 건너뜁니다. 이미 읽은 딜은 더 새 신고서가 나왔을 때만 다시 봅니다.
    """
    import json as _json
    from .doctext import VAL_VERSION
    cands = {r["deal_id"]: r for r in conn.execute(
        "SELECT d.deal_id, d.corp_code, d.first_filing_dt, d.status, COALESCE(c.corp_name, f.corp_name) AS corp_name "
        "FROM ipo_deal d LEFT JOIN company c USING (corp_code) LEFT JOIN filing f ON f.rcept_no = d.first_rcept_no "
        "WHERE d.is_ipo_candidate=1 AND COALESCE(d.doc_signal, 1) != 0")}
    done = {r["deal_id"]: r for r in conn.execute("SELECT deal_id, tried, parser_version, data FROM deal_val")}
    alls = _group(conn)[1]
    plan = []
    for deal_id, c in sorted(cands.items(), key=lambda kv: kv[1]["first_filing_dt"] or "", reverse=True):
        fd = c["first_filing_dt"] or ""
        if fd < min_year or deal_id not in alls or (max_year and fd[:4] > max_year):
            continue
        nm = c["corp_name"] or ""
        if "기업인수목적" in nm or "스팩" in nm:
            continue
        regs = [f for f in alls[deal_id] if f["doc_kind"] == "reg_equity"
                and not any(k in (f["report_nm"] or "") for k in ("발행조건확정", "첨부", "정정제출요구"))]
        order = [f["rcept_no"] for f in reversed(regs)]
        if len(order) > 2:
            order = [order[0], order[-1]]
        if not order:
            continue
        d = done.get(deal_id)
        if d:
            data = _json.loads(d["data"] or "{}")
            tried = set(_json.loads(d["tried"] or "[]"))
            stale = (d["parser_version"] or 0) < VAL_VERSION
            if (data.get("value") or data.get("disc_low") is not None) and not (stale and (data.get("multiple") is None or not data.get("peers"))):
                if data.get("src") == order[0] or order[0] in tried:
                    continue
                order = order[:1]
            elif stale:
                pass      # 규칙이 바뀌었고 배수를 못 읽은 건은 같은 원문을 다시 읽습니다
            elif all(no in tried for no in order):
                continue
            else:
                order = [no for no in order if no not in tried]
        plan.append((deal_id, c["corp_code"], order))
    return plan


def save_deal_val(conn, deal_id: str, corp_code: str, data: dict, tried: list, now: str) -> None:
    import json as _json
    from .doctext import VAL_VERSION
    ok = bool(data.get("value") or data.get("disc_low") is not None)
    upsert(conn, "deal_val", "deal_id", {
        "deal_id": deal_id, "corp_code": corp_code, "data": _json.dumps(data, ensure_ascii=False, sort_keys=True),
        "tried": _json.dumps(sorted(set(tried))), "status": "ok" if ok else "not_found",
        "parser_version": VAL_VERSION, "fetched_at": now}, volatile=("fetched_at",))


def result_plan(conn) -> list:
    """증권발행실적보고서 추출 계획: [(corp_code, rcept_no)] 후보 딜의 가장 최근 보고서 중 미추출·구버전 건."""
    from .doctext import PARSER_VERSION
    plan = []
    for r in conn.execute("SELECT corp_code, result_rcept_no FROM ipo_deal WHERE is_ipo_candidate=1 "
                          "AND result_rcept_no IS NOT NULL ORDER BY first_filing_dt DESC"):
        dr = conn.execute("SELECT parser_version FROM doc_result WHERE rcept_no=?",
                          (r["result_rcept_no"],)).fetchone()
        if dr is None or (dr["parser_version"] or 0) < PARSER_VERSION:
            plan.append((r["corp_code"], r["result_rcept_no"]))
    return plan


def save_doc_result(conn, rcept_no: str, corp_code: str, parsed: dict, now: str) -> None:
    from .doctext import PARSER_VERSION
    upsert(conn, "doc_result", "rcept_no", {
        "rcept_no": rcept_no, "corp_code": corp_code, **parsed,
        "parser_version": PARSER_VERSION, "fetched_at": now}, volatile=("fetched_at",))


def save_doc_price(conn, rcept_no: str, corp_code: str, parsed: dict, now: str) -> None:
    upsert(conn, "doc_price", "rcept_no", {
        "rcept_no": rcept_no, "corp_code": corp_code,
        "band_low": parsed["band_low"], "band_high": parsed["band_high"],
        "final_price": parsed["final_price"], "band_evidence": parsed["band_evidence"],
        "header_amount": parsed["header_amount"], "header_shares": parsed["header_shares"],
        "header_evidence": parsed["header_evidence"],
        "final_evidence": parsed["final_evidence"], "n_values": parsed["n_values"],
        "status": parsed["status"], "inst_ratio": parsed.get("inst_ratio"),
        "inst_count": parsed.get("inst_count"), "inst_evidence": parsed.get("inst_evidence"),
        "parser_version": parsed.get("parser_version"), "fetched_at": now}, volatile=("fetched_at",))


def prune_raw(conn) -> int:
    cur = conn.execute("DELETE FROM dart_raw WHERE corp_code NOT IN "
                       "(SELECT corp_code FROM ipo_deal WHERE is_ipo_candidate=1)")
    return cur.rowcount


# ---------------------------------------------------------------- 텍스트 덤프
def export_sql(conn, path: str) -> None:
    """변경분만 git diff로 보이도록 SQL 텍스트로 내보냅니다."""
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text("\n".join(conn.iterdump()) + "\n", encoding="utf-8")


def restore_sql(db_path: str, sql_path: str) -> None:
    p = Path(db_path)
    if p.exists():
        p.unlink()
    p.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.executescript(Path(sql_path).read_text(encoding="utf-8"))
    conn.commit()
    conn.close()
