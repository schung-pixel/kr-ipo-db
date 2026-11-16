# IPO Tracker (kr-ipo-db) 작업 규칙

- 앱의 원본은 이 저장소입니다. 아티팩트(https://claude.ai/artifact/9ocG9cDFeSR28AeUR2hwYw)는 `python3 tools/build_artifact.py <출력.html>`로 저장소 코드와 데이터를 묶은 사본입니다.
- 앱 코드(docs/index.html, docs/style.css, docs/app.js 등)를 고치면 아티팩트를 게시하기 전에 반드시 commit하고 push합니다. 저장소에 없는 수정은 평일 새벽 2시 자동 재게시 때 사라집니다.
- push 순서: `git pull -q --rebase` → 수정 → docs/sw.js의 VERSION 올리기 → 테스트(`set -o pipefail; python3 -m unittest discover -s tests | tail -1`) → commit → `(git pull -q --rebase -X theirs || true) && git push -q` → 빌드 → 아티팩트 게시.
- 게시가 "newer version" 충돌로 거절되면, 먼저 그 게시본을 저장해 `python3 tools/check_live.py <저장본.html>`로 확인합니다. 종료 코드 2(UNPUSHED)면 다른 대화의 미반영 수정이 있다는 뜻이므로 덮어쓰지 말고 사용자에게 알립니다.
- DART API 키 등 비밀값은 파일·커밋에 넣지 않습니다(환경변수 DART_API_KEY로만 사용). 커밋 전 저장소에 키 문자열이 없는지 grep으로 확인합니다.
- 디자인·UI 변경은 시안 4개 이상을 먼저 보여 주고 사용자가 고른 뒤 반영합니다.
