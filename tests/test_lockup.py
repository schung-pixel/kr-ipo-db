import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from collector import lockup  # noqa: E402

KOSDAQ = """가. 상장 이후 유통물량 출회에 따른 위험
금번 공모예정주식을 포함한 당사의 상장예정주식수 11,357,737주 중 31.27%에 해당하는 3,551,856주는 상장직후 유통가능 물량에 해당됩니다.
[상장 후 유통제한 및 유통가능주식수 현황] |
구분 | 주주명 | 회사와의 관계 | 공모전 보유주식 | 공모 후 | 매각제한기간(상장일 기준) | 매각제한사유 |
보유주식(A) | 매각제한물량(B) | 유통가능물량(A-B) |
주식수 | 지분율 | 주식수 | 지분율 | 주식수 | 지분율 | 주식수 | 지분율 |
최대주주등 | 박기철 | 대표이사 | 1,330,000 | 14.97% | 1,330,000 | 11.71% | 1,330,000 | 11.71% | 0 | 0.00% | 36개월 | 주1) |
김경수 | 등기임원 | 952,770 | 10.72% | 952,770 | 8.39% | 952,770 | 8.39% | 0 | 0.00% | 36개월 | 주1) |
소계 | 2,282,770 | 25.69% | 2,282,770 | 20.10% | 2,282,770 | 20.10% | 0 | 0.00% | - | - |
5% 이상소유주주 | 엘리스파트너스 11호 벤처투자조합 | 벤처금융 | 913,185 | 10.28% | 913,185 | 8.04% | 456,593 | 4.02% | 0 | 0.00% | 2개월 | 주3) |
456,592 | 4.02% | 3개월 |
공모주주 | 상장주선인 의무인수분 | - | - | - | 4,609,926 | 40.59% | 4,609,926 | 40.59% | 0 | 0.00% | 3개월 | 주5) |
기타주주 | 기타 | - | 3,551,856 | 31.27% | 3,551,856 | 31.27% | 0 | 0.00% | 3,551,856 | 31.27% | - | - |
합계 | | | | | 11,357,737 | 100.00% | 7,805,881 | 68.73% | 3,551,856 | 31.27% | - | - |
주1) | 최대주주등은 36개월간 의무보유합니다. |
[상장 후 유통가능 주식수 현황] |
구분 | 주식수 | 유통가능 주식수 비율 |
상장일 유통가능 | 3,551,856 | 31.27% |
상장 후 1개월 뒤 유통가능 | 3,551,856 | 31.27% |
상장 후 2개월 뒤 유통가능 | 4,008,449 | 35.29% |
상장 후 3개월 뒤 유통가능 | 8,818,841 | 77.65% |
상장 후 36개월 뒤 유통가능 | 11,357,737 | 100.00% |
주1) | 주식수 및 비율은 누적 기준입니다. |
(다) 의무보유확약기간별 수요예측 참여내역
구분 | 외국 기관투자자 | 합계 |
거래실적 유 | 거래실적 무 |
건수 | 수량 | 신청가격 | 건수 | 수량 | 신청가격 | 건수 | 수량 | 신청가격 |
1. 미확약 | 110 | 103,353,000 | 15,300 | - | - | - | 1,605 | 1,320,623,000 | 15,321 |
2. 15일 확약 | 5 | 9,000,000 | 15,300 | - | - | - | 430 | 342,843,000 | 15,306 |
3. 1개월 확약 | - | - | - | - | - | - | 70 | 72,579,000 | 15,300 |
4. 3개월 확약 | - | - | - | - | - | - | 85 | 47,844,000 | 15,300 |
5. 6개월 확약 | - | - | - | - | - | - | 84 | 89,938,000 | 15,315 |
합계 | 115 | 112,353,000 | 15,300 | - | - | - | 2,274 | 1,873,827,000 | 15,317 |
주1) | 인수인과 거래관계가 있는 기관투자자입니다. |
"""

KB_SINGLE = """(다) 의무보유 확약 기관수 및 신청수량
구분 | 참여건수(건) | 신청수량(주) | 비고 |
6개월 확약 | 17 | 5,900,000 | - |
3개월 확약 | 53 | 18,474,000 | - |
1개월 확약 | 54 | 18,848,000 | - |
15일 확약 | 2 | 700,000 | - |
합계 | 126 | 43,922,000 | - |
총 참여건수 및 신청수량 대비 비율 | 8.7% | 8.9% | - |
(라) 주당 확정공모가액의 결정
"""

KOSPI_STATUS = """당사의 상장예정주식수 30,445,200주 중 약 20.45%에 해당하는 6,227,100주는 상장 직후 유통가능 물량입니다.
[공모 후 유통가능 물량 세부내역] |
가능여부 | 구분 | 주주명 | 주식의 종류 | 공모 후 주식수 | 공모 후 지분율 | 의무보유 기간 | 비고 |
유통제한물량 | 최대주주 | 박동석 | 보통주 | 10,965,347 | 36.02% | 상장일로부터 6개월 | 주 1) |
최대주주등 | 강은숙 | 보통주 | 5,836,600 | 19.17% | 상장일로부터 6개월 | 주 1) |
공모주주 | 우리사주조합 | 보통주 | 1,216,000 | 3.99% | 상장일로부터 1년 | 주 2) |
기타 | 상장주선인 의무인수분 | 보통주 | 6,200,153 | 20.37% | 상장일로부터 3개월 | 주 3) |
유통가능물량 | 공모주주 | 보통주 | 6,080,000 | 19.97% | - | - |
기존주주 | 보통주 | 147,100 | 0.48% | - | - |
합계 | 보통주 | 30,445,200 | 100.00% | - | - |
주1) | 최대주주등은 6개월간 의무보유합니다. |
"""


class LockupTest(unittest.TestCase):
    def test_kosdaq_tables(self):
        r = lockup.extract_lockup(KOSDAQ)
        self.assertEqual(r["listed"], 11357737)
        self.assertEqual(r["float0"]["shares"], 3551856)
        self.assertEqual(r["float0"]["pct"], 31.27)
        self.assertEqual([s["months"] for s in r["schedule"]], [1, 2, 3, 36])
        self.assertEqual(r["schedule"][-1]["shares"], 11357737)
        g = {(x["category"], x["months"]): x["shares"] for x in r["groups"]}
        self.assertEqual(g[("최대주주등", 36)], 2282770)
        self.assertEqual(g[("벤처금융·전문투자자", 2)], 456593)
        self.assertEqual(g[("벤처금융·전문투자자", 3)], 456592)
        self.assertEqual(g[("상장주선인 의무인수", 3)], 4609926)
        c = r["commit"]
        self.assertEqual(c["total"], 1873827000)
        self.assertEqual(c["committed"], 342843000 + 72579000 + 47844000 + 89938000)
        self.assertAlmostEqual(c["ratio"], 29.52, places=2)

    def test_single_commit_table(self):
        c = lockup.extract_lockup(KB_SINGLE)["commit"]
        self.assertEqual(c["committed"], 43922000)
        self.assertEqual(c["ratio"], 8.9)
        self.assertIsNone(c["total"])

    def test_status_column(self):
        r = lockup.extract_lockup(KOSPI_STATUS)
        self.assertEqual(r["float0"]["shares"], 6227100)
        g = {(x["category"], x["months"]): x["shares"] for x in r["groups"]}
        self.assertEqual(g[("최대주주등", 6)], 10965347 + 5836600)
        self.assertEqual(g[("우리사주조합", 12)], 1216000)
        self.assertEqual(g[("상장주선인 의무인수", 3)], 6200153)
        # 해제 일정 표가 없으면 검증된 주주별 내역으로 누적 일정을 만듭니다
        self.assertEqual([s["months"] for s in r["schedule"]], [3, 6, 12])
        self.assertEqual(r["schedule"][-1]["shares"], 30445200)

    def test_merge_prefers_newest(self):
        a = {"float0": {"shares": 1, "pct": 1.0}, "status": "ok"}
        b = {"float0": {"shares": 2, "pct": 2.0}, "commit": {"ratio": 5.0}, "status": "ok"}
        m = lockup.merge({}, b, "20240102000001")
        m = lockup.merge(m, a, "20231201000001")   # 더 오래된 원문은 비어 있는 칸만
        self.assertEqual(m["float0"]["shares"], 2)
        self.assertEqual(m["commit"]["ratio"], 5.0)

    def test_merge_keeps_listed_without_float(self):
        m = lockup.merge({}, {"listed": 12548950, "status": "not_found"}, "20250411001507")
        self.assertEqual(m["listed_any"], 12548950)
        self.assertEqual(m["status"], "not_found")

    def test_period_parse(self):
        self.assertEqual(lockup._months("상장일로부터 6개월"), 6)
        self.assertEqual(lockup._months("2년 6개월"), 30)
        self.assertEqual(lockup._months("상장 후 3년"), 36)
        self.assertEqual(lockup._months("15일"), 0.5)
        self.assertIsNone(lockup._months("주1)"))
        self.assertEqual(lockup.period_label(30), "2년 6개월")


if __name__ == "__main__":
    unittest.main()
