"""수집 파이프라인: 공시 목록 → 증권신고서 주요정보 → 기업개황 → 딜 집계."""
from __future__ import annotations

import os
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from . import doctext, financials, lockup, store
from .dart import FATAL_STATUS, DartError, DartQuotaExceeded
from .parse import windows

KST = ZoneInfo("Asia/Seoul")
DETAIL_TYPE_EQUITY_REG = "C001"  # 증권신고(지분증권)
HISTORY_LOOKBACK_DAYS = 180      # 정정 건에서 최초 신고서를 찾을 때 되짚는 기간


def doc_text(client, rcept_no: str) -> str:
    """공시 원문 텍스트. OpenDART가 원문을 주지 않으면(014, 대개 2019년 이전) 공시 뷰어 화면으로 대신 받습니다."""
    try:
        return doctext.to_text(client.document(rcept_no))
    except DartError as exc:
        # GitHub Actions에서는 공시 뷰어 접속이 막혀 시간만 쓰므로 DART_VIEWER=0이면 대체 조회를 하지 않습니다.
        if exc.status != "014" or not hasattr(client, "viewer_html") or os.environ.get("DART_VIEWER") == "0":
            raise
    return doctext.html_to_text(client.viewer_html(rcept_no))


def doc_rows(client, rcept_no: str) -> str:
    """표의 행을 보존한 원문 텍스트(유통물량·보호예수 표용). 2019년 이전 원문(014)은 공시 뷰어로 대신 받습니다."""
    try:
        return lockup.rows_text_from_zip(client.document(rcept_no))
    except DartError as exc:
        if exc.status != "014" or not hasattr(client, "viewer_html") or os.environ.get("DART_VIEWER") == "0":
            raise
    return lockup.rows_text(client.viewer_html(rcept_no, sections=lockup.VIEWER_SECTIONS))


class _Prefetch:
    """공시 원문을 처리 순서대로 몇 건 앞서 병렬로 받아 둡니다(DART 응답이 느려 원문 단계가 대부분의 시간을 씀).
    document()는 미리 받은 결과를 돌려주고, 순서에 없는 접수번호는 그 자리에서 받습니다. 예외(한도 초과 등)는
    해당 건을 꺼낼 때 그대로 다시 발생합니다."""

    def __init__(self, client, order, workers: int = 4, ahead: int = 8, fetch=None):
        from concurrent.futures import ThreadPoolExecutor
        self.client, self.order, self.pos, self.fut, self.ahead = client, list(order), 0, {}, ahead
        self.fetch = (lambda no: fetch(client, no)) if fetch else (lambda no: doc_text(client, no))
        self.ex = ThreadPoolExecutor(max_workers=workers) if workers > 1 and self.order else None
        self._fill()

    def _fill(self):
        while self.ex and len(self.fut) < self.ahead and self.pos < len(self.order):
            no = self.order[self.pos]
            self.pos += 1
            if no not in self.fut:
                self.fut[no] = self.ex.submit(self.fetch, no)

    def document(self, rcept_no):
        f = self.fut.pop(rcept_no, None)
        self._fill()
        return f.result() if f is not None else self.fetch(rcept_no)

    def close(self):
        if self.ex:
            self.ex.shutdown(wait=False, cancel_futures=True)


def _collect_lockups(client, conn, now, stats, log, workers, budget):
    import json as _json
    lplan = store.lockup_plan(conn, min_year=os.environ.get("LOCKUP_MIN_YEAR", "2020"))
    # 추출 규칙 버전이 오른 행은 처음부터 다시 읽습니다(이전 결과·시도 목록을 쓰지 않음)
    existing = {r["deal_id"]: r for r in conn.execute(
        "SELECT deal_id, data, tried FROM deal_lockup WHERE parser_version >= ?", (lockup.LOCKUP_VERSION,))}
    first_docs = []
    for deal_id, _, order, _ in lplan:
        tried = set(_json.loads(existing[deal_id]["tried"] or "[]")) if deal_id in existing else set()
        first_docs += [no for no in order if no not in tried][:1]
    pf = _Prefetch(client, first_docs[: budget if budget is not None else None], workers, ahead=workers * 3, fetch=doc_rows)
    for deal_id, corp, order, priced in lplan:
        if stats["quota_hit"] or (budget is not None and budget <= 0):
            break
        row = existing.get(deal_id)
        data = _json.loads(row["data"]) if row and row["data"] else {}
        tried = set(_json.loads(row["tried"] or "[]")) if row else set()
        fetched = 0
        for no in order:
            if no in tried:
                continue
            if budget is not None and budget <= 0:
                break
            # 유통물량을 이미 읽었으면, 확약 비율은 공모가 확정 뒤 원문에만 있으므로 확정 딜만 한 건 더 봅니다
            if (data.get("float0") or data.get("listed_any")) and (data.get("commit") or not priced or fetched >= 2):
                break
            try:
                text = pf.document(no)
            except DartQuotaExceeded:
                stats["quota_hit"] = True
                log("DART 일일 요청 한도 도달: 남은 원문은 다음 실행에서 이어서 처리합니다.")
                break
            except DartError as exc:
                if exc.status in FATAL_STATUS:
                    raise
                tried.add(no)
                if exc.status != "014":
                    stats["errors"] += 1
                    log(f"원문 조회 오류({no}): {exc}")
                _kind(stats, "조회:" + str(getattr(exc, "status", "") or type(exc).__name__))
                continue
            except Exception as exc:
                stats["errors"] += 1
                tried.add(no)
                log(f"원문 처리 오류({no}): {type(exc).__name__}")
                _kind(stats, "처리:" + type(exc).__name__)
                continue
            tried.add(no)
            fetched += 1
            if budget is not None:
                budget -= 1
            data = lockup.merge(data, lockup.extract_lockup(text), no)
            if data.get("float0") and data.get("commit"):
                break
        store.save_deal_lockup(conn, deal_id, corp, data or {"status": "not_found"}, list(tried), now)
        conn.commit()
        stats["lockups"] += 1
    pf.close()
    return budget


def fin_rows(client, rcept_no: str) -> str:
    """요약재무정보용 행 보존 텍스트. 2019년 이전 원문(014)은 공시 뷰어에서 '요약재무정보' 목차만 받습니다."""
    try:
        return lockup.rows_text_from_zip(client.document(rcept_no))
    except DartError as exc:
        if exc.status != "014" or not hasattr(client, "viewer_html") or os.environ.get("DART_VIEWER") == "0":
            raise
    return lockup.rows_text(client.viewer_html(rcept_no, sections=financials.VIEWER_SECTIONS))


def _collect_financials(client, conn, now, stats, log, workers, budget):
    import json as _json
    plan = store.fin_plan(conn, min_year=os.environ.get("FIN_MIN_YEAR", os.environ.get("LOCKUP_MIN_YEAR", "2020")),
                          max_year=os.environ.get("FIN_MAX_YEAR") or None)
    existing = {r["deal_id"]: r for r in conn.execute(
        "SELECT deal_id, data, tried FROM deal_fin WHERE parser_version >= ? OR status = 'ok'", (financials.FIN_VERSION,))}
    first = []
    for deal_id, _, order in plan:
        tried = set(_json.loads(existing[deal_id]["tried"] or "[]")) if deal_id in existing else set()
        first += [no for no in order if no not in tried][:1]
    pf = _Prefetch(client, first[: budget if budget is not None else None], workers, ahead=workers * 3, fetch=fin_rows)
    for deal_id, corp, order in plan:
        if stats["quota_hit"] or (budget is not None and budget <= 0):
            break
        row = existing.get(deal_id)
        data = _json.loads(row["data"]) if row and row["data"] else {}
        tried = set(_json.loads(row["tried"] or "[]")) if row else set()
        for no in order:
            if no in tried:
                continue
            if budget is not None and budget <= 0:
                break
            try:
                text = pf.document(no)
            except DartQuotaExceeded:
                stats["quota_hit"] = True
                log("DART 일일 요청 한도 도달: 남은 원문은 다음 실행에서 이어서 처리합니다.")
                break
            except DartError as exc:
                if exc.status in FATAL_STATUS:
                    raise
                tried.add(no)
                if exc.status != "014":
                    stats["errors"] += 1
                    log(f"원문 조회 오류({no}): {exc}")
                _kind(stats, "조회:" + str(getattr(exc, "status", "") or type(exc).__name__))
                continue
            except Exception as exc:
                stats["errors"] += 1
                tried.add(no)
                log(f"원문 처리 오류({no}): {type(exc).__name__}")
                _kind(stats, "처리:" + type(exc).__name__)
                continue
            tried.add(no)
            if budget is not None:
                budget -= 1
            try:
                got = financials.extract_financials(text)
            except Exception as exc:
                got = None
                _kind(stats, "재무추출:" + type(exc).__name__)
            if got:
                got["src"] = no
                data = got
                break
        store.save_deal_fin(conn, deal_id, corp, data, list(tried), now)
        conn.commit()
        stats["financials"] += 1
    pf.close()
    return budget


VAL_VIEWER_SECTIONS = ("인수인의의견", "공모가격에대한의견", "공모가격결정방법")


def val_text(client, rcept_no: str) -> str:
    """공모가 산정 근거용 원문. 2019년 이전 원문(014)은 공시 뷰어에서 '인수인의 의견' 목차만 받습니다."""
    try:
        return doctext.to_text(client.document(rcept_no))
    except DartError as exc:
        if exc.status != "014" or not hasattr(client, "viewer_html") or os.environ.get("DART_VIEWER") == "0":
            raise
    return doctext.html_to_text(client.viewer_html(rcept_no, sections=VAL_VIEWER_SECTIONS))


def _collect_valuations(client, conn, now, stats, log, workers, budget):
    import json as _json
    plan = store.val_plan(conn, min_year=os.environ.get("VAL_MIN_YEAR", "2020"), max_year=os.environ.get("VAL_MAX_YEAR") or None)
    cap = os.environ.get("VAL_MAX")
    if cap:
        plan = plan[: int(cap)]
    existing = {r["deal_id"]: r for r in conn.execute("SELECT deal_id, data, tried FROM deal_val")}
    first = [order[0] for _, _, order in plan]
    pf = _Prefetch(client, first[: budget if budget is not None else None], workers, ahead=workers * 3, fetch=val_text)
    for deal_id, corp, order in plan:
        if stats["quota_hit"] or (budget is not None and budget <= 0):
            break
        row = existing.get(deal_id)
        data = _json.loads(row["data"]) if row and row["data"] else {}
        tried = set(_json.loads(row["tried"] or "[]")) if row else set()
        for no in order:
            if budget is not None and budget <= 0:
                break
            try:
                text = pf.document(no)
            except DartQuotaExceeded:
                stats["quota_hit"] = True
                log("DART 일일 요청 한도 도달: 남은 원문은 다음 실행에서 이어서 처리합니다.")
                break
            except DartError as exc:
                if exc.status in FATAL_STATUS:
                    raise
                tried.add(no)
                _kind(stats, "조회:" + str(getattr(exc, "status", "") or type(exc).__name__))
                continue
            except Exception as exc:
                stats["errors"] += 1
                tried.add(no)
                _kind(stats, "처리:" + type(exc).__name__)
                continue
            tried.add(no)
            if budget is not None:
                budget -= 1
            try:
                got = doctext.extract_valuation(text)
            except Exception as exc:
                got = {}
                _kind(stats, "평가추출:" + type(exc).__name__)
            if got.get("value") or got.get("disc_low") is not None:
                got["src"] = no
                data = got
                break
        store.save_deal_val(conn, deal_id, corp, data, list(tried), now)
        conn.commit()
        stats["valuations"] += 1
    pf.close()
    return budget


def _kind(stats: dict, key: str) -> None:
    stats["error_kinds"][key] = stats["error_kinds"].get(key, 0) + 1


def now_kst() -> datetime:
    return datetime.now(KST)


def collect(client, conn, bgn: date, end: date, max_corps: int | None = None,
            max_docs: int | None = None, refetch_docs: bool = False, log=print, workers: int = 4,
            lockups: bool = True) -> dict:
    now = now_kst().replace(microsecond=0).isoformat()
    today = now[:10]
    stats = {"filings": 0, "estk_calls": 0, "companies": 0, "deals": 0,
             "docs": 0, "doc_no_match": 0, "results": 0, "quota_hit": False, "errors": 0, "error_kinds": {},
             "unknown_groups": []}

    # 1) 공시 목록 (기간을 80일 단위로 분할)
    for w_bgn, w_end in windows(bgn, end):
        for row in client.list_filings(w_bgn, w_end, pblntf_detail_ty=DETAIL_TYPE_EQUITY_REG):
            store.save_filing(conn, row, now)
            stats["filings"] += 1
    conn.commit()
    log(f"공시 목록 {stats['filings']}건 반영 ({bgn} ~ {end})")

    # 2) 주요정보 미조회 기업별로 증권신고서 주요정보 조회 (오래된 건부터)
    todo = [r["corp_code"] for r in conn.execute(
        "SELECT corp_code FROM filing WHERE doc_kind='reg_equity' AND estk_status IS NULL "
        "GROUP BY corp_code ORDER BY MIN(rcept_dt), corp_code")]
    if max_corps is not None:
        todo = todo[:max_corps]
    for corp in todo:
        try:
            # 구간 안에서 정정 건만 잡힌 기업은 최초 신고서가 구간 이전일 수 있습니다.
            # estkRs는 '최초접수일' 기준이므로 기업별 이력을 먼저 조회해 최초 신고서를 찾습니다.
            known = conn.execute(
                "SELECT MIN(rcept_dt) d FROM filing WHERE corp_code=? AND doc_kind='reg_equity'",
                (corp,)).fetchone()["d"]
            back = date.fromisoformat(known) - timedelta(days=HISTORY_LOOKBACK_DAYS)
            for row in client.list_filings(back, end, pblntf_detail_ty=DETAIL_TYPE_EQUITY_REG,
                                           corp_code=corp):
                store.save_filing(conn, row, now)
            first_dt = conn.execute(
                "SELECT MIN(rcept_dt) d FROM filing WHERE corp_code=? AND doc_kind='reg_equity'",
                (corp,)).fetchone()["d"]
            payload = client.equity_registration(corp, date.fromisoformat(first_dt), end)
            stats["estk_calls"] += 1
        except DartQuotaExceeded:
            stats["quota_hit"] = True
            log("DART 일일 요청 한도 도달: 남은 기업은 다음 실행에서 이어서 처리합니다.")
            break
        except DartError as exc:
            if exc.status in FATAL_STATUS:
                raise
            stats["errors"] += 1
            log(f"주요정보 조회 오류({corp}): {exc}")
            continue
        seen, unknown = store.save_estk(conn, corp, payload, now)
        stats["unknown_groups"] += [u for u in unknown if u not in stats["unknown_groups"]]
        marks = ",".join("?" for _ in seen) or "NULL"
        conn.execute(
            f"UPDATE filing SET estk_status = CASE WHEN rcept_no IN ({marks}) THEN 'ok' ELSE 'missing' END "
            "WHERE corp_code=? AND doc_kind='reg_equity' AND estk_status IS NULL",
            [*seen, corp])
        conn.commit()

    # 3) 딜 집계
    stats["deals"] = store.rebuild_deals(conn, now)
    conn.commit()

    # 3-2) 후보 딜의 확정 신고서(없으면 최신 신고서) 원문에서 희망 밴드·확정가 추출
    if refetch_docs:
        conn.execute("DELETE FROM doc_price WHERE status != 'ok'")
    plan = store.doc_plan(conn)
    budget = max_docs

    def _needs(rcept_no, is_fixed):
        row = conn.execute("SELECT parser_version FROM doc_price WHERE rcept_no=?", (rcept_no,)).fetchone()
        return row is None or (row["parser_version"] or 0) < doctext.PARSER_VERSION
    order = [next((no for no in rc if _needs(no, fx)), None) for _, rc, fx in plan]
    pf = _Prefetch(client, [no for no in order if no][: budget if budget is not None else None], workers)
    for corp, rcepts, is_fixed in plan:
        if stats["quota_hit"] or (budget is not None and budget <= 0):
            break
        for rcept_no in rcepts:
            row = conn.execute("SELECT status, final_price, parser_version FROM doc_price WHERE rcept_no=?",
                               (rcept_no,)).fetchone()
            # 확정 신고서는 수요예측 결과(2차 규칙)까지 읽어야 하므로 구버전 추출 건은 다시 받습니다.
            stale = row is not None and (row["parser_version"] or 0) < doctext.PARSER_VERSION
            if row is None or stale:
                if budget is not None and budget <= 0:
                    break
                try:
                    text = pf.document(rcept_no)
                    parsed = doctext.extract_prices(text)
                    if is_fixed:
                        parsed.update(doctext.extract_demand(text))
                    parsed["parser_version"] = doctext.PARSER_VERSION
                    if not is_fixed:   # 확정 전 신고서는 같은 원문에서 수요예측 기일도 읽어 둡니다(추가 조회 없음).
                        store.save_doc_schedule(conn, rcept_no, corp, doctext.extract_listing_info(text), now)
                except DartQuotaExceeded:
                    stats["quota_hit"] = True
                    log("DART 일일 요청 한도 도달: 남은 원문은 다음 실행에서 이어서 처리합니다.")
                    break
                except DartError as exc:
                    if exc.status in FATAL_STATUS:
                        raise
                    stats["errors"] += 1
                    log(f"원문 조회 오류({rcept_no}): {exc}")
                    _kind(stats, "조회:" + str(getattr(exc, "status", "") or type(exc).__name__))
                    break
                except Exception as exc:  # 손상된 zip 등: 건너뛰고 다음 실행에서 다시 시도
                    stats["errors"] += 1
                    log(f"원문 처리 오류({rcept_no}): {type(exc).__name__}")
                    _kind(stats, "처리:" + type(exc).__name__)
                    break
                store.save_doc_price(conn, rcept_no, corp, parsed, now)
                conn.commit()
                stats["docs"] += 1
                stats["doc_no_match"] += parsed["status"] != "ok"
                if budget is not None:
                    budget -= 1
                row = {"status": parsed["status"], "final_price": parsed["final_price"]}
            # 확정 딜은 확정가가 읽힐 때까지 이전 확정 신고서로 거슬러 올라가고, 그 외는 한 건으로 끝냅니다.
            if not is_fixed or (row["status"] == "ok" and row["final_price"]):
                break
    pf.close()
    if stats["docs"] or refetch_docs:
        store.rebuild_deals(conn, now)
        conn.commit()

    # 3-2b) 확정 전 신고서 원문의 공모일정에서 수요예측 기일
    n_sched = 0
    splan = store.schedule_plan(conn)
    pf = _Prefetch(client, [rc[0] for _, rc in splan][: budget if budget is not None else None], workers)
    for corp, rcepts in splan:
        if stats["quota_hit"] or (budget is not None and budget <= 0):
            break
        for rcept_no in rcepts:
            try:
                parsed = doctext.extract_listing_info(pf.document(rcept_no))
            except DartQuotaExceeded:
                stats["quota_hit"] = True
                log("DART 일일 요청 한도 도달: 남은 원문은 다음 실행에서 이어서 처리합니다.")
                break
            except DartError as exc:
                if exc.status in FATAL_STATUS:
                    raise
                stats["errors"] += 1
                log(f"원문 조회 오류({rcept_no}): {exc}")
                _kind(stats, "조회:" + str(getattr(exc, "status", "") or type(exc).__name__))
                break
            except Exception as exc:
                stats["errors"] += 1
                log(f"원문 처리 오류({rcept_no}): {type(exc).__name__}")
                _kind(stats, "처리:" + type(exc).__name__)
                break
            store.save_doc_schedule(conn, rcept_no, corp, parsed, now)
            conn.commit()
            n_sched += 1
            if budget is not None:
                budget -= 1
            if parsed["status"] == "ok":
                break
    pf.close()
    stats["schedules"] = n_sched
    if n_sched:
        store.rebuild_deals(conn, now)
        conn.commit()

    # 3-3) 증권발행실적보고서에서 상장일·일반청약 경쟁률
    rplan = store.result_plan(conn)
    pf = _Prefetch(client, [no for _, no in rplan][: budget if budget is not None else None], workers)
    for corp, rcept_no in rplan:
        if stats["quota_hit"] or (budget is not None and budget <= 0):
            break
        try:
            parsed = doctext.extract_result(pf.document(rcept_no))
        except DartQuotaExceeded:
            stats["quota_hit"] = True
            log("DART 일일 요청 한도 도달: 남은 원문은 다음 실행에서 이어서 처리합니다.")
            break
        except DartError as exc:
            if exc.status in FATAL_STATUS:
                raise
            stats["errors"] += 1
            log(f"원문 조회 오류({rcept_no}): {exc}")
            _kind(stats, "조회:" + str(getattr(exc, "status", "") or type(exc).__name__))
            continue
        except Exception as exc:
            stats["errors"] += 1
            log(f"원문 처리 오류({rcept_no}): {type(exc).__name__}")
            _kind(stats, "처리:" + type(exc).__name__)
            continue
        store.save_doc_result(conn, rcept_no, corp, parsed, now)
        conn.commit()
        stats["results"] += 1
        if budget is not None:
            budget -= 1
    pf.close()
    if stats["results"]:
        store.rebuild_deals(conn, now)
        conn.commit()

    # 3-4) 투자설명서·신고서 원문에서 유통가능 물량·보호예수·기관 의무보유확약
    stats["lockups"] = 0
    if lockups and not stats["quota_hit"] and (budget is None or budget > 0):
        budget = _collect_lockups(client, conn, now, stats, log, workers, budget)

    # 3-5) 증권신고서·투자설명서 '요약재무정보'의 핵심 재무 수치
    stats["financials"] = 0
    if lockups and not stats["quota_hit"] and (budget is None or budget > 0):
        budget = _collect_financials(client, conn, now, stats, log, workers, budget)

    # 3-6) 증권신고서 '공모가격에 대한 의견'의 공모가 산정 근거
    stats["valuations"] = 0
    if lockups and not stats["quota_hit"] and (budget is None or budget > 0):
        budget = _collect_valuations(client, conn, now, stats, log, workers, budget)

    # 4) IPO 후보 기업 개황 (신규 또는 비상장 상태로 오래된 건만 갱신)
    candidates = [r["corp_code"] for r in conn.execute(
        "SELECT DISTINCT corp_code FROM ipo_deal WHERE is_ipo_candidate=1 ORDER BY corp_code")]
    for corp in candidates:
        if not store.needs_company_refresh(conn, corp, today):
            continue
        try:
            data = client.company(corp)
        except DartQuotaExceeded:
            stats["quota_hit"] = True
            break
        except DartError as exc:
            if exc.status in FATAL_STATUS:
                raise
            stats["errors"] += 1
            continue
        if data:
            store.save_company(conn, corp, data, now)
            stats["companies"] += 1
    conn.commit()

    # 5) 후보가 아닌 기업의 원본 응답 정리, 마지막 수집일 기록
    store.prune_raw(conn)
    store.set_meta(conn, "last_list_date", end.isoformat())
    store.set_meta(conn, "schema_stage", "2")
    conn.commit()

    log("요약: " + ", ".join(f"{k}={v}" for k, v in stats.items()))
    if stats["unknown_groups"]:
        log(f"주의: 알 수 없는 응답 그룹 {stats['unknown_groups']}: 개발가이드와 대조가 필요합니다.")
    return stats
