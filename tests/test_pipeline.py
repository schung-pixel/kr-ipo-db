"""모의 DART 응답으로 파이프라인 전 구간을 검증합니다 (네트워크·인증키 불필요)."""
import io
import os
import sys
import zipfile
import tempfile
import unittest
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from collector import doctext, store  # noqa: E402
from collector.dart import DartQuotaExceeded  # noqa: E402
from collector.parse import classify, extract_ints, price_range, to_int, windows  # noqa: E402
from collector.pipeline import collect  # noqa: E402


def filing(rcept_no, corp_code, name, report_nm, rcept_dt, stock_code="", corp_cls="E", rm=""):
    return {"rcept_no": rcept_no, "corp_code": corp_code, "corp_name": name,
            "report_nm": report_nm, "rcept_dt": rcept_dt, "stock_code": stock_code,
            "corp_cls": corp_cls, "flr_nm": name, "rm": rm}


def estk(corp_code, specs):
    """specs: [{rcept_no, slprc, slta, stkcnt, rpt_rcpn, uw:[(구분, 이름)], sellers:[주식수]}]"""
    groups = {"일반사항": [], "증권의종류": [], "인수인정보": [], "매출인에관한사항": []}
    for s in specs:
        base = {"rcept_no": s["rcept_no"], "corp_cls": "E", "corp_code": corp_code, "corp_name": "x"}
        groups["일반사항"].append({**base, "sbd": "2025-03-20~2025-03-21", "pymd": "2025-03-27",
                               "rpt_rcpn": s.get("rpt_rcpn", "")})
        groups["증권의종류"].append({**base, "stksen": "기명식 보통주", "stkcnt": s["stkcnt"],
                                "fv": "100", "slprc": s["slprc"], "slta": s["slta"],
                                "slmthn": "일반공모"})
        for sen, nm in s.get("uw", []):
            groups["인수인정보"].append({**base, "actsen": sen, "actnmn": nm, "stksen": "기명식 보통주"})
        for n in s.get("sellers", []):
            groups["매출인에관한사항"].append({**base, "hdr": "대주주", "slstk": n})
    return {"status": "000", "group": [{"title": t, "list": rows} for t, rows in groups.items() if rows]}


UW = [("대표주관회사", "가증권"), ("공동주관회사", "나증권"), ("인수회사", "다증권")]

LISTING = [
    filing("20250310000001", "00000001", "에이바이오", "증권신고서(지분증권)", "20250310"),
    filing("20250318000002", "00000001", "에이바이오", "[기재정정]증권신고서(지분증권)", "20250318"),
    filing("20250325000003", "00000001", "에이바이오", "[발행조건확정]증권신고서(지분증권)", "20250325"),
    filing("20250401000004", "00000002", "비상장증자", "증권신고서(지분증권)", "20250401",
           stock_code="123456", corp_cls="K"),
    filing("20250502000005", "00000003", "씨철회", "증권신고서(지분증권)", "20250502", rm="철"),
]

ESTK = {
    # 실제 estkRs는 딜당 마지막 [기재정정] 건 한 행만 돌려줍니다 (최초·발행조건확정 건 없음)
    "00000001": estk("00000001", [
        {"rcept_no": "20250318000002", "slprc": "6,000", "slta": "12,000,000,000",
         "stkcnt": "2,000,000", "uw": UW, "sellers": ["200,000"]},
    ]),
    "00000002": estk("00000002", [
        {"rcept_no": "20250401000004", "slprc": "10,000", "slta": "5,000,000,000",
         "stkcnt": "500,000", "rpt_rcpn": "20250320000099"}]),
    "00000003": estk("00000003", [
        {"rcept_no": "20250502000005", "slprc": "8,000", "slta": "4,000,000,000",
         "stkcnt": "500,000"}]),
}

COMPANIES = {
    "00000001": {"status": "000", "corp_name": "에이바이오", "stock_code": " ", "corp_cls": "E",
                 "induty_code": "21210", "est_dt": "20150601"},
    "00000003": {"status": "000", "corp_name": "씨철회", "stock_code": "", "corp_cls": "E",
                 "induty_code": "21210", "est_dt": "20180101"},
}


# 원문(document.xml) 모의본: 실제 공시의 문구 형태를 그대로 따릅니다.
DOCS = {
    "20250325000003": "<BODY><P>2. 모집 또는 매출 증권의 종류 : 기명식 보통주\n1,800,000주</P>"
                      "<P>3. 모집 또는 매출금액 : 금\n9,900,000,000원</P><P>주당 모집(매출)가액은 대표주관회사와 협의하여 제시한 공모희망가액인 "
                      "5,000원~6,500원 중 최저가액인 5,000원 기준입니다.</P>"
                      "<P>1주당 확정공모가액을\n5,500원으로 최종 결정하였습니다. 확정공모가액 5,500원 기준입니다.</P></BODY>",
    # 확정 직전 기재정정: 공모일정 표의 수요예측 일시 (발행조건확정 신고서에는 이 표가 없음)
    "20250318000002": "<TABLE><TR><TD>수요예측 일시</TD><TD>국내</TD><TD>2025년 03월 19일(수) ~ 03월 24일(월)</TD></TR></TABLE>"
                      "<P>공모희망가액인 5,000원~6,500원</P>",
}


def make_zip(text):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("doc.xml", f"<DOCUMENT>{text}</DOCUMENT>")
    return buf.getvalue()


class FakeClient:
    def __init__(self, quota_after=None, listing=None, estk_data=None, doc_quota_after=None):
        self.quota_after, self.estk_calls = quota_after, 0
        self.doc_quota_after, self.doc_calls = doc_quota_after, 0
        self.listing = LISTING if listing is None else listing
        self.estk_data = ESTK if estk_data is None else estk_data

    def list_filings(self, bgn, end, pblntf_detail_ty=None, corp_code=None):
        for r in self.listing:
            if corp_code and r["corp_code"] != corp_code:
                continue
            if bgn <= date(int(r["rcept_dt"][:4]), int(r["rcept_dt"][4:6]), int(r["rcept_dt"][6:])) <= end:
                yield dict(r)

    def equity_registration(self, corp_code, bgn, end):
        self.estk_calls += 1
        if self.quota_after is not None and self.estk_calls > self.quota_after:
            raise DartQuotaExceeded("020", "limit")
        # 실제 API와 같이 최초접수일이 조회 구간 안에 있는 건만 돌려줍니다.
        rows = [r["rcept_no"] for r in self.listing if r["corp_code"] == corp_code
                and not r["report_nm"].startswith("[")
                and bgn <= date(int(r["rcept_dt"][:4]), int(r["rcept_dt"][4:6]), int(r["rcept_dt"][6:])) <= end]
        return self.estk_data.get(corp_code, {"status": "013", "group": []}) if rows else \
            {"status": "013", "list": [], "group": []}

    def company(self, corp_code):
        return COMPANIES.get(corp_code)

    def document(self, rcept_no):
        self.doc_calls += 1
        if self.doc_quota_after is not None and self.doc_calls > self.doc_quota_after:
            raise DartQuotaExceeded("020", "limit")
        return make_zip(DOCS.get(rcept_no, "해당 문구 없음"))


def run(conn, client=None, **kw):
    return collect(client or FakeClient(), conn, date(2025, 1, 1), date(2025, 6, 30),
                   log=lambda *_: None, **kw)


class ParseTests(unittest.TestCase):
    def test_classify(self):
        a = classify("[기재정정]증권신고서(지분증권)")
        self.assertEqual((a["doc_kind"], a["is_amendment"], a["is_price_fixed"]), ("reg_equity", 1, 0))
        b = classify("[발행조건확정]증권신고서(지분증권)")
        self.assertEqual((b["is_amendment"], b["is_price_fixed"]), (0, 1))
        c = classify("증권신고서(지분증권)")
        self.assertEqual((c["tags"], c["is_amendment"], c["is_price_fixed"]), ("", 0, 0))
        d = classify("[기재정정][정정명령부과]증권신고서(지분증권)")
        self.assertEqual((d["is_amendment"], d["is_correction_order"]), (1, 1))
        self.assertEqual(classify("증권신고서(채무증권)")["doc_kind"], "other")

    def test_numbers(self):
        self.assertEqual(to_int("9,999,999,999"), 9999999999)
        self.assertIsNone(to_int("-"))
        self.assertEqual(extract_ints("5,400원 ~ 6,600원"), [5400, 6600])
        self.assertEqual(price_range("6,600"), (6600, 6600))
        self.assertEqual(price_range("5,400 ~ 6,600"), (5400, 6600))
        self.assertIsNone(price_range("1,2,3 또는 4,5,6 및 7"))

    def test_windows(self):
        chunks = list(windows(date(2025, 1, 1), date(2025, 6, 30)))
        self.assertEqual(chunks[0][0], date(2025, 1, 1))
        self.assertEqual(chunks[-1][1], date(2025, 6, 30))
        for (_, e1), (s2, _) in zip(chunks, chunks[1:]):
            self.assertEqual((s2 - e1).days, 1)
        self.assertTrue(all((e - s).days < 90 for s, e in chunks))


class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.conn = store.connect(":memory:")
        self.addCleanup(self.conn.close)

    def deal(self, corp):
        return self.conn.execute("SELECT * FROM ipo_deal WHERE corp_code=?", (corp,)).fetchone()

    def test_full_run(self):
        stats = run(self.conn)
        self.assertEqual(stats["deals"], 3)
        self.assertFalse(stats["quota_hit"])

        a = self.deal("00000001")
        self.assertEqual(a["status"], "price_fixed")
        self.assertEqual(a["filed_price"], 6000)
        self.assertEqual(a["final_price"], 5500)     # 확정가는 발행조건확정 신고서 원문에서 추출
        self.assertEqual((a["offer_price_low"], a["offer_price_high"]), (5000, 6500))
        self.assertEqual(a["fixed_rcept_no"], "20250325000003")
        self.assertEqual((a["shares_offered"], a["offer_amount"]), (1800000, 9900000000))  # 확정 건 첫머리 값
        self.assertEqual((a["estk_rcept_no"], a["estk_before_fixing"]), ("20250318000002", 1))
        self.assertEqual(a["secondary_shares"], 200000)
        self.assertEqual(a["amendment_count"], 2)
        self.assertEqual(a["is_ipo_candidate"], 1)
        self.assertEqual((a["lead_underwriters"], a["co_underwriters"]), ("가증권", "나증권"))
        self.assertEqual(a["deal_id"], "00000001_20250310000001")

        self.assertEqual(self.deal("00000002")["is_ipo_candidate"], 0)
        self.assertEqual(self.deal("00000003")["status"], "withdrawn")

        src = {r["field_name"]: r for r in self.conn.execute(
            "SELECT * FROM field_source WHERE deal_id=?", (a["deal_id"],))}
        self.assertEqual(src["filed_price"]["rcept_no"], "20250318000002")
        self.assertEqual(src["filed_price"]["evidence"], "6,000")
        self.assertEqual((src["final_price"]["method"], src["final_price"]["rcept_no"]),
                         ("DOC", "20250325000003"))
        self.assertIn("5,500원", src["final_price"]["evidence"])
        self.assertEqual(src["offer_price_low"]["value"], "5000")

        # 후보 기업만 원본 보존, 개황은 후보만 조회
        raw = {r["corp_code"] for r in self.conn.execute("SELECT corp_code FROM dart_raw")}
        self.assertEqual(raw, {"00000001", "00000003"})
        self.assertEqual(self.conn.execute("SELECT COUNT(*) c FROM company").fetchone()["c"], 2)
        self.assertIsNone(self.conn.execute(
            "SELECT stock_code FROM company WHERE corp_code='00000001'").fetchone()["stock_code"])

    def test_idempotent(self):
        run(self.conn)
        snapshot = "\n".join(self.conn.iterdump())
        run(self.conn)
        self.assertEqual(snapshot.count("INSERT INTO"), "\n".join(self.conn.iterdump()).count("INSERT INTO"))
        self.assertEqual(self.conn.execute("SELECT COUNT(*) c FROM field_source").fetchone()["c"],
                         snapshot.count('INSERT INTO "field_source"'))
        self.assertGreater(snapshot.count('INSERT INTO "field_source"'), 0)

    def test_quota_resume(self):
        first = run(self.conn, FakeClient(quota_after=1))
        self.assertTrue(first["quota_hit"])
        self.assertEqual(self.deal("00000001")["is_ipo_candidate"], 1)
        self.assertIsNone(self.deal("00000002")["is_ipo_candidate"])  # 아직 미조회

        second = run(self.conn)
        self.assertFalse(second["quota_hit"])
        self.assertEqual(second["estk_calls"], 2)  # 남은 두 기업만 조회
        self.assertEqual(self.deal("00000002")["is_ipo_candidate"], 0)
        self.assertEqual(self.deal("00000003")["status"], "withdrawn")

    def test_original_before_window(self):
        """구간 안에는 정정 건만 있어도 기업별 이력 조회로 최초 신고서를 찾아 한 건의 딜로 묶습니다."""
        listing = [
            filing("20241220000001", "00000004", "디바이오", "증권신고서(지분증권)", "20241220"),
            filing("20250110000002", "00000004", "디바이오", "[기재정정]증권신고서(지분증권)", "20250110"),
        ]
        data = {"00000004": estk("00000004", [
            {"rcept_no": "20241220000001", "slprc": "7,000 ~ 8,000", "slta": "8,000,000,000",
             "stkcnt": "1,000,000", "uw": UW},
            {"rcept_no": "20250110000002", "slprc": "7,000 ~ 8,000", "slta": "8,000,000,000",
             "stkcnt": "1,000,000", "uw": UW}])}
        client = FakeClient(listing=listing, estk_data=data)
        collect(client, self.conn, date(2025, 1, 1), date(2025, 3, 31), log=lambda *_: None)
        deals = self.conn.execute("SELECT * FROM ipo_deal").fetchall()
        self.assertEqual(len(deals), 1)
        self.assertEqual(deals[0]["deal_id"], "00000004_20241220000001")
        self.assertEqual(deals[0]["is_ipo_candidate"], 1)
        self.assertEqual((deals[0]["offer_price_low"], deals[0]["offer_price_high"]), (7000, 8000))

    def test_orphan_deal_cleanup(self):
        """먼저 정정 건만으로 만들어진 딜은 최초 신고서 확인 후 정리됩니다."""
        self.conn.execute("INSERT INTO ipo_deal (deal_id, corp_code) VALUES ('00000004_20250110000002', '00000004')")
        self.conn.execute("INSERT INTO field_source (deal_id, field_name) VALUES ('00000004_20250110000002', 'x')")
        self.test_original_before_window()
        self.assertEqual(self.conn.execute("SELECT COUNT(*) c FROM field_source").fetchone()["c"], 0 +
                         self.conn.execute("SELECT COUNT(*) c FROM field_source WHERE deal_id LIKE '00000004_2024%'").fetchone()["c"])

    def test_export_restore(self):
        run(self.conn)
        with tempfile.TemporaryDirectory() as tmp:
            sql, db = os.path.join(tmp, "ipo.sql"), os.path.join(tmp, "ipo.db")
            store.export_sql(self.conn, sql)
            store.restore_sql(db, sql)
            restored = store.connect(db)
            self.assertEqual(restored.execute("SELECT COUNT(*) c FROM ipo_deal").fetchone()["c"], 3)
            self.assertEqual(restored.execute(
                "SELECT filed_price FROM ipo_deal WHERE corp_code='00000001'").fetchone()[0], 6000)
            restored.close()

    def test_doctext_patterns(self):
        e = doctext.extract_prices("공모희망가액인 54,500원~66,300원 중 최저가액인 54,500원 기준. "
                                   "결정한 확정공모가액 66,300원 기준입니다.")
        self.assertEqual((e["band_low"], e["band_high"], e["final_price"], e["status"]),
                         (54500, 66300, 66300, "ok"))
        e = doctext.extract_prices("2. 모집 또는 매출 증권의 종류 : 기명식 보통주\n654,000주\n3. 모집 또는 매출금액 : 금\n"
                                   "43,360,200,000원\n4. 정정사유")
        self.assertEqual((e["header_shares"], e["header_amount"]), (654000, 43360200000))
        e = doctext.extract_prices("2. 모집 또는 매출 증권의 종류 : 기명식 보통주\n3. 모집 또는 매출금액 : 17,693,000,000원")
        self.assertEqual((e["header_shares"], e["header_amount"]), (None, 17693000000))
        e = doctext.extract_prices("확정공모가액인13,000원 기준. 1주당 확정공모가액을\n13,000원으로 최종 결정")
        self.assertEqual((e["band_low"], e["final_price"]), (None, 13000))
        e = doctext.extract_prices("공모희망가액인 2,000원 기준입니다. 확정공모가액인 2,000원")  # 스팩: 단일가
        self.assertEqual((e["band_low"], e["band_high"], e["final_price"]), (2000, 2000, 2000))
        e = doctext.extract_prices("공모희망가액 20,000원 ~ 17,000원")  # 역순 범위는 버림
        self.assertEqual(e["band_low"], None)
        e = doctext.extract_prices("확정공모가액 기준 40,830주")  # 가격이 아닌 숫자는 무시
        self.assertEqual((e["final_price"], e["status"]), (None, "no_match"))
        e = doctext.extract_prices("공모희망가액 10,000원~12,000원, 공모희망가액 9,000원~11,000원, 공모희망가액 9,000원~11,000원")
        self.assertEqual((e["band_low"], e["n_values"]), (9000, 2))   # 최빈값 채택, 불일치는 검수 표시

    def test_schedule_patterns(self):
        ex = doctext.extract_schedule
        self.assertEqual(ex("수요예측일 | 2025.09.16(화) ~ 2025.09.17(수) | 2일간")["demand_end"], "2025-09-17")
        r = ex("수요예측 일시 | 2026년 12월 30일(수) ~ 01월 05일(화) |")
        self.assertEqual((r["demand_start"], r["demand_end"]), ("2026-12-30", "2027-01-05"))   # 연도 넘김
        self.assertEqual(ex("수요예측 일시 | 2025년 07월 03일(목) | 주1)")["demand_end"], "2025-07-03")
        self.assertEqual(ex("수요예측일 현재 한국금융투자협회 홈페이지에 2025년 1월 21일")["status"], "no_match")

    def test_doc_phase_idempotent_and_quota(self):
        client = FakeClient()
        run(self.conn, client)
        first = client.doc_calls
        self.assertEqual(first, 3)                        # 후보 2건의 대상 문서 + 에이바이오 확정 전 신고서(수요예측 기일)
        a = self.deal("00000001")
        self.assertEqual((a["demand_start"], a["demand_end"]), ("2025-03-19", "2025-03-24"))
        status = {r["rcept_no"]: r["status"] for r in self.conn.execute("SELECT * FROM doc_price")}
        self.assertEqual(status, {"20250325000003": "ok", "20250502000005": "no_match"})
        run(self.conn, client)
        self.assertEqual(client.doc_calls, first)         # 재실행 시 다시 받지 않음
        stats = run(self.conn, client, refetch_docs=True)  # 실패 건만 재조회
        self.assertEqual(client.doc_calls, first + 1)
        self.assertEqual(stats["doc_no_match"], 1)

        conn2 = store.connect(":memory:")
        self.addCleanup(conn2.close)
        stats = run(conn2, FakeClient(doc_quota_after=1))
        self.assertTrue(stats["quota_hit"])
        self.assertEqual(conn2.execute("SELECT COUNT(*) FROM doc_price").fetchone()[0], 1)
        stats = run(conn2, FakeClient())                  # 다음 실행에서 이어서 처리
        self.assertEqual(conn2.execute("SELECT COUNT(*) FROM doc_price").fetchone()[0], 2)

    def test_multiple_fixed_filings_and_doc_signal(self):
        listing = LISTING + [filing("20250326000009", "00000001", "에이바이오",
                                    "[발행조건확정]증권신고서(지분증권)", "20250326")]
        client = FakeClient(listing=listing)
        run(self.conn, client)
        a = self.deal("00000001")
        self.assertEqual(a["fixed_rcept_no"], "20250326000009")      # 마지막 확정 건은 단순 정정
        self.assertEqual(a["final_price"], 5500)                      # 이전 확정 건 원문에서 추출
        self.assertEqual((a["offer_price_low"], a["offer_price_high"]), (5000, 6500))
        self.assertEqual(a["doc_signal"], 1)
        self.assertEqual(client.doc_calls, 4)                         # 마지막 건(실패) → 이전 건(성공), 씨철회 1건, 수요예측 기일 1건
        src = {r["field_name"]: r for r in self.conn.execute(
            "SELECT * FROM field_source WHERE deal_id=?", (a["deal_id"],))}
        self.assertEqual(src["final_price"]["rcept_no"], "20250325000003")
        c = self.deal("00000003")
        self.assertEqual(c["doc_signal"], 0)
        self.assertIn("문구 없음", c["ipo_basis"])
        run(self.conn, client)
        self.assertEqual(client.doc_calls, 4)                         # 재실행 시 추가 조회 없음

    def test_amount_mismatch_uses_computed(self):
        # 머리말 금액(5,000원×주식수가 아닌 정정 전 값)이 어긋나면 확정가×주식수로 계산합니다.
        DOCS["20250325000003"] = DOCS["20250325000003"].replace("9,900,000,000원", "8,100,000,000원")
        self.addCleanup(lambda: DOCS.__setitem__("20250325000003", DOCS["20250325000003"].replace("8,100,000,000원", "9,900,000,000원")))
        run(self.conn)
        a = self.deal("00000001")
        self.assertEqual((a["shares_offered"], a["offer_amount"]), (1800000, 9900000000))  # 5,500 × 1,800,000
        src = {r["field_name"]: r for r in self.conn.execute("SELECT * FROM field_source WHERE deal_id=?", (a["deal_id"],))}
        self.assertIn("불일치", src["offer_amount"]["evidence"])

    def test_refiling_after_withdrawal_and_results(self):
        # 첫 공모 철회 → [첨부추가]로 재신고 → 확정 → 발행실적보고서 (에스투더블유 사례)
        c = "00000004"
        extra = [
            filing("20250102000101", c, "디재신고", "증권신고서(지분증권)", "20250102", rm="정철"),
            filing("20250110000102", c, "디재신고", "[기재정정]증권신고서(지분증권)", "20250110", rm="정철"),
            filing("20250115000103", c, "디재신고", "[발행조건확정]증권신고서(지분증권)", "20250115", rm="철"),
            filing("20250116000104", c, "디재신고", "철회신고서", "20250116"),
            filing("20250120000105", c, "디재신고", "[첨부추가]증권신고서(지분증권)", "20250120", rm="정"),
            filing("20250201000106", c, "디재신고", "[기재정정]증권신고서(지분증권)", "20250201", rm="정"),
            filing("20250210000107", c, "디재신고", "[발행조건확정]증권신고서(지분증권)", "20250210"),
            filing("20250217000108", c, "디재신고", "증권발행실적보고서", "20250217"),
        ]
        estk_data = dict(ESTK)
        estk_data[c] = estk(c, [
            {"rcept_no": "20250110000102", "slprc": "9,000", "slta": "9,000,000,000", "stkcnt": "1,000,000"},
            {"rcept_no": "20250201000106", "slprc": "8,000", "slta": "8,000,000,000", "stkcnt": "1,000,000"}])
        DOCS.update({
            "20250210000107": "<P>공모희망가액인 8,000원~9,000원 중 최저가액인 8,000원 기준</P><P>확정공모가액 9,000원 기준</P>"
                              "<P>(13) 수요예측 결과 (가) 수요예측 참여내역</P><TABLE><TR><TD>구분</TD><TD>합계</TD></TR>"
                              "<TR><TD>건수</TD><TD>100</TD><TD>2,000</TD></TR><TR><TD>수량</TD><TD>1</TD><TD>2</TD></TR>"
                              "<TR><TD>경쟁률</TD><TD>12.50</TD><TD>1,145.40</TD></TR></TABLE>",
            "20250217000108": "<P>3. 청약 및 배정현황</P><TABLE><TR><TD>구 분</TD></TR>"
                              "<TR><TD>일반투자자</TD><TD>250,000</TD><TD>25.0</TD><TD>100,000</TD><TD>300,000,000</TD>"
                              "<TD>1,350,000,000,000</TD><TD>30</TD></TR></TABLE>"
                              "<P>3. 상장일(매매개시일)2025년 02월 20일 (예정)</P>",
        })
        self.addCleanup(lambda: [DOCS.pop(k, None) for k in ("20250210000107", "20250217000108")])
        client = FakeClient(listing=LISTING + extra, estk_data=estk_data)
        run(self.conn, client)
        deals = self.conn.execute("SELECT * FROM ipo_deal WHERE corp_code=? ORDER BY first_rcept_no", (c,)).fetchall()
        self.assertEqual([d["deal_id"] for d in deals], [f"{c}_20250102000101", f"{c}_20250120000105"])
        first, second = deals
        self.assertEqual(first["status"], "withdrawn")
        self.assertEqual(second["status"], "completed")
        self.assertEqual((second["final_price"], second["offer_price_low"], second["offer_price_high"]), (9000, 8000, 9000))
        self.assertEqual((second["inst_demand_ratio"], second["inst_demand_count"]), (1145.4, 2000))
        self.assertEqual((second["retail_ratio"], second["retail_count"]), (1200.0, 100000))   # 300,000,000 ÷ 250,000
        self.assertEqual(second["listing_dt"], "2025-02-20")
        # 다시 돌려도 추가 조회 없음
        calls = client.doc_calls
        run(self.conn, client)
        self.assertEqual(client.doc_calls, calls)

    def test_export_json(self):
        import json
        from collector import webexport
        run(self.conn)
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "deals.json")
            self.assertTrue(webexport.export_json(self.conn, path, "2025-04-01T00:00:00+09:00"))
            data = json.loads(Path(path).read_text(encoding="utf-8"))
            self.assertEqual(len(data["deals"]), 1)   # IPO만: 유상증자(비후보)·원문 문구 없는 후보 제외
            a = next(d for d in data["deals"] if d["corp_code"] == "00000001")
            self.assertEqual(a["filed_price"], 6000)
            self.assertEqual([f["rcept_no"] for f in a["filings"]][0], a["first_rcept_no"])
            self.assertEqual(len(a["filings"]), 3)
            self.assertEqual(a["underwriters"][0]["actnmn"], "가증권")
            self.assertTrue(any(s["field_name"] == "filed_price" for s in a["sources"]))
            # 내용이 같으면 다시 쓰지 않음(생성 시각만 달라진 경우 포함)
            self.assertFalse(webexport.export_json(self.conn, path, "2025-04-02T00:00:00+09:00"))
            self.assertEqual(json.loads(Path(path).read_text(encoding="utf-8"))["generated_at"],
                             "2025-04-01T00:00:00+09:00")


if __name__ == "__main__":
    unittest.main()
