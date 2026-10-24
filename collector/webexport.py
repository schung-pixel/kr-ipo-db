"""PWA가 읽는 deals.json 생성.

DB를 직접 노출하지 않고 화면에 필요한 값만 내보냅니다. 내용이 같으면 파일을 다시 쓰지 않아
매일 실행해도 git 변경이 생기지 않습니다(생성 시각은 내용 비교에서 제외).
"""
from __future__ import annotations

import json
from pathlib import Path

from . import store

SCHEMA_VERSION = 1

DEAL_FIELDS = (
    "deal_id", "corp_code", "first_rcept_no", "first_filing_dt", "latest_rcept_no",
    "latest_filing_dt", "amendment_count", "status", "is_ipo_candidate", "ipo_basis",
    "listing_type", "market", "offer_price_low", "offer_price_high", "filed_price",
    "estk_rcept_no", "estk_before_fixing", "fixed_rcept_no", "doc_signal", "final_price", "shares_offered",
    "secondary_shares", "offer_amount", "lead_underwriters", "co_underwriters",
    "subscription_raw", "payment_raw", "listing_dt", "demand_start", "demand_end", "result_rcept_no", "inst_demand_ratio",
    "inst_demand_count", "retail_ratio", "retail_count", "tech_track", "tech_grades", "tech_agencies", "alt_route",
)

_KIND_MARKET = {"코스닥": "KOSDAQ", "유가증권": "KOSPI", "코넥스": "KONEX"}


def board(market: str | None, tech_track: str | None) -> str | None:
    """앱 표시용 상장 구분: KOSPI / KOSDAQ / KOSDAQ_TECH."""
    if market == "KOSPI":
        return "KOSPI"
    if market == "KOSDAQ":
        return "KOSDAQ_TECH" if tech_track else "KOSDAQ"
    return None


def _rows(conn, sql, args=()):
    return [dict(r) for r in conn.execute(sql, args)]


# 증권사 영문 사명을 한글 음차로 적은 공시가 있어 앱에는 공식 표기로 보여 줍니다(사명 변경·합병은 바꾸지 않음).
UW_DISPLAY = {
    "케이비증권": "KB증권", "케이비투자증권": "KB투자증권", "엔에이치투자증권": "NH투자증권",
    "아이비케이투자증권": "IBK투자증권", "엘에스증권": "LS증권", "아이엠증권": "iM증권",
    "디비금융투자": "DB금융투자", "디비증권": "DB증권", "에스케이증권": "SK증권", "비엔케이투자증권": "BNK투자증권",
}


def uw_display(s):
    if not s:
        return s
    return ", ".join(UW_DISPLAY.get(n.strip(), n.strip()) for n in str(s).split(","))


SUMMARY_PATH = Path(__file__).resolve().parent.parent / "data" / "biz_summary.json"


def load_summaries(path=None) -> dict:
    """회사 개요 요약문: {corp_code: {"summary", "source_rcept_no", "generated_at"}}. 없으면 빈 사전."""
    p = Path(path or SUMMARY_PATH)
    try:
        return json.loads(p.read_text(encoding="utf-8")).get("companies", {})
    except (OSError, ValueError):
        return {}


def build_payload(conn) -> dict:
    deals = _rows(conn, f"SELECT {','.join('d.' + f for f in DEAL_FIELDS)}, "
                        "COALESCE(c.corp_name, f.corp_name) AS corp_name, c.corp_cls, c.stock_code, "
                        "c.induty_code, c.est_dt "
                        "FROM ipo_deal d LEFT JOIN company c USING (corp_code) "
                        "LEFT JOIN filing f ON f.rcept_no = d.first_rcept_no "
                        # IPO만 내보냅니다: 후보로 판별되고 원문에서 공모희망가액·확정공모가액 문구가 확인된 건
                        # (원문 미조회 건은 포함). 상장사 유상증자 등은 DB에만 남깁니다.
                        "WHERE d.is_ipo_candidate = 1 AND COALESCE(d.doc_signal, 1) != 0 "
                        "ORDER BY d.first_filing_dt DESC, d.deal_id")
    review = {r["deal_id"]: r for r in _rows(conn, "SELECT * FROM review")}

    filings_by_corp: dict[str, list] = {}
    for f in _rows(conn, "SELECT rcept_no, corp_code, report_nm, rcept_dt, rm, doc_kind, tags "
                         "FROM filing WHERE doc_kind IN ('reg_equity','prospectus','result') "
                         "ORDER BY corp_code, rcept_no"):
        filings_by_corp.setdefault(f["corp_code"], []).append(f)

    # 같은 기업의 딜은 최초 접수번호 순으로 구간을 나눠 공시를 배정합니다(접수번호는 날짜 순).
    starts: dict[str, list] = {}
    for d in deals:
        starts.setdefault(d["corp_code"], []).append(d["first_rcept_no"])
    for v in starts.values():
        v.sort()

    for d in deals:
        corp_starts = starts[d["corp_code"]]
        i = corp_starts.index(d["first_rcept_no"])
        hi = corp_starts[i + 1] if i + 1 < len(corp_starts) else "~"
        d["filings"] = [
            {"rcept_no": f["rcept_no"], "report_nm": f["report_nm"], "rcept_dt": f["rcept_dt"],
             "doc_kind": f["doc_kind"], "tags": f["tags"], "rm": f["rm"]}
            for f in filings_by_corp.get(d["corp_code"], [])
            if d["first_rcept_no"] <= f["rcept_no"] < hi]

        estk = d["estk_rcept_no"] if d["is_ipo_candidate"] == 1 else None
        d["underwriters"] = _rows(
            conn, "SELECT actsen, actnmn, stksen, udtcnt, udtamt, udtprc, udtmth FROM underwriter "
                  "WHERE rcept_no=? ORDER BY row_no", (estk,)) if estk else []
        for u in d["underwriters"]:
            u["actnmn"] = uw_display(u.get("actnmn"))
        d["lead_underwriters"] = uw_display(d.get("lead_underwriters"))
        d["co_underwriters"] = uw_display(d.get("co_underwriters"))
        d["securities"] = _rows(
            conn, "SELECT stksen, stkcnt, fv, slprc, slta, slmthn FROM estk_security "
                  "WHERE rcept_no=? ORDER BY row_no", (estk,)) if estk else []
        d["use_of_proceeds"] = _rows(
            conn, "SELECT se, amt FROM use_of_proceeds WHERE rcept_no=? ORDER BY row_no",
            (estk,)) if estk else []
        d["sellers"] = _rows(
            conn, "SELECT hdr, rl_cmp, bfsl_hdstk, slstk, atsl_hdstk FROM seller "
                  "WHERE rcept_no=? ORDER BY row_no", (estk,)) if estk else []
        d["sources"] = _rows(
            conn, "SELECT field_name, value, rcept_no, section, evidence, method, review_status "
                  "FROM field_source WHERE deal_id=? ORDER BY field_name", (d["deal_id"],)) \
            if d["is_ipo_candidate"] == 1 else []
        rv = review.get(d["deal_id"])
        d["correction_order"] = bool(rv and rv["correction_order"])

    # KIND 예비심사: DART 딜에 예심 청구·승인일을 붙이고, 승인 후 아직 신고서가 없는 회사를 따로 담습니다.
    from datetime import date as _date
    from . import kind
    summaries = load_summaries()
    for d in deals:
        rv = kind.review_for(conn, d.get("corp_name") or "", d["first_filing_dt"])
        d["prelim"] = {k: rv.get(k) for k in ("filed_dt", "decided_dt", "result", "market", "listing_type", "sponsor")} if rv else None
        if d["prelim"]:
            d["prelim"]["sponsor"] = uw_display(d["prelim"]["sponsor"])
        # 회사 개요: 요약문(data/biz_summary.json) > 신고서 '사업의 개요' 발췌, KIND 업종·주요제품
        regs = [f["rcept_no"] for f in d.get("filings", []) if f.get("doc_kind") == "reg_equity"]
        biz = None
        if regs:
            marks = ",".join("?" for _ in regs)
            biz = conn.execute(f"SELECT rcept_no, biz_excerpt FROM doc_schedule WHERE rcept_no IN ({marks}) "
                               "AND biz_excerpt IS NOT NULL ORDER BY rcept_no DESC LIMIT 1", regs).fetchone()
        ci = kind.corp_info(conn, d.get("corp_name") or "")
        sm = summaries.get(d.get("corp_code") or "")
        d["company"] = {
            "summary": sm.get("summary") if sm else None,
            "excerpt": biz["biz_excerpt"] if biz else None,
            "source_rcept_no": (sm or {}).get("source_rcept_no") or (biz["rcept_no"] if biz else None),
            "industry": ci.get("industry") if ci else None, "products": ci.get("products") if ci else None,
        } if (biz or ci or sm) else None
        km = _KIND_MARKET.get((rv or {}).get("market") or "")
        if km:   # KIND 예심 시장 구분이 있으면 원문 판정보다 우선
            d["market_src"] = "KIND" if d.get("market") in (None, km) else "KIND(원문 판정 " + str(d.get("market")) + "와 다름)"
            d["market"] = km
        elif d.get("market"):
            d["market_src"] = "원문"
        d["board"] = board(d.get("market"), d.get("tech_track"))
    asof = store.get_meta(conn, "last_list_date") or _date.today().isoformat()
    approvals = []
    for r in kind.pending_approvals(conn, deals, _date.fromisoformat(asof)):
        approvals.append({
            "deal_id": f"kind_{r['review_key']}", "corp_code": None, "corp_name": r["corp_name"],
            "status": "approved", "is_ipo_candidate": 1, "doc_signal": None,
            "first_filing_dt": r.get("decided_dt") or r.get("filed_dt"), "first_rcept_no": "",
            "lead_underwriters": uw_display(r.get("sponsor")), "market": _KIND_MARKET.get(r.get("market") or "", r.get("market")),
            "board": board(_KIND_MARKET.get(r.get("market") or ""), None), "tech_unknown": True,
            "listing_type": r.get("listing_type"),
            "prelim": {k: (uw_display(r.get(k)) if k == "sponsor" else r.get(k))
                       for k in ("filed_dt", "decided_dt", "result", "market", "listing_type", "sponsor")},
            "filings": [], "underwriters": [], "securities": [], "use_of_proceeds": [], "sellers": [], "sources": [],
        })

    return {
        "schema_version": SCHEMA_VERSION,
        "kind_as_of": store.get_meta(conn, "kind_as_of"),
        "approvals": approvals,
        "last_list_date": store.get_meta(conn, "last_list_date"),
        "attribution": "금융감독원 전자공시시스템(DART) 공시 기반",
        "deals": deals,
    }


def export_json(conn, path: str, now: str) -> bool:
    """내용이 바뀐 경우에만 쓰고, 썼는지 여부를 돌려줍니다."""
    payload = build_payload(conn)
    p = Path(path)
    if p.exists():
        try:
            old = json.loads(p.read_text(encoding="utf-8"))
            old.pop("generated_at", None)
            if old == payload:
                return False
        except (ValueError, OSError):
            pass
    # 딜 하나를 한 줄로 써서 git diff가 딜 단위로 보이게 합니다.
    dump = lambda o: json.dumps(o, ensure_ascii=False, sort_keys=True)
    head = {k: v for k, v in payload.items() if k != "deals"}
    head["generated_at"] = now
    lines = ["{", *[f'{dump(k)}: {dump(v)},' for k, v in sorted(head.items())],
             '"deals": [', ",\n".join(dump(d) for d in payload["deals"]), "]", "}"]
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return True
