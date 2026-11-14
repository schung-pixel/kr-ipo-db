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
    """KIND 실패는 수집 전체를 멈추지 않습니다(경고만 남기고 수동 파일·기존 값으로 진행).

    결과는 data/kind/_status.json에, 표를 못 읽은 응답 원문은 data/kind/_last_response.html에 남겨
    Actions 로그 없이도 저장소에서 원인을 확인할 수 있게 합니다.
    """
    import json
    from . import kind
    now = now_kst().replace(microsecond=0).isoformat()
    folder = Path("data/kind")
    status = {"run_at": now, "fetch": "skipped" if args.no_fetch else None}
    if not args.no_fetch:
        try:
            rows, html = kind.fetch(today=now_kst().date())
            status.update(http_status=200, response_bytes=len(html.encode("utf-8")), rows=len(rows))
            if rows:
                n = kind.save_rows(conn, rows, "kind", now)
                store.set_meta(conn, "kind_as_of", now[:10])
                ap = sum(kind.is_approved(r) for r in rows)
                status.update(fetch="ok", saved=n, approved=ap)
                print(f"KIND 예비심사 {n}건 반영 (승인 {ap}건)")
            else:
                p = kind.dump_debug(html, folder)
                status.update(fetch="no_table", dump=str(p))
                print(f"주의: KIND 응답에서 표를 읽지 못했습니다. 원문을 {p}에 저장했습니다.")
        except Exception as exc:   # 네트워크·차단 등
            resp = getattr(exc, "response", None)
            status.update(fetch="error", error=type(exc).__name__, message=str(exc)[:300])
            if resp is not None:
                status.update(http_status=resp.status_code, response_bytes=len(resp.content or b""))
                try:
                    status["dump"] = str(kind.dump_debug(resp.text, folder))
                except Exception:
                    pass
            print(f"주의: KIND 조회 실패({type(exc).__name__}: {str(exc)[:200]}). 수동 파일과 기존 값으로 진행합니다.")
    if not args.no_fetch and not store.get_meta(conn, "kind_review_history"):
        # 예심 이력 과거분(한 번만): 평소 조회는 최근 850일이라 그 이전 청구·승인일이 비어 있습니다. 연 단위로 나눠 받습니다.
        try:
            got, end = 0, now_kst().date() - timedelta(days=800)
            while end.year >= 2015:
                rows, _ = kind.fetch(today=end, from_date=end - timedelta(days=370))
                got += kind.save_rows(conn, rows, "kind", now)
                end -= timedelta(days=365)
            status["review_history"] = got
            if got:
                store.set_meta(conn, "kind_review_history", now[:10])
            print(f"KIND 예비심사 과거 이력 {got}건 반영")
        except Exception as exc:
            status["review_history_error"] = f"{type(exc).__name__}: {str(exc)[:200]}"
            print(f"주의: KIND 예비심사 과거 이력 조회 실패({type(exc).__name__})")
    if not args.no_fetch:   # 상장법인 목록(업종·주요제품): 실패해도 계속
        try:
            status["corp_list"] = kind.save_corp_list(conn, kind.fetch_corp_list(), now)
            print(f"KIND 상장법인 목록 {status['corp_list']}건 반영")
        except Exception as exc:
            status["corp_list_error"] = f"{type(exc).__name__}: {str(exc)[:200]}"
            print(f"주의: KIND 상장법인 목록 조회 실패({type(exc).__name__})")
    if not args.no_fetch:   # 신규상장 예정일: 실패해도 계속
        try:
            rows, st = kind.fetch_listing_sched(today=now_kst().date())
            status["listing_sched"] = {"screens": st, "saved": kind.save_listing_sched(conn, rows, now)}
            print(f"KIND 신규상장 예정일 {status['listing_sched']['saved']}건 반영 {st}")
        except Exception as exc:
            status["listing_sched_error"] = f"{type(exc).__name__}: {str(exc)[:200]}"
            print(f"주의: KIND 신규상장 예정일 조회 실패({type(exc).__name__})")
    if not args.no_fetch:   # 38커뮤니케이션 신규상장일·청약경쟁률(보조 출처): 실패해도 계속
        try:
            from . import src38
            rows, st = src38.fetch(pages=2)
            status["src38"] = {"screens": st, "saved": src38.save(conn, rows, now)}
            print(f"38커뮤니케이션 상장일·청약경쟁률 {status['src38']['saved']}건 반영 {st}")
        except Exception as exc:
            status["src38_error"] = f"{type(exc).__name__}: {str(exc)[:200]}"
            print(f"주의: 38커뮤니케이션 조회 실패({type(exc).__name__})")
    if folder.exists():
        m = kind.load_manual(conn, folder, now)
        status["manual_rows"] = m
        if m:
            store.set_meta(conn, "kind_as_of", store.get_meta(conn, "kind_as_of") or now[:10])
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "_status.json").write_text(json.dumps(status, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    conn.commit()
    store.export_sql(conn, args.sql)
    changed = webexport.export_json(conn, args.json, now)
    print(f"{args.json} {'갱신' if changed else '변경 없음'}")
    try:   # 품질 점검(실패해도 수집 결과는 그대로 커밋)
        from . import quality
        q = quality.write(conn, args.json, status, now_kst().date())
        print(f"품질 점검: 알림 {len(q['alerts'])}건, 출처 간 차이 {len(q['mismatch'])}건")
    except Exception as exc:
        print(f"주의: 품질 점검 실패({type(exc).__name__}: {str(exc)[:200]})")


def cmd_queue(conn, args) -> int:
    """과거 구간 대기열(data/backfill.json)을 시간 예산 안에서 한 구간 처리합니다.

    종료 코드: 0 = 한 구간 완료(남은 구간 있을 수 있음), 3 = 남은 구간 없음, 4 = DART 일일 한도 도달.
    구간마다 덤프·JSON을 갱신하므로 워크플로가 구간 단위로 커밋할 수 있습니다.
    """
    import json
    qpath = Path(args.file)
    if not qpath.exists():
        return 3
    q = json.loads(qpath.read_text(encoding="utf-8"))
    pending = [r for r in q.get("ranges", []) if not r.get("done")]
    if not pending:
        return 3
    r = pending[0]
    stats = collect(_client(), conn, date.fromisoformat(r["from"]), date.fromisoformat(r["to"]),
                    max_docs=args.max_docs)
    store.export_sql(conn, args.sql)
    webexport.export_json(conn, "docs/data/deals.json", now_kst().replace(microsecond=0).isoformat())
    r["runs"] = r.get("runs", 0) + 1
    r["last_run"] = now_kst().replace(microsecond=0).isoformat()
    r["last_stats"] = {k: v for k, v in stats.items() if k != "unknown_groups"}
    if stats["quota_hit"]:
        qpath.write_text(json.dumps(q, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print(f"{r['from']} ~ {r['to']}: DART 일일 한도 도달, 다음 실행에서 이어서 처리합니다.")
        return 4
    r["done"] = True
    qpath.write_text(json.dumps(q, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    left = sum(1 for x in q["ranges"] if not x.get("done"))
    print(f"{r['from']} ~ {r['to']} 완료 (남은 구간 {left}개): {r['last_stats']}")
    return 0


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
    qq = sub.add_parser("queue", help="data/backfill.json의 다음 과거 구간 한 개를 수집")
    qq.add_argument("--file", default="data/backfill.json")
    qq.add_argument("--max-docs", type=int)
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
        elif args.cmd == "queue":
            return cmd_queue(conn, args)
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
                    max_docs=args.max_docs, refetch_docs=args.refetch_docs,
                    workers=int(os.environ.get("DART_WORKERS", "4")))
            store.export_sql(conn, args.sql)
            webexport.export_json(conn, "docs/data/deals.json",
                                  now_kst().replace(microsecond=0).isoformat())
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
