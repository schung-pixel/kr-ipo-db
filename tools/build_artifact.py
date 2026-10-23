"""docs/ 의 PWA를 데이터까지 담은 단일 HTML(아티팩트용)로 묶습니다.

  python tools/build_artifact.py [출력경로]
"""
import json
import re
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
docs = root / "docs"
out = Path(sys.argv[1] if len(sys.argv) > 1 else root / "artifact.html")

html = (docs / "index.html").read_text(encoding="utf-8")
body = re.search(r"<body>(.*)</body>", html, re.S).group(1)
body = re.sub(r'\s*<script src="app.js"></script>', "", body)
css = (docs / "style.css").read_text(encoding="utf-8")
js = (docs / "app.js").read_text(encoding="utf-8")
data = json.dumps(json.loads((docs / "data" / "deals.json").read_text(encoding="utf-8")),
                  ensure_ascii=False, separators=(",", ":"))
data = data.replace("</", "<\\/")  # script 태그 종료로 오인되지 않도록

page = f"""<title>IPO 공시 DB</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans+KR:wght@400;500;600;700&display=swap">
<style>
{css}
</style>
{body}
<script type="application/json" id="embedded-data">{data}</script>
<script>
{js}
</script>
"""
out.write_text(page, encoding="utf-8")
print(f"{out} {out.stat().st_size / 1e6:.2f}MB")
