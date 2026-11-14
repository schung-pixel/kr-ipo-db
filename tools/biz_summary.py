"""회사 개요 요약문 보조 도구.

  python3 tools/biz_summary.py todo [출력.json]   요약문이 없고 신고서 '사업의 개요' 원문이 있는 회사 목록
  python3 tools/biz_summary.py apply 입력.json    {corp_code: {"summary", "source_rcept_no"}} 를 data/biz_summary.json 에 합침

todo 는 docs/data/deals.json 과 data/ipo.db(없으면 `python3 -m collector.run restore`)를 읽습니다.
원문(biz_text)이 회사 사업을 설명하지 않는 경우(용어 설명·투자위험·공모 조건 문구 등)가 있어, 요약을 쓸 때
원문에 근거가 없으면 비워 두고 넘어가야 합니다. 요약문에는 원문과 KIND 업종·주요제품 외의 사실을 넣지 않습니다.
"""
import datetime
import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SUMMARY = ROOT / "data" / "biz_summary.json"


def todo(out=None):
    deals = json.loads((ROOT / "docs" / "data" / "deals.json").read_text(encoding="utf-8"))["deals"]
    conn = sqlite3.connect(ROOT / "data" / "ipo.db")
    seen, rows = set(), []
    for d in deals:
        co = d.get("company") or {}
        cc = d.get("corp_code")
        if not co.get("excerpt") or co.get("summary") or cc in seen or d.get("is_spac"):
            continue
        seen.add(cc)
        r = conn.execute("SELECT biz_text FROM doc_schedule WHERE rcept_no=?", (co.get("source_rcept_no"),)).fetchone()
        rows.append({"corp_code": cc, "name": d.get("corp_name"), "status": d.get("status"),
                     "first_filing_dt": d.get("first_filing_dt"), "source_rcept_no": co.get("source_rcept_no"),
                     "industry": co.get("industry"), "products": co.get("products"),
                     "text": (r[0] if r and r[0] else co.get("excerpt"))})
    rows.sort(key=lambda x: x["first_filing_dt"] or "", reverse=True)
    s = json.dumps(rows, ensure_ascii=False, indent=1)
    if out:
        Path(out).write_text(s, encoding="utf-8")
        print(f"{len(rows)}개사 -> {out}")
    else:
        print(s)


def apply(path):
    new = json.loads(Path(path).read_text(encoding="utf-8"))
    data = json.loads(SUMMARY.read_text(encoding="utf-8"))
    comp = data.setdefault("companies", {})
    today = datetime.date.today().isoformat()
    n = 0
    for cc, v in new.items():
        if not v or not v.get("summary"):
            continue
        comp[cc] = {"summary": v["summary"].strip(), "source_rcept_no": v.get("source_rcept_no"),
                    "note": v.get("note", ""), "generated_at": today}
        n += 1
    data["companies"] = dict(sorted(comp.items()))
    SUMMARY.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"{n}개사 반영, 전체 {len(comp)}개사")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "todo":
        todo(sys.argv[2] if len(sys.argv) > 2 else None)
    elif cmd == "apply" and len(sys.argv) > 2:
        apply(sys.argv[2])
    else:
        print(__doc__)
