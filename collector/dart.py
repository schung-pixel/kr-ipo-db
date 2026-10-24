"""OpenDART 클라이언트.

사양은 OpenDART 개발가이드에서 확인한 내용을 따릅니다.
- 공시검색  list.json   : page_count 최대 100, corp_code 없이 조회하면 기간 3개월 제한
- 기업개황  company.json
- 증권신고서 주요정보(지분증권) estkRs.json : corp_code, bgn_de, end_de 모두 필수
- status: 000 정상 / 013 데이터 없음 / 020 요청 제한 초과 / 010·011·012·901 키 문제
"""
from __future__ import annotations

import time
from datetime import date
from typing import Iterator

import requests

BASE_URL = "https://opendart.fss.or.kr/api"
VIEWER_URL = "https://dart.fss.or.kr"
VIEWER_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
             "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
FATAL_STATUS = {"010", "011", "012", "800", "901"}


class DartError(Exception):
    def __init__(self, status: str, message: str = ""):
        super().__init__(f"DART status {status}: {message}")
        self.status = status
        self.message = message


class DartQuotaExceeded(DartError):
    """status 020: 일일 요청 한도 초과. 남은 작업은 다음 실행에서 이어갑니다."""


class DartClient:
    def __init__(self, api_key: str, session: requests.Session | None = None,
                 pause: float = 0.15, timeout: int = 30, retries: int = 3):
        self._key = api_key
        self.session = session or requests.Session()
        self.pause = pause
        self.timeout = timeout
        self.retries = retries

    def _get(self, endpoint: str, **params) -> dict:
        query = {"crtfc_key": self._key}
        query.update({k: v for k, v in params.items() if v is not None})
        data = None
        for attempt in range(self.retries):
            try:
                resp = self.session.get(f"{BASE_URL}/{endpoint}.json", params=query,
                                        timeout=self.timeout)
                resp.raise_for_status()
                data = resp.json()
                break
            except (requests.RequestException, ValueError) as exc:
                # 예외 문자열에는 인증키가 담긴 URL이 들어가므로 유형만 남깁니다.
                if attempt == self.retries - 1:
                    raise RuntimeError(f"{endpoint} 요청 실패: {type(exc).__name__}") from None
                time.sleep(2 ** attempt)
        time.sleep(self.pause)

        status = str(data.get("status", ""))
        if status == "000":
            return data
        if status == "013":
            return {"status": "013", "list": [], "group": []}
        if status == "020":
            raise DartQuotaExceeded(status, data.get("message", ""))
        raise DartError(status, data.get("message", ""))

    def document(self, rcept_no: str) -> bytes:
        """공시 원문(document.xml). 정상이면 zip 바이트, 오류면 DartError를 냅니다."""
        data = None
        for attempt in range(self.retries):
            try:
                resp = self.session.get(f"{BASE_URL}/document.xml",
                                        params={"crtfc_key": self._key, "rcept_no": rcept_no},
                                        timeout=max(self.timeout, 90))
                resp.raise_for_status()
                data = resp.content
                break
            except requests.RequestException as exc:
                if attempt == self.retries - 1:
                    raise RuntimeError(f"document 요청 실패: {type(exc).__name__}") from None
                time.sleep(2 ** attempt)
        time.sleep(self.pause)
        if data[:2] == b"PK":
            return data
        # 오류 시에는 zip이 아니라 <result><status>..</status><message>..</message> 형태의 XML이 옵니다.
        import re
        st = re.search(rb"<status>(\d+)</status>", data)
        msg = re.search(rb"<message>(.*?)</message>", data, re.S)
        status = st.group(1).decode() if st else "unknown"
        message = msg.group(1).decode("utf-8", "replace") if msg else ""
        if status == "020":
            raise DartQuotaExceeded(status, message)
        raise DartError(status, message)

    @staticmethod
    def _ymd(d: date) -> str:
        return d.strftime("%Y%m%d")

    def list_filings(self, bgn: date, end: date, pblntf_detail_ty: str | None = None,
                     corp_code: str | None = None) -> Iterator[dict]:
        """공시 목록. 정정보고서를 포함한 전체를 페이지 단위로 가져옵니다."""
        page = 1
        while True:
            data = self._get("list", corp_code=corp_code, bgn_de=self._ymd(bgn),
                             end_de=self._ymd(end), last_reprt_at="N",
                             pblntf_detail_ty=pblntf_detail_ty, page_no=page,
                             page_count=100)
            yield from data.get("list", [])
            if page >= int(data.get("total_page") or 1):
                return
            page += 1

    # 목차가 나뉜 문서는 viewer.do가 목차 한 칸씩만 돌려주므로, 추출에 쓰는 목차만 골라 이어 붙입니다.
    VIEWER_SECTIONS = ("정정신고", "요약정보", "핵심투자위험", "모집또는매출에관한일반사항", "공모개요", "공모방법",
                       "공모가격결정방법", "모집또는매출절차", "인수등에관한사항", "사업위험", "회사위험", "기타위험",
                       "인수인의의견", "증권신고서", "사업의개요", "사업의내용")

    def viewer_html(self, rcept_no: str, sections=None) -> str:
        """DART 공시 뷰어에서 문서 HTML을 받습니다. OpenDART document.xml이 원문을 주지 않는
        2019년 이전 공시(status 014)에 씁니다. 인증키는 쓰지 않습니다."""
        import re
        h = {"User-Agent": VIEWER_UA}

        def get(url, **params):
            last = None
            for attempt in range(self.retries):
                try:
                    r = self.session.get(url, params=params, headers=h, timeout=max(self.timeout, 60))
                    r.raise_for_status()
                    r.encoding = r.encoding or "utf-8"
                    time.sleep(self.pause)
                    return r.text
                except requests.RequestException as exc:
                    last = exc
                    time.sleep(2 ** attempt)
            raise RuntimeError(f"viewer 요청 실패: {type(last).__name__}")

        main = get(f"{VIEWER_URL}/dsaf001/main.do", rcpNo=rcept_no)
        m = re.search(r'viewDoc\("(\d+)",\s*"(\d+)",\s*"(\d+)",\s*"(\d+)",\s*"(\d+)",\s*"([^"]+)"', main)
        if not m:
            raise DartError("viewer", "문서 번호를 찾지 못했습니다")
        dcm, dtd = m.group(2), m.group(6)
        if m.group(3) == "0":   # 목차가 하나인 문서: 전체를 한 번에
            return get(f"{VIEWER_URL}/report/viewer.do", rcpNo=rcept_no, dcmNo=dcm, eleId="0",
                       offset="0", length="0", dtd=dtd)
        nodes = re.findall(r"\['text'\]\s*=\s*\"(.*?)\";.*?\['eleId'\]\s*=\s*\"(\d+)\";\s*"
                           r"\w+\['offset'\]\s*=\s*\"(\d+)\";\s*\w+\['length'\]\s*=\s*\"(\d+)\";", main, re.S)
        parts, seen = [], set()
        for title, ele, off, ln in nodes:
            key = re.sub(r"[\s\W_]+", "", title)
            if ele in seen or not any(k in key for k in (sections or self.VIEWER_SECTIONS)):
                continue
            seen.add(ele)
            parts.append(get(f"{VIEWER_URL}/report/viewer.do", rcpNo=rcept_no, dcmNo=dcm, eleId=ele,
                             offset=off, length=ln, dtd=dtd))
        if not parts:   # 목차 이름이 다른 서식(증권발행실적보고서 등): 앞쪽 목차부터 최대 30칸
            for title, ele, off, ln in nodes[:30]:
                if ele not in seen:
                    seen.add(ele)
                    parts.append(get(f"{VIEWER_URL}/report/viewer.do", rcpNo=rcept_no, dcmNo=dcm, eleId=ele,
                                     offset=off, length=ln, dtd=dtd))
        if not parts:
            raise DartError("viewer", "가져올 목차가 없습니다")
        return "\n".join(parts)

    def company(self, corp_code: str) -> dict | None:
        data = self._get("company", corp_code=corp_code)
        return data if data.get("status") == "000" else None

    def equity_registration(self, corp_code: str, bgn: date, end: date) -> dict:
        """증권신고서 주요정보(지분증권). 응답은 {'group': [{'title', 'list'}]} 구조입니다."""
        return self._get("estkRs", corp_code=corp_code, bgn_de=self._ymd(bgn),
                         end_de=self._ymd(end))
