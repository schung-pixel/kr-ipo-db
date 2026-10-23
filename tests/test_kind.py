"""KIND 예비심사 수집: 표 해석, 회사명 연결, 미신고 승인 건 선별, 내보내기."""
import io
import json
import os
import sys
import tempfile
import unittest
import zipfile
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from collector import kind, store, webexport  # noqa: E402

# KIND 목록 화면과 같은 형태의 표 (머리글 + 행, 회사명 칸에 title 속성)
HTML = """
<table class="list type-00 tmt30">
<thead><tr><th>번호</th><th>회사명</th><th>청구일</th><th>심사결과</th><th>결과확정일</th>
<th>시장구분</th><th>상장유형</th><th>상장주선인</th><th>업종</th></tr></thead>
<tbody>
<tr><td>1</td><td title="(주)알파바이오"><a href="#">알파바이오</a></td><td>2026-06-02</td><td>승인</td><td>2026-09-10</td>
<td>코스닥</td><td>신규상장(기술성장)</td><td>하나증권</td><td>의약품</td></tr>
<tr><td>2</td><td title="베타메드"><a href="#">베타메드</a></td><td>2026-05-11</td><td>미승인</td><td>2026-08-20</td>
<td>코스닥</td><td>신규상장</td><td>NH투자증권</td><td>의료기기</td></tr>
<tr><td>3</td><td>감마테크 주식회사</td><td>2026-04-01</td><td>승인</td><td>2026-07-01</td>
<td>유가증권</td><td>신규상장</td><td>미래에셋증권</td><td>IT</td></tr>
<tr><td>4</td><td>델타로보</td><td>2025-10-01</td><td>승인</td><td>2025-12-20</td>
<td>코스닥</td><td>신규상장</td><td>대신증권</td><td>로봇</td></tr>
<tr><td>5</td><td>엡실론</td><td>2026-09-01</td><td>심사중</td><td></td>
<td>코스닥</td><td>신규상장</td><td>KB증권</td><td>소재</td></tr>
</tbody></table>"""


# 실제 KIND 응답 형태: 머리글 칸은 비어 있고 열 순서는 summary에, 시장은 아이콘 alt에만 있음
LIVE = """
<table class="list type-00 tmt30" summary="회사명, 상장유형, 청구일, 결과확정일, 심사결과, 상장주선인">
<thead><tr class="first" id="title-contents"></tr></thead><tbody>
<tr class="first" onclick="fnDetailView('20260114000323')"><td class="first" title="럭스코">
<img src='../images/common/icn_t_ko.gif' alt='코스닥' /> 럭스코 </td>
<td class="txc">스팩 소멸합병</td><td class="txc">2026-06-19</td><td class="txc">2026-09-28</td><td class="txc">심사 승인</td><td class="txl">IBK투자증권(주)</td></tr>
<tr><td class="first" title="(주)태석광학"><img alt='유가증권' /> (주)태석광학</td>
<td class="txc">신규상장</td><td class="txc">2026-09-14</td><td class="txc">2026-10-13</td><td class="txc">심사 승인</td><td class="txl">신한투자증권 주식회사,대신증권(주)</td></tr>
<tr><td class="first">상장끝</td><td class="txc">신규상장</td><td class="txc">2026-03-02</td><td class="txc">2026-05-02</td><td class="txc">상장 승인</td><td class="txl">KB증권(주)</td></tr>
<tr><td class="first">접수중</td><td class="txc">신규상장</td><td class="txc">2026-10-02</td><td class="txc"></td><td class="txc">청구서 접수</td><td class="txl">KB증권(주)</td></tr>
</tbody></table>"""


class KindTests(unittest.TestCase):
    def test_parse_live_layout(self):
        rows = kind.parse_html(LIVE)
        self.assertEqual(len(rows), 4)
        t = rows[1]
        self.assertEqual((t["corp_name"], t["listing_type"], t["filed_dt"], t["decided_dt"], t["result"], t["market"], t["sponsor"]),
                         ("(주)태석광학", "신규상장", "2026-09-14", "2026-10-13", "심사 승인", "유가증권", "신한투자증권, 대신증권"))
        self.assertEqual(rows[0]["market"], "코스닥")
        kind.save_rows(self.conn, rows, "kind", "2026-10-24T00:00:00+09:00")
        names = [r["corp_name"] for r in kind.pending_approvals(self.conn, [], date(2026, 10, 24))]
        self.assertEqual(names, ["(주)태석광학"])   # 스팩 합병·상장 완료·접수 중 제외


    def setUp(self):
        self.conn = store.connect(":memory:")
        self.addCleanup(self.conn.close)

    def test_name_key(self):
        self.assertEqual(kind.name_key("(주)알파바이오"), kind.name_key("알파바이오 주식회사"))
        self.assertEqual(kind.name_key("Simwon America Corp."), "simwonamerica")
        self.assertEqual(kind.name_key("형지I&C"), "형지i&c")

    def test_parse_html(self):
        rows = kind.parse_html(HTML)
        self.assertEqual(len(rows), 5)
        a = rows[0]
        self.assertEqual((a["corp_name"], a["filed_dt"], a["decided_dt"], a["result"], a["market"], a["sponsor"]),
                         ("알파바이오", "2026-06-02", "2026-09-10", "승인", "코스닥", "하나증권"))
        self.assertEqual(rows[4]["decided_dt"], None)
        self.assertEqual([kind.is_approved(r) for r in rows], [True, False, True, True, False])
        self.assertEqual(kind.parse_html("<p>조회된 결과값이 없습니다.</p>"), [])

    def test_manual_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, "kind.xls").write_text(HTML, encoding="cp949", errors="ignore")
            Path(tmp, "kind.csv").write_text("회사명,청구일,심사결과,결과확정일\n오메가,2026-08-01,승인,2026-10-01\n", encoding="utf-8-sig")
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, "w") as z:
                z.writestr("xl/sharedStrings.xml", "<sst><si><t>회사명</t></si><si><t>청구일</t></si><si><t>심사결과</t></si>"
                                                   "<si><t>제타</t></si><si><t>2026-07-01</t></si><si><t>승인</t></si></sst>")
                z.writestr("xl/worksheets/sheet1.xml", '<worksheet><sheetData>'
                           '<row><c t="s"><v>0</v></c><c t="s"><v>1</v></c><c t="s"><v>2</v></c></row>'
                           '<row><c t="s"><v>3</v></c><c t="s"><v>4</v></c><c t="s"><v>5</v></c></row></sheetData></worksheet>')
            Path(tmp, "kind2.xlsx").write_bytes(buf.getvalue())
            Path(tmp, "_last_response.html").write_text(HTML, encoding="utf-8")   # 진단용 파일은 읽지 않음
            n = kind.load_manual(self.conn, Path(tmp), "2026-10-24T00:00:00+09:00", log=lambda *_: None)
        self.assertEqual(n, 7)
        names = {r["corp_name"] for r in self.conn.execute("SELECT corp_name FROM kind_review")}
        self.assertTrue({"알파바이오", "오메가", "제타"} <= names)

    def test_pending_and_export(self):
        kind.save_rows(self.conn, kind.parse_html(HTML), "kind", "2026-10-24T00:00:00+09:00")
        store.set_meta(self.conn, "last_list_date", "2026-10-23")
        # 감마테크는 승인 후 증권신고서를 냈으므로 DART 딜로 존재 → 예심 승인 목록에서 제외
        self.conn.execute("INSERT INTO filing (rcept_no, corp_code, corp_name, report_nm, rcept_dt, doc_kind, tags) "
                          "VALUES ('20260801000001','99999999','감마테크(주)','증권신고서(지분증권)','2026-08-01','reg_equity','')")
        self.conn.execute("INSERT INTO ipo_deal (deal_id, corp_code, first_rcept_no, first_filing_dt, status, is_ipo_candidate) "
                          "VALUES ('99999999_20260801000001','99999999','20260801000001','2026-08-01','filed',1)")
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "deals.json")
            webexport.export_json(self.conn, path, "2026-10-24T00:00:00+09:00")
            data = json.loads(Path(path).read_text(encoding="utf-8"))
        # 알파바이오: 승인·미신고·6개월 이내 → 포함 / 델타로보: 승인 후 6개월 경과 → 제외 / 베타·엡실론: 미승인·심사중 → 제외
        self.assertEqual([a["corp_name"] for a in data["approvals"]], ["알파바이오"])
        a = data["approvals"][0]
        self.assertEqual((a["status"], a["first_filing_dt"], a["lead_underwriters"], a["market"]),
                         ("approved", "2026-09-10", "하나증권", "코스닥"))
        g = next(d for d in data["deals"] if d["deal_id"].startswith("99999999"))
        self.assertEqual((g["prelim"]["filed_dt"], g["prelim"]["decided_dt"]), ("2026-04-01", "2026-07-01"))

    def test_fetch_uses_post_and_parses(self):
        calls = {}

        class Resp:
            text, encoding = HTML, "utf-8"
            def raise_for_status(self): pass

        class Sess:
            def post(self, url, data=None, headers=None, timeout=None):
                calls.update(url=url, data=data, headers=headers)
                return Resp()
        rows, html = kind.fetch(session=Sess(), today=date(2026, 10, 24))
        self.assertEqual(len(rows), 5)
        self.assertTrue(calls["url"].endswith("listinvstg/listinvstgcom.do"))
        self.assertEqual(calls["data"]["method"], "searchListInvstgCorpSub")
        self.assertIn("Referer", calls["headers"])


if __name__ == "__main__":
    unittest.main()
