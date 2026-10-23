"""명령행 진입점.

  python -m collector.run restore                  # data/ipo.sql → data/ipo.db 복원
  python -m collector.run backfill --from 2025-01-01
  python -m collector.run daily                    # 마지막 수집일 이후분 (겹치는 구간 포함)
  python -m collector.run export                   # data/ipo.db → data/ipo.sql
  python -m collector.run report                   # 딜 요약 출력
"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import date, timedelta
from pathlib import Path

from . import store, webexport
from .dart import DartClient
from .pipeline import collect, now_kst


def _client() -> DartClient:
    key = os.environ.get("DART_API_KEY", "").strip()
    if not key:
        sys.exit("환경변수 DART_API_KEY가 설정되지 않았습니다.")
    return DartClient(key)


def cmd_report(conn) -> None:
    """딜 요약. 후보(1) 먼저, 최근 신고 순. 기재가는 estkRs 최신 기재정정 기준이며 *는 발행조건확정 이전 값입니다."""
    rows = conn.execute(
        "SELECT d.deal_id, c.corp_name, d.first_filing_dt, d.status, d.is_ipo_candidate, "
        "d.offer_price_low, d.offer_price_high, d.filed_price, d.estk_before_fixing, d.final_price, "
        "d.shares_offered, d.offer_amount, d.lead_underwriters "
        "FROM ipo_deal d LEFT JOIN company c USING (corp_code) "
        "ORDER BY d.is_ipo_candidate DESC, d.first_filing_dt DESC").fetchall()
    print(f"딜 {len(rows)}건 (후보 {sum(1 for r in rows if r['is_ipo_candidate'] == 1)}건)")
    for r in rows:
        lo, hi = r["offer_price_low"], r["offer_price_high"]
        if lo:
            price = f"{lo:,}~{hi:,}"
        elif r["filed_price"]:
            price = f"{r['filed_price']:,}" + ("*" if r["estk_before_fixing"] else "")
        else:
            price = "-"
        amt = f"{r['offer_amount'] / 1e8:,.0f}억" if r["offer_amount"] else "-"
        print(f"{r['first_filing_dt']} {(r['corp_name'] or r['deal_id'])[:16]:<16} 후보={r['is_ipo_candidate']} "
              f"{r['status']:<11} 기재가 {price:<14} 공모액 {amt:<8} 주관 {r['lead_underwriters'] or '-'}")


def cmd_kind(conn, args) -> None:
    """KIND 실패는 수집 전체를 멈추지 않습니다(경고만 남기고 수동 파일·기존 값으로 진행)."""
    from . import kind
    now = now_kst().replace(microsecond=0).isoformat()
    folder = Path("data/kind")
    if not args.no_fetch:
        try:
            rows, html = kind.fetch(today=now_kst().date())
            if rows:
                n = kind.save_rows(conn, rows, "kind", now)
                store.set_meta(conn, "kind_as_of", now[:10])
                print(f"KIND 예비심사 {n}건 반영 (승인 {sum(kind.is_approved(r) for r in rows)}건)")
            else:
                p = kind.dump_debug(html, folder)
                print(f"주의: KIND 응답에서 표를 읽지 못했습니다. 원문을 {p}에 저장했습니다.")
        except Exception as exc:   # 네트워크·차단 등
            print(f"주의: KIND 조회 실패({type(exc).__name__}). 수동 파일과 기존 값으로 진행합니다.")
    if folder.exists():
        if kind.load_manual(conn, folder, now):
            store.set_meta(conn, "kind_as_of", store.get_meta(conn, "kind_as_of") or now[:10])
    conn.commit()
    store.export_sql(conn, args.sql)
    changed = webexport.export_json(conn, args.json, now)
    print(f"{args.json} {'갱신' if changed else '변경 없음'}")


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="collector")
    p.add_argument("--db", default="data/ipo.db")
    p.add_argument("--sql", default="data/ipo.sql")
    sub = p.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("backfill")
    b.add_argument("--from", dest="bgn", required=True, help="YYYY-MM-DD")
    b.add_argument("--to", dest="end")
    b.add_argument("--max-corps", type=int)
    b.add_argument("--max-docs", type=int, help="원문 추출 건수 상한")
    b.add_argument("--refetch-docs", action="store_true", help="추출 실패 건을 다시 조회")
    d = sub.add_parser("daily")
    d.add_argument("--lookback", type=int, default=7, help="마지막 수집일에서 되짚을 일수")
    d.add_argument("--max-corps", type=int)
    d.add_argument("--max-docs", type=int)
    d.add_argument("--refetch-docs", action="store_true")
    sub.add_parser("restore")
    sub.add_parser("export")
    j = sub.add_parser("export-json", help="PWA용 deals.json 생성")
    j.add_argument("--json", default="docs/data/deals.json")
    k = sub.add_parser("kind", help="KIND 상장예비심사 현황 수집(+ data/kind/ 수동 파일) 후 덤프·JSON 갱신")
    k.add_argument("--no-fetch", action="store_true", help="KIND 호출 없이 수동 파일만 반영")
    k.add_argument("--json", default="docs/data/deals.json")
    sub.add_parser("report")
    args = p.parse_args(argv)

    if args.cmd == "restore":
        if Path(args.sql).exists():
            store.restore_sql(args.db, args.sql)
            print(f"{args.sql} → {args.db} 복원 완료")
        else:
            print(f"{args.sql} 없음: 새 DB로 시작합니다.")
        return 0

    conn = store.connect(args.db)
    try:
        if args.cmd == "export":
            store.export_sql(conn, args.sql)
            print(f"{args.db} → {args.sql} 내보내기 완료")
        elif args.cmd == "report":
            cmd_report(conn)
        elif args.cmd == "kind":
            cmd_kind(conn, args)
        elif args.cmd == "export-json":
            changed = webexport.export_json(conn, args.json, now_kst().replace(microsecond=0).isoformat())
            print(f"{args.json} {'갱신' if changed else '변경 없음'}")
        else:
            today = now_kst().date()
            if args.cmd == "backfill":
                bgn = date.fromisoformat(args.bgn)
                end = date.fromisoformat(args.end) if args.end else today
            else:
                last = store.get_meta(conn, "last_list_date")
                anchor = date.fromisoformat(last) if last else today
                bgn, end = anchor - timedelta(days=args.lookback), today
            collect(_client(), conn, bgn, end, max_corps=args.max_corps,
                    max_docs=args.max_docs, refetch_docs=args.refetch_docs)
            store.export_sql(conn, args.sql)
            webexport.export_json(conn, "docs/data/deals.json",
                                  now_kst().replace(microsecond=0).isoformat())
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
