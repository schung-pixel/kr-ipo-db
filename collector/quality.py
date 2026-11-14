"""수집 품질 점검: 매 수집 뒤 결측·출처 간 차이·수집 실패를 data/kind/_quality.json에 남깁니다.

alerts가 비어 있지 않으면 사람이 확인해야 할 문제입니다(평일 아티팩트 갱신 작업이 읽어 알림을 보냄).
"""
from __future__ import annotations

import json
from datetime import date, timedelta
from pathlib import Path

# 최근 1년 상장 완료(스팩 제외) 기준 허용 결측률(%). 넘으면 알림.
MISSING_LIMIT = {"final_price": 0, "offer_band": 5, "inst_demand_ratio": 5, "retail_ratio": 5, "listing_dt": 0,
                 "float0": 15, "commit": 25, "fin": 10, "company_summary": 10}


def _get(d, f):
    if f == "offer_band":
        return d.get("offer_price_low")
    if f in ("float0", "commit"):
        return (d.get("lockup") or {}).get(f)
    if f == "company_summary":
        return (d.get("company") or {}).get("summary") or (d.get("company") or {}).get("excerpt")
    return d.get(f)


def check(conn, deals: list, status: dict, today: date) -> dict:
    alerts, mismatch = [], []
    real = [d for d in deals if d.get("is_ipo_candidate") == 1 and not d.get("is_spac")]

    # 1) 수집이 멈췄는지(마지막 DART 목록일)
    last = conn.execute("SELECT value FROM meta WHERE key='last_list_date'").fetchone()
    last = last[0] if last else None
    if not last or (today - date.fromisoformat(last)).days > 4:
        alerts.append(f"DART 공시 목록 수집이 {last or '-'} 이후 멈춰 있습니다.")

    # 2) 화면별 수집 실패(KIND·38)
    ls = (status.get("listing_sched") or {}).get("screens") or {}
    s38 = (status.get("src38") or {}).get("screens") or {}
    for name, v in [("KIND 공모기업 진행현황", ls.get("pubofrprogcom")), ("38 신규상장", s38.get("nw")), ("38 청약일정", s38.get("k"))]:
        if not isinstance(v, int) or v == 0:
            alerts.append(f"{name} 화면을 읽지 못했습니다({v}).")
    for k in ("listing_sched_error", "src38_error", "corp_list_error"):
        if status.get(k):
            alerts.append(f"{k}: {status[k]}")
    if status.get("fetch") not in ("ok", "skipped", None):
        alerts.append(f"KIND 예비심사 화면 조회 실패({status.get('fetch')}).")

    # 3) 진행 중 딜의 늦어진 값
    iso = today.isoformat()
    for d in real:
        nm = d.get("corp_name")
        if d.get("status") == "price_fixed" and not d.get("final_price"):
            alerts.append(f"{nm}: 발행조건확정 신고서는 있으나 확정가를 읽지 못했습니다.")
        lst = d.get("listing_dt") or d.get("listing_sched")
        if d.get("status") == "completed" and d.get("listing_dt") and d["listing_dt"] <= iso:
            if d.get("retail_ratio") is None and (today - date.fromisoformat(d["listing_dt"])).days > 3 \
                    and d["listing_dt"] >= (today - timedelta(days=60)).isoformat():
                alerts.append(f"{nm}: 상장({d['listing_dt']}) 뒤에도 일반청약 경쟁률이 비어 있습니다.")
        elif d.get("status") in ("price_fixed", "filed") and lst and lst < (today - timedelta(days=7)).isoformat():
            alerts.append(f"{nm}: 상장 예정일({lst})이 지났는데 증권발행실적보고서가 반영되지 않았습니다.")

    # 4) 출처 간 차이(최근 90일 상장 건, 38커뮤니케이션 대조)
    since = (today - timedelta(days=90)).isoformat()
    from . import kind, src38 as s38mod
    keys = kind._keys(conn, "src38")
    for d in real:
        if not d.get("listing_dt") or d["listing_dt"] < since:
            continue
        k = kind.find_key(keys, d.get("corp_name") or "")
        r = s38mod.lookup(conn, [k], None, d["listing_dt"], d["listing_dt"]) if k else None
        if not r:
            continue
        nm = d.get("corp_name")
        if r["offer_price"] and d.get("final_price") and r["offer_price"] != d["final_price"]:
            mismatch.append(f"{nm}: 확정가 DART {d['final_price']:,} / 38 {r['offer_price']:,}")
        if r["retail_ratio"] and d.get("retail_ratio") and d.get("retail_src") != "38" \
                and abs(d["retail_ratio"] - r["retail_ratio"]) > r["retail_ratio"] * 0.02:
            mismatch.append(f"{nm}: 일반청약 경쟁률 DART {d['retail_ratio']:,} / 38 {r['retail_ratio']:,}")

    # 5) 최근 1년 상장 완료 건의 필드별 결측률
    yr = [d for d in real if d.get("status") == "completed" and d.get("listing_dt")
          and (today - timedelta(days=365)).isoformat() <= d["listing_dt"] <= iso]
    missing = {}
    for f, lim in MISSING_LIMIT.items():
        pct = round(100 * sum(1 for d in yr if not _get(d, f)) / len(yr), 1) if yr else 0.0
        missing[f] = pct
        if yr and pct > lim:
            alerts.append(f"최근 1년 상장 {len(yr)}건 중 {f} 결측 {pct}%(허용 {lim}%).")
    if len(mismatch) >= 3:
        alerts.append(f"38커뮤니케이션과 값이 다른 최근 상장 건이 {len(mismatch)}건입니다.")
    return {"checked_at": iso, "last_list_date": last, "alerts": alerts, "mismatch": mismatch,
            "missing_pct_last_year": missing, "n_last_year": len(yr)}


def write(conn, json_path: str, status: dict, today: date, out: str = "data/kind/_quality.json") -> dict:
    deals = json.loads(Path(json_path).read_text(encoding="utf-8"))["deals"]
    q = check(conn, deals, status, today)
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    Path(out).write_text(json.dumps(q, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return q
