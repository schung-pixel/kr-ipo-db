import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from collector import doctext  # noqa: E402


class RatingTest(unittest.TestCase):
    def test_konex_single(self):
        t = ("한국거래소가 지정한 전문평가기관인 한국발명진흥회 및 나이스디앤비로부터 평가를 받아 각각 A등급과 BB등급을 획득하였습니다. "
             "당사는 제출일 현재 코넥스시장 상장법인으로 코스닥시장 상장규정 제28조 제1항 제1호 가항 3호를 적용받아 "
             "1개의 평가기관에서 A등급을 받아 요건을 충족하였습니다.")
        r = doctext.extract_rating(t)
        self.assertEqual(r["tech_grades"], "A, BB")
        self.assertEqual(r["tech_mode"], "단수평가(코넥스)")

    def test_market_cap_single(self):
        t = ("시장평가 우수기업 기술평가 절차 간소화를 적용 받아 상장을 추진하기 위해 기술평가를 신청하였으며, "
             "한국거래소가 지정한 전문평가기관 1곳(기술보증기금)으로부터 A등급을 통보받았습니다. 일반 요건은 2개 기관 A등급 및 BBB등급 이상입니다.")
        r = doctext.extract_rating(t)
        self.assertEqual(r["tech_grades"], "A")
        self.assertEqual(r["tech_mode"], "단수평가(시장평가 우수기업)")

    def test_reevaluation(self):
        t = ("전문평가기관 기술평가를 받았으며, 최초 평가 시 2개 기관으로부터 A, BB 등급을 통보받았습니다. "
             "재평가를 신청하여 또 다른 2개의 전문평가기관으로부터 A, A 등급을 획득한 바 있습니다.")
        r = doctext.extract_rating(t)
        self.assertEqual(r["tech_grades"], "A, A")
        self.assertEqual(r["tech_mode"], "재평가")

    def test_regular_pair_and_requirement_text(self):
        t = ("요건: 전문평가기관 2개 기관으로부터 A등급 및 BBB등급 이상. "
             "당사는 전문평가기관인 기술보증기금 및 나이스디앤비로부터 각각 A등급과 BBB등급을 받았습니다.")
        r = doctext.extract_rating(t)
        self.assertEqual(r["tech_grades"], "A, BBB")
        self.assertIsNone(r["tech_mode"])


if __name__ == "__main__":
    unittest.main()
