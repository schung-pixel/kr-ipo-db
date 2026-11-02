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
