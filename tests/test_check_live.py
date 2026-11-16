import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class CheckLiveTest(unittest.TestCase):
    def test_built_page_matches_repo_and_edit_is_flagged(self):
        with tempfile.TemporaryDirectory() as td:
            out = Path(td) / "a.html"
            subprocess.run([sys.executable, str(ROOT / "tools/build_artifact.py"), str(out)], check=True, capture_output=True)
            # 게시 플랫폼이 덧붙이는 문서 골격을 흉내 냅니다.
            out.write_text("<!doctype html><html><head><style>body{margin:0}</style></head><body>\n" + out.read_text(encoding="utf-8") + "\n</body></html>", encoding="utf-8")
            ok = subprocess.run([sys.executable, str(ROOT / "tools/check_live.py"), str(out)], capture_output=True, text=True)
            self.assertEqual(ok.returncode, 0, ok.stdout)
            out.write_text(out.read_text(encoding="utf-8").replace("function briefing(today) {", "function briefing(today) { var x = 1;", 1), encoding="utf-8")
            bad = subprocess.run([sys.executable, str(ROOT / "tools/check_live.py"), str(out)], capture_output=True, text=True)
            self.assertEqual(bad.returncode, 2, bad.stdout)


if __name__ == "__main__":
    unittest.main()
