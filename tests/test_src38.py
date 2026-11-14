import unittest

from collector import src38
from collector.webexport import _add_bizdays, _bizdays_between, _listing_offset

NW = """<table><tr><td>기업명</td><td>신규상장일</td><td>현재가(원)</td><td>공모가(원)</td></tr>
<tr><td>엠비디</td><td>2026/11/24</td><td>-&nbsp;</td><td>7,000&nbsp;</td></tr>
<tr><td>에스에프씨(유가)</td><td>2026/11/27</td><td>-</td><td>-</td></tr></table>"""
K = """<table><tr><td>종목명</td><td>공모주일정</td><td>확정공모가</td><td>희망공모가</td><td>청약경쟁률</td><td>주간사</td></tr>
<tr><td>&nbsp;엠비디</td><td>2026.11.12~11.13</td><td>7,000</td><td>9,600~11,700</td><td>172:1</td><td>하나증권</td></tr>
<tr><td>&nbsp;하나에어로다이내믹스</td><td>2026.11.10~11.11</td><td>5,700</td><td>4,700~5,700</td><td>1,851.14:1</td><td>IBK투자증권</td></tr>
<tr><td>&nbsp;제논</td><td>2026.12.30~01.02</td><td>-</td><td>-</td><td>&nbsp;</td><td>-</td></tr></table>"""


class Src38Test(unittest.TestCase):
    def test_new_listing(self):
        rows = src38.parse_new_listing(NW)
        self.assertEqual(rows[0]["listing_dt"], "2026-11-24")
        self.assertEqual(rows[1]["name_key"], "에스에프씨")      # '(유가)' 꼬리표 제거

    def test_subscription(self):
        rows = {r["corp_name"]: r for r in src38.parse_subscription(K)}
        self.assertEqual(rows["엠비디"]["retail_ratio"], 172.0)
        self.assertEqual(rows["하나에어로다이내믹스"]["retail_ratio"], 1851.14)
        self.assertEqual(rows["엠비디"]["sub_start"], "2026-11-12")
        self.assertEqual(rows["제논"]["sub_end"], "2027-01-02")   # 연도 넘김
        self.assertIsNone(rows["제논"]["retail_ratio"])

    def test_listing_offset(self):
        from datetime import date
        y = date.today().year
        deals = [{"status": "completed", "payment_raw": f"{y}년 03월 03일", "listing_dt": _add_bizdays(f"{y}-03-03", 5)}] * 20 + \
                [{"status": "completed", "payment_raw": f"{y}년 03월 03일", "listing_dt": _add_bizdays(f"{y}-03-03", 4)}] * 15
        self.assertEqual(_listing_offset(deals), 5)
        self.assertEqual(_listing_offset(deals[:10]), 5)          # 표본 부족 → 기본값
        self.assertEqual(_bizdays_between("2026-11-17", "2026-11-24"), 5)


if __name__ == "__main__":
    unittest.main()
