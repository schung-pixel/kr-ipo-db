"""게시 중인 아티팩트의 앱 코드가 저장소 이력에 있는지 확인합니다.

  python tools/check_live.py <게시본.html>

아티팩트는 tools/build_artifact.py 로 저장소 코드(docs/index.html, style.css, app.js)를 묶어 만듭니다.
다른 대화가 아티팩트에만 게시하고 저장소에 push하지 않은 수정이 있으면, 저장소 기준으로 다시 만들 때
그 수정이 사라집니다. 이 스크립트는 게시본에서 코드 부분만 떼어 최근 커밋들의 코드와 비교합니다.

종료 코드: 0 = 저장소 이력에 있는 코드(덮어써도 안전), 2 = 저장소에 없는 코드(덮어쓰면 수정이 사라짐),
          3 = 게시본 구조를 읽지 못함
"""
import hashlib
import re
import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
FILES = ["docs/index.html", "docs/style.css", "docs/app.js"]


def code_hash(body: str, css: str, js: str) -> str:
    norm = lambda t: t.replace("\r\n", "\n").strip()
    return hashlib.sha256("\0".join(norm(x) for x in (body, css, js)).encode("utf-8")).hexdigest()


def from_page(page: str):
    # 게시 플랫폼이 앞뒤에 문서 골격(<!doctype>…<style>…</style></head><body>, </body></html>)을 덧붙이므로
    # 줄 첫머리의 <style> 블록(빌드가 넣은 것)부터 찾습니다.
    css = re.search(r"(?:^|\n)<style>\n(.*?)\n</style>\n", page, re.S)
    if not css:
        return None
    body = re.match(r"(.*?)\n<script type=\"application/json\" id=\"embedded-data\">", page[css.end():], re.S)
    js = re.search(r"\n<script>\n(.*)\n</script>\s*(?:</body></html>\s*)?$", page, re.S)
    if not (body and js):
        return None
    return code_hash(body.group(1), css.group(1), js.group(1))


def body_of(index_html: str) -> str:
    body = re.search(r"<body>(.*)</body>", index_html, re.S).group(1)
    return re.sub(r'\s*<script src="app.js"></script>', "", body)


def git(*args) -> str:
    return subprocess.run(["git", "-C", str(root), *args], capture_output=True, text=True, check=True).stdout


def at_commit(rev: str):
    try:
        idx, css, js = (git("show", f"{rev}:{f}") for f in FILES)
    except subprocess.CalledProcessError:
        return None
    return code_hash(body_of(idx), css, js)


def main():
    live = from_page(Path(sys.argv[1]).read_text(encoding="utf-8"))
    if live is None:
        print("게시본에서 앱 코드 구조를 찾지 못했습니다.")
        sys.exit(3)
    work = code_hash(body_of((root / FILES[0]).read_text(encoding="utf-8")),
                     (root / FILES[1]).read_text(encoding="utf-8"), (root / FILES[2]).read_text(encoding="utf-8"))
    if live == work:
        print("OK 게시본 코드 = 현재 작업 폴더 코드")
        return
    revs = git("log", "-n", "300", "--format=%H", "--", *FILES).split()
    for r in revs:
        if at_commit(r) == live:
            print(f"OK 게시본 코드는 커밋 {r[:7]}에 있습니다.")
            return
    print("UNPUSHED 게시본에 저장소에 없는 앱 코드 수정이 있습니다. 덮어쓰면 그 수정이 사라집니다.")
    sys.exit(2)


if __name__ == "__main__":
    main()
