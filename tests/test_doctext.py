import unittest
from collector import doctext


class RowValuesTest(unittest.TestCase):
    def test_multiline_cells(self):
        t = ("(가) 수요예측 참여내역\n구 분 |\n합 계 |\n건수 |\n488 |\n1,988 |\n수량 |\n1 |\n"
             "경쟁률 |\n586.97 |\n2,023.37 |\n주1) |\n설명 |")
        d = doctext.extract_demand(t)
        self.assertEqual(d["inst_ratio"], 2023.37)
        self.assertEqual(d["inst_count"], 1988)

    def test_single_line_stops_at_row_end(self):
        t = "수요예측 참여내역\n건수 | 10 | 20 |\n경쟁률 | 1.5 | 42.0 ; 1 |\n계 | 999 |"
        d = doctext.extract_demand(t)
        self.assertEqual(d["inst_ratio"], 42.0)
        self.assertEqual(d["inst_count"], 20)

    def test_retail_multiline(self):
        t = ("청약 및 배정현황\n일반투자자 |\n10,625,000 |\n25.0 |\n4,424,470 |\n760,710,960 |\n"
             "228,213,288,000,000 |\n96.0 |\n4,105,303 |\n10,970,482 |\n3,291,144,600,000 |\n25.8 |\n계 |\n1 |")
        r = doctext.extract_result(t)
        self.assertEqual(r["retail_ratio"], 71.6)
        self.assertEqual(r["retail_count"], 4424470)


if __name__ == "__main__":
    unittest.main()


class ValuationTest(unittest.TestCase):
    def test_per_table(self):
        t = ("[PER에 의한 ㈜가나의 평가가치] | 구분 | 내용 | 적용 PER | (D) | 11.55배 | - | 주당 평가가액 | 4,470원 | - |\n"
             "주당 평가가액을 기초로 하여 31.00% ~ 20.00%의 할인율을 적용하여")
        v = doctext.extract_valuation(t)
        self.assertEqual((v["method"], v["multiple"], v["value"], v["disc_low"], v["disc_high"]), ("PER", 11.55, 4470, 20.0, 31.0))

    def test_ev_ebitda_mode(self):
        t = ("적용 EV/EBITDA 거래배수 | 51.4 | 자료 |\n적용 EV/EBITDA 거래배수 | 51.4 | 자료 |\n"
             "[참고] 적용 EV/EBITDA 거래배수 | 82.5 | 자료 |\n주당 평가가액 | (G) = (A) / (F) | 479,514원 |")
        v = doctext.extract_valuation(t)
        self.assertEqual((v["method"], v["multiple"], v["value"]), ("EV/EBITDA", 51.4, 479514))

    def test_future_earnings(self):
        t = ("2027년 추정 순이익 | 11,972백만원 | 연할인율 | 20.0% | B |\n적용 PER(배) | 평균 | 27.49 | 주1)")
        v = doctext.extract_valuation(t)
        self.assertEqual((v["basis"], v["pv_rate"], v["multiple"]), ("2027년 추정 순이익", 20.0, 27.49))
