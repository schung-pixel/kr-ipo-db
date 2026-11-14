"use strict";
(function () {
  var DART_VIEW = "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=";
  var app = document.getElementById("app");
  var tip = document.getElementById("tip");
  var data = null;

  // 아티팩트(임베드) 모드: 데이터가 페이지에 들어 있고, 주소 대신 메모리로 화면을 바꿉니다.
  var embedEl = document.getElementById("embedded-data");
  var EMBED = !!embedEl;
  var memPath = "/";
  function curPath() { return EMBED ? memPath : (location.hash.replace(/^#/, "") || "/"); }
  // 화면 이동 기록: 휴대폰(갤럭시 등)의 뒤로 가기가 앱을 닫지 않고 앞 화면으로 돌아가게, 이동마다 기록을 쌓습니다.
  // 임베드(아티팩트)에서도 같은 방식(주소는 바꾸지 않고 기록만)으로 동작합니다.
  var hist = [curPath()], hi = 0, popSkip = 0, overlay = null, exitAt = 0;
  function pushH(st, url) {
    try { if (EMBED) history.pushState(st, ""); else history.pushState(st, "", url); return true; } catch (e) { return false; }
  }
  function replaceH(st, url) {
    try { if (EMBED) history.replaceState(st, ""); else history.replaceState(st, "", url); } catch (e) { /* 무시 */ }
  }
  function goPath(p, replace) {
    var cur = curPath();
    if (p === cur) { route(); return; }
    // 상세에서 다른 상세로(이전·다음) 넘어갈 때는 기록을 늘리지 않습니다
    if (replace == null) replace = /^\/deal\//.test(cur) && /^\/deal\//.test(p);
    if (replace) { hist[hi] = p; replaceH({ n: hi, p: p }, "#" + p); }
    else { hist = hist.slice(0, hi + 1); hist.push(p); hi++; if (!pushH({ n: hi, p: p }, "#" + p)) { hist.pop(); hi--; } }
    if (EMBED) memPath = p;
    route();
  }
  // 상세 닫기: 목록에서 연 상세면 기록 한 칸 뒤로(뒤로 가기와 같은 결과), 아니면 바탕 화면으로 바꿔 둡니다
  function closeTo(base) {
    if (hi > 0 && hist[hi - 1] === base) { try { history.back(); return; } catch (e) { /* 아래로 */ } }
    goPath(base, true);
  }
  // 팝업(필터·드롭다운 시트): 열 때 기록 한 칸을 쌓아 뒤로 가기로 닫히게 합니다
  function overlayOpen(close) {
    if (overlay) return;
    if (pushH({ n: hi, p: curPath(), ov: 1 }, "#" + curPath())) overlay = close;
  }
  function overlayDone() {
    if (!overlay) return;
    overlay = null; popSkip++;
    try { history.back(); } catch (e) { popSkip--; }
  }
  var toastTimer = null;
  function toast(msg) {
    var t = document.getElementById("toast");
    if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
    t.textContent = msg; t.classList.add("on");
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove("on"); }, 1800);
  }
  window.addEventListener("popstate", function (e) {
    if (popSkip) { popSkip--; return; }
    var st = e.state || {};
    if (overlay && !st.ov) { var f = overlay; overlay = null; f(); return; }
    if (st.guard) {
      // 첫 화면에서 뒤로 가기: 한 번 더 누르면 종료(2초 안)
      if (Date.now() - exitAt < 2000) { popSkip = 0; try { history.back(); } catch (err) { /* 무시 */ } return; }
      exitAt = Date.now(); toast("뒤로 버튼을 한 번 더 누르면 종료합니다");
      pushH({ n: 0, p: hist[0] }, "#" + hist[0]); hi = 0;
      if (EMBED) memPath = hist[0];
      route(); return;
    }
    if (typeof st.n === "number") {
      hi = st.n; hist[hi] = st.p;
      if (EMBED) memPath = st.p;
      route();
    }
  });
  // 시작 시: 맨 앞에 '종료 확인' 칸을 두고 그 위에 현재 화면을 올립니다
  (function () {
    var p0 = curPath();
    replaceH({ guard: 1 }, EMBED ? undefined : "#/");
    pushH({ n: 0, p: p0 }, "#" + p0);
  })();

  var DEFAULTS = { status: "all", cand: "ipo", spac: false, year: "", board: "", sector: "", focus: "", q: "", sortKey: "date", sortDir: -1 };
  var state = Object.assign({}, DEFAULTS, { sYear: "", sPeriod: "all", sUnit: "year", sWin: null, metric: "count", league: "count", fSeg: "all", fKey: "inst_demand_ratio", listScroll: 0 });
  try {
    var saved = JSON.parse(localStorage.getItem("ipo-db-view") || "null");
    if (saved) ["status", "spac", "year", "board", "sector", "focus", "sortKey", "sortDir", "sPeriod", "sUnit", "sWin", "metric", "league", "fSeg", "fKey"].forEach(function (k) {
      if (k in saved) state[k] = saved[k];
    });
  } catch (e) { /* 저장소를 쓸 수 없으면 기본값으로 시작 */ }
  function persist() {
    try {
      var o = {};
      ["status", "cand", "spac", "year", "board", "sector", "focus", "sortKey", "sortDir", "sPeriod", "sUnit", "sWin", "metric", "league", "fSeg", "fKey"].forEach(function (k) { o[k] = state[k]; });
      localStorage.setItem("ipo-db-view", JSON.stringify(o));
    } catch (e) { /* 무시 */ }
  }

  // ---------------------------------------------------------------- 공통 표기
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  // 숫자 서식기는 만들 때 비용이 커서 한 번만 만들어 둡니다(목록 860건을 그릴 때 수백 ms 차이).
  var NF = {};
  function nf(min, max) { var k = min + ":" + max; return NF[k] || (NF[k] = new Intl.NumberFormat("ko-KR", { minimumFractionDigits: min, maximumFractionDigits: max })); }
  function int(n) { return n == null ? "-" : nf(0, 3).format(Number(n)); }
  function eok(n) {
    if (n == null) return "-";
    var v = n / 1e8;
    return v >= 100 ? nf(0, 0).format(Math.round(v)) : nf(0, 1).format(v);
  }
  function pctText(v) { return (v > 0 ? "+" : "") + v.toFixed(1) + "%"; }
  var CORP_FORM = /\(주\)|㈜|\(유\)|\(재\)|\(사\)|주식회사|유한회사|유한책임회사/g;
  function name(d) {
    var n = (d.corp_name || "").replace(CORP_FORM, " ").replace(/\s+/g, " ").trim();
    return n || d.corp_name || d.corp_code;
  }
  var byCorp = {};
  function indexCorps() {
    byCorp = {};
    data.deals.forEach(function (d) { if (d.corp_code) (byCorp[d.corp_code] = byCorp[d.corp_code] || []).push(d); });
    Object.keys(byCorp).forEach(function (k) { byCorp[k].sort(function (a, b) { return a.first_rcept_no < b.first_rcept_no ? -1 : 1; }); });
  }
  function laterDeal(d) {
    return (byCorp[d.corp_code] || []).filter(function (x) { return x.first_rcept_no > d.first_rcept_no && x.is_ipo_candidate === 1; })[0] || null;
  }
  function earlierWithdrawn(d) {
    var xs = (byCorp[d.corp_code] || []).filter(function (x) { return x.first_rcept_no < d.first_rcept_no && x.status === "withdrawn" && x.is_ipo_candidate === 1; });
    return xs.length ? xs[xs.length - 1] : null;
  }
  function refileTag(d) {
    if (d.status === "withdrawn" && laterDeal(d)) return '<span class="tag b-etc" title="철회 후 다시 신고한 공모가 있습니다">재신고함</span>';
    if (earlierWithdrawn(d)) return '<span class="tag b-etc" title="이전 공모를 철회한 뒤 다시 신고한 공모입니다">재신고</span>';
    return "";
  }
  function isSpac(d) { return !!d.is_spac || /기업인수목적|스팩/.test(d.corp_name || ""); }
  // 상장 구분: KOSPI / KOSDAQ / KOSDAQ_TECH (원문의 상장 경로 서술, 시장은 KIND 예심 값 우선)
  var BOARDS = { KOSPI: "유가증권", KOSDAQ: "코스닥", KOSDAQ_TECH: "코스닥 기술특례" };
  var BOARD_SHORT = { KOSPI: "유가증권", KOSDAQ: "코스닥", KOSDAQ_TECH: "기술특례" };
  // 시장 필터: '코스닥'은 기술특례를 포함한 코스닥 전체, '코스닥 기술특례'는 그중 기술특례만
  function boardOk(d, b) {
    if (!b) return true;
    if (b === "KOSDAQ") return d.board === "KOSDAQ" || d.board === "KOSDAQ_TECH";
    if (d.tech_unknown && d.board === "KOSDAQ") return b === "KOSDAQ_TECH";
    return d.board === b;
  }
  // 배지: 시장(유가·코스닥)과 상장 경로(기술특례·성장성 특례·이익미실현)를 따로 붙입니다.
  // 기준 주관사(강조 대상): NH투자증권. 대표·공동·인수단 중 맡은 역할을 돌려줍니다(없으면 "")
  var FOCUS_NAME = "NH투자증권", FOCUS_SHORT = "NH";
  var SECTORS = ["바이오·제약", "의료기기", "반도체", "전자부품·디스플레이", "통신·전자기기", "기계·장비", "전기장비·2차전지",
    "자동차·운송장비", "화학·소재", "소비재·유통", "SW·IT서비스", "게임", "미디어·콘텐츠", "금융·지주", "서비스·기타"];
  function focusRole(d) {
    if (d._fr !== undefined) return d._fr;
    var r = "";
    if ((d.lead_underwriters || "").indexOf(FOCUS_NAME) >= 0) r = "대표";
    else if ((d.co_underwriters || "").indexOf(FOCUS_NAME) >= 0) r = "공동";
    else (d.underwriters || []).forEach(function (u) {
      if (!r && (u.actnmn || "").replace("엔에이치투자증권", FOCUS_NAME).indexOf(FOCUS_NAME) >= 0) r = u.actsen === "대표" ? "대표" : u.actsen === "공동" ? "공동" : "인수";
    });
    d._fr = r;
    return r;
  }
  function focusTag(d) {
    var r = focusRole(d);
    return r ? '<span class="tag b-focus" title="' + FOCUS_NAME + " " + r + (r === "인수" ? "단" : "주관") + ' 참여">' + FOCUS_SHORT + " " + r + "</span>" : "";
  }
  function boardTag(d) {
    var m = d.board === "KOSPI" ? '<span class="tag b-ks">유가</span>'
      : (d.board === "KOSDAQ" || d.board === "KOSDAQ_TECH") ? '<span class="tag b-kq">코스닥</span>' : "";
    if (isSpac(d)) return m;
    var r = "";
    if (d.board === "KOSDAQ_TECH") {
      var growth = d.tech_track === "성장성 추천";
      var single = /^단수평가/.test(d.tech_mode || "");
      var gtxt = d.tech_grades && !growth ? (single ? "단수 " + bestGrade(d.tech_grades) : d.tech_grades.replace(/\s*,\s*/g, "·")) : "";
      r += '<span class="tag b-tech" title="코스닥 기술특례 · ' + esc(d.tech_track || "") + (d.tech_mode ? " · " + esc(d.tech_mode) : "") + (d.tech_agencies ? " · " + esc(d.tech_agencies) : "") + '">' +
        (growth ? "성장성 특례" : "기술") + (gtxt ? " " + esc(gtxt) : "") + "</span>";
    }
    if (d.alt_route) r += '<span class="tag b-route" title="이익미실현(테슬라) 요건 상장">' + esc(d.alt_route) + "</span>";
    return m + r;
  }
  var GRADE_ORDER = ["AAA", "AA", "A", "BBB", "BB", "B"];
  function bestGrade(gs) {
    return gs.split(/\s*,\s*/).sort(function (a, b) { return GRADE_ORDER.indexOf(a) - GRADE_ORDER.indexOf(b); })[0];
  }
  function modeText(d) {
    if (!d.tech_mode) return "";
    if (d.tech_mode === "재평가") return "재평가 등급";
    var basis = (d.tech_mode.match(/\((.+)\)/) || [])[1];
    return "단수평가" + (basis ? "(" + basis + ")" : "") + ": 1개 기관 A 이상으로 요건 충족";
  }
  function boardText(d) {
    if (!d.board) return "-";
    var t = BOARDS[d.board];
    if (d.board === "KOSDAQ_TECH" && d.tech_track) t += " (" + d.tech_track + (d.tech_grades ? " " + (/^단수평가/.test(d.tech_mode || "") ? "단수 " + bestGrade(d.tech_grades) : d.tech_grades.replace(/\s*,\s*/g, "·")) : "") + ")";
    if (d.board === "KOSDAQ" && d.alt_route) t += " (" + d.alt_route + " 요건)";
    if (d.tech_unknown && d.board === "KOSDAQ") t = "코스닥 (기술특례 여부 미확인)";
    return t;
  }
  // 검색: 일반 문자열 + 초성(자음) 검색. 'ㄷㅂ'는 '달바', 'ㅁㄹㅇㅅ'는 '미래에셋'에 맞습니다.
  var CHO = ["ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
  function isCho(c) { return CHO.indexOf(c) >= 0; }
  function choOf(c) {
    var code = c.charCodeAt(0) - 0xac00;
    return code >= 0 && code < 11172 ? CHO[Math.floor(code / 588)] : null;
  }
  function charMatch(tc, qc) { return tc === qc || (isCho(qc) && choOf(tc) === qc); }
  function findMatch(text, q) {
    if (!q) return -1;
    var t = text.toLowerCase(), k = q.toLowerCase().replace(/\s+/g, "");
    if (!k) return -1;
    var plain = t.indexOf(k);
    if (plain >= 0 && !/[ㄱ-ㅎ]/.test(k)) return { i: plain, n: k.length };
    // 공백을 건너뛰며 한 글자씩 비교 (초성 포함)
    for (var s0 = 0; s0 < t.length; s0++) {
      if (t[s0] === " ") continue;
      var i = s0, j = 0;
      while (i < t.length && j < k.length) {
        if (t[i] === " ") { i++; continue; }
        if (!charMatch(t[i], k[j])) break;
        i++; j++;
      }
      if (j === k.length) return { i: s0, n: i - s0 };
    }
    return -1;
  }
  // 비슷한 이름 찾기: 한글을 자음·모음으로 풀고(ㅐ=ㅔ, ㅒ=ㅖ, ㅙ=ㅞ=ㅚ), 자주 섞이는 영문 표기(LG=엘지 등)를
  // 맞춘 뒤, 검색어와 이름의 일부 구간이 자음·모음 1~2개 차이 안에 들면 비슷한 이름으로 봅니다.
  var JUNG = ["ㅏ", "ㅐ", "ㅑ", "ㅒ", "ㅓ", "ㅔ", "ㅕ", "ㅖ", "ㅗ", "ㅘ", "ㅙ", "ㅚ", "ㅛ", "ㅜ", "ㅝ", "ㅞ", "ㅟ", "ㅠ", "ㅡ", "ㅢ", "ㅣ"];
  var JONG = ["", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ", "ㄻ", "ㄼ", "ㄽ", "ㄾ", "ㄿ", "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
  var VOWEL_EQ = { "ㅐ": "ㅔ", "ㅒ": "ㅖ", "ㅙ": "ㅚ", "ㅞ": "ㅚ" };
  var LATIN_KO = [["에이치디", "hd"], ["엘지", "lg"], ["에스케이", "sk"], ["케이비", "kb"], ["엔에이치", "nh"], ["씨제이", "cj"], ["지에스", "gs"],
    ["케이티", "kt"], ["디비", "db"], ["아이비케이", "ibk"], ["비엔케이", "bnk"], ["에이아이", "ai"], ["아이엠", "im"], ["케이", "k"]];
  function latinize(t) {
    t = t.toLowerCase().replace(/\(주\)|㈜|주식회사|\s+/g, "");
    LATIN_KO.forEach(function (p) { t = t.split(p[0]).join(p[1]); });
    return t;
  }
  // 글자(음절) 단위로 쪼개고, 한글 음절은 자음·모음 배열로 둡니다(모음은 ㅐ=ㅔ 등으로 맞춤).
  function units(t) {
    var out = [];
    for (var i = 0; i < t.length; i++) {
      var c = t.charCodeAt(i) - 0xac00;
      if (c >= 0 && c < 11172) {
        var j = JUNG[Math.floor((c % 588) / 28)], jo = JONG[c % 28];
        out.push(jo ? [CHO[Math.floor(c / 588)], VOWEL_EQ[j] || j, jo] : [CHO[Math.floor(c / 588)], VOWEL_EQ[j] || j]);
      } else out.push([VOWEL_EQ[t[i]] || t[i]]);
    }
    return out;
  }
  var UNIT_CACHE = {};
  function unitsOf(t) { return UNIT_CACHE[t] || (UNIT_CACHE[t] = units(latinize(t))); }
  function jdist(x, y) {        // 음절 하나의 자음·모음 편집 거리(최대 3칸)
    if (x.length === y.length && x.join("") === y.join("")) return 0;
    var p = [], i, j;
    for (j = 0; j <= y.length; j++) p[j] = j;
    for (i = 1; i <= x.length; i++) {
      var c = [i];
      for (j = 1; j <= y.length; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
      p = c;
    }
    return p[y.length];
  }
  // 검색어와 같은 글자 수의 이름 구간을 하나씩 대 보며, 자음·모음 차이 합과 틀린 글자 수가 기준 안인 구간 중 가장 가까운 것
  function fzWin(a, b, lim) {
    var m = b.length, best = null;
    for (var s0 = 0; s0 + m <= a.length; s0++) {
      var tot = 0, diff = [];
      for (var k = 0; k < m && tot <= lim; k++) {
        var d = jdist(a[s0 + k], b[k]);
        if (d) { tot += d; diff.push(k); }
      }
      if (tot <= lim && diff.length <= lim && (!best || tot < best.tot)) { best = { s: s0, diff: diff, tot: tot }; if (!tot) break; }
    }
    return best;
  }
  function fuzzyHit(text, q, lim) { return !!fzWin(unitsOf(text), units(latinize(q)), lim); }
  // 허용 기준: 검색어 길이(영문 약칭 변환 후 글자 수) 2~5글자는 자음·모음 1개, 6글자 이상은 2개까지.
  // 한 글자, 초성 검색은 정확히 일치하는 것만 찾습니다.
  function fuzzyLimit(q) {
    var k = latinize(q.replace(/\s+/g, "")), syl = (k.match(/[가-힣]/g) || []).length;
    if (/[ㄱ-ㅎ]/.test(k)) return 0;
    if (k.length >= 6) return 2;
    if (syl >= 2 || k.length >= 3) return 1;
    return 0;
  }
  function fuzzyMatch(text, q) {
    var lim = fuzzyLimit(q);
    if (!lim || !text) return false;
    return fuzzyHit(text, q, lim);
  }
  function highlight(text, q) {
    var t = esc(text);
    var m = findMatch(text, q);
    if (m === -1) return t;
    return esc(text.slice(0, m.i)) + "<mark>" + esc(text.slice(m.i, m.i + m.n)) + "</mark>" + esc(text.slice(m.i + m.n));
  }  // 비슷한 이름으로만 걸린 경우: 다른 글자에 점선 밑줄을 긋습니다(영문 약칭 변환으로 맞은 경우는 밑줄 없이).
  function fuzzyMark(text, q) {
    var idx = [], ch = [];
    for (var i = 0; i < text.length; i++) if (!/\s/.test(text[i])) { idx.push(i); ch.push(text[i].toLowerCase()); }
    var w = fzWin(units(ch.join("")), units(latinize(q)), fuzzyLimit(q));
    if (!w) return esc(text);
    var qc = latinize(q), on = {};
    w.diff.forEach(function (k) { on[idx[w.s + k]] = 1; });
    // ㅐ/ㅔ처럼 같은 소리로 본 글자도 실제 글자가 다르면 밑줄
    for (var k = 0; k < qc.length && w.s + k < idx.length; k++) if (ch[w.s + k] !== qc[k]) on[idx[w.s + k]] = 1;
    var out = "";
    for (var j = 0; j < text.length; j++) out += on[j] ? "<u>" + esc(text[j]) + "</u>" : esc(text[j]);
    return out;
  }
  // 이름 표시: 정확히 맞으면 형광 표시, 비슷한 이름으로만 걸렸으면 점선 밑줄과 "비슷" 배지
  function hlName(text, q) {
    q = (q || "").trim();
    if (!q || findMatch(text, q) !== -1 || !fuzzyMatch(text, q)) return highlight(text, q);
    return fuzzyMark(text, q) + '<span class="fzb" title="검색어와 비슷한 이름">비슷</span>';
  }


  var STATUS = {
    approved: { label: "예심 승인", tip: "상장예비심사 승인을 받았고 증권신고서는 아직 내지 않은 단계", icon: '<path d="M7 1.6l1.5 1.2 1.9-.2.6 1.8 1.6 1-.6 1.8.6 1.8-1.6 1-.6 1.8-1.9-.2L7 12.4l-1.5-1.2-1.9.2-.6-1.8-1.6-1 .6-1.8-.6-1.8 1.6-1 .6-1.8 1.9.2z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M4.8 7.1l1.5 1.5 2.9-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' },
    filed: { label: "신고서 제출", tip: "증권신고서를 냈고 공모가는 아직 정해지지 않은 단계(수요예측 전·중)", icon: '<circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.8"/>' },
    price_fixed: { label: "가격 확정", tip: "발행조건확정 신고서로 공모가가 정해졌고 증권발행실적보고서는 아직인 단계(청약·납입)", icon: '<path d="M2.5 7.4l3 3 6-6.4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>' },
    completed: { label: "상장 완료", tip: "증권발행실적보고서 제출 후 상장일이 지난 공모", icon: '<path d="M3.5 12V2.5M3.5 3h7l-1.8 2.5L10.5 8h-7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/>' },
    withdrawn: { label: "철회", tip: "철회신고서를 낸 공모", icon: '<path d="M3 3l8 8M11 3l-8 8" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>' }
  };
  function asOf() { return (data && data.last_list_date) || new Date().toISOString().slice(0, 10); }
  function statusLabel(d) {
    if (d.status === "completed") return upcoming(d) ? "상장 예정" : "상장 완료";
    return (STATUS[d.status] || STATUS.filed).label;
  }
  function upcoming(d) { return d.status === "completed" && d.listing_dt && d.listing_dt > asOf(); }
  // 필터용 진행 상태: 상장 완료(completed) 중 상장일이 아직 오지 않은 건은 "상장 예정"(upcoming)으로 따로 셉니다
  function stKey(d) { return upcoming(d) ? "upcoming" : d.status; }
  function chip(d) {
    var st = typeof d === "string" ? d : d.status;
    var s = STATUS[st] || STATUS.filed;
    var label = typeof d === "string" ? s.label : statusLabel(d);
    var up = typeof d !== "string" && upcoming(d);
    var tip = up ? "증권발행실적보고서를 냈고 상장일(" + d.listing_dt + ")이 아직 오지 않은 공모" : s.tip;
    return '<span class="chip ' + esc(st) + (up ? " upcoming" : "") + '" title="' + esc(tip || "") + '"><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">' + s.icon + "</svg>" + label + "</span>";
  }
  function ratio(v, digits) {
    if (v == null) return null;
    return nf(digits || 0, digits == null ? 0 : digits).format(Number(v)) + ":1";
  }

  // 확정가가 희망 밴드의 어디에 놓였는지 (밴드가 없거나 단일 희망가면 판단하지 않음)
  var POS = ["초과", "상단", "밴드 내", "하단", "미달"];
  var POS_KEY = { "초과": "over", "상단": "top", "밴드 내": "in", "하단": "low", "미달": "under" };
  var POS_MARK = { "초과": "▲▲", "상단": "▲", "밴드 내": "●", "하단": "▼", "미달": "▼▼" };
  function position(d) {
    var lo = d.offer_price_low, hi = d.offer_price_high, f = d.final_price;
    if (!f || !lo || lo === hi) return null;
    if (f > hi) return "초과";
    if (f === hi) return "상단";
    if (f < lo) return "미달";
    if (f === lo) return "하단";
    return "밴드 내";
  }
  function pill(p) {
    return '<span class="pill p-' + POS_KEY[p] + '"><span class="m" aria-hidden="true">' + POS_MARK[p] + "</span>" + esc(p) + "</span>";
  }
  function vsTop(d) { return d.final_price && d.offer_price_high && d.offer_price_low !== d.offer_price_high ? (d.final_price / d.offer_price_high - 1) * 100 : null; }
  function bandText(d) {
    if (!d.offer_price_low) return "-";
    return d.offer_price_low === d.offer_price_high ? int(d.offer_price_low) : int(d.offer_price_low) + "~" + int(d.offer_price_high);
  }
  function srcMethod(d, field) {
    var s = (d.sources || []).filter(function (x) { return x.field_name === field; })[0];
    return s ? s.method : null;
  }
  // 수요예측 기일: short=true면 "10.28~11.03", 아니면 "2026-10-28 ~ 11-03"
  function demandText(d, short) {
    var a = d.demand_start, b = d.demand_end;
    if (!a) return "";
    if (short) return a.slice(5).replace("-", ".") + (b && b !== a ? "~" + b.slice(5).replace("-", ".") : "");
    return a + (b && b !== a ? " ~ " + (b.slice(0, 4) === a.slice(0, 4) ? b.slice(5) : b) : "");
  }
  function pricingDate(d) {
    var no = d.fixed_rcept_no;
    return no ? no.slice(0, 4) + "-" + no.slice(4, 6) + "-" + no.slice(6, 8) : null;
  }
  function candOk(d, cand) {
    if (cand === "all") return true;
    if (cand === "ipo") return d.is_ipo_candidate === 1 && d.doc_signal !== 0;
    if (cand === "check") return d.is_ipo_candidate === 1 && d.doc_signal === 0;
    return d.is_ipo_candidate !== 1;
  }

  // ---------------------------------------------------------------- 라우팅
  var view = null;          // 시트 아래에 깔린 화면: "list" | "stats"
  var sheet = document.getElementById("sheet"), shade = document.getElementById("shade"), sbody = document.getElementById("sbody");
  var sheetId = null;
  function placeInd(container) {
    if (!container) return;
    var ind = container.querySelector(".ind");
    var on = container.querySelector('[aria-current="true"], [aria-pressed="true"]');
    if (!ind) return;
    if (!on || !on.offsetWidth) { ind.style.opacity = 0; return; }
    ind.style.width = on.offsetWidth + "px";
    ind.style.transform = "translateX(" + on.offsetLeft + "px)";
    ind.style.opacity = 1;
  }
  function setTabs(tab) {
    document.querySelectorAll(".tabs [data-tab], .pager [data-tab]").forEach(function (a) {
      if (a.dataset.tab === tab) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current");
    });
    placeInd(document.querySelector(".tabs"));
  }
  var routeSeq = 0;
  function route() {
    if (typeof setNavUp === "function") setNavUp(false);
    var h = curPath();
    var m = h.match(/^\/deal\/(.+)$/), mb = h.match(/^\/bio\/(.+)$/);
    var tab = h.indexOf("/stats") === 0 ? "stats" : h === "/cal" ? "cal" : mb || h === "/bio" ? "bio" : m ? (view || "list") : "list";
    setTabs(tab);
    hideTip();
    if (!data) return;
    if (m) {
      if (!view) renderList();
      openSheet(decodeURIComponent(m[1]));
      return;
    }
    if (mb) {
      if (view !== "bio") renderBio();
      openBioSheet(decodeURIComponent(mb[1]));
      return;
    }
    closeSheet();
    var draw = function () {
      if (tab === "stats") { if (view !== "stats") { renderStats(); window.scrollTo(0, 0); } }
      else if (tab === "bio") { if (view !== "bio") { renderBio(); window.scrollTo(0, 0); } }
      else if (tab === "cal") { if (view !== "cal") { renderCal(); window.scrollTo(0, 0); } }
      else if (view !== "list") { renderList(); window.scrollTo(0, 0); }
    };
    // 탭을 바꿀 때는 표시 막대가 먼저 움직이기 시작한 뒤(두 프레임 뒤) 화면을 그립니다.
    // 목록처럼 무거운 화면을 바로 그리면 그동안 애니메이션이 멈췄다가 튀어 보입니다.
    var token = ++routeSeq;
    if (view && view !== tab) requestAnimationFrame(function () { requestAnimationFrame(function () { if (token === routeSeq) draw(); }); });
    else draw();
    document.title = (tab === "stats" ? "통계" : tab === "bio" ? "기술특례 바이오" : tab === "cal" ? "일정" : "목록") + " · IPO 데이터룸";
  }
  function baseView() { return view === "stats" ? "/stats" : view === "bio" ? "/bio" : view === "cal" ? "/cal" : "/"; }

  // ---------------------------------------------------------------- 목록
  function baseRows(ignoreStatus) {
    var q = state.q.trim().toLowerCase();
    return data.deals.filter(function (d) {
      if (!candOk(d, state.cand)) return false;
      if (!state.spac && isSpac(d)) return false;
      var ss = multi("status"), ys = multi("year");
      if (!ignoreStatus && ss.length && ss.indexOf(stKey(d)) < 0) return false;
      if (ys.length && ys.indexOf(d.first_filing_dt.slice(0, 4)) < 0) return false;
      if (!boardOk(d, state.board)) return false;
      var secs = multi("sector");
      if (secs.length && secs.indexOf(d.sector || "") < 0) return false;
      if (state.focus && !focusRole(d)) return false;
      if (state.focus === "lead" && focusRole(d) !== "대표") return false;
      if (q && findMatch(name(d), q) === -1 && findMatch((d.lead_underwriters || "") + "," + uwSet(d).join(",") + "," + uwShortStr(d.lead_underwriters), q) === -1 && !fuzzyMatch(name(d), q)) return false;
      return true;
    });
  }
  var SORTERS = {
    // 상장일(확정) → KIND 상장예정일 → 예상 상장일(납입일+4영업일) → 없으면 최초 신고일
    date: function (d) { return d.listing_dt || d.listing_sched || d.listing_est || d.first_filing_dt; },
    inst: function (d) { return d.inst_demand_ratio; },
    retail: function (d) { return d.retail_ratio; },
    name: function (d) { return name(d); },
    lead: function (d) { return d.lead_underwriters || null; },
    status: function (d) { return d.status; },
    band: function (d) { return d.offer_price_high; },
    final: function (d) { return d.final_price; },
    vs: function (d) { return vsTop(d); },
    amount: function (d) { return d.offer_amount; }
  };
  function filtered() {
    var rows = baseRows(false);
    var f = SORTERS[state.sortKey] || SORTERS.date, dir = state.sortDir;
    rows.sort(function (a, b) {
      var x = f(a), y = f(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;            // 값 없는 건은 정렬 방향과 무관하게 뒤로
      if (y == null) return -1;
      if (x < y) return -dir;
      if (x > y) return dir;
      return a.first_filing_dt < b.first_filing_dt ? 1 : -1;
    });
    return rows;
  }
  function years() {
    var s = {};
    data.deals.forEach(function (d) { s[d.first_filing_dt.slice(0, 4)] = 1; });
    return Object.keys(s).sort().reverse();
  }
  function opt(v, label, cur) { return '<option value="' + esc(v) + '"' + (v === cur ? " selected" : "") + ">" + esc(label) + "</option>"; }

  // ---- 드롭다운: 기본 <select>는 값과 change 이벤트를 그대로 맡고, 화면에는 자체 버튼과 목록을 보입니다.
  //      PC는 버튼 아래 팝오버, 휴대폰(≤760px)은 아래에서 올라오는 시트로 엽니다.
  var ddOpen = null;
  var CHECK = '<svg class="ck" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function ddLabel(sel) { var o = sel.options[sel.selectedIndex]; return o ? o.textContent : ""; }
  function enhanceSelects(root) {
    root.querySelectorAll("select.sel:not(.dd-native)").forEach(function (sel) {
      sel.classList.add("dd-native"); sel.tabIndex = -1; sel.setAttribute("aria-hidden", "true");
      var b = document.createElement("button");
      b.type = "button"; b.className = "sel dd"; b.setAttribute("aria-haspopup", "listbox"); b.setAttribute("aria-expanded", "false");
      b.setAttribute("aria-label", (sel.getAttribute("aria-label") || "") + ": " + ddLabel(sel));
      var so = sel.options[sel.selectedIndex], short = so && so.dataset.s;
      b.innerHTML = '<span class="dd-t">' + (short ? '<span class="lf">' + esc(ddLabel(sel)) + '</span><span class="ls">' + esc(short) + "</span>" : esc(ddLabel(sel))) + "</span>";
      if (sel.dataset.def != null && sel.value !== sel.dataset.def) b.classList.add("on");
      sel.after(b);
      b.addEventListener("click", function (e) { e.preventDefault(); if (ddOpen && ddOpen.btn === b) ddClose(true); else ddShow(sel, b); });
      b.addEventListener("keydown", function (e) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); ddShow(sel, b); }
      });
      var lab = sel.closest("label");
      if (lab) lab.addEventListener("click", function (e) { if (!e.target.closest(".dd")) { e.preventDefault(); b.click(); } });
    });
  }
  function ddShow(sel, btn) {
    if (ddOpen) ddClose(false);
    var mobile = window.matchMedia("(max-width: 760px)").matches;
    var title = sel.getAttribute("aria-label") || "";
    var lid = "dd-" + sel.id;
    var h = "";
    var item = function (o) {
      if (o.hidden) return "";
      var on = o.selected;
      return '<button type="button" role="option" class="dd-o" tabindex="-1" data-v="' + esc(o.value) + '" aria-selected="' + on + '"><span>' + esc(o.textContent) + "</span>" + CHECK + "</button>";
    };
    Array.prototype.forEach.call(sel.children, function (c) {
      if (c.tagName === "OPTGROUP") {
        var lbl = c.getAttribute("label");
        h += '<div class="dd-g' + (c.dataset.grid ? " grid" : "") + '" role="group"' + (lbl ? ' aria-label="' + esc(lbl) + '"' : "") + ">" +
          (lbl ? '<div class="dd-h" aria-hidden="true">' + esc(lbl) + "</div>" : '<div class="dd-sep" aria-hidden="true"></div>') +
          '<div class="dd-items">' + Array.prototype.map.call(c.children, item).join("") + "</div></div>";
      } else h += item(c);
    });
    var wrap = document.createElement("div");
    wrap.className = "dd-layer" + (mobile ? " sheet-mode" : "");
    wrap.innerHTML = (mobile ? '<div class="dd-scrim"></div>' : "") +
      '<div class="dd-panel" id="' + lid + '" role="listbox" aria-label="' + esc(title) + '">' +
      (mobile ? '<div class="dd-top"><span class="grab" aria-hidden="true"></span><b>' + esc(title) + '</b></div>' : "") +
      '<div class="dd-body">' + h + "</div></div>";
    document.body.appendChild(wrap);
    var panel = wrap.querySelector(".dd-panel");
    btn.setAttribute("aria-expanded", "true"); btn.setAttribute("aria-controls", lid); btn.classList.add("open");
    if (!mobile) ddPlace(panel, btn);
    var opts = Array.prototype.slice.call(panel.querySelectorAll(".dd-o"));
    var cur = panel.querySelector('.dd-o[aria-selected="true"]') || opts[0];
    ddOpen = { sel: sel, btn: btn, wrap: wrap, panel: panel, mobile: mobile };
    if (mobile) overlayOpen(function () { ddClose(false); });
    if (cur) { cur.focus({ preventScroll: true }); cur.scrollIntoView({ block: "nearest" }); }
    opts.forEach(function (o) {
      o.addEventListener("click", function () { ddPick(o.dataset.v); });
    });
    panel.addEventListener("keydown", function (e) {
      var i = opts.indexOf(document.activeElement), k = e.key;
      if (k === "ArrowDown" || k === "ArrowRight") { e.preventDefault(); (opts[Math.min(opts.length - 1, i + 1)] || opts[0]).focus(); }
      else if (k === "ArrowUp" || k === "ArrowLeft") { e.preventDefault(); (opts[Math.max(0, i - 1)] || opts[0]).focus(); }
      else if (k === "Home") { e.preventDefault(); opts[0].focus(); }
      else if (k === "End") { e.preventDefault(); opts[opts.length - 1].focus(); }
      else if (k === "Escape") { e.preventDefault(); e.stopPropagation(); ddClose(true); }
      else if (k === "Tab") { e.preventDefault(); ddClose(true); }
    });
    var scrim = wrap.querySelector(".dd-scrim");
    if (scrim) scrim.addEventListener("click", function () { ddClose(true); });
  }
  function ddPlace(panel, btn) {
    var r = btn.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
    var grid = panel.querySelector(".dd-g.grid");
    var w = Math.max(r.width, grid ? 280 : 196);
    panel.style.minWidth = w + "px";
    var pw = panel.offsetWidth, ph = panel.offsetHeight;
    var left = Math.min(Math.max(8, r.left), vw - pw - 8);
    var below = vh - r.bottom - 8, above = r.top - 8;
    var up = ph > below && above > below;
    var room = (up ? above : below) - 6;
    panel.style.maxHeight = Math.max(160, Math.min(room, 420)) + "px";
    panel.style.left = left + "px";
    if (up) { panel.style.bottom = (vh - r.top + 6) + "px"; panel.classList.add("up"); }
    else panel.style.top = (r.bottom + 6) + "px";
  }
  function ddPick(v) {
    var o = ddOpen; if (!o) return;
    var changed = o.sel.value !== v;
    ddClose(true);
    if (!changed) return;
    o.sel.value = v;
    o.sel.dispatchEvent(new Event("change", { bubbles: true }));
    // 다시 그린 화면의 같은 버튼으로 초점을 옮깁니다.
    var nb = document.getElementById(o.sel.id);
    nb = nb && nb.nextElementSibling;
    if (nb && nb.classList.contains("dd")) nb.focus({ preventScroll: true });
  }
  function ddClose(refocus) {
    var o = ddOpen; if (!o) return;
    ddOpen = null;
    if (o.mobile) overlayDone();
    o.btn.setAttribute("aria-expanded", "false"); o.btn.classList.remove("open"); o.btn.removeAttribute("aria-controls");
    if (o.mobile) {
      o.wrap.classList.add("closing");
      setTimeout(function () { o.wrap.remove(); }, 180);
    } else o.wrap.remove();
    if (refocus && document.contains(o.btn)) o.btn.focus({ preventScroll: true });
  }
  // 바깥을 눌러 닫을 때는 그 클릭이 뒤의 행·버튼까지 가지 않게 막습니다.
  var ddSwallow = 0;
  document.addEventListener("pointerdown", function (e) {
    if (ddOpen && !ddOpen.mobile && !e.target.closest(".dd-panel") && !(e.target.closest(".dd") === ddOpen.btn)) { ddClose(false); ddSwallow = Date.now(); }
  }, true);
  document.addEventListener("click", function (e) {
    if (ddSwallow && Date.now() - ddSwallow < 800) { e.preventDefault(); e.stopPropagation(); }
    ddSwallow = 0;
  }, true);
  window.addEventListener("resize", function () { if (ddOpen && !ddOpen.mobile) ddClose(false); });
  window.addEventListener("scroll", function (e) {
    if (ddOpen && !ddOpen.mobile && !(e.target.closest && e.target.closest(".dd-panel"))) ddClose(false);
  }, true);

  var ST_LABEL = { all: "전체", approved: "예심 승인", filed: "신고서 제출", price_fixed: "가격 확정", upcoming: "상장 예정", completed: "상장 완료", withdrawn: "철회" };
  // 진행 상태·신고 연도는 여러 개를 고를 수 있습니다. 값은 "filed,price_fixed"처럼 쉼표로 이은 문자열("all"·""는 전체)
  var MULTI = { status: ["approved", "filed", "price_fixed", "upcoming", "completed", "withdrawn"], sector: SECTORS };
  function multi(k) {
    var v = state[k];
    return !v || v === "all" ? [] : String(v).split(",").filter(Boolean);
  }
  function toggleMulti(k, v) {
    if (!v || v === "all") { state[k] = DEFAULTS[k]; return; }
    var cur = multi(k), i = cur.indexOf(v);
    if (i >= 0) cur.splice(i, 1); else cur.push(v);
    var order = MULTI[k];
    cur.sort(order ? function (a, b) { return order.indexOf(a) - order.indexOf(b); } : function (a, b) { return b.localeCompare(a); });
    state[k] = cur.length ? cur.join(",") : DEFAULTS[k];
  }
  function yearText(ys) {
    var n = ys.map(Number).sort(function (a, b) { return a - b; });
    if (n.length === 1) return n[0] + "년 신고";
    var run = n.every(function (y, i) { return !i || y === n[i - 1] + 1; });
    if (run) return n[0] + "~" + n[n.length - 1] + "년 신고";
    return n.length <= 3 ? n.join("·") + "년 신고" : n[0] + "년 외 " + (n.length - 1) + "개 연도 신고";
  }
  function activeFilters() {
    var a = [], ss = multi("status"), ys = multi("year");
    if (ss.length) a.push({ k: "status", t: ST_LABEL[ss[0]] + (ss.length > 1 ? " 외 " + (ss.length - 1) : "") });
    if (state.board) a.push({ k: "board", t: BOARDS[state.board] });
    if (ys.length) a.push({ k: "year", t: yearText(ys) });
    var secs = multi("sector");
    if (secs.length) a.push({ k: "sector", t: secs[0] + (secs.length > 1 ? " 외 " + (secs.length - 1) : "") });
    if (state.focus) a.push({ k: "focus", t: FOCUS_SHORT + (state.focus === "lead" ? " 대표주관" : " 참여") });
    if (state.spac !== DEFAULTS.spac) a.push({ k: "spac", t: state.spac ? "스팩 포함" : "스팩 제외" });
    return a;
  }
  var FILTER_ICON = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5h14M5.5 10h9M8 15h4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  function renderList() {
    view = "list";
    var act = activeFilters();
    app.innerHTML = '<div class="content">' +
      '<div class="srow" role="search"><div class="sbox">' +
      '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M13.5 13.5L17 17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>' +
      '<input class="search" id="f-q" type="search" autocomplete="off" placeholder="기업명·주관사 검색 (초성 가능)" aria-label="기업명·주관사 검색" value="' + esc(state.q) + '">' +
      '<button type="button" class="sclear" id="f-clear" aria-label="검색어 지우기"' + (state.q ? "" : " hidden") + '><svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>' +
      '<button type="button" class="fbtn' + (act.length ? " on" : "") + '" id="f-menu" aria-haspopup="dialog" aria-expanded="false" aria-label="필터' + (act.length ? " " + act.length + "개 적용" : "") + '">' + FILTER_ICON +
      (act.length ? '<span class="fb-n">' + act.length + "</span>" : "") + "</button></div></div>" +
      (act.length ? '<div class="afilters" aria-label="적용된 필터">' + act.map(function (f) {
        return '<button type="button" class="af" data-k="' + f.k + '" aria-label="' + esc(f.t) + ' 필터 해제">' + esc(f.t) + '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></button>';
      }).join("") + '<button type="button" class="linkbtn" id="f-reset">모두 지우기</button></div>' : "") +
      '<section class="ledger" aria-label="IPO 딜 목록"><div class="ledger-top" id="ledger-top"></div><div id="result"></div></section>' +
      '<p class="note">희망 밴드·확정가·경쟁률·상장일은 공시 원문에서 규칙으로 추출한 값입니다. 스팩 등 단일 희망가는 밴드에 한 값으로 표시하고, 밴드가 없는 건의 * 값은 신고서 기재 기준가입니다. 공모액은 확정 건은 확정 금액, 그 외는 신고서 기재 금액입니다. 상장사 유상증자 등은 제외했습니다.' +
      (data.last_list_date ? " 자료 기준: DART " + esc(data.last_list_date) + (data.kind_as_of ? " · KIND " + esc(data.kind_as_of) : "") + "." : "") + "</p>" +
      "</div>";
    var qi = document.getElementById("f-q"), qc = document.getElementById("f-clear");
    qi.addEventListener("input", function (e) { state.q = e.target.value; qc.hidden = !state.q; renderRows(); });
    qc.addEventListener("click", function () { state.q = ""; qi.value = ""; qc.hidden = true; renderRows(); qi.focus(); });
    document.getElementById("f-menu").addEventListener("click", function () { if (fpOpen) fpClose(true); else fpShow(); });
    app.querySelectorAll(".af").forEach(function (b) {
      b.addEventListener("click", function () { state[b.dataset.k] = DEFAULTS[b.dataset.k]; persist(); renderList(); });
    });
    var rb = document.getElementById("f-reset");
    if (rb) rb.addEventListener("click", resetFilters);
    renderRows();
  }
  // ---- 필터 패널: PC는 버튼 아래 팝오버, 휴대폰은 아래에서 올라오는 시트
  var fpOpen = null;
  function fpBody() {
    var counts = { all: 0, approved: 0, filed: 0, price_fixed: 0, upcoming: 0, completed: 0, withdrawn: 0 };
    baseRows(true).forEach(function (d) { var k = stKey(d); counts.all++; counts[k] = (counts[k] || 0) + 1; });
    var secCounts = {};
    data.deals.forEach(function (d) { if (candOk(d, state.cand) && (state.spac || !isSpac(d)) && d.sector) secCounts[d.sector] = (secCounts[d.sector] || 0) + 1; });
    var opt2 = function (k, v, label, n) {
      var on = k === "status" || k === "year" || k === "sector" ? (multi(k).length ? multi(k).indexOf(String(v)) >= 0 : v === "all" || v === "") : String(state[k]) === String(v);
      return '<button type="button" class="fo" data-k="' + k + '" data-v="' + esc(v) + '" aria-pressed="' + on + '">' + esc(label) +
        (n != null ? '<span class="n">' + n + "</span>" : "") + "</button>";
    };
    var st = ["all", "approved", "filed", "price_fixed", "upcoming", "completed", "withdrawn"].filter(function (k) { return (k !== "approved" && k !== "upcoming") || counts[k] || multi("status").indexOf(k) >= 0; });
    return '<div class="fp-sec"><div class="fp-h">진행 상태<small>여러 개 선택</small></div><div class="fp-opts">' + st.map(function (k) { return opt2("status", k, ST_LABEL[k], counts[k]); }).join("") + "</div></div>" +
      '<div class="fp-sec"><div class="fp-h">상장 시장</div><div class="fp-opts">' + opt2("board", "", "전체") +
      Object.keys(BOARDS).map(function (k) { return opt2("board", k, BOARDS[k]); }).join("") + "</div></div>" +
      '<div class="fp-sec"><div class="fp-h">신고 연도<small>여러 개 선택</small></div><div class="fp-opts years" id="fp-years">' + opt2("year", "", "전체") +
      years().map(function (y) { return opt2("year", y, y); }).join("") + "</div></div>" +
      '<div class="fp-sec"><div class="fp-h">업종<small>여러 개 선택</small></div><div class="fp-opts">' + opt2("sector", "", "전체") +
      SECTORS.filter(function (k) { return secCounts[k]; }).map(function (k) { return opt2("sector", k, k, secCounts[k]); }).join("") + "</div></div>" +
      '<div class="fp-sec"><div class="fp-h">' + FOCUS_NAME + '</div><div class="fp-opts">' + opt2("focus", "", "전체") + opt2("focus", "any", "참여 딜") + opt2("focus", "lead", "대표주관") + "</div></div>" +
      '<div class="fp-foot"><label class="switch"><input type="checkbox" id="fp-spac"' + (state.spac ? " checked" : "") + ">스팩 포함</label>" +
      '<span class="sp"></span><button type="button" class="linkbtn" id="fp-reset">초기화</button>' +
      '<button type="button" class="fp-done" id="fp-done">' + filtered().length.toLocaleString("ko-KR") + "건 보기</button></div>";
  }
  function fpBind() {
    var o = fpOpen; if (!o) return;
    o.body.querySelectorAll(".fo").forEach(function (b) {
      b.addEventListener("click", function () {
        var k = b.dataset.k;
        if (k === "status" || k === "year" || k === "sector") toggleMulti(k, b.dataset.v); else state[k] = b.dataset.v;
        persist(); fpRefresh();
      });
    });
    o.body.querySelector("#fp-spac").addEventListener("change", function (e) { state.spac = e.target.checked; persist(); fpRefresh(); });
    o.body.querySelector("#fp-reset").addEventListener("click", function () {
      ["status", "spac", "year", "board", "sector", "focus"].forEach(function (k) { state[k] = DEFAULTS[k]; }); persist(); fpRefresh();
    });
    o.body.querySelector("#fp-done").addEventListener("click", function () { fpClose(true); });
  }
  function fpRefresh() {
    var o = fpOpen; if (!o) return;
    var sc = o.body.scrollTop;
    renderList();
    var nb = document.getElementById("f-menu");
    if (nb) { nb.setAttribute("aria-expanded", "true"); nb.classList.add("open"); o.btn = nb; }
    o.body.innerHTML = fpBody(); o.body.scrollTop = sc; fpBind();
  }
  function fpShow() {
    if (ddOpen) ddClose(false);
    var btn = document.getElementById("f-menu");
    var mobile = window.matchMedia("(max-width: 760px)").matches;
    var wrap = document.createElement("div");
    wrap.className = "dd-layer fp-layer" + (mobile ? " sheet-mode" : "");
    wrap.innerHTML = (mobile ? '<div class="dd-scrim"></div>' : "") +
      '<div class="dd-panel fp-panel" role="dialog" aria-label="필터">' +
      (mobile ? '<div class="dd-top"><span class="grab" aria-hidden="true"></span><b>필터</b></div>' : "") +
      '<div class="dd-body fp-body"></div></div>';
    document.body.appendChild(wrap);
    var panel = wrap.querySelector(".dd-panel");
    fpOpen = { btn: btn, wrap: wrap, panel: panel, body: wrap.querySelector(".fp-body"), mobile: mobile };
    if (mobile) overlayOpen(function () { fpClose(false); });
    fpOpen.body.innerHTML = fpBody(); fpBind();
    btn.setAttribute("aria-expanded", "true"); btn.classList.add("open");
    if (!mobile) {
      var r = btn.getBoundingClientRect();
      panel.style.width = Math.min(372, window.innerWidth - 16) + "px";
      panel.style.top = (r.bottom + 6) + "px";
      panel.style.left = Math.max(8, Math.min(r.right - panel.offsetWidth, window.innerWidth - panel.offsetWidth - 8)) + "px";
      panel.style.maxHeight = Math.max(240, window.innerHeight - r.bottom - 20) + "px";
    }
    var first = panel.querySelector('.fo[aria-pressed="true"]') || panel.querySelector(".fo");
    if (first) first.focus({ preventScroll: true });
    panel.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); fpClose(true); } });
    var scrim = wrap.querySelector(".dd-scrim");
    if (scrim) scrim.addEventListener("click", function () { fpClose(true); });
  }
  function fpClose(refocus) {
    var o = fpOpen; if (!o) return;
    fpOpen = null;
    if (o.mobile) overlayDone();
    var btn = document.getElementById("f-menu");
    if (btn) { btn.setAttribute("aria-expanded", "false"); btn.classList.remove("open"); }
    if (o.mobile) { o.wrap.classList.add("closing"); setTimeout(function () { o.wrap.remove(); }, 180); } else o.wrap.remove();
    if (refocus && btn) btn.focus({ preventScroll: true });
  }
  document.addEventListener("pointerdown", function (e) {
    if (fpOpen && !fpOpen.mobile && !e.target.closest(".fp-panel") && !e.target.closest("#f-menu")) { fpClose(false); ddSwallow = Date.now(); }
  }, true);
  function boardSelect(id) {
    return '<select class="sel" id="' + id + '" aria-label="상장 시장" data-def="">' + opt("", "전체 시장", state.board) + '<optgroup label="">' +
      Object.keys(BOARDS).map(function (k) { return opt(k, BOARDS[k], state.board).replace("<option ", '<option data-s="' + BOARD_SHORT[k] + '" '); }).join("") + "</optgroup></select>";
  }
  function syncReset() {
    var changed = state.status !== DEFAULTS.status || state.spac !== DEFAULTS.spac || state.year || state.board || state.q;
    var rb = document.getElementById("f-reset"), box = document.querySelector(".fopts");
    if (changed && !rb && box) {
      rb = document.createElement("button"); rb.type = "button"; rb.className = "linkbtn"; rb.id = "f-reset"; rb.textContent = "초기화";
      rb.addEventListener("click", resetFilters); box.appendChild(rb);
    } else if (!changed && rb) rb.remove();
  }
  function resetFilters() {
    ["status", "spac", "year", "board", "sector", "focus", "q"].forEach(function (k) { state[k] = DEFAULTS[k]; });
    persist(); renderList();
  }

  var COLS = [
    { key: "date", label: "상장일 / 신고일", cls: "c-date" },
    { key: "name", label: "기업", cls: "c-name" },
    { key: "lead", label: "대표주관", cls: "c-lead" },
    { key: "status", label: "상태", cls: "c-status" },
    { key: "band", label: "희망 밴드(원)", cls: "c-band n" },
    { key: "final", label: "확정가(원)", cls: "c-final n" },
    { key: "inst", label: "수요예측", cls: "c-inst n" },
    { key: "retail", label: "일반청약", cls: "c-retail n" },
    { key: "amount", label: "공모액(억원)", cls: "c-amt n" }
  ];
  function renderRows() {
    var rows = filtered();
    var amt = rows.reduce(function (s, d) { return s + (d.offer_amount || 0); }, 0);
    document.getElementById("ledger-top").innerHTML = '<h2>IPO 딜 <span class="cnt">' + rows.length + "</span></h2>" +
      (rows.length ? '<span class="hint">공모액 합계 <b>' + eok(amt) + "</b>억원</span>" : "");
    var box = document.getElementById("result");
    if (!rows.length) {
      box.innerHTML = '<div class="empty">조건에 맞는 공모 건이 없습니다. <button type="button" class="linkbtn" id="e-reset">필터 초기화</button></div>';
      document.getElementById("e-reset").addEventListener("click", resetFilters);
      return;
    }
    var q = state.q.trim();
    var html = '<div class="scroll"><table class="deals"><thead><tr>' + COLS.map(function (c) {
      var on = state.sortKey === c.key;
      return "<th class=\"" + c.cls + '"' + (on ? ' aria-sort="' + (state.sortDir > 0 ? "ascending" : "descending") + '"' : "") +
        '><button type="button" class="sort" data-key="' + c.key + '">' + c.label + "</button></th>";
    }).join("") + "</tr></thead><tbody>";
    var cards = '<div class="cards">';
    rows.forEach(function (d) {
      var p = position(d);
      var tags = boardTag(d) + (isSpac(d) ? '<span class="tag b-spac">스팩</span>' : "") + refileTag(d) + focusTag(d);
      var bandCell = d.offer_price_low ? bandText(d) : (d.filed_price ? '<span class="dim" title="신고서 기재 기준가">' + int(d.filed_price) + "*</span>" : "-");
      var href = "#/deal/" + encodeURIComponent(d.deal_id);
      html += '<tr data-id="' + esc(d.deal_id) + '">' +
        '<td class="c-date">' + (d.listing_dt ? esc(d.listing_dt) : d.demand_start && d.status !== "withdrawn" ? '<span class="dim">수요예측 </span>' + esc(demandText(d, true)) : '<span class="dim">' + (d.status === "approved" ? "승인 " : "신고 ") + esc(d.first_filing_dt) + "</span>") + "</td>" +
        '<td class="c-name"><a class="nm" href="' + href + '">' + hlName(name(d), q) + "</a>" + tags + "</td>" +
        '<td class="c-lead" title="' + esc(d.lead_underwriters || "") + '">' + (d.lead_underwriters ? highlight(d.lead_underwriters, q) : '<span class="dim">-</span>') + "</td>" +
        '<td class="c-status">' + chip(d) + "</td>" +
        '<td class="c-band n">' + bandCell + "</td>" +
        '<td class="c-final n">' + (d.final_price ? (p ? pill(p) : "") + "<b>" + int(d.final_price) + "</b>" : '<span class="dim">-</span>') + "</td>" +
        '<td class="c-inst n">' + (d.inst_demand_ratio != null ? ratio(d.inst_demand_ratio) : '<span class="dim">-</span>') + "</td>" +
        '<td class="c-retail n">' + (d.retail_ratio != null ? ratio(d.retail_ratio) : '<span class="dim">-</span>') + "</td>" +
        '<td class="c-amt n">' + eok(d.offer_amount) + "</td></tr>";
      var price = d.status === "approved"
        ? '<span class="lbl">시장</span><span class="b">' + esc((d.prelim && d.prelim.market) || d.market || "-") + '</span><span class="lbl">청구</span><span class="b">' + esc((d.prelim && d.prelim.filed_dt) || "-") + "</span>"
        : d.final_price
        ? '<span class="b">' + bandCell + '</span><span class="arrow" aria-label="확정">→</span><b>' + int(d.final_price) + "</b>" + (p ? pill(p) : "")
        : '<span class="lbl">밴드</span><span class="b">' + bandCell + "</span>";
      var hasRatio = d.inst_demand_ratio != null || d.retail_ratio != null;
      cards += '<a class="card" href="' + href + '" data-id="' + esc(d.deal_id) + '">' +
        '<div class="r1"><span class="nmw"><span class="nm">' + hlName(name(d), q) + '</span>' + (tags ? '<span class="tags">' + tags + "</span>" : "") + "</span>" + chip(d) + "</div>" +
        '<div class="r2">' + (d.listing_dt ? '상장 <span class="mono">' + esc(d.listing_dt) + "</span>" : d.demand_start && d.status !== "withdrawn" ? '수요예측 <span class="mono">' + esc(demandText(d, true)) + "</span>" : (d.status === "approved" ? "예심 승인 " : "신고 ") + '<span class="mono">' + esc(d.first_filing_dt) + "</span>") + " · " + (d.lead_underwriters ? highlight(uwShortStr(d.lead_underwriters), q) : "주관사 미확인") + "</div>" +
        '<div class="r3"><span class="price">' + price + "</span>" + (!hasRatio && d.offer_amount != null ? '<span class="amt r3a">공모액<b>' + eok(d.offer_amount) + "억</b></span>" : "") + "</div>" +
        (hasRatio
          ? '<div class="r4">' + (d.inst_demand_ratio != null ? "<span>수요예측<b>" + ratio(d.inst_demand_ratio) + "</b></span>" : "") +
            (d.retail_ratio != null ? "<span>일반청약<b>" + ratio(d.retail_ratio) + "</b></span>" : "") +
            (d.offer_amount != null ? '<span class="amt">공모액<b>' + eok(d.offer_amount) + "억</b></span>" : "") + "</div>" : "") + "</a>";
    });
    cards += "</div>";
    box.innerHTML = html + "</tbody></table></div>" + cards;
    box.querySelectorAll("th .sort").forEach(function (b) {
      b.addEventListener("click", function () {
        var k = b.dataset.key;
        if (state.sortKey === k) state.sortDir = -state.sortDir;
        else { state.sortKey = k; state.sortDir = (k === "name" || k === "status" || k === "lead") ? 1 : -1; }
        persist(); renderRows();
        var nb = document.querySelector('th .sort[data-key="' + k + '"]'); if (nb) nb.focus();
      });
    });
    box.querySelector("tbody").addEventListener("click", function (e) {
      if (e.target.closest("a")) return;
      var tr = e.target.closest("tr[data-id]");
      if (tr) openDeal(tr.dataset.id);
    });
  }
  // 시트를 열면 키보드로 연 경우에만 닫기 버튼에 초점(터치·마우스로 열면 시트 자체에 두어 초점 테두리를 띄우지 않음)
  var kbNav = false;
  document.addEventListener("keydown", function () { kbNav = true; }, true);
  document.addEventListener("pointerdown", function () { kbNav = false; }, true);
  function focusSheet() {
    if (kbNav) document.getElementById("s-close").focus({ preventScroll: true });
    else { sheet.setAttribute("tabindex", "-1"); sheet.focus({ preventScroll: true }); }
  }
  function openDeal(id) { goPath("/deal/" + encodeURIComponent(id)); }

  // ---------------------------------------------------------------- 상세
  function table(head, rows, numCols, cls) {
    if (!rows.length) return '<p class="muted">해당 정보가 없습니다.</p>';
    numCols = numCols || [];
    return '<div class="scroll"><table class="mini' + (cls ? " " + cls : "") + '"><thead><tr>' + head.map(function (h, i) {
      return "<th" + (numCols.indexOf(i) >= 0 ? ' class="num"' : "") + ">" + esc(h) + "</th>";
    }).join("") + "</tr></thead><tbody>" + rows.map(function (r) {
      return "<tr>" + r.map(function (c, i) { return "<td" + (numCols.indexOf(i) >= 0 ? ' class="num"' : "") + ">" + c + "</td>"; }).join("") + "</tr>";
    }).join("") + "</tbody></table></div>";
  }
  // 회사 개요: 요약문(신고서 '사업의 개요'를 바탕으로 작성) 또는 발췌, KIND 업종·주요제품
  function companyBlock(d) {
    var c = d.company;
    if (!c || isSpac(d)) return "";
    var text = c.summary || c.excerpt;
    var meta = [];
    if (c.industry) meta.push('<span><b>업종</b>' + esc(c.industry) + "</span>");
    if (c.products) meta.push('<span><b>주요제품</b>' + esc(c.products) + "</span>");
    if (!text && !meta.length) return "";
    var src = c.summary ? "증권신고서 '사업의 개요'를 바탕으로 요약" : c.excerpt ? "증권신고서 '사업의 개요' 발췌" : "";
    return '<section class="company" aria-label="회사 개요"><h3>회사 개요</h3>' +
      (text ? "<p>" + esc(text) + "</p>" : "") +
      (meta.length ? '<div class="cmeta">' + meta.join("") + "</div>" : "") +
      '<p class="csrc">' + [src && (c.source_rcept_no ? src + " · " + dartLink(c.source_rcept_no) : src), meta.length ? "업종·주요제품: KIND 상장법인 목록" : ""].filter(Boolean).join(" / ") + "</p></section>";
  }
  // 유통물량·보호예수: 투자설명서(없으면 신고서) 원문의 표에서 읽은 값
  function periodText(m) {
    if (m < 1) return Math.round(m * 30) + "일";
    var y = Math.floor(Math.round(m) / 12), r = Math.round(m) % 12;
    return y && r ? y + "년 " + r + "개월" : y ? y + "년" : r + "개월";
  }
  function addPeriod(iso, m) {
    if (!iso) return "";
    var t = new Date(iso + "T00:00:00");
    if (m < 1) t.setDate(t.getDate() + Math.round(m * 30));
    else t.setMonth(t.getMonth() + Math.round(m));
    return t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0");
  }
  function pct1(v) { return v == null ? "-" : (Math.round(v * 10) / 10).toFixed(1) + "%"; }
  // 보호예수 해제일 기준: 상장일(확정) → KIND 상장예정일 → 예상 상장일. q: ""(확정)·"예정"·"예상"
  function lkBase(d) { var l = lstOf(d); return { dt: l.dt, q: l.q }; }
  function lkDate(base, x) {
    // x: {months} 또는 {until}(날짜로 정해진 기간: 우리사주 예탁 등, 상장일과 무관)
    if (x.until) return { dt: x.until, q: "", fixed: true };
    if (x.months == null || !base.dt) return { dt: "", q: "" };
    return { dt: addPeriod(base.dt, x.months), q: base.q };
  }
  function dtShort(iso) { return iso ? iso.slice(2).replace(/-/g, ".") : ""; }
  function lkWhen(x) { return x.until ? dtShort(x.until) + " 이후" : x.mixed ? esc(x.label) : x.months === 0 ? "상장일" : periodText(x.months) + " 후"; }
  // 해제 시점 목록(누적): 상장일 + 해제 일정. 같은 비율이 이어지는 중간 시점은 뺍니다
  function lkPoints(d) {
    var L = d.lockup || {}, f0 = L.float0, base = lkBase(d);
    var pts = [{ months: 0, shares: f0 ? f0.shares : null, pct: f0 ? f0.pct : null }].concat((L.schedule || []).map(function (x) {
      return { months: x.months, until: x.until, shares: x.shares, pct: x.pct };
    }));
    pts = pts.filter(function (x, i) { return x.pct != null && (i === 0 || x.pct !== pts[i - 1].pct || i === pts.length - 1); });
    return pts.map(function (x, i) {
      var prev = i ? pts[i - 1].pct : 0;
      return { months: x.months, until: x.until, pct: x.pct, add: i ? x.pct - prev : x.pct, prev: prev, date: x.months === 0 ? { dt: base.dt, q: base.q } : lkDate(base, x) };
    });
  }
  function lkDateHtml(dd, short) {
    if (!dd || !dd.dt) return "";
    var t = short ? dtShort(dd.dt) : esc(dd.dt);
    return dd.q ? '<span class="lk-est" title="' + dd.q + ' 상장일 기준">' + t + "</span>" : t;
  }
  // 상단 요약(카드 첫 화면, 시안 A): 증권신고서 제출부터 상장 전까지만 보여 주고, 상장 후(상장일 당일 포함)와 철회 건은 숨깁니다
  function lkSummary(d) {
    var L = d.lockup;
    if (!L || !L.float0 || d.status === "withdrawn" || (d.listing_dt && d.listing_dt <= asOf())) return "";
    var pts = lkPoints(d), f0 = L.float0, rel = pts.slice(1), first = rel[0], base = lkBase(d);
    var top = (L.groups || []).filter(function (g) { return g.category === "최대주주등" && g.months != null; })
      .sort(function (a, b) { return b.months - a.months; })[0];
    var in6 = rel.filter(function (x) { return x.months != null && x.months <= 6; }).pop();
    var tile = function (k, val, sub) { return '<div><span class="k">' + k + '</span><span class="v">' + val + "</span>" + (sub ? '<span class="s">' + sub + "</span>" : "") + "</div>"; };
    return '<div class="lk-sum lk-a"><div class="lk-sum-hd">유통물량·보호예수 요약</div><div class="terms t3">' +
      tile("상장일 유통가능", pct1(f0.pct), int(f0.shares) + "주") +
      tile("첫 해제", first ? "+" + pct1(first.add) : '<span class="dim">-</span>', first ? lkWhen(first) + (first.date.dt ? " · " + lkDateHtml(first.date, true) : "") : "") +
      tile(top ? "최대주주 보호예수" : "6개월 내 누적", top ? periodText(top.months) : in6 ? pct1(in6.pct) : '<span class="dim">-</span>',
        top ? (base.dt ? "해제 " + lkDateHtml(lkDate(base, top), true) : pct1(top.pct) + " 보유") : in6 ? "상장일 대비 +" + pct1(in6.pct - f0.pct) : "") +
      "</div></div>";
  }
  // 상단 요약(가격 확정 단계): 확정 공모가가 나온 뒤 상장 전까지, 유통물량 요약 대신 공모 결과를 보여 줍니다
  function priceStage(d) { return !!d.final_price && d.status !== "withdrawn" && !(d.listing_dt && d.listing_dt <= asOf()); }
  function subDates(d) {
    var m = (d.subscription_raw || "").match(/(\d{1,2})월\s*(\d{1,2})일(?:[^~]*~[^0-9]*(?:\d{4}년\s*)?(\d{1,2})월\s*(\d{1,2})일)?/);
    if (!m) return "";
    var f = function (a, b) { return ("0" + a).slice(-2) + "." + ("0" + b).slice(-2); };
    return f(m[1], m[2]) + (m[3] ? "~" + f(m[3], m[4]) : "");
  }
  function priceSummary(d) {
    if (!priceStage(d)) return "";
    var p = position(d), vt = vsTop(d), c = d.lockup && d.lockup.commit, sd = subDates(d);
    // 배경색: 하단 이하 파랑, 밴드 내 초록, 상단 이상(및 단일가) 빨강
    var tone = p === "하단" || p === "미달" ? "t-blue" : p === "밴드 내" ? "t-green" : "t-red";
    var tile = function (k, val, sub) { return '<div><span class="k">' + k + '</span><span class="v">' + val + "</span>" + (sub ? '<span class="s">' + sub + "</span>" : "") + "</div>"; };
    var inst = d.inst_demand_ratio != null ? ratio(d.inst_demand_ratio, 2) : '<span class="dim">집계 전</span>';
    var instS = [d.inst_demand_count ? int(d.inst_demand_count) + "건 참여" : "", c ? "확약 " + pct1(c.ratio) : ""].filter(Boolean).join(" · ");
    var subStarted = sd && asOf().slice(5).replace("-", ".") >= sd.slice(0, 5);
    var ret = d.retail_ratio != null ? ratio(d.retail_ratio, 2) : '<span class="dim">' + (subStarted ? "집계 전" : "청약 전") + "</span>";
    var retS = d.retail_ratio != null ? (d.retail_count ? int(d.retail_count) + "건" : "") : (sd ? "청약 " + sd : "");
    var gap = p === "미달" || p === "하단" ? (d.final_price / d.offer_price_low - 1) * 100 : vt;
    var gapT = gap != null && p && p !== "상단" && p !== "하단" ? (p === "미달" ? "하단 " : "상단 ") + (gap > 0 ? "+" : "") + (Math.round(gap * 10) / 10).toFixed(1) + "%" : "";
    var posV = p ? pill(p) + (gapT ? " <small>" + gapT + "</small>" : "") : '<span class="pill">' + (d.offer_price_low && d.offer_price_low === d.offer_price_high ? "단일 희망가" : "밴드 정보 없음") + "</span>";
    return '<div class="ps ' + tone + '"><div class="ps-hd"><b>공모가 확정 요약</b><span>' + (pricingDate(d) ? esc(pricingDate(d).slice(5).replace("-", ".")) + " 확정" : "") + "</span></div>" +
      '<div class="ps-body"><div class="ps-hero"><span class="k">확정 공모가</span><span class="v">' + int(d.final_price) + "<small>원</small></span>" +
      '<span class="pp">' + posV + '</span><span class="s">' + (d.offer_price_low ? "희망 " + bandText(d) + "원" : "") + "</span></div>" +
      '<div class="ps-side">' + tile("수요예측 경쟁률", inst, instS) + tile("일반청약 경쟁률", ret, retS) + "</div></div></div>";
  }
  function lockupBlock(d) {
    var L = d.lockup;
    if (!L || (!L.float0 && !L.schedule && !L.commit)) return "";
    var listed = L.listed, f0 = L.float0, c = L.commit, base = lkBase(d);
    var tile = function (k, v, sub) { return '<div><span class="k">' + k + '</span><span class="v">' + v + "</span>" + (sub ? '<span class="s">' + sub + "</span>" : "") + "</div>"; };
    var h = '<div class="terms lk-terms">' +
      tile("상장일 유통가능", f0 ? pct1(f0.pct) : '<span class="dim">-</span>', f0 ? int(f0.shares) + "주" : "") +
      tile("기관 의무보유확약", c ? pct1(c.ratio) : '<span class="dim">-</span>', c ? "수요예측 신청수량 기준" : (d.status === "filed" ? "수요예측 결과가 나오면 표시" : "원문에서 찾지 못함")) +
      tile("상장예정주식수", listed ? int(listed) + "<small>주</small>" : '<span class="dim">-</span>') + "</div>";
    // 해제 일정(누적)
    var sch = L.schedule || [];
    if (f0 || sch.length) {
      var pts = lkPoints(d);
      h += '<div class="lk-sub">보호예수 해제 일정 <span class="dim">(누적 유통가능' + (base.q && base.dt ? " · 해제일은 " + base.q + " 상장일 " + esc(base.dt) + " 기준" : "") + ")</span></div><ol class=\"lk-sched\">" + pts.map(function (x, i) {
        return '<li><span class="w">' + lkWhen(x) + (x.date.dt ? "<small>" + lkDateHtml(x.date) + "</small>" : "") + '</span><span class="bar"><i class="base" style="width:' + Math.min(100, x.prev).toFixed(2) + '%"></i><i class="add" style="left:' + Math.min(100, x.prev).toFixed(2) + "%;width:" + Math.max(0, Math.min(100 - x.prev, x.add)).toFixed(2) + '%"></i></span>' +
          '<span class="p">' + pct1(x.pct) + (i ? '<small>+' + pct1(x.add) + "</small>" : "") + "</span></li>";
      }).join("") + "</ol>" + (sch.some(function (x) { return x.derived; }) ? '<p class="snote">해제 일정은 주주별 매각제한 내역으로 계산했습니다.</p>' : "") +
        (sch.some(function (x) { return x.until; }) ? '<p class="snote">날짜로 적힌 시점(우리사주 예탁 등)은 상장일과 무관하게 정해져 있어 다른 시점과 선후가 바뀔 수 있습니다.</p>' : "");
    }
    if (L.groups && L.groups.length) {
      h += '<div class="lk-sub">보호예수·의무보유 내역</div>' + table(["구분", "기간 · 해제일", "주식수", "상장주식 대비"],
        L.groups.map(function (g) {
          var per = g.until ? "날짜 지정" : g.mixed ? esc(g.label) : esc(periodText(g.months));
          var dd = g.mixed ? null : lkDate(base, g);
          return [esc(g.category), '<span class="lk-per">' + per + (dd && dd.dt ? "<small>" + lkDateHtml(dd, true) + "</small>" : "") + "</span>", int(g.shares), g.pct != null ? pct1(g.pct) : "-"];
        }), [2, 3]);
      if (L.groups_full === false) h += '<p class="snote">원문 표에 실린 주주 기준입니다. 표 밖의 물량(공모주 배정분 등)은 빠져 있을 수 있습니다.</p>';
    }
    if (c && c.by && c.by.length) {
      h += '<div class="lk-sub">기관 의무보유확약 기간별 <span class="dim">(신청수량)</span></div>' + table(["확약 기간", "해제일", "신청수량", c.total ? "참여수량 대비" : "확약 내 비중"],
        c.by.slice().sort(function (a, b) { return b.months - a.months; }).map(function (b) {
          var dd = lkDate(base, b);
          return [esc(periodText(b.months)), dd.dt ? lkDateHtml(dd, true) : '<span class="dim">-</span>', int(b.qty), pct1(b.qty / (c.total || c.committed) * 100)];
        }), [2, 3]);
    }
    var src = [];
    if (L.src_float) src.push("유통물량 " + dartLink(L.src_float));
    if (L.src_commit) src.push("확약 " + dartLink(L.src_commit));
    h += '<p class="snote">상장일 유통가능 물량은 공모주 배정분의 기관 의무보유확약을 반영하지 않은 증권신고서·투자설명서 기준입니다. 해제일은 상장일에 기간을 더한 날짜이며, 상장 전에는 예정·예상 상장일로 계산합니다. 원문의 표를 규칙으로 읽은 값이며, 검증이 맞지 않은 항목은 비워 둡니다.' +
      (src.length ? " 출처: " + src.join(" · ") : "") + "</p>";
    return section("유통물량·보호예수", h, true);
  }
  // 재무 요약: 증권신고서·투자설명서 '요약재무정보'(백만원 → 억원). 가장 최근 분·반기 1개 + 연간 최대 3개
  var FIN_ROWS = [["revenue", "매출액"], ["op_income", "영업이익"], ["net_income", "당기순이익"],
    ["assets", "자산총계"], ["liabilities", "부채총계"], ["equity", "자본총계"]];
  function finNum(v) {
    if (v == null) return '<span class="dim">-</span>';
    var e = v / 100, a = Math.abs(e);
    var t = a >= 100 || a === 0 ? Math.round(e).toLocaleString("ko-KR") : e.toLocaleString("ko-KR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    return e < 0 ? '<span class="neg">' + t + "</span>" : t;
  }
  function finBlock(d) {
    var F = d.fin;
    if (!F || !F.periods || !F.periods.length) return "";
    var idx = [], annual = 0;
    F.periods.forEach(function (p, i) {
      var part = F.q && F.q[i];
      if (part ? i === 0 : annual < 3) { idx.push(i); if (!part) annual++; }
    });
    var rows = FIN_ROWS.filter(function (r) { return F[r[0]]; }).map(function (r) {
      return [r[1]].concat(idx.map(function (i) { return finNum(F[r[0]][i]); }));
    });
    var head = ["억원"].concat(idx.map(function (i) { return esc(F.periods[i]); }));
    var nums = idx.map(function (_, j) { return j + 1; });
    var h = table(head, rows, nums, "fin") +
      '<p class="snote">' + esc(F.basis || "별도") + " 기준 · 증권신고서 요약재무정보" +
      (F.q && F.q[idx[0]] ? " · 분·반기는 해당 연도 누적" : "") +
      (F.src ? " · 출처 " + dartLink(F.src) : "") + "</p>";
    return section("재무 요약", h, true);
  }
  // 공모 후 시총: 상장예정주식수 × 가격(억원, 1조 이상은 조원). 밴드는 하단~상단
  function capText(n, lo, hi) {
    if (!n || !lo) return "";
    var x = n * lo, y = n * (hi || lo), jo = y >= 1e12;
    var f = function (v) { return jo ? (v / 1e12).toLocaleString("ko-KR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : eok(v); };
    var a = f(x), b = f(y);
    return "시총 " + (a === b ? a : a + "~" + b) + (jo ? "조원" : "억원");
  }
  function bandCap(d) {
    var single = d.offer_price_low && d.offer_price_low === d.offer_price_high;
    var c = capText(d.listed_shares, d.offer_price_low, d.offer_price_high);
    return [single ? "단일 희망가" : "", c].filter(Boolean).join(" · ");
  }
  function dartLink(no, text) {
    return '<a href="' + DART_VIEW + esc(no) + '" target="_blank" rel="noopener noreferrer">' + esc(text || no) + "</a>";
  }
  var FIELD = {
    filed_price: "신고서 기재 기준가(원)", offer_price_low: "희망 밴드 하단(원)", offer_price_high: "희망 밴드 상단(원)",
    final_price: "확정 공모가(원)", shares_offered: "모집·매출 주식수", offer_amount: "모집·매출 총액(원)",
    secondary_shares: "구주매출 주식수", lead_underwriters: "대표주관",
    inst_demand_ratio: "수요예측 경쟁률(:1)", retail_ratio: "일반청약 경쟁률(:1)", listing_dt: "상장일"
  };
  function fieldValue(v) {
    if (/^\d+$/.test(String(v))) return int(v);
    if (/^\d+\.\d+$/.test(String(v))) return Number(v).toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return v;
  }
  // 공모 구조: 신주·구주 비중, 공모비율(공모주식수 ÷ 상장예정주식수), 인수수수료율(인수대가 ÷ 인수금액)
  function numOf(v) { if (v == null) return null; var n = Number(String(v).replace(/,/g, "")); return isFinite(n) && String(v).trim() !== "-" && String(v).trim() !== "" ? n : null; }
  function structInfo(d) {
    var so = d.shares_offered, sec = d.secondary_shares || 0, ls = d.listed_shares;
    var amt = 0, fee = 0;
    (d.underwriters || []).forEach(function (u) { var a = numOf(u.udtamt), f = numOf(u.udtprc); if (a && f != null) { amt += a; fee += f; } });
    var sellers = (d.sellers || []).filter(function (x) { return numOf(x.slstk); });
    return { so: so, neu: so != null ? so - sec : null, sec: sec, ls: ls, flt: so && ls ? so / ls * 100 : null,
      fee: amt ? fee / amt * 100 : null, feeAmt: amt ? fee : null, sellers: sellers };
  }
  function valTerms(d, V, term, pct) {
    var num = function (v, dg) { return v == null ? "-" : Number(v).toLocaleString("ko-KR", { maximumFractionDigits: dg == null ? 2 : dg }); };
    var disc = V.disc_low != null ? num(V.disc_low, 1) + "~" + num(V.disc_high, 1) + "<small>%</small>" : "-";
    var fd = V.final_disc != null ? (V.final_disc >= 0 ? num(V.final_disc, 1) + "<small>%</small>" : "할증 " + num(-V.final_disc, 1) + "<small>%</small>") : "-";
    return '<div class="terms t4 val">' +
      term("평가방법", esc(V.method || "-") + (V.multiple != null ? ' <span class="sl">·</span> ' + num(V.multiple) + "<small>배</small>" : ""), [V.basis, V.peers_n && !(V.peers && V.peers.length) ? "비교기업 " + V.peers_n + "곳" : ""].filter(Boolean).join(" · ") || (V.multiple != null ? "적용 배수" : "")) +
      term("주당 평가가액", V.value ? int(V.value) + "<small>원</small>" : "-", V.pv_rate != null ? "추정이익 현가 할인 연 " + num(V.pv_rate, 1) + "%" : "") +
      term("밴드 할인율", disc, d.offer_price_low ? "희망 밴드 " + bandText(d) + "원" : "") +
      term("확정가 할인율", fd, d.final_price ? "확정가 " + int(d.final_price) + "원 기준" : "공모가 미확정") +
      "</div>" + (V.peers && V.peers.length ? '<p class="peers"><span class="k">비교기업 ' + V.peers.length + "곳</span>" + V.peers.map(function (x) { return '<span class="chip-s">' + esc(x) + "</span>"; }).join("") + "</p>" : "");
  }
  function structBlock(d) {
    if (isSpac(d)) return "";
    var s = structInfo(d);
    var V = d.val;
    if (s.so == null && s.fee == null && !V) return "";
    var term = function (k, v, sub) { return '<div><span class="k">' + k + '</span><span class="v">' + v + "</span>" + (sub ? '<span class="s">' + sub + "</span>" : "") + "</div>"; };
    var pct = function (v) { return v == null ? "-" : v.toLocaleString("ko-KR", { maximumFractionDigits: 1 }) + "<small>%</small>"; };
    var top = s.sellers.slice().sort(function (a, b) { return numOf(b.slstk) - numOf(a.slstk); });
    var selTxt = top.length ? top.slice(0, 2).map(function (x) { return esc(x.hdr) + (x.rl_cmp && x.rl_cmp !== "-" ? "(" + esc(x.rl_cmp) + ")" : ""); }).join(", ") + (top.length > 2 ? " 외 " + (top.length - 2) + "명" : "") : "";
    return section(V ? "공모 구조 · 밸류에이션" : "공모 구조", '<div class="terms t4">' +
      term("신주 · 구주", s.so != null ? pct(s.so ? s.neu / s.so * 100 : null) + ' <span class="sl">/</span> ' + pct(s.so ? s.sec / s.so * 100 : null) : "-", s.sec ? "구주 " + int(s.sec) + "주" + (selTxt ? " · " + selTxt : "") : "전량 신주") +
      term("공모비율", pct(s.flt), s.ls ? "상장예정 " + int(s.ls) + "주" : "상장예정주식수 미확인") +
      term("인수수수료율", pct(s.fee), s.feeAmt != null ? "인수대가 " + eok(s.feeAmt) + "억원 · 신고서 기준" : "") +
      term("인수단", int((d.underwriters || []).length) + "<small>곳</small>", (d.underwriters || []).map(function (u) { return u.actsen; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).join("·")) +
      "</div>" + (V ? valTerms(d, V, term, pct) : "") +
      '<p class="snote">공모비율은 공모주식수 ÷ 상장예정주식수, 수수료율은 인수단 인수대가 합계 ÷ 인수금액 합계(증권신고서 주요정보, 밴드 하단 기준)입니다. 성과수수료는 포함하지 않습니다.' +
      (V ? " 공모가 산정 근거는 증권신고서 &lsquo;공모가격에 대한 의견&rsquo;에서 규칙으로 읽은 값입니다" + (V.src ? " (" + dartLink(V.src) + ")" : "") + "." + (V.check === false ? ' <b class="warn-t">할인율·평가가액이 희망 밴드와 맞지 않아 원문 확인이 필요합니다.</b>' : "") : "") + "</p>", true);
  }
  function section(title, body, open, count) {
    return '<details class="sec"' + (open ? " open" : "") + "><summary>" + esc(title) +
      (count != null ? '<span class="cnt">' + count + "</span>" : "") + "</summary>" + body + "</details>";
  }

  // 희망 밴드 막대 위에 확정가를 표시합니다.
  function bandViz(d, width) {
    var lo = d.offer_price_low, hi = d.offer_price_high, f = d.final_price;
    if (!lo || lo === hi) return "";
    var p = position(d);
    var minV = Math.min(lo, f || lo), maxV = Math.max(hi, f || hi);
    var span = maxV - minV || hi;
    var a = minV - span * 0.18, b = maxV + span * 0.18;
    var W = Math.max(260, Math.round(width || 600)), H = 84, L = 14, R = 14, y = 46;
    var x = function (v) { return L + (v - a) / (b - a) * (W - L - R); };
    var svg = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="희망 밴드 ' + int(lo) + "~" + int(hi) + "원" + (f ? ", 확정가 " + int(f) + "원" : "") + '">' +
      '<line class="axis" x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '"/>' +
      '<rect class="band" x="' + x(lo) + '" y="' + (y - 9) + '" width="' + Math.max(2, x(hi) - x(lo)) + '" height="18" rx="4"/>' +
      '<line class="tick" x1="' + x(lo) + '" x2="' + x(lo) + '" y1="' + (y + 12) + '" y2="' + (y + 16) + '"/>' +
      '<line class="tick" x1="' + x(hi) + '" x2="' + x(hi) + '" y1="' + (y + 12) + '" y2="' + (y + 16) + '"/>' +
      '<text x="' + x(lo) + '" y="' + (y + 30) + '" text-anchor="middle">하단 ' + int(lo) + "</text>" +
      '<text x="' + x(hi) + '" y="' + (y + 30) + '" text-anchor="middle">상단 ' + int(hi) + "</text>";
    if (f) {
      var fx = x(f), col = "var(--pos-" + POS_KEY[p] + ")";
      var anchor = fx < 80 ? "start" : fx > W - 80 ? "end" : "middle";
      svg += '<line x1="' + fx + '" x2="' + fx + '" y1="' + (y - 18) + '" y2="' + (y + 9) + '" stroke="' + col + '" stroke-width="2.5"/>' +
        '<circle cx="' + fx + '" cy="' + y + '" r="7" fill="' + col + '" stroke="var(--surface)" stroke-width="2"/>' +
        '<text class="lbl" x="' + fx + '" y="' + (y - 24) + '" text-anchor="' + anchor + '">확정 ' + int(f) + "원</text>";
    }
    svg += "</svg>";
    var cap = f
      ? "확정가는 밴드 하단 대비 " + pctText((f / lo - 1) * 100) + ", 상단 대비 " + pctText((f / hi - 1) * 100) + "입니다."
      : "확정가가 아직 없습니다. 발행조건확정 신고서가 제출되면 표시됩니다.";
    return '<div class="bandviz"><div class="label">희망 밴드와 확정가</div>' + svg + '<p class="cap">' + cap + "</p></div>";
  }

  function closeSheet() {
    if (sheet.hidden) return;
    sheet.hidden = true; shade.hidden = true; sheetId = null;
    document.documentElement.classList.remove("lock");
  }
  // nav: 바이오 명단에서 연 경우 {sid, idx, len, prev, next} — 같은 카드를 그리되 앞뒤 이동만 바이오 명단 기준
  function openSheet(id, nav) {
    var d = data.deals.filter(function (x) { return x.deal_id === id; })[0];
    var wasOpen = !sheet.hidden;
    sheet.hidden = false; shade.hidden = false; sheetId = nav ? nav.sid : id;
    document.documentElement.classList.add("lock");
    if (!wasOpen) { sheet.style.animation = "none"; void sheet.offsetWidth; sheet.style.animation = ""; }
    var titleEl = document.getElementById("sheet-title"), chipEl = document.getElementById("sheet-chip"), subEl = document.getElementById("sheet-sub");
    if (!d) {
      titleEl.textContent = "공모 건을 찾을 수 없습니다"; chipEl.innerHTML = ""; subEl.textContent = ""; document.getElementById("sheet-tl").hidden = true;
      sbody.innerHTML = '<p class="err">목록으로 돌아가 다시 선택해 주십시오.</p>';
      return;
    }
    document.title = name(d) + " · IPO 데이터룸";
    var bc = bioByDeal[d.deal_id] || null;
    var list = !nav && view === "list" ? filtered() : [], idx = -1;
    for (var i = 0; i < list.length; i++) if (list[i].deal_id === id) { idx = i; break; }
    var prev = idx > 0 ? list[idx - 1] : null, next = idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null;
    titleEl.textContent = name(d);
    chipEl.innerHTML = chip(d) + boardTag(d) + (isSpac(d) ? '<span class="tag b-spac">스팩</span>' : "") + refileTag(d) + focusTag(d) + (bc ? bioChips(bc) : "");
    var tlEl = document.getElementById("sheet-tl");
    if (d.status === "approved") {
      subEl.textContent = "예심 승인 " + (d.first_filing_dt || "-") + (d.prelim && d.prelim.market ? " · " + d.prelim.market : "") + (d.lead_underwriters ? " · " + d.lead_underwriters : "");
      tlEl.hidden = true; tlEl.innerHTML = "";
    } else {
      // 신고 → 수요예측 → 가격 확정 → 상장(또는 철회) 4단계. 지난 단계는 채운 점, 남은 단계는 빈 점
      var md = function (x) { return x ? x.slice(5).replace("-", ".") : "-"; };
      var today = asOf(), wd = d.status === "withdrawn";
      var steps = [
        ["신고", d.first_filing_dt, md(d.first_filing_dt), d.first_filing_dt],
        ["수요예측", d.demand_start, d.demand_start ? demandText(d, true) : "-", demandText(d)],
        ["가격 확정", pricingDate(d), md(pricingDate(d)), pricingDate(d)],
        wd ? ["철회", "0000", "-", "철회신고서 제출"] : (function () {
          var l = lstOf(d);
          return [l.q ? "상장(" + l.q + ")" : "상장", d.listing_dt, md(l.dt), l.dt ? l.dt + (l.q ? " (" + (l.q === "예상" ? "예상 · 납입일 + 4영업일" : "KIND 신규상장 예정") + ")" : "") : ""];
        })()
      ];
      tlEl.innerHTML = steps.map(function (t) {
        var done = !!t[1] && t[1].slice(0, 10) <= today;
        return '<li class="' + (done ? "done" : "up") + (wd && t[0] === "철회" ? " wd" : "") + (t[0].indexOf("(") > 0 ? " est" : "") + '"' + (t[3] ? ' title="' + esc(t[0] + " " + t[3]) + '"' : "") + "><b>" + esc(t[2]) + "</b><span>" + t[0] + "</span></li>";
      }).join("");
      tlEl.hidden = false;
      subEl.textContent = (d.first_filing_dt || "").slice(0, 4) + "년 신고 · 정정 " + (d.amendment_count || 0) + "회" + (d.lead_underwriters ? " · " + d.lead_underwriters : "");
    }
    if (nav) setNav(nav.idx, nav.len, nav.prev, nav.next);
    else setNav(idx, list.length, prev && function () { goPath("/deal/" + encodeURIComponent(prev.deal_id)); }, next && function () { goPath("/deal/" + encodeURIComponent(next.deal_id)); });

    var html = "";
    if (d.status === "approved") {
      var pr = d.prelim || {}, exp = null;
      if (pr.decided_dt) { var t = new Date(pr.decided_dt + "T00:00:00"); t.setDate(t.getDate() + 183); exp = t.toISOString().slice(0, 10); }
      var tm = function (k, v, sub) { return '<div><span class="k">' + k + '</span><span class="v">' + v + "</span>" + (sub ? '<span class="s">' + sub + "</span>" : "") + "</div>"; };
      sbody.innerHTML = '<p class="notice">상장예비심사 승인을 받았고 아직 증권신고서를 내지 않은 회사입니다. 증권신고서가 DART에 제출되면 일반 공모 건으로 바뀝니다.</p>' +
        '<div class="terms">' + tm("예심 청구일", esc(pr.filed_dt || "-")) + tm("승인일", esc(pr.decided_dt || "-"), "결과 확정일") +
        tm("시장", '<span style="font-family:var(--f-body);font-size:15px">' + esc(pr.market || "-") + "</span>") +
        tm("상장유형", '<span style="font-family:var(--f-body);font-size:15px">' + esc(pr.listing_type || "-") + "</span>") +
        tm("상장주선인", '<span style="font-family:var(--f-body);font-size:15px;font-weight:600">' + esc(pr.sponsor || "-") + "</span>") +
        tm("승인 효력 만료(추정)", esc(exp || "-"), "승인 후 약 6개월") + "</div>" +
        '<p class="snote">출처: 한국거래소 KIND 상장예비심사 현황' + (data.kind_as_of ? " (" + esc(data.kind_as_of) + " 기준)" : "") + ". KRX의 사전 허락 없이 외부에 배포하지 마십시오.</p>";
      sbody.scrollTop = 0;
      if (!wasOpen) focusSheet();
      return;
    }
    if (d.status === "price_fixed" && !d.final_price) html += '<p class="notice warn">발행조건확정 신고서는 제출되었으나 확정가를 원문에서 자동으로 읽지 못했습니다. 공시 이력의 접수번호로 원문을 확인해 주십시오.</p>';
    if (d.correction_order) html += '<p class="notice warn">정정명령 또는 정정제출요구가 부과된 이력이 있습니다.</p>';
    var nx = d.status === "withdrawn" ? laterDeal(d) : null, pv = earlierWithdrawn(d);
    if (nx) html += '<p class="notice">이 공모는 철회되었습니다. 이후 ' + esc(nx.first_filing_dt) + "에 다시 신고한 공모가 있습니다" +
      (nx.status === "completed" && nx.listing_dt ? "(" + (nx.listing_dt > asOf() ? "상장 예정 " : "상장 ") + esc(nx.listing_dt) + ")" : "") +
      '. <a href="#/deal/' + encodeURIComponent(nx.deal_id) + '">재신고 공모 보기</a></p>';
    if (pv) html += '<p class="notice">이전 공모(최초 신고 ' + esc(pv.first_filing_dt) + ")를 철회한 뒤 다시 신고한 공모입니다. " +
      '<a href="#/deal/' + encodeURIComponent(pv.deal_id) + '">철회된 공모 보기</a></p>';

    var p = position(d);
    html += priceStage(d) ? priceSummary(d) : lkSummary(d);
    html += companyBlock(d);
    var amtLabel = srcMethod(d, "offer_amount") === "DOC" ? "공모액 · 확정" : "공모액 · 신고서 기재";
    var shrLabel = srcMethod(d, "shares_offered") === "DOC" ? "공모주식수 · 확정" : "공모주식수 · 신고서 기재";
    var term = function (k, v, sub, cls) { return '<div><span class="k">' + k + '</span><span class="v' + (cls ? " " + cls : "") + '">' + v + "</span>" + (sub ? '<span class="s">' + sub + "</span>" : "") + "</div>"; };
    html += '<div class="terms">' +
      term("확정 공모가", d.final_price ? int(d.final_price) + "<small>원</small>" + (p ? pill(p) : "") : '<span class="dim">' + (d.status === "price_fixed" ? "확인 필요" : "미확정") + "</span>", d.final_price ? capText(d.listed_shares, d.final_price, d.final_price) : "", d.final_price ? "hl" : "") +
      term("희망 밴드", d.offer_price_low ? bandText(d) + "<small>원</small>" : "-", bandCap(d)) +
      term("수요예측 경쟁률", d.inst_demand_ratio != null ? ratio(d.inst_demand_ratio, 2) : '<span class="dim">-</span>', [demandText(d, true), d.inst_demand_count ? int(d.inst_demand_count) + "건 참여" : ""].filter(Boolean).join(" · ")) +
      term("일반청약 경쟁률", d.retail_ratio != null ? ratio(d.retail_ratio, 2) : '<span class="dim">-</span>', d.retail_count ? int(d.retail_count) + "건" : "") +
      term("상장일", d.listing_dt ? esc(d.listing_dt) : lstOf(d).dt ? esc(lstOf(d).dt) : '<span class="dim">-</span>',
        d.listing_dt ? (d.listing_dt > asOf() ? "예정" : "") : d.listing_sched ? "KIND 신규상장 예정" : d.listing_est ? "예상 · 납입일 + 4영업일" : "") +
      term(amtLabel, d.offer_amount != null ? eok(d.offer_amount) + "<small>억원</small>" : "-") +
      term(shrLabel, d.shares_offered != null ? int(d.shares_offered) + "<small>주</small>" : "-", d.secondary_shares ? "구주 " + int(d.secondary_shares) + "주" : "") +
      term("대표주관", esc(d.lead_underwriters || "-"), d.co_underwriters ? "공동 " + esc(d.co_underwriters) : "", "txt") +
      "</div>";
    html += '<div id="bandviz-slot"></div>';
    html += structBlock(d);
    html += finBlock(d);
    html += lockupBlock(d);
    if (bc) html += bioDetail(bc, true, !!companyBlock(d)) + '<h3 class="bio-hd">공모 세부 정보<span>일정·공시·인수인·자금 사용</span></h3>';

    html += section("일정·기타", '<dl class="kv">' +
      (d.prelim ? "<dt>예심 청구일</dt><dd>" + esc(d.prelim.filed_dt || "-") + "</dd><dt>예심 승인일</dt><dd>" + esc(d.prelim.decided_dt || "-") + (d.prelim.result ? ' <span class="dim">(' + esc(d.prelim.result) + ")</span>" : "") + "</dd>" : "") +
      "<dt>상장 시장</dt><dd>" + esc(boardText(d)) + (d.market_src ? ' <span class="dim">(시장: ' + esc(d.market_src) + ")</span>" : "") + "</dd>" +
      (d.tech_grades ? "<dt>기술평가 등급</dt><dd>" + esc(d.tech_grades) + (d.tech_agencies ? ' <span class="dim">(' + esc(d.tech_agencies) + ")</span>" : "") +
        (d.tech_mode ? '<br><span class="dim">' + esc(modeText(d)) + "</span>" : "") + "</dd>" : "") +
      "<dt>수요예측 기일</dt><dd>" + esc(demandText(d) || "-") + "</dd>" +
      "<dt>청약기일</dt><dd>" + esc(d.subscription_raw || "-") + "</dd>" +
      "<dt>납입기일</dt><dd>" + esc(d.payment_raw || "-") + "</dd>" +
      "<dt>신고서 기재 기준가</dt><dd>" + (d.filed_price != null ? int(d.filed_price) + "원 <span class=\"dim\">(밴드 하단 기준)</span>" : "-") + "</dd>" +
      "<dt>구분 판별 근거</dt><dd>" + esc(d.ipo_basis || "-") + "</dd></dl>", true);
    html += section("공시 이력", table(["접수일", "보고서명", "접수번호"],
      d.filings.map(function (f) {
        return [esc(f.rcept_dt), esc(f.report_nm) + (f.rm ? ' <span class="dim">(' + esc(f.rm) + ")</span>" : ""), dartLink(f.rcept_no)];
      }), [], "filings") + '<p class="snote">접수번호를 누르면 DART 원문이 새 창으로 열립니다.</p>', true, d.filings.length);
    html += section("인수인", table(["구분", "인수인", "증권", "수량", "인수대가"],
      d.underwriters.map(function (u) { return [esc(u.actsen), esc(u.actnmn), esc(u.stksen), esc(u.udtcnt), esc(u.udtprc)]; }), [3, 4]), false, d.underwriters.length);
    var realSellers = d.sellers.filter(function (x) { return [x.hdr, x.slstk, x.bfsl_hdstk].some(function (v) { return v && v !== "-"; }); });
    if (realSellers.length) {
      html += section("구주매출 (매출인)", table(["보유자", "관계", "매출 전 보유", "매출 주식수", "매출 후 보유"],
        realSellers.map(function (s) { return [esc(s.hdr), esc(s.rl_cmp), esc(s.bfsl_hdstk), esc(s.slstk), esc(s.atsl_hdstk)]; }), [2, 3, 4]), false, realSellers.length);
    }
    if (d.use_of_proceeds.length) {
      html += section("자금의 사용목적", table(["구분", "금액(원)"], d.use_of_proceeds.map(function (u) { return [esc(u.se), esc(u.amt)]; }), [1]), false, d.use_of_proceeds.length);
    }
    if (d.sources.length) {
      html += section("값의 출처", table(["항목", "값", "근거", "접수번호"],
        d.sources.map(function (s) { return [esc(FIELD[s.field_name] || s.field_name), esc(fieldValue(s.value)), esc(s.section) + " · " + esc(s.evidence), dartLink(s.rcept_no)]; }), [], "src") +
        '<p class="snote">&lsquo;원문&rsquo; 근거는 공시 본문에서 규칙으로 읽은 문구입니다. 중요한 값은 접수번호의 원문과 대조해 주십시오.</p>', false, d.sources.length);
    }
    sbody.innerHTML = html;
    sbody.scrollTop = 0;
    var slot = document.getElementById("bandviz-slot");
    var viz = bandViz(d, slot.clientWidth - 32);
    slot.outerHTML = viz || "";
    if (!wasOpen) focusSheet();
  }
  document.getElementById("s-close").addEventListener("click", function () { closeTo(baseView()); });
  shade.addEventListener("click", function () { closeTo(baseView()); });
  // 휴대폰: 시트 머리(손잡이 부분)를 잡아 아래로 끌면 닫힘. 충분히 내리거나 빠르게 튕기면 닫고, 아니면 제자리로
  (function () {
    var head = sheet.querySelector(".sheet-head"), y0 = null, t0 = 0, dy = 0, pid = null;
    function mobile() { return window.matchMedia("(max-width: 760px)").matches; }
    head.addEventListener("pointerdown", function (e) {
      if (!mobile() || e.button > 0 || e.target.closest("a, button")) return;
      y0 = e.clientY; t0 = Date.now(); dy = 0; pid = e.pointerId;
      sheet.style.transition = "none"; sheet.style.animation = "none";
      try { head.setPointerCapture(pid); } catch (err) { /* 무시 */ }
    });
    head.addEventListener("pointermove", function (e) {
      if (y0 == null || e.pointerId !== pid) return;
      dy = Math.max(0, e.clientY - y0);
      sheet.style.transform = "translateY(" + dy + "px)";
      shade.style.opacity = String(Math.max(0, 1 - dy / 400));
    });
    function end(e) {
      if (y0 == null || (e && e.pointerId !== pid)) return;
      var v = dy / Math.max(1, Date.now() - t0);
      y0 = null;
      sheet.style.transition = "transform .22s cubic-bezier(.2, .9, .3, 1)";
      if (dy > Math.min(140, sheet.offsetHeight * 0.25) || (dy > 30 && v > 0.6)) {
        sheet.style.transform = "translateY(100%)";
        setTimeout(function () {
          closeTo(baseView());
          sheet.style.transition = ""; sheet.style.transform = ""; shade.style.opacity = "";
        }, 200);
      } else {
        sheet.style.transform = "";
        shade.style.opacity = "";
        setTimeout(function () { sheet.style.transition = ""; }, 240);
      }
    }
    head.addEventListener("pointerup", end);
    head.addEventListener("pointercancel", end);
  })();

  // ---------------------------------------------------------------- 통계
  // 통계는 상장일 기준(상장 완료 건만). 상장일을 원문에서 못 읽은 일부 옛 건은 증권발행실적보고서 제출일로 추정합니다.
  function listDate(d) {
    if (d.status !== "completed") return null;
    if (d.listing_dt) return d.listing_dt;
    var no = d.result_rcept_no;
    return no ? no.slice(0, 4) + "-" + no.slice(4, 6) + "-" + no.slice(6, 8) : null;
  }
  function listedDeals() {
    var today = asOf();
    return data.deals.filter(function (d) {
      var ld = listDate(d);
      return ld && ld <= today && candOk(d, "ipo") && (state.spac || !isSpac(d)) && boardOk(d, state.board);
    });
  }
  function splitNames(s) { return (s || "").split(/\s*,\s*/).filter(Boolean); }
  // 순위 집계용: 사명 변경·합병 증권사를 현재 사명으로 묶습니다(목록·상세에는 공시 당시 사명을 그대로 표시).
  var UW_ALIAS = {
    "미래에셋대우": "미래에셋증권", "대우증권": "미래에셋증권",
    "KB투자증권": "KB증권", "현대증권": "KB증권",
    "하나금융투자": "하나증권", "신한금융투자": "신한투자증권", "DB금융투자": "DB증권",
    "이베스트투자증권": "LS증권", "하이투자증권": "iM증권"
  };
  function uwKey(n) { return UW_ALIAS[n] || n; }
  function uwSet(d) {
    return splitNames(d.lead_underwriters).map(uwKey).filter(function (n, i, arr) { return arr.indexOf(n) === i; });
  }
  // 좁은 목록용 증권사 약칭(한투, NH, 미래 …). 상세 화면과 주관사 순위표는 전체 사명을 씁니다.
  var UW_SHORT = { "한국투자증권": "한투", "NH투자증권": "NH", "미래에셋증권": "미래", "미래에셋대우": "미래", "대우증권": "대우",
    "KB투자증권": "KB", "하나금융투자": "하나", "신한금융투자": "신한", "DB금융투자": "DB", "유진투자증권": "유진",
    "현대차투자증권": "현대차", "이베스트투자증권": "이베스트", "골든브릿지투자증권": "골든브릿지", "케이프투자증권": "케이프" };
  function uwShort(n) { return UW_SHORT[n] || n.replace(/(금융투자|투자증권|증권)$/, "") || n; }
  function uwShortStr(s) { return splitNames(s).map(uwShort).join(", "); }
  function median(a) {
    a = a.filter(function (v) { return v != null && !isNaN(v); }).sort(function (x, y) { return x - y; });
    if (!a.length) return null;
    var m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  function jo(eokVal) {   // 억원 → "1.2조" / "8,500억"
    return eokVal >= 10000 ? (Math.round(eokVal / 1000) / 10).toLocaleString("ko-KR") + "조" : int(Math.round(eokVal)) + "억";
  }

  // 기간·단위
  var STAT_SERIES = [
    { key: "KOSPI", label: "유가증권", css: "var(--mk-ks)" },
    { key: "KOSDAQ", label: "코스닥 일반", css: "var(--mk-kq)" },
    { key: "KOSDAQ_TECH", label: "코스닥 기술특례", css: "var(--mk-tech)" },
    { key: "SPAC", label: "스팩", css: "var(--mk-spac)" }
  ];
  function seriesOf(d) {
    if (isSpac(d)) return "SPAC";
    if (d.board === "KOSPI") return "KOSPI";
    if (d.board === "KOSDAQ_TECH") return "KOSDAQ_TECH";
    return "KOSDAQ";   // 시장 판정이 없는 옛 건은 코스닥 일반으로 둡니다(대부분 코스닥).
  }
  function periodRange(ys) {
    var last = +ys[0], first = +ys[ys.length - 1], p = state.sPeriod;
    if (p === "5y") return [Math.max(first, last - 4), last];
    if (p === "3y") return [Math.max(first, last - 2), last];
    if (/^\d{4}$/.test(p)) return [+p, +p];
    return [first, last];
  }
  // ---- 통계 기간 창: 기간 선택 또는 핀치·드래그로 정한 [시작 월, 끝 월]
  function mIdx(k) { return +k.slice(0, 4) * 12 + (+k.slice(5, 7) - 1); }
  function mKey(i) { var y = Math.floor(i / 12), m = i % 12 + 1; return y + "-" + (m < 10 ? "0" : "") + m; }
  var statNow = null;   // 직전 렌더의 창·경계(제스처 계산용)
  function statBounds() {
    var ds = data.deals.map(listDate).filter(function (x) { return x && x <= asOf(); }).sort();
    return [mIdx(ds[0].slice(0, 7)), mIdx(asOf().slice(0, 7))];
  }
  function statWindow(ys, b) {
    var w = state.sWin;
    if (w && w.from && w.to) return [Math.max(b[0], mIdx(w.from)), Math.min(b[1], mIdx(w.to))];
    var rg = periodRange(ys);
    return [Math.max(b[0], rg[0] * 12), Math.min(b[1], rg[1] * 12 + 11)];
  }
  function pickUnit(span) { return span > 72 ? "year" : span > 24 ? "quarter" : "month"; }
  function snapWin(f, t, unit) {
    if (unit === "year") return [f - (f % 12), t + (11 - (t % 12))];
    if (unit === "quarter") return [f - (f % 3), t + (2 - (t % 3))];
    return [f, t];
  }
  function winText(f, t) {
    var a = mKey(f), b = mKey(t);
    var lastM = statNow ? statNow.b1 : -1;
    if (f % 12 === 0 && (t % 12 === 11 || t === lastM)) return a.slice(0, 4) === b.slice(0, 4) ? a.slice(0, 4) + "년" : a.slice(0, 4) + "~" + b.slice(0, 4) + "년";
    return a.replace("-", ".") + "~" + b.replace("-", ".");
  }
  function unitKey(dt, unit) {
    if (unit === "year") return dt.slice(0, 4);
    if (unit === "quarter") return dt.slice(0, 4) + "Q" + (Math.floor((+dt.slice(5, 7) - 1) / 3) + 1);
    return dt.slice(0, 7);
  }
  function unitKeys(y0, y1, unit, lastDt) {
    var out = [];
    for (var y = y0; y <= y1; y++) {
      if (unit === "year") out.push(String(y));
      else if (unit === "quarter") for (var q = 1; q <= 4; q++) out.push(y + "Q" + q);
      else for (var m = 1; m <= 12; m++) out.push(y + "-" + (m < 10 ? "0" : "") + m);
    }
    var lastKey = unitKey(lastDt, unit);   // 아직 오지 않은 분기·월은 그리지 않습니다
    return out.filter(function (k) { return k <= lastKey; });
  }
  function unitLabel(k, unit, many) {
    if (unit === "year") return many ? "'" + k.slice(2) : k;
    if (unit === "quarter") return k.slice(2, 4) + "Q" + k.slice(5);
    return k.slice(2, 4) + "." + k.slice(5);
  }
  function unitTitle(k, unit) {
    if (unit === "year") return k + "년";
    if (unit === "quarter") return k.slice(0, 4) + "년 " + k.slice(5) + "분기";
    return k.slice(0, 4) + "년 " + +k.slice(5) + "월";
  }
  function niceMax(v) {
    if (v <= 0) return 4;
    var p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p;
    var f = n <= 1 ? 1 : n <= 2 ? 2 : n <= 4 ? 4 : n <= 5 ? 5 : n <= 8 ? 8 : 10;
    return f * p;
  }
  function niceCountMax(v) {
    var step = Math.max(1, Math.ceil(v / 4));
    var nice = [1, 2, 3, 4, 5, 6, 8, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200, 250].filter(function (n) { return n >= step; })[0] || step;
    return nice * 4;
  }
  function barPath(x, y, w, h, r) {
    r = Math.min(r, w / 2, h);
    return "M" + x + "," + (y + h) + "V" + (y + r) + "Q" + x + "," + y + " " + (x + r) + "," + y +
      "H" + (x + w - r) + "Q" + (x + w) + "," + y + " " + (x + w) + "," + (y + r) + "V" + (y + h) + "Z";
  }
  // 축·격자·가로 눈금(겹치지 않게 건너뛰기)
  function frame(W, H, L, R, T, B, top, labels, fmtY, ticks) {
    var ih = H - T - B, svg = "", n = ticks || 4;
    for (var g = 0; g <= n; g++) {
      var gy = T + ih - (ih * g) / n;
      svg += '<line class="' + (g === 0 ? "axis" : "grid") + '" x1="' + L + '" x2="' + (W - R) + '" y1="' + gy + '" y2="' + gy + '"/>' +
        '<text x="' + (L - 6) + '" y="' + (gy + 4) + '" text-anchor="end">' + fmtY((top * g) / n) + "</text>";
    }
    var band = (W - L - R) / labels.length, widest = Math.max.apply(null, labels.map(function (s) { return s.length; }));
    var step = Math.max(1, Math.ceil((widest * 7 + 10) / band)), last = labels.length - 1;
    labels.forEach(function (s, i) {
      if (i % step === 0 || (i === last && last % step >= Math.ceil(step / 2) + (step === 1 ? 0 : 1))) {
        svg += '<text x="' + (L + band * i + band / 2) + '" y="' + (H - 10) + '" text-anchor="middle">' + s + "</text>";
      }
    });
    return svg;
  }
  function colHit(x, T, w, ih, tipHtml, aria, extra) {
    return '<g class="col"' + (extra || "") + ' data-tip="' + esc(tipHtml) + '"><rect class="hit" tabindex="0" x="' + x + '" y="' + T + '" width="' + w + '" height="' + ih + '" aria-label="' + esc(aria) + '"/>';
  }
  function tipRow(color, label, value) {
    return '<div class="row"><span>' + (color ? '<i style="background:' + color + '"></i>' : "") + label + "</span><span>" + value + "</span></div>";
  }
  function segBtns(attr, opts, cur) {
    var i = Math.max(0, opts.map(function (o) { return o[0]; }).indexOf(cur));
    return '<div class="seg" role="group" style="--n:' + opts.length + ";--i:" + i + '">' + opts.map(function (o) {
      return '<button type="button" ' + attr + '="' + o[0] + '" aria-pressed="' + (o[0] === cur) + '">' + o[1] + "</button>";
    }).join("") + "</div>";
  }

  // ---- 상장일 유통물량 통계: 연도별 유통가능 비율, 유통물량과 경쟁률의 관계(스팩 제외, 상장 완료 건)
  function spearman(xs, ys) {
    var n = xs.length;
    if (n < 5) return null;
    var rank = function (a) {
      var o = a.map(function (v, i) { return [v, i]; }).sort(function (p, q) { return p[0] - q[0]; }), r = new Array(n);
      for (var i = 0; i < n;) { var j = i; while (j + 1 < n && o[j + 1][0] === o[i][0]) j++; for (var k = i; k <= j; k++) r[o[k][1]] = (i + j) / 2; i = j + 1; }
      return r;
    };
    var a = rank(xs), b = rank(ys), ma = (n - 1) / 2, sab = 0, saa = 0, sbb = 0;
    for (var i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - ma); saa += (a[i] - ma) * (a[i] - ma); sbb += (b[i] - ma) * (b[i] - ma); }
    var r = saa && sbb ? sab / Math.sqrt(saa * sbb) : 0;
    // 유의성(근사): t = r√((n−2)/(1−r²)), |t| > 1.97 이면 5% 수준
    var t = Math.abs(r) < 1 ? r * Math.sqrt((n - 2) / (1 - r * r)) : 99;
    return { r: r, n: n, sig: Math.abs(t) > 1.97 };
  }
  function quant(a, q) {
    a = a.filter(function (v) { return v != null; }).sort(function (x, y) { return x - y; });
    if (!a.length) return null;
    var p = (a.length - 1) * q, i = Math.floor(p);
    return a[i] + (a[Math.min(i + 1, a.length - 1)] - a[i]) * (p - i);
  }
  var FSEG = [["all", "전체"], ["KOSDAQ", "코스닥 일반"], ["KOSDAQ_TECH", "기술특례"]];
  var FBUCK = [[0, 25, "25% 미만"], [25, 30, "25~30%"], [30, 35, "30~35%"], [35, 40, "35~40%"], [40, 101, "40% 이상"]];
  function rhoTxt(c) { return c ? '<span class="rho' + (c.sig ? " sig" : "") + '">' + (c.r >= 0 ? "+" : "−") + Math.abs(c.r).toFixed(2) + "</span>" : '<span class="dim">-</span>'; }
  function floatPanel(deals, periodText, W, halfW, H) {
    var f0 = function (d) { return d.lockup && d.lockup.float0 ? d.lockup.float0.pct : null; };
    var ds = deals.filter(function (d) { return !isSpac(d) && f0(d) != null; });
    var seg = state.fSeg || "all", key = state.fKey === "retail_ratio" ? "retail_ratio" : "inst_demand_ratio", keyLabel = key === "retail_ratio" ? "일반청약" : "수요예측";
    var inSeg = function (d) { return seg === "all" || seriesOf(d) === seg; };
    var years = Array.from(new Set(ds.map(function (d) { return listDate(d).slice(0, 4); }))).sort();
    var byY = {}; ds.forEach(function (d) { var y = listDate(d).slice(0, 4); (byY[y] = byY[y] || []).push(d); });
    var boards = [["KOSPI", "유가", "var(--mk-ks)"], ["KOSDAQ", "코스닥 일반", "var(--mk-kq)"], ["KOSDAQ_TECH", "기술특례", "var(--mk-tech)"]];
    if (state.board) boards = boards.filter(function (b) { return b[0] === state.board; });
    var medOf = function (xs, b) { return median(xs.filter(function (d) { return !b || seriesOf(d) === b; }).map(f0)); };
    var corrOf = function (xs) { xs = xs.filter(function (d) { return inSeg(d) && d[key] > 0; }); return spearman(xs.map(f0), xs.map(function (d) { return d[key]; })); };
    var all = ds.filter(inSeg), cAll = corrOf(ds);
    var ctrl = '<div class="fctl">' + segBtns("data-fs", FSEG, seg) + segBtns("data-fk", [["inst_demand_ratio", "수요예측"], ["retail_ratio", "일반청약"]], key) + "</div>";
    var hd = '<header><div><h2>상장일 유통물량</h2><p>' + periodText + " 상장 기준(스팩 제외). 상장일 유통가능 비율은 증권신고서·투자설명서의 공모 후 기준이며 기관 확약분은 반영하지 않습니다. " +
      "상관은 순위상관(Spearman)이고 굵게 표시한 값은 5% 수준에서 유의합니다.</p></div>" + ctrl + "</header>";
    if (!ds.length) return '<section class="panel fpanel">' + hd + '<div class="pbody"><div class="empty">유통물량을 읽은 상장 건이 없습니다.</div></div></section>';
    var kpi = '<div class="cmp f4">' +
      '<div><span class="k">상장일 유통가능 중앙값</span><span class="v">' + pct1(median(all.map(f0))) + '</span><span class="s">' + all.length + "건 · 가운데 50% " + pct1(quant(all.map(f0), .25)) + "~" + pct1(quant(all.map(f0), .75)) + "</span></div>" +
      '<div><span class="k">유통물량과 ' + keyLabel + " 경쟁률</span><span class=\"v\">" + rhoTxt(cAll) + '</span><span class="s">' + (cAll ? cAll.n + "건 · " + (cAll.r < -0.1 ? "유통물량이 많을수록 경쟁률이 낮은 편" : cAll.r > 0.1 ? "유통물량이 많을수록 경쟁률이 높은 편" : "뚜렷한 관계 없음") : "표본 부족") + "</span></div></div>";
    // 유통 구간별 경쟁률 중앙값
    var bk = FBUCK.map(function (b) {
      var xs = all.filter(function (d) { var x = f0(d); return x >= b[0] && x < b[1] && d[key] > 0; });
      return { label: b[2], n: xs.length, med: median(xs.map(function (d) { return d[key]; })) };
    });
    var bmax = Math.max.apply(null, bk.map(function (b) { return b.med || 0; }).concat([1]));
    var bucketTbl = '<table class="mini fbk"><thead><tr><th>상장일 유통가능</th><th class="num">건수</th><th class="num">' + keyLabel + ' 경쟁률 중앙값</th><th class="bar-cell"><span class="sr">막대</span></th></tr></thead><tbody>' +
      bk.map(function (b) { return "<tr><td>" + b.label + '</td><td class="num">' + b.n + '</td><td class="num">' + (b.med != null && b.n >= 3 ? ratio(b.med, 0) : "-") + '</td><td class="bar-cell"><div class="hbar" style="width:' + (b.n >= 3 && b.med ? b.med / bmax * 100 : 0).toFixed(1) + '%"></div></td></tr>'; }).join("") + "</tbody></table>";
    // 연도별 표
    var yearTbl = '<table class="mini fyr"><thead><tr><th>연도</th><th class="num">건수</th><th class="num">유통가능 중앙값</th>' +
      boards.map(function (b) { return '<th class="num">' + b[1] + "</th>"; }).join("") + '<th class="num">가운데 50%</th><th class="num">상관 · ' + keyLabel + "</th></tr></thead><tbody>" +
      years.slice().reverse().map(function (y) {
        var xs = byY[y], sx = xs.filter(inSeg);
        return "<tr><td>" + y + '</td><td class="num">' + sx.length + '</td><td class="num"><b>' + pct1(median(sx.map(f0))) + "</b></td>" +
          boards.map(function (b) { var m = medOf(xs, b[0]); return '<td class="num">' + (m != null ? pct1(m) : "-") + "</td>"; }).join("") +
          '<td class="num">' + pct1(quant(sx.map(f0), .25)) + "~" + pct1(quant(sx.map(f0), .75)) + '</td><td class="num">' + rhoTxt(corrOf(xs)) + "</td></tr>";
      }).join("") + "</tbody></table>";
    var Lp = 44, Rp = 10, Tp = 20, Bp = 28;
    // 연도별 중앙값 선 그래프(시장별)
    var lineChart = function (w, h) {
      var ih = h - Tp - Bp, band = (w - Lp - Rp) / years.length, top = Math.max(60, Math.ceil(Math.max.apply(null, years.map(function (y) { return Math.max(medOf(byY[y]) || 0, quant(byY[y].filter(inSeg).map(f0), .75) || 0, Math.max.apply(null, boards.map(function (b) { return medOf(byY[y], b[0]) || 0; }))); })) / 20) * 20);
      var svg = '<svg data-w="' + w + '" viewBox="0 0 ' + w + " " + h + '" role="img" aria-label="연도별 상장일 유통가능 비율 중앙값">' + frame(w, h, Lp, Rp, Tp, Bp, top, years.map(function (y) { return years.length > 8 ? "'" + y.slice(2) : y; }), function (x) { return Math.round(x) + "%"; });
      var px = function (i) { return Lp + band * i + band / 2; }, py = function (x) { return Tp + ih - Math.min(x, top) / top * ih; };
      var q1 = years.map(function (y) { return quant(byY[y].filter(inSeg).map(f0), .25); }), q3 = years.map(function (y) { return quant(byY[y].filter(inSeg).map(f0), .75); });
      // 가운데 50% 띠: 값이 있는 연도끼리 이어진 구간마다 따로 그립니다(표본 3건 미만 연도는 끊음)
      var runs = [], cur = [];
      years.forEach(function (y, i) { if (q1[i] != null && byY[y].filter(inSeg).length >= 3) cur.push(i); else if (cur.length) { runs.push(cur); cur = []; } });
      if (cur.length) runs.push(cur);
      runs.forEach(function (r) {
        if (r.length < 2) return;
        svg += '<path class="iqr" d="M' + r.map(function (i) { return px(i) + "," + py(q3[i]); }).join("L") + "L" + r.slice().reverse().map(function (i) { return px(i) + "," + py(q1[i]); }).join("L") + 'Z"/>';
      });
      boards.forEach(function (b) {
        var d = "", pen = false;
        years.forEach(function (y, i) { var m = medOf(byY[y], b[0]); if (m == null) { pen = false; return; } d += (pen ? "L" : "M") + px(i).toFixed(1) + "," + py(m).toFixed(1); pen = true; });
        svg += '<path class="ln" style="stroke:' + b[2] + '" d="' + d + '"/>';
      });
      years.forEach(function (y, i) {
        var tip = "<b>" + y + "년 상장일 유통가능 중앙값</b>" + boards.map(function (b) { var m = medOf(byY[y], b[0]); return tipRow(b[2], b[1], m != null ? pct1(m) : "-"); }).join("") + tipRow("", "가운데 50%", pct1(q1[i]) + "~" + pct1(q3[i]));
        svg += colHit(Lp + band * i, Tp, band, ih, tip, y + "년") + boards.map(function (b) { var m = medOf(byY[y], b[0]); return m == null ? "" : '<circle class="dot" style="fill:' + b[2] + '" cx="' + px(i) + '" cy="' + py(m) + '" r="3.5"/>'; }).join("") + "</g>";
      });
      return svg + "</svg>";
    };
    var legendB = '<div class="legend">' + boards.map(function (b) { return '<span><i class="ln-key" style="background:' + b[2] + '"></i>' + b[1] + "</span>"; }).join("") + '<span><i class="iqr-key"></i>가운데 50%(' + FSEG.filter(function (f) { return f[0] === seg; })[0][1] + ")</span></div>";
    // 연도별 상관 막대(0 기준)
    var rhoBars = function (w, h) {
      var ih = h - Tp - Bp, band = (w - Lp - Rp) / years.length, mid = Tp + ih / 2, svg = '<svg data-w="' + w + '" viewBox="0 0 ' + w + " " + h + '" role="img" aria-label="연도별 순위상관">';
      [-1, -0.5, 0, 0.5, 1].forEach(function (t) { var y = mid - t * ih / 2; svg += '<line class="' + (t === 0 ? "axis" : "grid") + '" x1="' + Lp + '" x2="' + (w - Rp) + '" y1="' + y + '" y2="' + y + '"/><text x="' + (Lp - 6) + '" y="' + (y + 4) + '" text-anchor="end">' + (t > 0 ? "+" : "") + t + "</text>"; });
      years.forEach(function (y, i) {
        var c = corrOf(byY[y]), bw = Math.min(26, band * .6), x = Lp + band * i + (band - bw) / 2;
        svg += '<text x="' + (Lp + band * i + band / 2) + '" y="' + (h - 8) + '" text-anchor="middle">' + (years.length > 8 ? "'" + y.slice(2) : y) + "</text>";
        if (!c) return;
        var hh = Math.abs(c.r) * ih / 2;
        svg += colHit(Lp + band * i, Tp, band, ih, "<b>" + y + "년</b>" + tipRow("", "순위상관", (c.r >= 0 ? "+" : "") + c.r.toFixed(2) + (c.sig ? " (유의)" : "")) + tipRow("", "표본", c.n + "건"), y + "년") +
          '<rect class="rb' + (c.sig ? " sig" : "") + '" x="' + x + '" y="' + (c.r >= 0 ? mid - hh : mid) + '" width="' + bw + '" height="' + Math.max(1, hh) + '" rx="3"/></g>';
      });
      return svg + "</svg>";
    };
    var body = kpi + '<div class="fgrid"><div><h3 class="minih">연도별 유통가능 비율 중앙값</h3>' + legendB + '<div class="chart">' + lineChart(halfW, H - 30) + '</div></div>' +
      '<div><h3 class="minih">연도별 순위상관 · ' + keyLabel + " 경쟁률</h3>" + '<div class="chart">' + rhoBars(halfW, H - 30) + "</div>" +
      '<h3 class="minih">유통 구간별 ' + keyLabel + " 경쟁률</h3>" + bucketTbl + "</div></div>" +
      '<details class="tv"><summary>연도별 표로 보기</summary><div class="scroll">' + yearTbl + "</div></details>";
    return '<section class="panel fpanel">' + hd + '<div class="pbody">' + body + "</div></section>";
  }
  function renderStats() {
    document.title = "통계 · IPO 데이터룸";
    view = "stats";
    var all = listedDeals();
    var ys = Array.from(new Set(data.deals.map(listDate).filter(Boolean).map(function (s) { return s.slice(0, 4); }))).sort().reverse();
    ys = ys.filter(function (y) { return y <= asOf().slice(0, 4); });
    var unit = state.sUnit || "year";
    var bnd = ys.length ? statBounds() : null, win = ys.length ? statWindow(ys, bnd) : null;
    if (win) statNow = { from: win[0], to: win[1], b0: bnd[0], b1: bnd[1] };
    var custom = !!(state.sWin && win);
    var spacSw = function (id) { return '<label class="switch"><input type="checkbox" class="s-spac" id="' + id + '"' + (state.spac ? " checked" : "") + ">스팩 포함</label>"; };
    var head = '<div class="sfilters glass" role="group" aria-label="통계 조건">' +
      (custom ? '<button type="button" class="wchip" id="s-win-reset" title="확대 해제">' + esc(winText(win[0], win[1])) + '<span aria-hidden="true">×</span><span class="sr">전체 기간으로</span></button>' : "") +
      '<label class="flabel"><span class="fl-t">기간</span><select class="sel" id="s-period" aria-label="기간" data-def="all">' + (custom ? '<option value="custom" selected hidden data-s="' + esc(winText(win[0], win[1]).replace(/(^|~)20(\d\d)/g, "$1$2")) + '">' + esc(winText(win[0], win[1])) + "</option>" : "") +
      '<optgroup label="빠른 선택">' + opt("all", "전체 기간", custom ? "" : state.sPeriod) + opt("5y", "최근 5년", custom ? "" : state.sPeriod) + opt("3y", "최근 3년", custom ? "" : state.sPeriod) + "</optgroup>" +
      '<optgroup label="연도별" data-grid="1">' + ys.map(function (y) { return opt(y, y + "년", custom ? "" : state.sPeriod); }).join("") + "</optgroup></select></label>" +
      '<div class="flabel"><span class="fl-t">단위</span>' + segBtns("data-u", [["year", "연"], ["quarter", "분기"], ["month", "월"]], unit) + "</div>" +
      boardSelect("s-board") + '<span class="sw-d">' + spacSw("s-spac") + "</span></div>" +
      '<div class="sopt-m">' + spacSw("s-spac-m") + "</div>";
    if (!ys.length) { app.innerHTML = '<div class="content">' + gsearchBox() + head + '<div class="ledger"><div class="empty">상장 건이 없습니다.</div></div></div>'; bindStats(); return; }
    var wf = win[0], wt = win[1];
    statNow = { from: wf, to: wt, b0: bnd[0], b1: bnd[1] };
    var deals = all.filter(function (d) { var m = mIdx(listDate(d).slice(0, 7)); return m >= wf && m <= wt; });
    var keys = [];
    for (var mi = wf; mi <= wt; mi++) { var uk = unitKey(mKey(mi) + "-01", unit); if (keys[keys.length - 1] !== uk) keys.push(uk); }
    var many = keys.length > 8;
    var labels = keys.map(function (k) { return unitLabel(k, unit, many); });
    var idx = {};
    keys.forEach(function (k, i) { idx[k] = i; });
    var byK = keys.map(function () { return []; });
    deals.forEach(function (d) { var i = idx[unitKey(listDate(d), unit)]; if (i != null) byK[i].push(d); });
    var periodText = winText(wf, wt);

    // ---- KPI
    var totalAmt = deals.reduce(function (s, d) { return s + (d.offer_amount || 0); }, 0) / 1e8;
    var posD = deals.filter(function (d) { return position(d); });
    var upper = posD.filter(function (d) { var p = position(d); return p === "상단" || p === "초과"; }).length;
    var kq = deals.filter(function (d) { return !isSpac(d) && (d.board === "KOSDAQ" || d.board === "KOSDAQ_TECH"); });
    var techN = kq.filter(function (d) { return d.board === "KOSDAQ_TECH"; }).length;
    var instMed = median(deals.filter(function (d) { return !isSpac(d); }).map(function (d) { return d.inst_demand_ratio; }));
    var estN = deals.filter(function (d) { return !d.listing_dt; }).length;
    var kpi = '<section class="summary s5" aria-label="요약">' +
      kpiTile(int(deals.length), "건", "상장 건수 · " + periodText) +
      kpiTile(jo(totalAmt).replace(/(조|억)$/, ""), /조$/.test(jo(totalAmt)) ? "조원" : "억원", "공모액 합계") +
      kpiTile(posD.length ? Math.round(upper / posD.length * 100) : "-", posD.length ? "%" : "", "밴드 상단 이상 확정 (" + posD.length + "건 기준)", true) +
      kpiTile(kq.length ? Math.round(techN / kq.length * 100) : "-", kq.length ? "%" : "", "코스닥 중 기술특례 (" + techN + "/" + kq.length + "건)") +
      kpiTile(instMed != null ? ratio(instMed, 0).replace(":1", "") : "-", instMed != null ? ":1" : "", "수요예측 경쟁률 중앙값 (스팩 제외)") + "</section>";

    var W = Math.max(300, Math.min(app.clientWidth - 40, 1220)), H = W < 500 ? 240 : 280;
    var L = 48, R = 10, T = 24, B = 30, ih = H - T - B;
    var halfW = window.innerWidth > 1060 ? Math.round((Math.min(app.clientWidth, 1232) - 16) / 2) - 38 : W;

    // ---- 1) 시장별 상장 추이 (누적 막대)
    var isAmt = state.metric === "amount";
    var series = STAT_SERIES.filter(function (s) { return s.key !== "SPAC" || state.spac; });
    if (state.board) series = series.filter(function (s) { return s.key === state.board; });
    var cell = byK.map(function (ds) {
      var o = {};
      series.forEach(function (s) { o[s.key] = 0; });
      ds.forEach(function (d) { var s = seriesOf(d); if (s in o) o[s] += isAmt ? (d.offer_amount || 0) / 1e8 : 1; });
      return o;
    });
    var tots = cell.map(function (o) { return series.reduce(function (a, s) { return a + o[s.key]; }, 0); });
    var top1 = isAmt ? niceMax(Math.max.apply(null, tots.concat([1]))) : niceCountMax(Math.max.apply(null, tots.concat([1])));
    var iw = W - L - R, band = iw / keys.length, bw = Math.min(unit === "year" ? 44 : 26, band * 0.64);
    var svg1 = '<svg data-w="' + W + '" data-l="' + L + '" data-r="' + R + '" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + unitTitle(keys[0], unit) + "부터 시장별 상장 " + (isAmt ? "공모액" : "건수") + ' 누적 막대">' +
      frame(W, H, L, R, T, B, top1, labels, function (v) { return isAmt ? jo(v) : int(Math.round(v)); });
    var maxI = tots.indexOf(Math.max.apply(null, tots));
    cell.forEach(function (o, i) {
      var x = L + band * i + (band - bw) / 2, acc = 0, segs = "", shown = series.filter(function (s) { return o[s.key] > 0; });
      shown.forEach(function (s, j) {
        var h = (o[s.key] / top1) * ih, y = T + ih - acc - h, gap = j > 0 ? 2 : 0;
        segs += j === shown.length - 1
          ? '<path class="seg-r" fill="' + s.css + '" d="' + barPath(x, y, bw, Math.max(0, h - gap), 4) + '"/>'
          : '<rect class="seg-r" fill="' + s.css + '" x="' + x + '" y="' + y + '" width="' + bw + '" height="' + Math.max(0, h - gap) + '"/>';
        acc += h;
      });
      var tipH = "<b>" + unitTitle(keys[i], unit) + " 상장 " + byK[i].length + "건</b>" +
        series.slice().reverse().map(function (s) { return tipRow(s.css, s.label, isAmt ? jo(o[s.key]) + "원" : o[s.key] + "건"); }).join("") +
        (isAmt ? "" : tipRow("", "공모액", jo(byK[i].reduce(function (a, d) { return a + (d.offer_amount || 0); }, 0) / 1e8) + "원"));
      var showLbl = tots[i] > 0 && (keys.length <= 16 || i === maxI);
      svg1 += colHit(L + band * i, T, band, ih, tipH, unitTitle(keys[i], unit) + " " + byK[i].length + "건") + segs +
        (showLbl ? '<text class="vlabel" x="' + (x + bw / 2) + '" y="' + (T + ih - (tots[i] / top1) * ih - 6) + '" text-anchor="middle">' + (isAmt ? jo(tots[i]) : int(tots[i])) + "</text>" : "") + "</g>";
    });
    svg1 += "</svg>";
    var legend1 = '<div class="legend">' + series.map(function (s) {
      var t = cell.reduce(function (a, o) { return a + o[s.key]; }, 0);
      return '<span><i style="background:' + s.css + '"></i>' + s.label + " " + (isAmt ? jo(t) + "원" : int(t) + "건") + "</span>";
    }).join("") + "</div>";
    var tbl1 = table([unit === "year" ? "연도" : unit === "quarter" ? "분기" : "월", "상장", "유가", "코스닥 일반", "기술특례"].concat(state.spac ? ["스팩"] : []).concat(["공모액", "수요예측 중앙값", "일반청약 중앙값", "상단 이상"]),
      keys.map(function (k, i) {
        var ds = byK[i], c = {};
        STAT_SERIES.forEach(function (s) { c[s.key] = 0; });
        ds.forEach(function (d) { c[seriesOf(d)]++; });
        var pd = ds.filter(function (d) { return position(d); }), up = pd.filter(function (d) { var p = position(d); return p === "상단" || p === "초과"; }).length;
        var ns = ds.filter(function (d) { return !isSpac(d); });
        var im = median(ns.map(function (d) { return d.inst_demand_ratio; })), rm = median(ns.map(function (d) { return d.retail_ratio; }));
        return [unitTitle(k, unit), String(ds.length), String(c.KOSPI), String(c.KOSDAQ), String(c.KOSDAQ_TECH)].concat(state.spac ? [String(c.SPAC)] : [])
          .concat([jo(ds.reduce(function (a, d) { return a + (d.offer_amount || 0); }, 0) / 1e8), im != null ? ratio(im, 0) : "-", rm != null ? ratio(rm, 0) : "-", pd.length ? Math.round(up / pd.length * 100) + "%" : "-"]);
      }).reverse(), [1, 2, 3, 4, 5, 6, 7, 8, 9]);

    // ---- 2) 경쟁률 중앙값 추이 (선)
    var LN = [{ key: "inst_demand_ratio", label: "수요예측", css: "var(--ln-inst)" }, { key: "retail_ratio", label: "일반청약", css: "var(--ln-retail)" }];
    var MIN_N = 5;   // 표본이 적은 기간은 중앙값이 흔들리므로 선을 끊습니다
    var nOf = LN.map(function (s) { return byK.map(function (ds) { return ds.filter(function (d) { return !isSpac(d) && d[s.key] != null; }).length; }); });
    var baseN = byK.map(function (ds) { return ds.filter(function (d) { return !isSpac(d); }).length; });
    var enough = function (si, i) { return nOf[si][i] >= MIN_N && nOf[si][i] >= baseN[i] * 0.5; };   // 추출률 50% 미만이면 편향 우려
    var med = LN.map(function (s, si) { return byK.map(function (ds, i) { return enough(si, i) ? median(ds.filter(function (d) { return !isSpac(d); }).map(function (d) { return d[s.key]; })) : null; }); });
    var mx = Math.max.apply(null, med[0].concat(med[1]).filter(function (v) { return v != null; }).concat([1]));
    var top2 = niceMax(mx), W2 = halfW, H2 = H - 10, ih2 = H2 - T - B, band2 = (W2 - L - R) / keys.length;
    var svg2 = '<svg data-w="' + W2 + '" data-l="' + L + '" data-r="' + R + '" viewBox="0 0 ' + W2 + " " + H2 + '" role="img" aria-label="수요예측·일반청약 경쟁률 중앙값 추이">' +
      frame(W2, H2, L, R, T, B, top2, labels, function (v) { return int(Math.round(v)); });
    var px = function (i) { return L + band2 * i + band2 / 2; }, py = function (v) { return T + ih2 - (v / top2) * ih2; };
    LN.forEach(function (s, si) {
      var d = "", pen = false;
      med[si].forEach(function (v, i) {
        if (v == null) { pen = false; return; }
        d += (pen ? "L" : "M") + px(i).toFixed(1) + "," + py(v).toFixed(1); pen = true;
      });
      svg2 += '<path class="ln" style="stroke:' + s.css + '" d="' + d + '"/>';
    });
    keys.forEach(function (k, i) {
      var tipH = "<b>" + unitTitle(k, unit) + " 상장 (스팩 제외)</b>" + LN.map(function (s, si) { return tipRow(s.css, s.label + " 중앙값", (med[si][i] != null ? ratio(med[si][i], 0) : nOf[si][i] ? "표본 부족" : "-") + " (" + nOf[si][i] + "/" + baseN[i] + "건)"); }).join("");
      svg2 += colHit(L + band2 * i, T, band2, ih2, tipH, unitTitle(k, unit)) + '<line class="xh" x1="' + px(i) + '" x2="' + px(i) + '" y1="' + T + '" y2="' + (T + ih2) + '"/>' +
        LN.map(function (s, si) { var v = med[si][i]; return v == null ? "" : '<circle class="dot" style="fill:' + s.css + '" cx="' + px(i) + '" cy="' + py(v) + '" r="' + (keys.length > 30 ? 2.5 : 4) + '"/>'; }).join("") + "</g>";
    });
    // 마지막 값 직접 표시
    LN.forEach(function (s, si) {
      for (var i = keys.length - 1; i >= 0; i--) if (med[si][i] != null) {
        svg2 += '<text class="vlabel" x="' + Math.min(px(i), W2 - R - 4) + '" y="' + (py(med[si][i]) - 9) + '" text-anchor="end">' + s.label + " " + int(Math.round(med[si][i])) + "</text>";
        break;
      }
    });
    svg2 += "</svg>";
    var legend2 = '<div class="legend">' + LN.map(function (s) { return '<span><i class="ln-key" style="background:' + s.css + '"></i>' + s.label + " 경쟁률 중앙값</span>"; }).join("") + '<span class="fnote">값을 확보한 건이 ' + MIN_N + "건 미만이거나 상장 건의 절반 미만인 기간은 표시하지 않음</span></div>";

    // ---- 3) 밴드 대비 위치 비중 (100% 누적 막대)
    var pc = byK.map(function (ds) { var o = {}; POS.forEach(function (p) { o[p] = 0; }); ds.forEach(function (d) { var p = position(d); if (p) o[p]++; }); return o; });
    var W3 = halfW, H3 = H - 10, ih3 = H3 - T - B, band3 = (W3 - L - R) / keys.length, bw3 = Math.min(unit === "year" ? 34 : 20, band3 * 0.64);
    var svg3 = '<svg data-w="' + W3 + '" data-l="' + L + '" data-r="' + R + '" viewBox="0 0 ' + W3 + " " + H3 + '" role="img" aria-label="밴드 대비 확정가 위치 비중">' +
      frame(W3, H3, L, R, T, B, 100, labels, function (v) { return Math.round(v) + "%"; });
    pc.forEach(function (o, i) {
      var n = POS.reduce(function (a, p) { return a + o[p]; }, 0), x = L + band3 * i + (band3 - bw3) / 2, acc = 0, segs = "";
      if (n) {
        var shown = POS.slice().reverse().filter(function (p) { return o[p]; });
        shown.forEach(function (p, j) {
          var h = (o[p] / n) * ih3, y = T + ih3 - acc - h, gap = j > 0 ? 2 : 0;
          segs += j === shown.length - 1
            ? '<path class="seg-r" fill="var(--pos-' + POS_KEY[p] + ')" d="' + barPath(x, y, bw3, Math.max(0, h - gap), 4) + '"/>'
            : '<rect class="seg-r" fill="var(--pos-' + POS_KEY[p] + ')" x="' + x + '" y="' + y + '" width="' + bw3 + '" height="' + Math.max(0, h - gap) + '"/>';
          acc += h;
        });
      }
      var tipH = "<b>" + unitTitle(keys[i], unit) + " 확정 " + n + "건</b>" + (n ? POS.filter(function (p) { return o[p]; }).map(function (p) {
        return tipRow("var(--pos-" + POS_KEY[p] + ")", p, o[p] + "건 (" + Math.round(o[p] / n * 100) + "%)");
      }).join("") : "<div>밴드가 있는 확정 건 없음</div>");
      svg3 += colHit(L + band3 * i, T, band3, ih3, tipH, unitTitle(keys[i], unit) + " 확정 " + n + "건") + segs + "</g>";
    });
    svg3 += "</svg>";
    var posTot = {}; POS.forEach(function (p) { posTot[p] = pc.reduce(function (a, o) { return a + o[p]; }, 0); });
    var legend3 = '<div class="legend">' + POS.map(function (p) { return '<span><i style="background:var(--pos-' + POS_KEY[p] + ')"></i>' + p + " " + posTot[p] + "</span>"; }).join("") + "</div>";

    var techPanel = "", leaguePanel = "", sectorPanel = "", valPanel = "", uwPanel = "", floatP = "";
    if (!statFast) (function () {
    floatP = floatPanel(deals, periodText, W, halfW, H);   // 기술특례·주관사 표는 제스처가 끝난 뒤에만 다시 계산
    // ---- 4) 기술특례 분석
    var tech = deals.filter(function (d) { return d.board === "KOSDAQ_TECH" && !isSpac(d); });
    var grp = {};
    tech.forEach(function (d) {
      var GR = { AAA: 0, AA: 1, A: 2, BBB: 3, BB: 4, B: 5 };
      var g = d.tech_grades ? (/^단수평가/.test(d.tech_mode || "") ? "단수 " + bestGrade(d.tech_grades)
        : d.tech_grades.split(/\s*,\s*/).sort(function (a, b) { return (GR[a] || 9) - (GR[b] || 9); }).join("·")) : d.tech_track === "성장성 추천" ? "성장성 추천" : "등급 미확인";
      if (d.tech_grades && d.tech_grades.indexOf(",") < 0) g += " (단수)";
      (grp[g] = grp[g] || []).push(d);
    });
    var GRANK = { "AA·AA": 0, "AA·A": 1, "A·A": 2, "AA·BBB": 3, "A·BBB": 4 };
    var gradeRank = function (g) { return g in GRANK ? GRANK[g] : /단수/.test(g) ? 6 : g === "성장성 추천" ? 8 : g === "등급 미확인" ? 9 : 5; };
    var gkeys = Object.keys(grp).sort(function (a, b) { return gradeRank(a) - gradeRank(b) || grp[b].length - grp[a].length; });
    var gmax = Math.max.apply(null, gkeys.map(function (g) { return grp[g].length; }).concat([1]));
    var gradeRows = gkeys.map(function (g) {
      var ds = grp[g], im = median(ds.map(function (d) { return d.inst_demand_ratio; })), rm = median(ds.map(function (d) { return d.retail_ratio; }));
      var pd = ds.filter(function (d) { return position(d); }), up = pd.filter(function (d) { var p = position(d); return p === "상단" || p === "초과"; }).length;
      return '<tr><td><span class="gtag">' + esc(g) + '</span></td><td class="num">' + ds.length + '</td><td class="bar-cell"><div class="hbar t" style="width:' + (ds.length / gmax * 100).toFixed(1) + '%"></div></td><td class="num">' +
        (im != null ? ratio(im, 0) : "-") + '</td><td class="num">' + (rm != null ? ratio(rm, 0) : "-") + '</td><td class="num">' + (pd.length ? Math.round(up / pd.length * 100) + "%" : "-") + "</td></tr>";
    }).join("");
    var routes = {};
    tech.forEach(function (d) { var r = d.tech_track || "기타"; routes[r] = (routes[r] || 0) + 1; });
    var nonTechKq = deals.filter(function (d) { return d.board === "KOSDAQ" && !isSpac(d); });
    var cmp = [["기술특례", tech], ["코스닥 일반", nonTechKq]].map(function (r) {
      var ds = r[1], pd = ds.filter(function (d) { return position(d); }), up = pd.filter(function (d) { var p = position(d); return p === "상단" || p === "초과"; }).length;
      return '<div><span class="k">' + r[0] + '</span><span class="v">' + (median(ds.map(function (d) { return d.inst_demand_ratio; })) != null ? int(Math.round(median(ds.map(function (d) { return d.inst_demand_ratio; })))) + "<small>:1</small>" : "-") +
        '</span><span class="s">상단 이상 ' + (pd.length ? Math.round(up / pd.length * 100) + "%" : "-") + " · 공모액 중앙값 " + (median(ds.map(function (d) { return d.offer_amount; })) != null ? jo(median(ds.map(function (d) { return d.offer_amount; })) / 1e8) : "-") + "</span></div>";
    }).join("");
    techPanel = '<section class="panel tech"><header><div><h2>기술특례 분석</h2><p>' + periodText + " 상장 기술특례 " + tech.length + "건. 등급은 전문평가기관 2곳 결과(소부장 단수평가는 1곳). 경쟁률은 중앙값입니다.</p></div></header>" +
      '<div class="pbody">' + (tech.length ? '<div class="cmp">' + cmp + "</div>" +
        '<div class="routes">' + Object.keys(routes).sort(function (a, b) { return routes[b] - routes[a]; }).map(function (r) { return '<span class="chip-s">' + esc(r) + " <b>" + routes[r] + "</b></span>"; }).join("") + "</div>" +
        '<div class="scroll"><table class="mini grades"><thead><tr><th>평가 등급</th><th class="num">건수</th><th class="bar-cell"><span class="sr">건수 막대</span></th><th class="num">수요예측</th><th class="num">일반청약</th><th class="num">상단 이상</th></tr></thead><tbody>' + gradeRows + "</tbody></table></div>"
        : '<div class="empty">선택한 조건에 기술특례 상장 건이 없습니다.</div>') + "</div></section>";

    // ---- 4-2) 업종별 현황(스팩 제외)
    var sg = {};
    deals.forEach(function (d) { if (!isSpac(d) && d.sector) (sg[d.sector] = sg[d.sector] || []).push(d); });
    var skeys = Object.keys(sg).sort(function (a, b) { return sg[b].length - sg[a].length; });
    var smax = Math.max.apply(null, skeys.map(function (k) { return sg[k].length; }).concat([1]));
    var sectorRows = skeys.map(function (k) {
      var ds = sg[k], im = median(ds.map(function (d) { return d.inst_demand_ratio; }));
      var cm = ds.map(function (d) { return d.lockup && d.lockup.commit ? d.lockup.commit.ratio : null; }).filter(function (v) { return v != null; });
      var pd = ds.filter(function (d) { return position(d); }), up = pd.filter(function (d) { var p = position(d); return p === "상단" || p === "초과"; }).length;
      var amt = ds.reduce(function (a, d) { return a + (d.offer_amount || 0); }, 0);
      return '<tr><td>' + esc(k) + '</td><td class="num">' + ds.length + '</td><td class="bar-cell"><div class="hbar" style="width:' + (ds.length / smax * 100).toFixed(1) + '%"></div></td><td class="num">' + eok(amt) +
        '</td><td class="num">' + (im != null ? ratio(im, 0) : "-") + '</td><td class="num">' + (cm.length ? pct1(cm.reduce(function (a, v) { return a + v; }, 0) / cm.length) : "-") +
        '</td><td class="num">' + (pd.length ? Math.round(up / pd.length * 100) + "%" : "-") + "</td></tr>";
    }).join("");
    sectorPanel = '<section class="panel sectors"><header><div><h2>업종별 현황</h2><p>' + periodText + " 상장 기준(스팩 제외). 업종은 DART 업종코드(KSIC)를 15개 대분류로 묶었습니다. 경쟁률은 중앙값, 확약비율은 원문에서 읽힌 건의 평균입니다.</p></div></header>" +
      '<div class="pbody">' + (skeys.length ? '<div class="scroll"><table class="mini sect"><thead><tr><th>업종</th><th class="num">건수</th><th class="bar-cell"><span class="sr">막대</span></th><th class="num">공모액(억)</th><th class="num">수요예측</th><th class="num">확약비율</th><th class="num">상단 이상</th></tr></thead><tbody>' + sectorRows + "</tbody></table></div>"
        : '<div class="empty">선택한 조건에 상장 건이 없습니다.</div>') + "</div></section>";

    // ---- 4-3) 공모가 산정 근거(밸류에이션)
    var vds = deals.filter(function (d) { return !isSpac(d) && d.val && (d.val.disc_low != null || d.val.value); });
    var nAll = deals.filter(function (d) { return !isSpac(d); }).length;
    var avg = function (xs) { xs = xs.filter(function (v) { return v != null; }); return xs.length ? xs.reduce(function (a, b) { return a + b; }, 0) / xs.length : null; };
    var f1 = function (v, u) { return v == null ? "-" : v.toLocaleString("ko-KR", { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + (u || ""); };
    var valRow = function (label, ds, showMul) {
      var lo = avg(ds.map(function (d) { return d.val.disc_low; })), hi = avg(ds.map(function (d) { return d.val.disc_high; }));
      var fd = median(ds.map(function (d) { return d.val.final_disc; })), mu = median(ds.map(function (d) { return d.val.multiple; }));
      return "<tr><td>" + label + '</td><td class="num">' + ds.length + '</td><td class="num">' + (lo != null ? f1(lo) + "~" + f1(hi, "%") : "-") +
        '</td><td class="num">' + (fd == null ? "-" : fd < 0 ? "할증 " + f1(-fd, "%") : f1(fd, "%")) + '</td><td class="num">' + (showMul && mu != null ? f1(mu, "배") : "-") + "</td></tr>";
    };
    var VM = ["PER", "EV/EBITDA", "PSR"];
    var mRows = VM.map(function (m) { return [m, vds.filter(function (d) { return d.val.method === m; })]; })
      .concat([["기타", vds.filter(function (d) { return VM.indexOf(d.val.method) < 0; })]])
      .filter(function (r) { return r[1].length; }).map(function (r) { return valRow(esc(r[0]), r[1], r[0] !== "기타"); }).join("");
    var tRows = [["코스닥 기술특례", vds.filter(function (d) { return d.board === "KOSDAQ_TECH"; })], ["코스닥 일반", vds.filter(function (d) { return d.board === "KOSDAQ"; })], ["유가증권", vds.filter(function (d) { return d.board === "KOSPI"; })]]
      .filter(function (r) { return r[1].length; }).map(function (r) { return valRow(esc(r[0]), r[1], false); }).join("");
    var per = vds.filter(function (d) { return d.val.method === "PER" && d.sector; }), ps = {};
    per.forEach(function (d) { (ps[d.sector] = ps[d.sector] || []).push(d); });
    var sRows = Object.keys(ps).filter(function (k) { return ps[k].length >= 3; }).sort(function (a, b) { return ps[b].length - ps[a].length; })
      .map(function (k) { return valRow(esc(k), ps[k], true); }).join("");
    var vHead = '<thead><tr><th>구분</th><th class="num">건수</th><th class="num">밴드 할인율(평균)</th><th class="num">확정가 할인율</th><th class="num">적용 배수</th></tr></thead>';
    valPanel = '<section class="panel valp"><header><div><h2>공모가 산정 근거</h2><p>' + periodText + " 상장 기준(스팩 제외). 증권신고서 &lsquo;공모가격에 대한 의견&rsquo;에서 읽은 " + vds.length + "건 / " + nAll + "건. 밴드 할인율은 주당 평가가액 대비 희망 밴드 상단~하단의 할인율 평균, 확정가 할인율·적용 배수는 중앙값입니다.</p></div></header>" +
      '<div class="pbody">' + (vds.length ? '<div class="scroll"><table class="mini sect">' + vHead + "<tbody>" + mRows + '<tr class="gap"><td colspan="5"></td></tr>' + tRows + "</tbody></table></div>" +
        (sRows ? '<h3 class="minih">업종별 PER 적용 (3건 이상)</h3><div class="scroll"><table class="mini sect">' + vHead + "<tbody>" + sRows + "</tbody></table></div>" : "")
        : '<div class="empty">선택한 조건에 산정 근거를 읽은 상장 건이 없습니다.</div>') + "</div></section>";

    // ---- 4-4) 대표주관사별 공모 조건(수수료율·할인율·가격 결정)
    var ug = {};
    deals.filter(function (d) { return !isSpac(d); }).forEach(function (d) {
      uwSet(d).forEach(function (n) { (ug[n] = ug[n] || []).push(d); });
    });
    var ukeys = Object.keys(ug).filter(function (k) { return ug[k].length >= 5; }).sort(function (a, b) { return ug[b].length - ug[a].length; });
    var uRows = ukeys.map(function (k) {
      var ds = ug[k], fees = ds.map(function (d) { return structInfo(d).fee; }).filter(function (v) { return v != null && v > 0 && v < 15; });
      var vs = ds.filter(function (d) { return d.val; });
      var lo = avg(vs.map(function (d) { return d.val.disc_low; })), hi = avg(vs.map(function (d) { return d.val.disc_high; }));
      var fd = median(vs.map(function (d) { return d.val.final_disc; }));
      var pd = ds.filter(function (d) { return position(d); }), up = pd.filter(function (d) { var q = position(d); return q === "상단" || q === "초과"; }).length;
      var im = median(ds.map(function (d) { return d.inst_demand_ratio; }));
      var foc = k.indexOf(FOCUS_NAME) >= 0;
      return "<tr" + (foc ? ' class="focus"' : "") + "><td>" + esc(k) + '</td><td class="num">' + ds.length + '</td><td class="num">' + (fees.length ? f1(avg(fees), "%") : "-") +
        '</td><td class="num">' + (lo != null ? f1(lo) + "~" + f1(hi, "%") : "-") + '</td><td class="num">' + (fd == null ? "-" : fd < 0 ? "할증 " + f1(-fd, "%") : f1(fd, "%")) +
        '</td><td class="num">' + (pd.length ? Math.round(up / pd.length * 100) + "%" : "-") + '</td><td class="num">' + (im != null ? ratio(im, 0) : "-") + "</td></tr>";
    }).join("");
    uwPanel = '<section class="panel uwp"><header><div><h2>대표주관사별 공모 조건</h2><p>' + periodText + " 상장 기준(스팩 제외), 대표주관 5건 이상. 공동 대표주관은 각사에 1건씩 셉니다. 수수료율은 인수대가 ÷ 인수금액(신고서 기준, 성과수수료 제외) 평균, 밴드 할인율은 평균, 확정가 할인율·경쟁률은 중앙값입니다.</p></div></header>" +
      '<div class="pbody">' + (uRows ? '<div class="scroll"><table class="mini sect uw"><thead><tr><th>대표주관</th><th class="num">건수</th><th class="num">수수료율</th><th class="num">밴드 할인율</th><th class="num">확정가 할인율</th><th class="num">상단 이상</th><th class="num">수요예측</th></tr></thead><tbody>' + uRows + "</tbody></table></div>"
        : '<div class="empty">선택한 조건에 대표주관 5건 이상인 주관사가 없습니다.</div>') + "</div></section>";

    // ---- 5) 대표주관사 순위
    var lg = {};
    deals.forEach(function (d) {
      var names = uwSet(d);
      names.forEach(function (n) {
        var r = lg[n] = lg[n] || { name: n, count: 0, amount: 0, tech: 0 };
        r.count++;
        if (d.offer_amount) r.amount += d.offer_amount / names.length;
        if (d.board === "KOSDAQ_TECH") r.tech++;
      });
    });
    var leag = Object.keys(lg).map(function (k) { return lg[k]; });
    var lk = ["amount", "tech"].indexOf(state.league) >= 0 ? state.league : "count";
    leag.sort(function (a, b) { return b[lk] - a[lk] || b.count - a.count; });
    var maxL = leag.length ? Math.max(1, leag[0][lk]) : 1, topN = leag.slice(0, 15);
    var leagueRows = topN.map(function (r, i) {
      return '<tr class="go' + (r.name === FOCUS_NAME ? " focus" : "") + '" tabindex="0" data-uw="' + esc(r.name) + '"><td class="rank">' + (i + 1) + "</td><td>" + esc(r.name) + '</td><td class="num">' + r.count + '</td><td class="num">' + r.tech +
        '</td><td class="num">' + eok(r.amount) +
        '</td><td class="bar-cell"><div class="hbar" style="width:' + (r[lk] / maxL * 100).toFixed(1) + '%"></div></td></tr>';
    }).join("");
    leaguePanel = '<section class="panel league"><header><div><h2>대표주관사 순위</h2><p>' + periodText + " 상장 기준. 공동 대표주관은 건수 각 1건, 공모액은 사 수로 나눔. 사명 변경·합병사는 현재 사명으로 합산. 행을 누르면 해당 딜 목록으로 이동합니다.</p></div>" +
      segBtns("data-l", [["count", "건수순"], ["amount", "공모액순"], ["tech", "기술특례순"]], lk) + '</header><div class="pbody">' +
      '<div class="scroll"><table class="mini"><thead><tr><th>순위</th><th>대표주관</th><th class="num">건수</th><th class="num">기술특례</th><th class="num">공모액(억)</th><th class="bar-cell"><span class="sr">막대</span></th></tr></thead><tbody>' + leagueRows + "</tbody></table></div>" +
      '<p class="snote">상위 ' + topN.length + "개사 / 전체 " + leag.length + "개사</p></div></section>";

    })();
    var unitWord = unit === "year" ? "연도별" : unit === "quarter" ? "분기별" : "월별";
    setStatsHtml('<div class="content">' + gsearchBox() + head + kpi +
      '<section class="panel"><header><div><h2>' + unitWord + " 상장 추이</h2><p>상장일 기준(상장 완료 건). 공모액은 확정 금액입니다." + (estN ? " 상장일을 원문에서 읽지 못한 " + estN + "건은 증권발행실적보고서 제출일로 추정했습니다." : "") + "</p></div>" +
      segBtns("data-m", [["count", "건수"], ["amount", "공모액"]], isAmt ? "amount" : "count") + '</header><div class="pbody chart zoomable">' + legend1 + svg1 +
      '<p class="zhint">' + (COARSE ? "두 손가락으로 벌리거나 모아 기간 조정 · 확대 후 좌우로 끌어 이동 · 두 번 탭하면 원래대로" : "트랙패드 핀치 또는 Ctrl+스크롤로 기간 조정 · 확대 후 드래그로 이동 · 더블클릭하면 원래대로") + "</p>" +
      '<details class="tv"><summary>표로 보기</summary>' + tbl1 + "</details></div></section>" +
      '<div class="panels even">' +
      '<section class="panel"><header><div><h2>경쟁률 추이</h2><p>' + unitWord + " 상장 건의 수요예측·일반청약 경쟁률 중앙값(스팩 제외).</p></div></header>" +
      '<div class="pbody chart zoomable">' + legend2 + svg2 + "</div></section>" +
      '<section class="panel"><header><div><h2>밴드 대비 확정가 위치</h2><p>' + unitWord + " 상장 건의 비중. 단일 희망가(스팩 등)는 제외. 위로 갈수록 높은 가격입니다.</p></div></header>" +
      '<div class="pbody chart zoomable">' + legend3 + svg3 + "</div></section></div>" +
      (statFast ? '<div class="keep"></div>' : '<div class="stack">' + floatP + '<div class="panels even">' + techPanel + leaguePanel + "</div>" + '<div class="panels even">' + sectorPanel + valPanel + "</div>" + uwPanel + "</div>") + "</div>");
    bindStats();
    bindChart();
  }
  // 제스처 중에는 그래프 상자(.zoomable)를 DOM에서 떼지 않고 안쪽만 바꿉니다(포인터 캡처 유지).
  function patchNode(o, n) {
    if (n.classList && n.classList.contains("keep")) return;   // 제스처 중에는 그대로 둠
    if (o.classList && o.classList.contains("zoomable")) { o.innerHTML = n.innerHTML; return; }
    if (!o.querySelector || !o.querySelector(".zoomable") || o.childNodes.length !== n.childNodes.length || o.tagName !== n.tagName) {
      o.replaceWith(n); return;
    }
    var oc = Array.prototype.slice.call(o.childNodes), nc = Array.prototype.slice.call(n.childNodes);
    for (var i = 0; i < oc.length; i++) patchNode(oc[i], nc[i]);
    if (n.attributes) Array.prototype.forEach.call(n.attributes, function (a) { o.setAttribute(a.name, a.value); });
  }
  function setStatsHtml(html) {
    var old = app.firstElementChild;
    if (statLive && old && old.querySelector(".zoomable")) {
      var t = document.createElement("div");
      t.innerHTML = html;
      patchNode(old, t.firstElementChild);
    } else app.innerHTML = html;
  }
  function kpiTile(v, unitTxt, label, hl) {
    return '<div><div class="v' + (hl ? " hl" : "") + '">' + v + (unitTxt ? "<small>" + unitTxt + "</small>" : "") + '</div><div class="l">' + label + "</div></div>";
  }
  function autoUnit(p) {
    if (/^\d{4}$/.test(p)) return "month";
    if (p === "3y") return "quarter";
    return "year";
  }
  function bindStats() {
    if (!(document.activeElement && document.activeElement.id === "g-q")) bindGsearch();
    enhanceSelects(app);
    var pe = document.getElementById("s-period");
    if (pe) pe.addEventListener("change", function (e) {
      if (e.target.value === "custom") return;
      state.sWin = null; state.sPeriod = e.target.value; state.sUnit = autoUnit(state.sPeriod); persist(); renderStats();
    });
    var wr = document.getElementById("s-win-reset");
    if (wr) wr.addEventListener("click", resetWin);
    var bs = document.getElementById("s-board");
    if (bs) bs.addEventListener("change", function (e) { state.board = e.target.value; persist(); renderStats(); });
    app.querySelectorAll(".s-spac").forEach(function (sp) {
      sp.addEventListener("change", function (e) { state.spac = e.target.checked; persist(); renderStats(); });
    });
    app.querySelectorAll("[data-u]").forEach(function (b) {
      b.addEventListener("click", function () { state.sUnit = b.dataset.u; persist(); renderStats(); });
    });
    app.querySelectorAll("[data-m]").forEach(function (b) {
      b.addEventListener("click", function () { state.metric = b.dataset.m; persist(); renderStats(); });
    });
    if (statFast) return;   // 기술특례·주관사 표는 그대로 두었으므로 다시 묶지 않음
    app.querySelectorAll("[data-l]").forEach(function (b) {
      b.addEventListener("click", function () { state.league = b.dataset.l; persist(); renderStats(); });
    });
    app.querySelectorAll("[data-fs]").forEach(function (b) {
      b.addEventListener("click", function () { state.fSeg = b.dataset.fs; persist(); renderStats(); });
    });
    app.querySelectorAll("[data-fk]").forEach(function (b) {
      b.addEventListener("click", function () { state.fKey = b.dataset.fk; persist(); renderStats(); });
    });
    // 주관사 행 → 딜 목록(주관사 검색, 상장 건)
    app.querySelectorAll("tr[data-uw]").forEach(function (tr) {
      var go = function () {
        state.q = tr.dataset.uw; state.status = "completed"; state.year = ""; persist();
        view = null; goPath("/");
      };
      tr.addEventListener("click", go);
      tr.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    });
  }

  // ---------------------------------------------------------------- 통계 핀치 확대·축소(실시간)
  var COARSE = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
  var MIN_SPAN = 6;   // 최소 6개월
  var statLive = false, statFast = false, liveFrame = 0;
  function resetWin() { state.sWin = null; state.sPeriod = "all"; state.sUnit = "year"; persist(); hideTip(); statLive = false; renderStats(); }
  // 창 적용: final이면 단위 경계에 맞추고 저장, 아니면 다음 프레임에 그래프만 갱신
  function applyWin(f, t, final) {
    var n = statNow;
    if (!n) return;
    var full = n.b1 - n.b0 + 1, span = Math.max(MIN_SPAN, Math.min(full, Math.round(t - f + 1)));
    f = Math.round(f);
    f = Math.max(n.b0, Math.min(f, n.b1 - span + 1)); t = f + span - 1;
    var unit = pickUnit(span);
    if (final) { var sw = snapWin(f, t, unit); f = Math.max(n.b0, sw[0]); t = Math.min(n.b1, sw[1]); }
    if (span >= full || (f <= n.b0 && t >= n.b1)) { state.sWin = null; state.sPeriod = "all"; state.sUnit = "year"; }
    else { state.sWin = { from: mKey(f), to: mKey(t) }; state.sPeriod = "custom"; state.sUnit = unit; }
    if (final) {
      cancelAnimationFrame(liveFrame); liveFrame = 0;
      persist(); statLive = true; renderStats(); statLive = false;
      return;
    }
    if (!liveFrame) liveFrame = requestAnimationFrame(function () { liveFrame = 0; statLive = statFast = true; renderStats(); statLive = statFast = false; });
  }
  function plotGeom(z, clientX) {   // 화면 x → 플롯 안 비율(0~1), 플롯 폭(px)
    var svg = z.querySelector("svg"), r = svg.getBoundingClientRect();
    var W = +svg.dataset.w || r.width, L = +svg.dataset.l || 0, R = +svg.dataset.r || 0;
    var px = r.width * (W - L - R) / W, x0 = r.left + r.width * L / W;
    return { f: Math.max(0, Math.min(1, (clientX - x0) / px)), px: px };
  }
  (function () {
    var ptr = {}, g = null, lastTap = 0, lastX = 0;
    function zoneOf(e) { return e.target.closest ? e.target.closest(".zoomable") : null; }
    function pts() { return Object.keys(ptr).map(function (k) { return ptr[k]; }); }
    function startPinch(z, ids) {
      ids.forEach(function (id) { try { z.setPointerCapture(id); } catch (err) { /* 무시 */ } });
      var p = pts(), a = p[0], b = p[1], cx = (a.x + b.x) / 2, geo = plotGeom(z, cx), n = statNow;
      g = { mode: "pinch", z: z, from0: n.from, span0: n.to - n.from + 1, d0: Math.max(24, Math.abs(a.x - b.x)), c0: n.from + geo.f * (n.to - n.from + 1) };
      hideTip();
    }
    function startPan(z, x) {
      var n = statNow;
      g = { mode: "pan", z: z, from0: n.from, span0: n.to - n.from + 1, x0: x, px: plotGeom(z, x).px, moved: false };
    }
    app.addEventListener("pointerdown", function (e) {
      if (view !== "stats" || !statNow) return;
      var z = zoneOf(e);
      if (!z || (e.pointerType === "mouse" && e.button !== 0)) return;
      ptr[e.pointerId] = { x: e.clientX, y: e.clientY };
      var n = pts().length;
      if (n === 2) { startPinch(z, Object.keys(ptr).map(Number)); return; }
      if (n === 1) {
        var now = Date.now();
        if (now - lastTap < 320 && Math.abs(e.clientX - lastX) < 24 && state.sWin) { lastTap = 0; ptr = {}; g = null; resetWin(); return; }
        lastTap = now; lastX = e.clientX;
        if (state.sWin) { try { z.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ } startPan(z, e.clientX); }
      }
    });
    app.addEventListener("pointermove", function (e) {
      if (!ptr[e.pointerId]) return;
      ptr[e.pointerId].x = e.clientX; ptr[e.pointerId].y = e.clientY;
      if (!g) return;
      if (g.mode === "pinch" && pts().length >= 2) {
        var p = pts(), d = Math.max(8, Math.abs(p[0].x - p[1].x)), cx = (p[0].x + p[1].x) / 2;
        var span = Math.max(MIN_SPAN, g.span0 * g.d0 / d), f = plotGeom(g.z, cx).f;
        applyWin(g.c0 - f * span, g.c0 - f * span + span - 1, false);   // 손가락 사이 지점이 같은 날짜에 머물도록
      } else if (g.mode === "pan") {
        var dx = e.clientX - g.x0;
        if (!g.moved && Math.abs(dx) < 6) return;
        g.moved = true; lastTap = 0; hideTip();
        var shift = -dx / g.px * g.span0;
        applyWin(g.from0 + shift, g.from0 + shift + g.span0 - 1, false);
      }
    });
    function up(e) {
      if (!ptr[e.pointerId]) return;
      delete ptr[e.pointerId];
      if (!g) return;
      var left = pts().length;
      if (g.mode === "pinch" && left >= 2) return;
      var done = g; g = null;
      if (done.mode === "pinch" || done.moved) applyWin(statNow.from, statNow.to, true);
      if (done.mode === "pinch" && left === 1 && state.sWin) {   // 한 손가락이 남으면 이어서 이동
        var k = Object.keys(ptr)[0]; startPan(done.z, ptr[k].x);
      }
    }
    app.addEventListener("pointerup", up);
    app.addEventListener("pointercancel", up);
    // 컴퓨터: 트랙패드 핀치(ctrl+wheel)·Ctrl+스크롤 확대, 가로 스크롤 이동 — 즉시 반영, 멈추면 단위 경계에 맞춤
    var wheelTimer = 0;
    app.addEventListener("wheel", function (e) {
      if (view !== "stats" || !statNow) return;
      var z = zoneOf(e);
      if (!z) return;
      var n = statNow, span = n.to - n.from + 1;
      if (e.ctrlKey) {
        e.preventDefault();
        var geo = plotGeom(z, e.clientX), c = n.from + geo.f * span, ns = Math.max(MIN_SPAN, span * Math.exp(e.deltaY * 0.004));
        applyWin(c - geo.f * ns, c - geo.f * ns + ns - 1, false);
      } else if (state.sWin && Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaX) > 1) {
        e.preventDefault();
        var sh = e.deltaX / plotGeom(z, e.clientX).px * span;
        applyWin(n.from + sh, n.to + sh, false);
      } else return;
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(function () { applyWin(statNow.from, statNow.to, true); }, 220);
    }, { passive: false });
  })();

  // ---------------------------------------------------------------- 기술특례 바이오 (케이스 스터디)
  // data/biotech.json: 2005년 이후 기술특례 신약개발사 70개사의 상장 당시 증권신고서 정리와 상장예비심사 청구 건(승인·철회·미승인)
  var bio = null, bioByDeal = {}, bioByName = {};
  var bioState = { q: "" };
  function bioIndex() {
    bioByDeal = {}; bioByName = {};
    if (!bio) return;
    bio.companies.forEach(function (c) {
      bioByName[c.n] = c;
      c.cdeals = (c.deals || []).filter(function (x) { return /L\/O|플랫폼|옵션|공동/.test(x.dir || ""); });   // 계약 = L/O + 공동연구·공동개발
      c.nco = c.cdeals.length;
      (c.deal_ids || []).forEach(function (id) { bioByDeal[id] = c; });
    });
  }
  var BIO_RES = [
    { key: "승인", css: "var(--bar)" },
    { key: "철회", css: "var(--mk-tech)" },
    { key: "미승인", css: "var(--pos-over)" }
  ];
  var BIO_GRP = [
    { key: "L/O 있음 · 2상 이상", css: "var(--mk-ks)" },
    { key: "L/O 있음 · 2상 미만", css: "var(--mk-kq)" },
    { key: "L/O 없음 · 2상 이상", css: "var(--mk-tech)" },
    { key: "L/O 없음 · 2상 미만", css: "var(--mk-spac)" },
    { key: "확인 못함", css: "var(--faint)" }
  ];
  var BIO_PROF = [
    { key: "해외 상대방 L/O", css: "var(--mk-ks)" },
    { key: "국내 L/O만", css: "var(--mk-kq)" },
    { key: "공동연구만", css: "var(--mk-tech)" },
    { key: "계약 없음·기타", css: "var(--faint)" }
  ];
  var BIO_ERAS = [["2005–13", 2005, 2013], ["2014–16", 2014, 2016], ["2017–19", 2017, 2019], ["2020–21", 2020, 2021], ["2022–23", 2022, 2023], ["2024–26", 2024, 2026]];
  function bioYears() {
    var ys = bio.attempts.map(function (a) { return a.y; });
    var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys), out = [];
    for (var y = y0; y <= y1; y++) out.push(y);
    return out;
  }
  function bioGroup(a) { return a.group || "확인 못함"; }
  function bioProfKey(c) {
    if (c.nlo) return c.glo ? "해외 상대방 L/O" : "국내 L/O만";
    var co = (c.deals || []).some(function (x) { return /공동/.test(x.dir || ""); });
    return co ? "공동연구만" : "계약 없음·기타";
  }
  function bioPassText(xs) {
    if (!xs.length) return '<span class="dim">-</span>';
    var ok = xs.filter(function (a) { return a.outcome === "승인"; }).length;
    return '<span class="pr">' + Math.round(ok / xs.length * 100) + '%</span><span class="fr">' + ok + "/" + xs.length + "</span>";
  }
  function nameList(xs, fmt) {
    if (!xs.length) return "";
    var shown = xs.slice(0, 14).map(fmt || function (a) { return a.name; });
    return '<div class="tnames">' + esc(shown.join(", ")) + (xs.length > 14 ? " 외 " + (xs.length - 14) + "곳" : "") + "</div>";
  }
  // 연도별 누적 막대 (막대마다 회사 이름이 담긴 툴팁)
  function bioStack(o) {
    var years = o.years, W = o.W, H = o.H, L = 34, R = 8, T = 22, B = 30, ih = H - T - B;
    var cells = years.map(function (y) {
      var m = {};
      o.series.forEach(function (s) { m[s.key] = []; });
      o.items.forEach(function (it) { if (it.y === y && m[it.k]) m[it.k].push(it.x); });
      return m;
    });
    var tots = cells.map(function (m) { return o.series.reduce(function (a, s) { return a + m[s.key].length; }, 0); });
    var top = o.max || niceCountMax(Math.max.apply(null, tots.concat([1])));
    var band = (W - L - R) / years.length, bw = Math.min(28, band * 0.66);
    var svg = '<svg data-w="' + W + '" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc(o.aria) + '">' +
      frame(W, H, L, R, T, B, top, years.map(String), function (v) { return int(Math.round(v)); });
    cells.forEach(function (m, i) {
      var x = L + band * i + (band - bw) / 2, acc = 0, segs = "", shown = o.series.filter(function (s) { return m[s.key].length; });
      shown.forEach(function (s, j) {
        var h = (m[s.key].length / top) * ih, y = T + ih - acc - h, gap = j > 0 ? 2 : 0;
        segs += j === shown.length - 1
          ? '<path class="seg-r" fill="' + s.css + '" d="' + barPath(x, y, bw, Math.max(0, h - gap), 3) + '"/>'
          : '<rect class="seg-r" fill="' + s.css + '" x="' + x + '" y="' + y + '" width="' + bw + '" height="' + Math.max(0, h - gap) + '"/>';
        acc += h;
      });
      var tipH = "<b>" + years[i] + "년 " + o.unit + " " + tots[i] + "건" + (o.extra ? o.extra(m, tots[i]) : "") + "</b>" +
        (tots[i] ? o.series.filter(function (s) { return m[s.key].length; }).map(function (s) {
          return tipRow(s.css, s.key, m[s.key].length + "건") + nameList(m[s.key], o.fmt);
        }).join("") : "<div>" + o.unit + " 건 없음</div>");
      var lbl = o.label && tots[i] && band >= 30 ? o.label(m, tots[i]) : "";
      svg += colHit(L + band * i, T, band, ih, tipH, years[i] + "년 " + tots[i] + "건") + segs +
        (lbl ? '<text class="vlabel" x="' + (x + bw / 2) + '" y="' + (T + ih - (tots[i] / top) * ih - 6) + '" text-anchor="middle">' + lbl + "</text>" : "") + "</g>";
    });
    return svg + "</svg>";
  }
  function bioLegend(series, items) {
    return '<div class="legend">' + series.map(function (s) {
      var n = items ? items.filter(function (it) { return it.k === s.key; }).length : null;
      return '<span><i style="background:' + s.css + '"></i>' + esc(s.key) + (n != null ? " " + n : "") + "</span>";
    }).join("") + "</div>";
  }
  // ---------------------------------------------------------------- 일정 (공모 일정 · 최근 공시 · 예심 현황)
  function isoOf(dt) { return dt.getFullYear() + "-" + ("0" + (dt.getMonth() + 1)).slice(-2) + "-" + ("0" + dt.getDate()).slice(-2); }
  function dOf(s) { var p = s.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(s, n) { var t = dOf(s); t.setDate(t.getDate() + n); return isoOf(t); }
  function addMonths(s, n) { var t = dOf(s); t.setMonth(t.getMonth() + n); return isoOf(t); }
  function daysBetween(a, b) { return Math.round((dOf(b) - dOf(a)) / 864e5); }
  function todayIso() { return isoOf(new Date()); }
  var WD = ["일", "월", "화", "수", "목", "금", "토"];
  function mdw(s) { var t = dOf(s); return (t.getMonth() + 1) + "." + t.getDate() + " (" + WD[t.getDay()] + ")"; }
  function md(s) { var t = dOf(s); return (t.getMonth() + 1) + "." + t.getDate(); }
  // "2026년 12월 14일 ~ 2026년 12월 15일", "2026.12.14 ~ 12.15" 같은 원문 기일을 ISO 날짜 배열로
  function kdates(raw) {
    if (!raw) return [];
    var out = [], y = null, m, re = /(?:(\d{4})\s*[년.\-]\s*)?(\d{1,2})\s*[월.\-]\s*(\d{1,2})\s*일?/g;
    while ((m = re.exec(raw))) {
      if (m[1]) y = +m[1];
      if (!y) continue;
      var mo = +m[2], da = +m[3];
      if (mo < 1 || mo > 12 || da < 1 || da > 31) continue;
      out.push(y + "-" + ("0" + mo).slice(-2) + "-" + ("0" + da).slice(-2));
    }
    return out;
  }
  function bizStart(today, n) {      // 오늘 포함 최근 n영업일(주말 제외)의 첫날
    var t = dOf(today), k = 0;
    while (true) { if (t.getDay() !== 0 && t.getDay() !== 6) { k++; if (k >= n) break; } t.setDate(t.getDate() - 1); }
    return isoOf(t);
  }
  var EV_ORDER = { "수요예측": 0, "청약": 1, "납입": 2, "상장": 3 };
  // 상장일: 실적보고서 확정 > KIND 신규상장 예정 > 납입일+4영업일 예상
  function lstOf(d) {
    if (d.listing_dt) return { dt: d.listing_dt, q: "" };
    if (d.listing_sched) return { dt: d.listing_sched, q: "예정" };
    if (d.listing_est) return { dt: d.listing_est, q: "예상" };
    return { dt: null, q: "" };
  }
  function calEvents() {
    var ev = [];
    data.deals.forEach(function (d) {
      if (d.status === "withdrawn" || d.is_ipo_candidate !== 1) return;
      if (d.demand_start) ev.push({ k: "수요예측", a: d.demand_start, b: d.demand_end || d.demand_start, d: d });
      var s = kdates(d.subscription_raw);
      if (s.length) ev.push({ k: "청약", a: s[0], b: s[s.length - 1] >= s[0] ? s[s.length - 1] : s[0], d: d });
      var p = kdates(d.payment_raw);
      if (p.length) ev.push({ k: "납입", a: p[0], b: p[0], d: d });
      var lq = lstOf(d);
      if (lq.dt) ev.push({ k: "상장", a: lq.dt, b: lq.dt, d: d, q: lq.q });
    });
    return ev;
  }
  function rvApproved(r) { return /승인/.test(r.r || "") && !/미승인/.test(r.r || ""); }
  function rvKind(r) {
    var x = r.r || "";
    if (!r.d || /접수/.test(x)) return "pending";
    if (/미승인/.test(x)) return "rejected";
    if (/심사 철회/.test(x)) return "withdrawn";
    return rvApproved(r) || /공모 철회|상장 철회/.test(x) ? "approved" : "other";
  }
  function rvIpo(r) { return /신규상장/.test(r.t || "") && !/스팩/.test(r.n || ""); }
  function nmLink(id, nm) { return id ? '<a class="nm" href="#/deal/' + encodeURIComponent(id) + '">' + esc(nm) + "</a>" : '<span class="nm">' + esc(nm) + "</span>"; }
  function spText(s) {
    if (!s) return '<span class="dim">-</span>';
    return s.split(/\s*,\s*/).map(function (x) { return x.indexOf(FOCUS_NAME) >= 0 ? '<b class="focus-t">' + esc(uwShort(x)) + "</b>" : esc(uwShort(x)); }).join(", ");
  }
  function medInt(xs) { var m = median(xs); return m == null ? null : Math.round(m); }
  // 일정 행: 날짜 | 종류·회사명·배지(줄바꿈 허용) / 주관사·가격(줄바꿈 허용). 휴대폰에서 좌우로 넘치지 않게 모두 접어 씁니다.
  function evRow(e, today) {
    var d = e.d, past = e.b < today, now = e.a <= today && e.b >= today;
    var sub = [esc(uwShortStr(d.lead_underwriters) || "주관사 미확인")];
    if (e.k === "수요예측" && d.offer_price_low) sub.push('<span class="mono">' + bandText(d) + "원</span>");
    if (e.k !== "수요예측" && d.final_price) sub.push('<span class="mono">' + int(d.final_price) + "원</span>");
    if (d.offer_amount && e.k !== "납입") sub.push('<span class="mono">' + eok(d.offer_amount) + "억</span>");
    return '<a class="ev' + (past ? " past" : "") + (now ? " now" : "") + (focusRole(d) ? " focus" : "") + '" href="#/deal/' + encodeURIComponent(d.deal_id) + '">' +
      '<span class="ed mono">' + (e.b !== e.a ? esc(md(e.a)) + "<br>~" + esc(md(e.b)) : esc(mdw(e.a))) + "</span>" +
      '<span class="em"><span class="ek k-' + EV_ORDER[e.k] + '">' + e.k + '</span><span class="nm">' + esc(name(d)) + "</span>" +
      boardTag(d) + (isSpac(d) ? '<span class="tag b-spac">스팩</span>' : "") + focusTag(d) + "</span>" +
      '<span class="eu">' + sub.join(" · ") + "</span></a>";
  }
  // 달력: 월 단위, 일요일 시작. 여러 날짜에 걸친 수요예측·청약은 평일에만 표시합니다.
  var calMonth = null, calDay = null;
  function dayEvents() {
    var m = {};
    calEvents().forEach(function (e) {
      if (e.k === "납입") return;          // 공모 달력에서는 납입을 보여주지 않습니다
      var t = e.a, guard = 0;
      while (t <= e.b && guard++ < 40) {
        var w = dOf(t).getDay();
        if (e.a === e.b || (w !== 0 && w !== 6)) (m[t] = m[t] || []).push(e);
        t = addDays(t, 1);
      }
    });
    Object.keys(m).forEach(function (k) { m[k].sort(function (x, y) { return EV_ORDER[x.k] - EV_ORDER[y.k] || (name(x.d) < name(y.d) ? -1 : 1); }); });
    return m;
  }
  function calDates(d) {
    var sub = kdates(d.subscription_raw), pay = kdates(d.payment_raw);
    var lq = lstOf(d);
    return { ds: d.demand_start, de: d.demand_end || d.demand_start, ss: sub[0] || null, se: sub.length ? sub[sub.length - 1] : null, pay: pay[0] || null, lst: lq.dt, lq: lq.q };
  }
  function rngT(a, b) { return a ? md(a) + (b && b !== a ? "~" + md(b) : "") : "미정"; }
  function pxText(d) {
    var p = d.final_price ? int(d.final_price) + "원" : d.offer_price_low ? bandText(d) + "원" : "";
    return [p, d.offer_amount ? eok(d.offer_amount) + "억" : ""].filter(Boolean).join(" · ");
  }
  // 그날 일정: 종류별(수요예측·청약·상장·납입)로 묶은 목록
  // 수요예측·청약이 그날 며칠째인지(주말 제외 영업일 기준) [n, 전체 일수]
  function dayNth(e, day) {
    var n = 0, tot = 0, t = e.a, g = 0;
    while (t <= e.b && g++ < 40) { var w = dOf(t).getDay(); if (w !== 0 && w !== 6) { tot++; if (t <= day) n++; } t = addDays(t, 1); }
    return tot > 1 ? [n, tot] : null;
  }
  function dayNthHtml(e, day) {
    if (e.k !== "수요예측" && e.k !== "청약") return "";
    var x = dayNth(e, day);
    return x ? '<em class="dnth' + (x[0] === x[1] ? " last" : "") + '" data-n="' + x[0] + '" data-t="' + x[1] + '">' + x[0] + "일차" + (x[0] === x[1] ? " · 마감" : "") + "</em>" : "";
  }
  function dayList(evs, day) {
    if (!evs.length) return '<div class="empty">이날 확인된 공모 일정이 없습니다.</div>';
    return ["상장", "청약", "수요예측"].map(function (k) {
      var xs = evs.filter(function (e) { return e.k === k; });
      if (!xs.length) return "";
      return '<div class="dg g-' + EV_ORDER[k] + '"><h4>' + k + " · " + xs.length + "건</h4>" + xs.map(function (e) {
        var d = e.d;
        return '<a class="it' + (focusRole(d) ? " focus" : "") + '" href="#/deal/' + encodeURIComponent(d.deal_id) + '"><span class="nm">' + esc(name(d)) + "</span>" +
          boardTag(d) + (isSpac(d) ? '<span class="tag b-spac">스팩</span>' : "") + focusTag(d) +
          (function () { var dn = dayNthHtml(e, day);   // 며칠차가 나오면 기간은 생략(기간은 툴팁으로)
            return dn ? '<span class="r mono" title="' + esc(rngT(e.a, e.b)) + '">' + dn + "</span>" : '<span class="r mono">' + esc(rngT(e.a, e.b)) + (e.q ? ' <em class="lq">' + e.q + "</em>" : "") + "</span>"; })() + '<span class="u">' + esc(uwShortStr(d.lead_underwriters) || "주관사 미확인") + (pxText(d) ? " · " + '<span class="mono">' + pxText(d) + "</span>" : "") + "</span></a>";
      }).join("") + "</div>";
    }).join("");
  }
  // 공모 달력(S5): 점은 그날 진행 중인 일정 종류, 누른 날은 상장 → 청약 → 수요예측 순으로(납입 제외)
  function monthPanel(today) {
    if (!calMonth) calMonth = today.slice(0, 7);
    if (!calDay) calDay = today;
    var DE = dayEvents(), ST = {};
    calEvents().forEach(function (e) { if (e.k !== "납입") { var o = ST[e.a] = ST[e.a] || { "수요예측": 0, "청약": 0, "상장": 0 }; o[e.k]++; } });
    var y = +calMonth.slice(0, 4), mo = +calMonth.slice(5, 7);
    var first = new Date(y, mo - 1, 1), start = isoOf(new Date(y, mo - 1, 1 - first.getDay()));
    var cells = "", t = start;
    for (var k = 0; k < 42; k++) {
      var inMon = t.slice(0, 7) === calMonth, w = dOf(t).getDay(), st = ST[t];
      if (k === 35 && !inMon) break;
      var ks = {}; (DE[t] || []).forEach(function (e) { ks[e.k] = 1; });
      var dots = ["수요예측", "청약", "상장"].filter(function (k) { return ks[k]; }).map(function (k) { return '<i class="k-' + EV_ORDER[k] + '"></i>'; }).join("");
      cells += '<button type="button" class="cd m1' + (inMon ? "" : " out") + (t === today ? " today" : "") + (t === calDay ? " sel" : "") + (w === 0 ? " sun" : w === 6 ? " sat" : "") +
        '" data-day="' + t + '" aria-label="' + esc(mdw(t)) + ((DE[t] || []).length ? " 일정 " + DE[t].length + "건" : "") + '"><span class="dn">' + dOf(t).getDate() + '</span><span class="mdots">' + dots + "</span></button>";
      t = addDays(t, 1);
    }
    var sel = DE[calDay] || [];
    return '<section class="panel calm"><header><div><h2>공모 달력</h2><p>점은 그날 진행 중인 일정 종류입니다. 날짜를 누르면 그날 일정이 아래에 나옵니다.</p></div>' +
      '<div class="cnav"><button type="button" class="xbtn" data-mon="-1" aria-label="이전 달"><svg viewBox="0 0 16 16"><path d="M10 3L5 8l5 5"/></svg></button>' +
      '<b class="mono">' + y + "." + ("0" + mo).slice(-2) + '</b><button type="button" class="xbtn" data-mon="1" aria-label="다음 달"><svg viewBox="0 0 16 16"><path d="M6 3l5 5-5 5"/></svg></button>' +
      '<button type="button" class="linkbtn" data-mon="0">오늘</button></div></header>' +
      '<div class="pbody"><div class="legend cal-lg">' + ["수요예측", "청약", "상장"].map(function (k) { return '<span><i class="k-' + EV_ORDER[k] + '"></i>' + k + "</span>"; }).join("") + '</div><div class="cgrid">' + ["일", "월", "화", "수", "목", "금", "토"].map(function (x, i) { return '<span class="cw' + (i === 0 ? " sun" : i === 6 ? " sat" : "") + '">' + x + "</span>"; }).join("") + cells + "</div>" +
      '<h3 class="cday">' + esc(mdw(calDay)) + ' <span class="dim">' + sel.length + "건</span></h3>" + '<div class="cdl">' + dayList(sel, calDay) + "</div></div></section>";
  }
  // 딜별 일정표(S1): 회사마다 수요예측·청약·상장 날짜를 나란히, 진행 중인 단계는 강조색
  function dealTable(today) {
    var rows = data.deals.filter(function (d) { return d.status !== "withdrawn" && d.is_ipo_candidate === 1; }).map(function (d) {
      var c = calDates(d), nxt = [c.ds, c.de, c.ss, c.se, c.pay, c.lst].filter(function (v) { return v && v >= today; }).sort()[0];
      return { d: d, c: c, nxt: nxt };
    }).filter(function (r) {
      var c = r.c;
      if (!r.nxt || r.nxt > addDays(today, 70)) return false;
      if (c.ds && c.de < addDays(today, -14) && !c.ss && !c.lst) return false;   // 일정이 멈춘 신고서
      return true;
    });
    var live = function (r) { var c = r.c; return (c.ds && c.ds <= today && c.de >= today) || (c.ss && c.ss <= today && c.se >= today) || c.lst === today; };
    var now = rows.filter(live).sort(function (a, b) { return a.nxt < b.nxt ? -1 : 1; });
    var next = rows.filter(function (r) { return !live(r); }).sort(function (a, b) { return a.nxt < b.nxt ? -1 : a.nxt > b.nxt ? 1 : (name(a.d) < name(b.d) ? -1 : 1); });
    var row = function (r) {
      var d = r.d, c = r.c;
      var box = function (lab, a, b) {
        var on = a && a <= today && (b || a) >= today, done = a && (b || a) < today;
        return '<span class="dt' + (on ? " on" : done ? " done" : "") + '"><i>' + lab + '</i><b class="mono">' + esc(rngT(a, b)) + "</b></span>";
      };
      return '<a class="drow' + (focusRole(d) ? " focus" : "") + '" href="#/deal/' + encodeURIComponent(d.deal_id) + '"><span class="t1"><span class="nm">' + esc(name(d)) + "</span>" +
        boardTag(d) + (isSpac(d) ? '<span class="tag b-spac">스팩</span>' : "") + focusTag(d) + '<span class="u">' + esc(uwShortStr(d.lead_underwriters)) + "</span></span>" +
        '<span class="dts">' + box("수요예측", c.ds, c.de) + box("청약", c.ss, c.se) + box("상장" + (c.lq ? ' <em class="lq">' + c.lq + "</em>" : ""), c.lst, c.lst) + "</span>" +
        (pxText(d) ? '<span class="px mono">' + pxText(d) + "</span>" : "") + "</a>";
    };
    return '<section class="panel dtable"><header><div><h2>딜별 공모 일정</h2><p>진행 중 ' + now.length + "건 · 다가오는 일정 " + next.length + "건(70일 이내). 진행 중인 단계는 남색, 끝난 단계는 흐리게 표시합니다. 상장일은 증권발행실적보고서가 나와야 표시됩니다.</p></div></header>" +
      '<div class="pbody">' + (now.length ? '<h3 class="dsec">진행 중</h3>' + now.map(row).join("") : "") +
      (next.length ? '<h3 class="dsec">다가오는 일정</h3>' + next.map(row).join("") : "") +
      (!now.length && !next.length ? '<div class="empty">확인된 공모 일정이 없습니다.</div>' : "") + "</div></section>";
  }
  function bindCal() {
    var p = app.querySelector(".calm");
    if (!p) return;
    p.addEventListener("click", function (ev) {
      var d = ev.target.closest("[data-day]"), m = ev.target.closest("[data-mon]");
      if (!d && !m) return;
      if (d) { calDay = d.dataset.day; if (calDay.slice(0, 7) !== calMonth) calMonth = calDay.slice(0, 7); }
      else {
        var n = +m.dataset.mon;
        if (!n) { calDay = todayIso(); calMonth = calDay.slice(0, 7); }
        else { var y = +calMonth.slice(0, 4), mo = +calMonth.slice(5, 7) - 1 + n; var dt = new Date(y, mo, 1); calMonth = isoOf(dt).slice(0, 7); }
      }
      var y0 = window.scrollY, old = app.querySelector(".calm"), tmp = document.createElement("div");
      tmp.innerHTML = monthPanel(todayIso());
      old.replaceWith(tmp.firstChild);
      bindCal();
      window.scrollTo(0, y0);
    });
  }
  // ---------------------------------------------------------------- 어느 화면에서나 검색(G1): 그 자리에서 결과
  var SEARCH_ICON = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M13.5 13.5L17 17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  function gsearchBox() {
    return '<div class="srow gsr" role="search"><div class="sbox">' + SEARCH_ICON +
      '<input class="search" id="g-q" type="search" autocomplete="off" placeholder="기업명·주관사 검색 (초성 가능)" aria-label="기업명·주관사 검색" aria-controls="g-dd" aria-expanded="false">' +
      '<button type="button" class="sclear" id="g-clear" aria-label="검색어 지우기" hidden><svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>' +
      '</div><div class="gdd" id="g-dd" hidden></div></div>';
  }
  function gsearchHits(q) {
    q = q.trim().toLowerCase();
    if (!q) return [];
    var ex = [], fz = [];
    data.deals.forEach(function (d) {
      if (!candOk(d, "ipo")) return;
      if (findMatch(name(d), q) !== -1 || findMatch((d.lead_underwriters || "") + "," + uwSet(d).join(",") + "," + uwShortStr(d.lead_underwriters), q) !== -1) ex.push(d);
      else if (fuzzyMatch(name(d), q)) fz.push(d);
    });
    var f = SORTERS.date, by = function (a, b) { var x = f(a) || "", y = f(b) || ""; return x < y ? 1 : x > y ? -1 : 0; };
    ex.sort(by); fz.sort(by);
    // 정확히 맞는 것을 먼저 6건까지, 비슷한 이름은 그 뒤에 최대 3건
    var shown = ex.slice(0, 6).concat(fz.slice(0, Math.max(3, 6 - Math.min(ex.length, 6))));
    shown.total = ex.length + fz.length;
    return shown;
  }
  function gsearchWhen(d) {
    var l = lstOf(d);
    if (l.dt) return "상장 " + l.dt.slice(2).replace(/-/g, ".") + (l.q ? " " + l.q : "");
    if (d.demand_start && d.status !== "withdrawn") return "수요예측 " + demandText(d, true);
    return (d.status === "approved" ? "예심 승인 " : d.status === "withdrawn" ? "철회 · 신고 " : "신고 ") + (d.first_filing_dt || "-");
  }
  function bindGsearch() {
    var qi = document.getElementById("g-q"), dd = document.getElementById("g-dd"), qc = document.getElementById("g-clear");
    if (!qi || !dd) return;
    var draw = function () {
      var q = qi.value, hits = gsearchHits(q);
      qc.hidden = !q;
      if (!q.trim()) { dd.hidden = true; qi.setAttribute("aria-expanded", "false"); return; }
      dd.innerHTML = (hits.length ? '<div class="gdh">기업 ' + hits.total + "</div>" + hits.map(function (d) {
        return '<a class="gri" href="#/deal/' + encodeURIComponent(d.deal_id) + '"><span class="nm">' + hlName(name(d), q.trim()) + "</span>" + boardTag(d) +
          (isSpac(d) ? '<span class="tag b-spac">스팩</span>' : "") + focusTag(d) + '<span class="gst">' + esc(statusLabel(d)) + "</span>" +
          '<span class="u">' + esc(gsearchWhen(d)) + " · " + esc(uwShortStr(d.lead_underwriters) || "주관사 미확인") + "</span></a>";
      }).join("") : '<div class="gdh">"' + esc(q.trim()) + '"에 맞는 공모가 없습니다.</div>') +
        (hits.length > 0 ? '<button type="button" class="gall" id="g-all">목록에서 전체 결과 보기' + (hits.total > hits.length ? " (" + hits.total + "건)" : "") + " ›</button>" : "");
      dd.hidden = false; qi.setAttribute("aria-expanded", "true");
      var all = document.getElementById("g-all");
      if (all) all.addEventListener("click", function () { state.q = q; persist(); goPath("/"); });
    };
    qi.addEventListener("input", draw);
    qi.addEventListener("focus", function () { if (qi.value.trim()) draw(); });
    qi.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { dd.hidden = true; qi.blur(); }
      if (e.key === "Enter") { var a = dd.querySelector(".gri"); if (a) { e.preventDefault(); goPath(a.getAttribute("href").slice(1)); } }
    });
    qc.addEventListener("click", function () { qi.value = ""; draw(); qi.focus(); });
  }
  // 검색 결과 밖을 누르면 닫습니다(화면마다 다시 그려지므로 리스너는 한 번만 둡니다).
  document.addEventListener("pointerdown", function (e) {
    var dd = document.getElementById("g-dd"), qi = document.getElementById("g-q");
    if (dd && !dd.hidden && !(e.target.closest && e.target.closest(".gsr"))) { dd.hidden = true; if (qi) qi.setAttribute("aria-expanded", "false"); }
  }, true);
  function renderCal() {
    document.title = "일정 · IPO 데이터룸";
    view = "cal";
    var today = todayIso(), dow = dOf(today).getDay();
    var wk0 = addDays(today, -((dow + 6) % 7));          // 이번 주 월요일
    var horizon = addDays(wk0, 7 * 9 - 1);
    var RV = data.reviews || [];
    var byId = {}; data.deals.forEach(function (d) { byId[d.deal_id] = d; });

    // 3) 예심 현황
    var decided = RV.filter(function (r) { return rvKind(r) !== "pending" && rvKind(r) !== "other" && r.f && r.d; });
    var y1 = addDays(today, -365);
    var appr1 = decided.filter(function (r) { return r.d >= y1 && rvIpo(r) && rvKind(r) === "approved"; });
    var dec1 = decided.filter(function (r) { return r.d >= y1 && rvIpo(r); });
    var durs1 = appr1.map(function (r) { return daysBetween(r.f, r.d); });
    var medDur = medInt(durs1);
    var pendAll = RV.filter(function (r) { return rvKind(r) === "pending"; });
    var pend = pendAll.filter(function (r) { return daysBetween(r.f, today) <= 365; }).sort(function (a, b) { return a.f < b.f ? -1 : 1; });
    var stale = pendAll.length - pend.length;
    var pendRows = pend.map(function (r) {
      var el = daysBetween(r.f, today), over = medDur && el > medDur;
      return "<tr" + ((r.s || "").indexOf(FOCUS_NAME) >= 0 ? ' class="focus"' : "") + "><td>" + nmLink(r.id, r.n) + (/스팩/.test(r.t || "") ? ' <span class="dim">(' + esc(r.t) + ")</span>" : "") + '</td><td class="c-m">' + esc(r.m || "-") + "</td><td>" + spText(r.s) +
        '</td><td class="num mono">' + esc(r.f.slice(2).replace(/-/g, ".")) + '</td><td class="num mono' + (over ? " warn" : "") + '">' + el + "일</td></tr>";
    }).join("");
    var pendPanel = '<section class="panel"><header><div><h2>심사 중 <span class="cnt">' + pend.length + "</span></h2><p>청구서 접수 후 결과가 나오지 않은 건. 경과일이 최근 1년 승인 건의 심사기간 중앙값(" + (medDur != null ? medDur + "일" : "-") + ")을 넘으면 붉게 표시합니다." + (stale ? " 청구 후 1년이 넘도록 결과가 수록되지 않은 " + stale + "건은 제외했습니다." : "") + "</p></div></header>" +
      '<div class="pbody"><div class="scroll"><table class="mini rv"><thead><tr><th>회사</th><th class="c-m">시장</th><th>주관사</th><th class="num">청구일</th><th class="num">경과</th></tr></thead><tbody>' + pendRows + "</tbody></table></div></div></section>";

    // 승인 후 아직 상장하지 않은 건: 효력 6개월
    var waiting = RV.filter(function (r) { return r.r === "심사 승인" && r.d && !/스팩|재상장/.test(r.t || ""); }).map(function (r) {
      var exp = addMonths(r.d, 6), d = r.id ? byId[r.id] : null;
      return { r: r, exp: exp, left: daysBetween(today, exp), d: d };
    }).filter(function (x) { return x.left >= -30; }).sort(function (a, b) { return a.exp < b.exp ? -1 : 1; });
    // T4: 진행 상태는 색 점 + 짧은 글자, 효력 만료 45일 이내는 승인일을 붉게(남은 기간 열 없음)
    var DOT = { filed: ["신고", "filed"], price_fixed: ["확정", "fixed"], completed: ["상장", "done"], upcoming: ["예정", "done"], withdrawn: ["철회", "off"] };
    var waitRows = waiting.map(function (x) {
      var r = x.r, d = x.d, k = d && d.status !== "approved" ? stKey(d) : null, o = k ? (DOT[k] || DOT.filed) : x.left < 0 ? ["만료", "off"] : ["대기", "off"];
      var tip = (k ? statusLabel(d) : "신고서 제출 전") + " · 효력 만료 " + x.exp + (x.left >= 0 ? " (" + x.left + "일 남음)" : " (만료)");
      return "<tr" + ((r.s || "").indexOf(FOCUS_NAME) >= 0 ? ' class="focus"' : "") + "><td>" + nmLink(r.id, r.n) + "</td><td>" + spText(r.s) + '</td><td class="num mono' + (x.left <= 45 ? " warn" : "") + '" title="' + esc(tip) + '">' + esc(r.d.slice(2).replace(/-/g, ".")) +
        '</td><td><span class="sdot s-' + o[1] + '" title="' + esc(tip) + '"><i></i>' + o[0] + "</span></td></tr>";
    }).join("");
    var waitPanel = '<section class="panel"><header><div><h2>승인 후 상장 대기 <span class="cnt">' + waiting.length + "</span></h2><p>예심 승인 효력은 결과 통지일부터 6개월입니다(승인일 + 6개월로 계산). 효력 만료가 45일 이내로 남은 건은 승인일을 붉게 표시합니다.</p></div></header>" +
      '<div class="pbody"><div class="scroll"><table class="mini rv wait"><colgroup><col class="w-n"><col class="w-u"><col class="w-d"><col class="w-s"></colgroup><thead><tr><th>회사</th><th>주관사</th><th class="num">승인일</th><th>진행</th></tr></thead><tbody>' + waitRows + "</tbody></table></div></div></section>";

    // 주관사별 예심 실적 (KIND 수록 기간 전체, 신규상장·스팩 제외)
    var sp = {};
    decided.filter(rvIpo).forEach(function (r) {
      (r.s || "미확인").split(/\s*,\s*/).forEach(function (s) {
        var o = sp[s] = sp[s] || { s: s, n: 0, ok: 0, rej: 0, wd: 0, durs: [] };
        o.n++;
        var k = rvKind(r);
        if (k === "approved") { o.ok++; o.durs.push(daysBetween(r.f, r.d)); } else if (k === "rejected") o.rej++; else o.wd++;
      });
    });
    var spRows = Object.keys(sp).map(function (k) { return sp[k]; }).sort(function (a, b) { return b.n - a.n || b.ok - a.ok; });
    var allOk = decided.filter(function (r) { return rvIpo(r) && rvKind(r) === "approved"; }).length, allN = decided.filter(rvIpo).length;
    var minF = RV.reduce(function (m, r) { return r.d && (!m || r.d < m) ? r.d : m; }, null);
    var spHtml = spRows.map(function (o) {
      var foc = o.s.indexOf(FOCUS_NAME) >= 0;
      return "<tr" + (foc ? ' class="focus"' : "") + "><td>" + esc(o.s) + '</td><td class="num">' + o.n + '</td><td class="num">' + o.ok + '</td><td class="num">' + (o.wd || '<span class="dim">0</span>') + '</td><td class="num">' + (o.rej || '<span class="dim">0</span>') +
        '</td><td class="num"><b>' + Math.round(o.ok / o.n * 100) + '%</b></td><td class="num">' + (o.durs.length ? medInt(o.durs) + "일" : "-") + "</td></tr>";
    }).join("");
    var spPanel = '<section class="panel"><header><div><h2>주관사별 예심 실적</h2><p>KIND 수록 결과(' + (minF ? esc(minF.slice(0, 7).replace("-", ".")) : "-") + " 이후) 중 신규상장 청구, 스팩 제외. 공동 주관은 각각 1건. 승인률 = 승인 ÷ (승인 + 철회 + 미승인). 전체 " + allN + "건 중 승인 " + allOk + "건(" + (allN ? Math.round(allOk / allN * 100) : 0) + "%).</p></div></header>" +
      '<div class="pbody"><div class="scroll"><table class="mini rv"><thead><tr><th>주관사</th><th class="num">결과</th><th class="num">승인</th><th class="num">철회</th><th class="num">미승인</th><th class="num">승인률</th><th class="num">심사기간</th></tr></thead><tbody>' + spHtml + "</tbody></table></div>" +
      '<p class="snote">심사기간은 승인 건의 청구일~결과일 중앙값입니다. 출처: 한국거래소 KIND 상장예비심사 현황.</p></div></section>';

    // 분기별 심사기간·승인률
    var qs = {};
    decided.filter(rvIpo).forEach(function (r) {
      var q = r.d.slice(0, 4) + " Q" + (Math.floor((+r.d.slice(5, 7) - 1) / 3) + 1);
      var o = qs[q] = qs[q] || { q: q, n: 0, ok: 0, durs: [] };
      o.n++; if (rvKind(r) === "approved") { o.ok++; o.durs.push(daysBetween(r.f, r.d)); }
    });
    var qList = Object.keys(qs).sort().map(function (k) { return qs[k]; });
    var qMax = Math.max.apply(null, qList.map(function (o) { return medInt(o.durs) || 0; }).concat([1]));
    var qHtml = qList.map(function (o) {
      var m = medInt(o.durs);
      return "<tr><td>" + esc(o.q) + '</td><td class="num">' + o.n + '</td><td class="num">' + Math.round(o.ok / o.n * 100) + '%</td><td class="num">' + (m != null ? m + "일" : "-") +
        '</td><td class="bar-cell"><div class="hbar" style="width:' + (m ? Math.round(m / qMax * 100) : 0) + '%"></div></td></tr>';
    }).join("");
    var qPanel = '<section class="panel"><header><div><h2>분기별 심사기간</h2><p>결과 통지일이 속한 분기 기준. 신규상장 청구, 스팩 제외.</p></div></header>' +
      '<div class="pbody"><div class="scroll"><table class="mini rv q"><thead><tr><th>분기</th><th class="num">결과</th><th class="num">승인률</th><th class="num">심사기간</th><th class="bar-cell"><span class="sr">막대</span></th></tr></thead><tbody>' + qHtml + "</tbody></table></div></div></section>";

    app.innerHTML = '<div class="content cal-page">' + gsearchBox() + monthPanel(today) + dealTable(today) +
      '<div class="panels even">' + pendPanel + waitPanel + "</div>" +
      '<div class="panels even">' + spPanel + qPanel + "</div></div>";
    bindCal();
    bindGsearch();
  }
  function renderBio() {
    document.title = "기술특례 바이오 · IPO 데이터룸";
    view = "bio";
    if (!bio) {
      app.innerHTML = '<div class="content"><div class="ledger"><div class="empty">기술특례 바이오 자료를 불러오지 못했습니다. 네트워크 연결을 확인한 뒤 새로 고침해 주십시오.</div></div></div>';
      return;
    }
    var A = bio.attempts, CO = bio.companies, years = bioYears();
    var W = Math.max(300, Math.min(app.clientWidth - 40, 1220)), H = W < 500 ? 240 : 270;
    var halfW = window.innerWidth > 1060 ? Math.round((Math.min(app.clientWidth, 1232) - 16) / 2) - 38 : W;
    var recent = A.filter(function (a) { return a.y >= 2024 && a.group; });
    var past = A.filter(function (a) { return a.y >= 2014 && a.y <= 2021 && a.group; });
    var rate = function (xs) { var ok = xs.filter(function (a) { return a.outcome === "승인"; }).length; return xs.length ? Math.round(ok / xs.length * 100) : null; };
    var loR = recent.filter(function (a) { return a.lo; }), nl2 = recent.filter(function (a) { return a.group === "L/O 없음 · 2상 이상"; }), nl2p = past.filter(function (a) { return a.group === "L/O 없음 · 2상 이상"; });
    var okA = A.filter(function (a) { return a.outcome === "승인"; });
    var kpi = '<section class="summary s5" aria-label="요약">' +
      kpiTile(int(CO.length), "개사", "기술특례 신약개발사 (2005~)") +
      kpiTile(int(CO.filter(function (c) { return c.nlo; }).length), "개사", "상장 시점 L/O 보유 (플랫폼·옵션 포함)") +
      kpiTile(Math.round(okA.length / A.length * 100), "%", "예비심사 통과율 (" + okA.length + "/" + A.length + "건)") +
      kpiTile(rate(loR) != null ? rate(loR) : "-", "%", "2024년 이후 L/O 보유 통과율 (" + loR.length + "건)", true) +
      kpiTile(rate(nl2) != null ? rate(nl2) : "-", "%", "2024년 이후 L/O 없이 2상 이상 (" + nl2.length + "건, 2014~21년 " + (rate(nl2p) != null ? rate(nl2p) + "%" : "-") + ")") + "</section>";

    // 1) 연도별 예비심사 결과
    var resItems = A.map(function (a) { return { y: a.y, k: a.outcome, x: a }; });
    var svgRes = bioStack({ years: years, W: W, H: H, series: BIO_RES, items: resItems, unit: "청구", aria: "연도별 상장예비심사 결과",
      extra: function (m, n) { return n ? " · 통과율 " + Math.round(m["승인"].length / n * 100) + "%" : ""; },
      label: function (m, n) { return Math.round(m["승인"].length / n * 100) + "%"; } });
    // 2) L/O × 단계: 승인 / 탈락
    var gItems = function (ok) { return A.filter(function (a) { return (a.outcome === "승인") === ok; }).map(function (a) { return { y: a.y, k: bioGroup(a), x: a }; }); };
    var gi1 = gItems(true), gi2 = gItems(false);
    var perY = {}; A.forEach(function (a) { var k = a.y + (a.outcome === "승인" ? "o" : "f"); perY[k] = (perY[k] || 0) + 1; });
    var gmax = niceCountMax(Math.max.apply(null, Object.keys(perY).map(function (k) { return perY[k]; }).concat([1])));
    var stageFmt = function (a) { return a.name + (a.stage && a.stage !== "확인 못함" ? "(" + a.stage.replace("임상 ", "").replace("·허가심사", "") + ")" : ""); };
    var svgG1 = bioStack({ years: years, W: halfW, H: H - 10, series: BIO_GRP, items: gi1, unit: "승인", max: gmax, aria: "승인 건의 L/O·선두 단계 구성", fmt: stageFmt });
    var svgG2 = bioStack({ years: years, W: halfW, H: H - 10, series: BIO_GRP, items: gi2, unit: "철회·미승인", max: gmax, aria: "철회·미승인 건의 L/O·선두 단계 구성", fmt: stageFmt });
    // 조건별 통과율 표
    var condRows = BIO_ERAS.map(function (e) {
      var xs = A.filter(function (a) { return a.y >= e[1] && a.y <= e[2]; });
      return [esc(e[0])].concat([bioPassText(xs)]).concat(BIO_GRP.slice(0, 4).map(function (g) { return bioPassText(xs.filter(function (a) { return a.group === g.key; })); }));
    });
    var condTbl = '<div class="scroll"><table class="mini bio-cond"><thead><tr><th>청구 연도</th><th class="num">전체</th>' +
      BIO_GRP.slice(0, 4).map(function (g) { var k = g.key.split(" · "); return '<th class="num"><i class="sw" style="background:' + g.css + '"></i>' + esc(k[0]) + "<br>" + esc(k[1].replace(" 이상", "↑").replace(" 미만", "↓")) + "</th>"; }).join("") +
      "</tr></thead><tbody>" + condRows.map(function (r) { return "<tr>" + r.map(function (c, i) { return "<td" + (i ? ' class="num"' : "") + ">" + c + "</td>"; }).join("") + "</tr>"; }).join("") + "</tbody></table></div>" +
      '<p class="snote">위는 통과율, 아래는 승인 건/청구 건입니다.</p>';
    // 3) 심사 소요일 (연도별 중앙값)
    var W4 = halfW, H4 = H - 10, L = 44, R = 10, T = 22, B = 30, ih4 = H4 - T - B, band4 = (W4 - L - R) / years.length;
    var dser = [{ key: "승인", css: "var(--bar)", f: function (a) { return a.outcome === "승인"; } }, { key: "철회·미승인", css: "var(--mk-tech)", f: function (a) { return a.outcome !== "승인"; } }];
    var dm = dser.map(function (s) {
      return years.map(function (y) {
        var xs = A.filter(function (a) { return a.y === y && s.f(a) && a.days > 0; }).sort(function (a, b) { return a.days - b.days; });
        return { med: median(xs.map(function (a) { return a.days; })), xs: xs };
      });
    });
    var dmax = niceMax(Math.max.apply(null, dm[0].concat(dm[1]).map(function (c) { return c.med || 0; }).concat([60])));
    var px = function (i) { return L + band4 * i + band4 / 2; }, py = function (v) { return T + ih4 - (v / dmax) * ih4; };
    var svgD = '<svg data-w="' + W4 + '" viewBox="0 0 ' + W4 + " " + H4 + '" role="img" aria-label="연도별 청구부터 결과까지 일수 중앙값">' +
      frame(W4, H4, L, R, T, B, dmax, years.map(String), function (v) { return int(Math.round(v)) + "일"; });
    dser.forEach(function (s, si) {
      var d = "", pen = false;
      dm[si].forEach(function (c, i) { if (c.med == null) { pen = false; return; } d += (pen ? "L" : "M") + px(i).toFixed(1) + "," + py(c.med).toFixed(1); pen = true; });
      svgD += '<path class="ln" style="stroke:' + s.css + '" d="' + d + '"/>';
    });
    years.forEach(function (y, i) {
      var tipH = "<b>" + y + "년 청구 · 결과까지 일수</b>" + dser.map(function (s, si) {
        var c = dm[si][i];
        return c.med == null ? "" : tipRow(s.css, s.key + " 중앙값", int(Math.round(c.med)) + "일 (" + c.xs.length + "건)") + nameList(c.xs, function (a) { return a.name + " " + a.days + "일"; });
      }).join("");
      if (!dm[0][i].xs.length && !dm[1][i].xs.length) tipH += "<div>청구 건 없음</div>";
      svgD += colHit(L + band4 * i, T, band4, ih4, tipH, y + "년") + '<line class="xh" x1="' + px(i) + '" x2="' + px(i) + '" y1="' + T + '" y2="' + (T + ih4) + '"/>' +
        dser.map(function (s, si) { var c = dm[si][i]; return c.med == null ? "" : '<circle class="dot" style="fill:' + s.css + '" cx="' + px(i) + '" cy="' + py(c.med) + '" r="3.5"/>'; }).join("") + "</g>";
    });
    svgD += "</svg>";
    // 4) 승인사 계약 구성 (청구 연도 기준)
    var pItems = CO.map(function (c) { return { y: +(c.req || c.list_date).slice(0, 4), k: bioProfKey(c), x: { name: c.n } }; });
    var svgP = bioStack({ years: years, W: halfW, H: H - 10, series: BIO_PROF, items: pItems, unit: "청구·승인", aria: "승인 회사의 계약 구성" });

    // 5) 명단
    var q = bioState.q.trim();
    var list = bioList();
    var coTxt = function (c) { return c.nco + '<span class="lo-n' + (c.nlo ? "" : " z") + '">(' + c.nlo + ")</span>"; };
    var rowsH = list.map(function (c) {
      return '<tr class="go" tabindex="0" data-bio="' + esc(c.n) + '"><td class="c-date">' + esc(c.list_date) + '</td><td><span class="nm">' + hlName(c.n, q) + "</span>" +
        (c.cat === "B" ? '<span class="tag b-etc" title="경계 분류: 개량신약·약물전달·세포치료 중심 개발사">경계</span>' : "") + (c.glo ? '<span class="tag b-tech" title="해외 상대방 L/O 포함">해외 L/O</span>' : "") + "</td>" +
        '<td class="hide-m">' + esc(c.desc || "") + '</td><td>' + esc(c.top || "-") + '</td><td class="num">' + coTxt(c) + '</td><td class="num hide-m">' + c.np + "</td></tr>";
    }).join("");
    var cardsH = list.map(function (c) {
      return '<a class="bcard" href="#/bio/' + encodeURIComponent(c.n) + '">' +
        '<div class="b1"><span class="nm">' + hlName(c.n, q) + "</span>" + (c.cat === "B" ? '<span class="tag b-etc">경계</span>' : "") +
        (c.glo ? '<span class="tag b-tech">해외 L/O</span>' : "") + '<span class="stg">' + esc(c.top || "-") + "</span></div>" +
        '<div class="b2"><span class="mono">' + esc(c.list_date) + "</span>" + (c.desc ? " · " + esc(c.desc) : "") + "</div>" +
        '<div class="b3"><span>계약(L/O)<b>' + coTxt(c) + "</b></span><span>파이프라인<b>" + c.np + "</b></span></div></a>";
    }).join("");
    var listPanel = '<section class="panel bio-list"><header><div><h2>기술특례 신약개발사 명단 <span class="cnt">' + list.length + (list.length !== bio.companies.length ? " / " + bio.companies.length : "") + "</span></h2>" +
      "<p>행을 누르면 상장 당시 증권신고서 정리(기술이전·파이프라인·추정 손익)가 열립니다. 계약은 기술이전(L/O, 플랫폼·옵션 포함)과 공동연구·공동개발이고, 괄호 안이 그중 L/O입니다. 선두 단계는 신고서 문구를 규칙으로 분류한 근사치입니다.</p></div></header>" +
      '<div class="pbody">' + bioSearchRow("c") + bioChips("c") +
      '<div class="scroll bio-box"><table class="mini bio-t"><thead><tr><th>상장일</th><th>회사</th><th class="hide-m">사업</th><th>선두 단계</th><th class="num" title="기술이전(L/O)과 공동연구·공동개발 계약 수, 괄호는 L/O 수">계약(L/O)</th><th class="num hide-m">파이프라인</th></tr></thead><tbody id="bio-rows">' +
      (rowsH || '<tr><td colspan="6" class="muted">조건에 맞는 회사가 없습니다.</td></tr>') + "</tbody></table></div>" +
      '<div class="bcards">' + (cardsH || '<div class="empty">조건에 맞는 회사가 없습니다.</div>') + "</div></div></section>";
    // 6) 철회·미승인 명단
    var fails = bioFails();
    var nFailAll = A.filter(function (a) { return a.outcome !== "승인"; }).length;
    var failPanel = '<section class="panel bio-failp"><header><div><h2>철회·미승인 명단 <span class="cnt">' + fails.length + (fails.length !== nFailAll ? " / " + nFailAll : "") + "</span></h2><p>사유는 거래소 공식 사유가 아니라 보도·회사 설명입니다. 2017년 이전 건은 기사가 적어 확인 못한 항목이 많습니다.</p></div>" +
      bioFilterBtn("f") + "</header>" +
      '<div class="pbody bio-boxw">' + bioChips("f") + (fails.length ? table(["청구일", "회사", "결과", "선두 단계", "L/O", "소요일", "보도된 사유"], fails.map(function (a) {
        var inList = bioByName[a.name];
        return [esc(a.req), inList ? '<a href="#/bio/' + encodeURIComponent(a.name) + '">' + esc(a.name) + "</a>" : esc(a.name), esc(a.outcome), esc(a.stage),
          a.lo == null ? '<span class="dim">확인 못함</span>' : a.lo ? "있음" : "없음", a.days ? int(a.days) + "일" : "-", esc(a.reason || "-")];
      }), [5], "bio-fail") : '<p class="muted">조건에 맞는 건이 없습니다.</p>') + '<div class="bcards fails">' + fails.map(function (a) {
        var inList = bioByName[a.name];
        var head = '<div class="b1"><span class="nm">' + esc(a.name) + '</span><span class="tag ' + (a.outcome === "미승인" ? "b-rej" : "b-etc") + '">' + esc(a.outcome) + '</span><span class="stg mono">' + esc(a.req) + "</span></div>" +
          '<div class="b3"><span>선두 단계<b class="t">' + esc(a.stage) + '</b></span><span>L/O<b class="t">' + (a.lo == null ? "확인 못함" : a.lo ? "있음" : "없음") + "</b></span>" + (a.days ? "<span>소요<b>" + int(a.days) + "일</b></span>" : "") + "</div>" +
          (a.reason ? '<div class="b4">' + esc(a.reason) + "</div>" : "");
        return inList ? '<a class="bcard" href="#/bio/' + encodeURIComponent(a.name) + '">' + head + "</a>" : '<div class="bcard">' + head + "</div>";
      }).join("") + "</div></div></section>";

    app.innerHTML = '<div class="content">' + gsearchBox() +
      '<p class="notice">상장예비심사를 청구한 코스닥 신약개발사(2005~2026년, 경계 바이오 포함)의 결과와 청구 당시 프로필입니다. 신고서 제출 당시 신약개발사로 보기 어려운 소재·의료기기·진단·분석 플랫폼·바이오시밀러·CDMO 주업 회사는 뺐습니다. 승인 건은 상장 당시 증권신고서, 철회·미승인 건은 언론·공시로 조사했습니다. 기술성평가에서 이미 떨어져 청구하지 못한 회사는 포함되지 않습니다.</p>' + kpi +
      '<section class="panel"><header><div><h2>연도별 상장예비심사 결과</h2><p>청구 연도 기준. 막대 위 숫자는 통과율이고, 막대에 마우스를 올리면 회사 이름이 나옵니다. 심사를 통과한 뒤 공모를 접은 건은 뺐습니다.</p></div></header>' +
      '<div class="pbody chart">' + bioLegend(BIO_RES, resItems) + svgRes + "</div></section>" +
      '<section class="panel"><header><div><h2>청구 시점 L/O 유무와 선두 임상 단계</h2><p>L/O에는 플랫폼·옵션 계약을 포함합니다. "2상 이상"은 선두 자산이 임상 2상 이상이거나 상용화 단계입니다. 칸당 표본이 작아 방향만 참고하십시오.</p></div></header>' +
      '<div class="pbody">' + bioLegend(BIO_GRP) + '<div class="panels even bio-pair"><div class="chart"><div class="lk-sub">승인 건</div>' + svgG1 + '</div><div class="chart"><div class="lk-sub">철회·미승인 건</div>' + svgG2 + "</div></div>" +
      '<div class="lk-sub">조건별 통과율 (승인/청구)</div>' + condTbl + "</div></section>" +
      '<div class="panels even">' +
      '<section class="panel"><header><div><h2>청구부터 결과까지 걸린 기간</h2><p>연도별 중앙값. 2022년 이후 승인까지 걸리는 기간이 크게 늘었습니다.</p></div></header><div class="pbody chart">' +
      '<div class="legend">' + dser.map(function (s) { return '<span><i class="ln-key" style="background:' + s.css + '"></i>' + s.key + "</span>"; }).join("") + "</div>" + svgD + "</div></section>" +
      '<section class="panel"><header><div><h2>승인 회사의 상장 당시 계약 구성</h2><p>청구 연도별 승인 회사 수를 신고서상 계약 구성으로 나눴습니다.</p></div></header><div class="pbody chart">' + bioLegend(BIO_PROF, pItems) + svgP + "</div></section></div>" +
      listPanel + failPanel +
      '<p class="note">' + esc(bio.note) + " 출처: " + esc(bio.sources) + ". 생성 " + esc(bio.generated) + ".</p></div>";
    bindChart();
    bindBio(); bindGsearch();
  }
  // ---- 바이오 명단·철회 명단 필터 (딜 목록과 같은 필터 버튼·패널)
  var BIO_STAGES = ["탐색·연구", "전임상", "임상 1상", "임상 2상", "임상 3상·허가심사", "상용화", "기재 불명확"];
  function bioEraOf(y) { for (var i = 0; i < BIO_ERAS.length; i++) if (y >= BIO_ERAS[i][1] && y <= BIO_ERAS[i][2]) return BIO_ERAS[i][0]; return ""; }
  function bioLoKey(c) { return c.nlo ? (c.glo ? "해외 L/O" : "국내 L/O만") : "L/O 없음"; }
  function bioFailStage(a) { return /확인/.test(a.stage || "") ? "확인 못함" : a.stage === "임상 3상" ? "임상 3상·허가심사" : a.stage; }
  // 각 필터: 키, 제목, 선택지 [값, 표시], 한 행이 어떤 값인지
  var BIO_FDEF = {
    c: [
      { k: "sort", t: "정렬", single: true, opts: [["-1", "상장일 최근순"], ["1", "상장일 오래된순"]] },
      { k: "cat", t: "분류", opts: [["A", "신약개발"], ["B", "경계(개량신약·약물전달·세포치료)"]], of: function (c) { return c.cat; } },
      { k: "era", t: "상장 연도", opts: BIO_ERAS.map(function (e) { return [e[0], e[0]]; }), of: function (c) { return bioEraOf(+c.list_date.slice(0, 4)); } },
      { k: "top", t: "선두 단계", opts: BIO_STAGES.map(function (s) { return [s, s]; }), of: function (c) { return c.top; } },
      { k: "lo", t: "기술이전(L/O)", opts: [["해외 L/O", "해외 상대방 L/O"], ["국내 L/O만", "국내 L/O만"], ["L/O 없음", "L/O 없음"]], of: bioLoKey },
      { k: "route", t: "상장 경로", opts: null, of: function (c) { return c.route || "기타"; } },
      { k: "prior", t: "예심 이력", opts: [["재도전", "예심 탈락 후 재도전 상장"], ["첫 시도", "첫 청구에 상장"]], of: function (c) { return c.prior_fail ? "재도전" : "첫 시도"; } },
      { k: "proj", t: "추정 손익표", opts: [["있음", "있음"], ["없음", "없음"]], of: function (c) { return c.proj_yes ? "있음" : "없음"; } }
    ],
    f: [
      { k: "sort", t: "정렬", single: true, opts: [["-1", "청구일 최근순"], ["1", "청구일 오래된순"]] },
      { k: "res", t: "결과", opts: [["철회", "철회"], ["미승인", "미승인"]], of: function (a) { return a.outcome; } },
      { k: "era", t: "청구 연도", opts: BIO_ERAS.map(function (e) { return [e[0], e[0]]; }), of: function (a) { return bioEraOf(a.y); } },
      { k: "stage", t: "선두 단계", opts: ["전임상", "임상 1상", "임상 2상", "임상 3상·허가심사", "상용화", "탐색·연구", "확인 못함"].map(function (s) { return [s, s]; }), of: bioFailStage },
      { k: "lo", t: "청구 시점 L/O", opts: [["있음", "있음"], ["없음", "없음"], ["확인 못함", "확인 못함"]], of: function (a) { return a.lo == null ? "확인 못함" : a.lo ? "있음" : "없음"; } },
      { k: "later", t: "이후 상장", opts: [["상장", "이후 상장함"], ["미상장", "아직 미상장"]], of: function (a) { return bioByName[a.name] ? "상장" : "미상장"; } }
    ]
  };
  var bioF = { c: { sort: "-1" }, f: { sort: "-1" } };
  function bioFdefs(sc) {
    return BIO_FDEF[sc].map(function (d) {
      if (d.opts) return d;
      var seen = {};
      bio.companies.forEach(function (c) { seen[d.of(c)] = (seen[d.of(c)] || 0) + 1; });
      return Object.assign({}, d, { opts: Object.keys(seen).sort(function (a, b) { return seen[b] - seen[a]; }).map(function (v) { return [v, v]; }) });
    });
  }
  function bioSel(sc, k) { var v = bioF[sc][k]; return Array.isArray(v) ? v : []; }
  function bioPass(sc, x, skip) {
    return BIO_FDEF[sc].every(function (d) {
      if (d.single || d.k === skip) return true;
      var s = bioSel(sc, d.k);
      return !s.length || s.indexOf(d.of(x)) >= 0;
    });
  }
  function bioActive(sc) {
    var out = [];
    bioFdefs(sc).forEach(function (d) {
      if (d.single) { if (bioF[sc][d.k] !== "-1") out.push({ k: d.k, v: null, t: d.opts.filter(function (o) { return o[0] === bioF[sc][d.k]; })[0][1] }); return; }
      bioSel(sc, d.k).forEach(function (v) { var o = d.opts.filter(function (x) { return x[0] === v; })[0]; out.push({ k: d.k, v: v, t: (o ? o[1] : v) }); });
    });
    return out;
  }
  var FILTER_SVG = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5h14M6 10h8M8.5 15h3" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>';
  function bioFilterBtn(sc) {
    var n = bioActive(sc).length;
    return '<button type="button" class="fbtn bfbtn' + (n ? " on" : "") + '" data-bf="' + sc + '" aria-haspopup="dialog" aria-expanded="false" aria-label="필터' + (n ? " " + n + "개 적용" : "") + '">' + FILTER_SVG +
      (n ? '<span class="fb-n">' + n + "</span>" : "") + "</button>";
  }
  function bioSearchRow(sc) {
    return '<div class="srow bio-srow"><div class="sbox"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M13.5 13.5L17 17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>' +
      '<input class="search" id="bio-q" type="search" autocomplete="off" placeholder="회사·사업 검색 (초성 가능)" value="' + esc(bioState.q) + '" aria-label="회사 검색">' + bioFilterBtn(sc) + "</div></div>";
  }
  function bioChips(sc) {
    var act = bioActive(sc);
    if (!act.length) return "";
    return '<div class="afilters" aria-label="적용된 필터">' + act.map(function (f) {
      return '<button type="button" class="af" data-bsc="' + sc + '" data-bk="' + f.k + '" data-bv="' + esc(f.v == null ? "" : f.v) + '" aria-label="' + esc(f.t) + ' 필터 해제">' + esc(f.t) +
        '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></button>';
    }).join("") + '<button type="button" class="linkbtn" data-breset="' + sc + '">모두 지우기</button></div>';
  }
  function bioList() {
    var q = bioState.q.trim(), dir = +bioF.c.sort;
    return bio.companies.filter(function (c) {
      if (!bioPass("c", c)) return false;
      if (q && findMatch(c.n, q) === -1 && findMatch((c.kind_name || "") + " " + (c.desc || ""), q) === -1 && !fuzzyMatch(c.n, q)) return false;
      return true;
    }).sort(function (a, b) { return (a.list_date < b.list_date ? -1 : a.list_date > b.list_date ? 1 : a.n < b.n ? -1 : 1) * dir; });
  }
  function bioFails() {
    var dir = +bioF.f.sort;
    return bio.attempts.filter(function (a) { return a.outcome !== "승인" && bioPass("f", a); })
      .sort(function (a, b) { return (a.req < b.req ? -1 : a.req > b.req ? 1 : 0) * dir; });
  }
  var bfOpen = null;
  function bfBody(sc) {
    var rows = sc === "c" ? bio.companies : bio.attempts.filter(function (a) { return a.outcome !== "승인"; });
    var h = bioFdefs(sc).map(function (d) {
      var cnt = {};
      if (!d.single) rows.forEach(function (x) { if (bioPass(sc, x, d.k)) { var v = d.of(x); cnt[v] = (cnt[v] || 0) + 1; } });
      var opts = d.opts.filter(function (o) { return d.single || cnt[o[0]] || bioSel(sc, d.k).indexOf(o[0]) >= 0; });
      return '<div class="fp-sec"><div class="fp-h">' + esc(d.t) + (d.single ? "" : "<small>여러 개 선택</small>") + '</div><div class="fp-opts">' + opts.map(function (o) {
        var on = d.single ? bioF[sc][d.k] === o[0] : bioSel(sc, d.k).indexOf(o[0]) >= 0;
        return '<button type="button" class="fo" data-k="' + d.k + '" data-v="' + esc(o[0]) + '" aria-pressed="' + on + '">' + esc(o[1]) + (d.single ? "" : '<span class="n">' + (cnt[o[0]] || 0) + "</span>") + "</button>";
      }).join("") + "</div></div>";
    }).join("");
    var n = sc === "c" ? bioList().length : bioFails().length;
    return h + '<div class="fp-foot"><span class="sp"></span><button type="button" class="linkbtn" id="bf-reset">초기화</button>' +
      '<button type="button" class="fp-done" id="bf-done">' + n + (sc === "c" ? "곳" : "건") + " 보기</button></div>";
  }
  function bfBind() {
    var o = bfOpen; if (!o) return;
    o.body.querySelectorAll(".fo").forEach(function (b) {
      b.addEventListener("click", function () {
        var d = BIO_FDEF[o.sc].filter(function (x) { return x.k === b.dataset.k; })[0];
        if (d.single) bioF[o.sc][d.k] = b.dataset.v;
        else {
          var s = bioSel(o.sc, d.k).slice(), i = s.indexOf(b.dataset.v);
          if (i >= 0) s.splice(i, 1); else s.push(b.dataset.v);
          bioF[o.sc][d.k] = s;
        }
        bfRefresh();
      });
    });
    o.body.querySelector("#bf-reset").addEventListener("click", function () { bioF[o.sc] = { sort: "-1" }; bfRefresh(); });
    o.body.querySelector("#bf-done").addEventListener("click", function () { bfClose(true); });
  }
  function bfRerender() { var y = window.scrollY; renderBio(); window.scrollTo(0, y); }
  function bfRefresh() {
    var o = bfOpen; if (!o) return;
    var sc = o.body.scrollTop;
    bfRerender();
    var nb = app.querySelector('[data-bf="' + o.sc + '"]');
    if (nb) { nb.setAttribute("aria-expanded", "true"); nb.classList.add("open"); o.btn = nb; }
    o.body.innerHTML = bfBody(o.sc); o.body.scrollTop = sc; bfBind();
  }
  function bfShow(sc, btn) {
    if (bfOpen) bfClose(false);
    var mobile = window.matchMedia("(max-width: 760px)").matches;
    var wrap = document.createElement("div");
    wrap.className = "dd-layer fp-layer" + (mobile ? " sheet-mode" : "");
    wrap.innerHTML = (mobile ? '<div class="dd-scrim"></div>' : "") +
      '<div class="dd-panel fp-panel" role="dialog" aria-label="' + (sc === "c" ? "명단 필터" : "철회·미승인 명단 필터") + '">' +
      (mobile ? '<div class="dd-top"><span class="grab" aria-hidden="true"></span><b>' + (sc === "c" ? "명단 필터" : "철회·미승인 명단 필터") + "</b></div>" : "") +
      '<div class="dd-body fp-body"></div></div>';
    document.body.appendChild(wrap);
    var panel = wrap.querySelector(".dd-panel");
    bfOpen = { sc: sc, btn: btn, wrap: wrap, panel: panel, body: wrap.querySelector(".fp-body"), mobile: mobile };
    if (mobile) overlayOpen(function () { bfClose(false); });
    bfOpen.body.innerHTML = bfBody(sc); bfBind();
    btn.setAttribute("aria-expanded", "true"); btn.classList.add("open");
    if (!mobile) {
      var r = btn.getBoundingClientRect();
      panel.style.width = Math.min(400, window.innerWidth - 16) + "px";
      panel.style.left = Math.max(8, Math.min(r.right - panel.offsetWidth, window.innerWidth - panel.offsetWidth - 8)) + "px";
      var below = window.innerHeight - r.bottom - 20, above = r.top - 20;
      if (below >= 320 || below >= above) { panel.style.top = (r.bottom + 6) + "px"; panel.style.maxHeight = Math.max(240, below) + "px"; }
      else { panel.classList.add("up"); panel.style.maxHeight = above + "px"; panel.style.top = Math.max(8, r.top - 6 - Math.min(panel.scrollHeight, above)) + "px"; }
    }
    var first = panel.querySelector('.fo[aria-pressed="true"]') || panel.querySelector(".fo");
    if (first) first.focus({ preventScroll: true });
    panel.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); bfClose(true); } });
    var scrim = wrap.querySelector(".dd-scrim");
    if (scrim) scrim.addEventListener("click", function () { bfClose(true); });
  }
  function bfClose(refocus) {
    var o = bfOpen; if (!o) return;
    bfOpen = null;
    if (o.mobile) overlayDone();
    var btn = app.querySelector('[data-bf="' + o.sc + '"]');
    if (btn) { btn.setAttribute("aria-expanded", "false"); btn.classList.remove("open"); }
    if (o.mobile) { o.wrap.classList.add("closing"); setTimeout(function () { o.wrap.remove(); }, 180); } else o.wrap.remove();
    if (refocus && btn) btn.focus({ preventScroll: true });
  }
  document.addEventListener("pointerdown", function (e) {
    if (bfOpen && !bfOpen.mobile && !e.target.closest(".fp-panel") && !e.target.closest("[data-bf]")) bfClose(false);
  }, true);
  function bindBio() {
    var qi = document.getElementById("bio-q");
    if (qi) qi.addEventListener("input", function () {
      bioState.q = qi.value;
      var keep = qi.selectionStart;
      bfRerender();
      var n = document.getElementById("bio-q"); if (n) { n.focus({ preventScroll: true }); try { n.setSelectionRange(keep, keep); } catch (e) { /* 무시 */ } }
    });
    app.querySelectorAll("[data-bf]").forEach(function (b) {
      b.addEventListener("click", function () { if (bfOpen && bfOpen.sc === b.dataset.bf) bfClose(true); else bfShow(b.dataset.bf, b); });
    });
    app.querySelectorAll(".af[data-bsc]").forEach(function (b) {
      b.addEventListener("click", function () {
        var sc = b.dataset.bsc, k = b.dataset.bk;
        if (k === "sort") bioF[sc].sort = "-1";
        else bioF[sc][k] = bioSel(sc, k).filter(function (v) { return v !== b.dataset.bv; });
        bfRerender();
      });
    });
    app.querySelectorAll("[data-breset]").forEach(function (b) {
      b.addEventListener("click", function () { bioF[b.dataset.breset] = { sort: "-1" }; bfRerender(); });
    });
    app.querySelectorAll("tr[data-bio]").forEach(function (tr) {
      var go = function () { goPath("/bio/" + encodeURIComponent(tr.dataset.bio)); };
      tr.addEventListener("click", function (e) { if (!e.target.closest("a")) go(); });
      tr.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    });
  }
  // 상세: 증권신고서 정리 섹션 (바이오 시트와 딜 시트가 함께 씀)
  function bioSections(c) {
    var h = "";
    var srcNote = c.basis + " 기준" + (c.rcp ? " · 최초 신고서 " + dartLink(c.rcp) : "") + " · 숫자 뒤 [줄]은 신고서 본문 줄번호(정리용 텍스트 기준)";
    if (c.lic_sum) h += section("기술이전·계약 요약", "<p>" + esc(c.lic_sum) + "</p>", true);
    var day = function (x) { return String(x || "").replace(/\s*[(（].*$/, "").replace(/\s*;.*$/, "") || "-"; };
    var dirCls = function (d) { return /L\/O|플랫폼|옵션/.test(d || "") ? "lo" : /L\/I/.test(d || "") ? "li" : "etc"; };
    var nz = function (v) { return v && !/^(기재 ?없음|비공개|해당 ?없음|미기재|-)/.test(v) ? v : ""; };
    var noEn = function (v) { return String(v || "").replace(/\s*\((?=[A-Za-z])[^)]*\)/g, "").trim(); };
    var noParen = function (v) { return String(v || "").replace(/\s*[(（][^)）]*[)）]/g, "").trim(); };
    var shortAmt = function (x) {
      var t = nz(x.total) || (nz(x.upfront) ? "선급금 " + nz(x.upfront) : "");
      var cut = t.replace(/\s*[(（;].*$/, "");
      return { full: t, short: cut.length > 34 ? cut.slice(0, 33) + "…" : cut };
    };
    var ym = function (x) { var m = String(x || "").match(/((?:19|20)\d{2})[.\-\/년\s]*(\d{1,2})?/); return m ? m[1] + (m[2] ? "." + ("0" + m[2]).slice(-2) : "") : "-"; };
    if (c.cdeals.length) {
      var cd = c.cdeals.slice().sort(function (a, b) { return ym(a.date) < ym(b.date) ? -1 : ym(a.date) > ym(b.date) ? 1 : 0; });
      var nLo = cd.filter(function (x) { return dirCls(x.dir) === "lo"; }).length;
      var sum = '<div class="tsum"><span>L/O <b>' + nLo + "</b></span><span>공동연구·공동개발 <b>" + (cd.length - nLo) + "</b></span>" + (c.glo ? '<span class="tag b-tech">해외 L/O 포함</span>' : "") + "</div>";
      h += section("기술이전·공동연구 계약", sum + '<div class="scroll"><table class="mini btbl"><thead><tr><th>체결</th><th>유형</th><th>대상 자산 · 상대방</th><th class="hide-m">규모</th><th class="num hide-m">줄</th></tr></thead><tbody>' +
        cd.map(function (x) {
          var a = shortAmt(x), co = noParen(nz(x.country));
          return '<tr><td class="c-ym">' + esc(ym(x.date)) + '</td><td><span class="ty ' + dirCls(x.dir) + '">' + esc(dirCls(x.dir) === "lo" ? (/플랫폼/.test(x.dir) ? "플랫폼" : /옵션/.test(x.dir) ? "옵션" : "L/O") : "공동") + "</span></td>" +
            '<td><b class="as">' + esc(x.asset || "-") + '</b><span class="pt">' + esc(x.partner || "-") + (co ? " · " + esc(co) : "") + "</span>" +
            (a.short ? '<span class="am show-m">' + esc(a.short) + "</span>" : "") + "</td>" +
            '<td class="hide-m c-am"' + (a.full ? ' title="' + esc(a.full) + '"' : "") + ">" + (a.short ? esc(a.short) : '<span class="dim">비공개·미기재</span>') + "</td>" +
            '<td class="num hide-m dim">' + esc(x.src || "") + "</td></tr>";
        }).join("") + "</tbody></table></div>" +
        '<p class="snote">' + srcNote + " · 규모에 마우스를 올리면 원문 표기 전체가 보입니다. 기술도입(L/I)·물질이전(MTA)·공급 계약 등은 뺐습니다.</p>", true, cd.length);
    }
    if (c.pipes.length) {
      var SR = { "상용화": 0, "임상 3상·허가심사": 1, "임상 2상": 2, "임상 1상": 3, "전임상": 4, "탐색·연구": 5, "플랫폼": 6, "기재 불명확": 7 };
      var pp = c.pipes.slice().sort(function (a, b) { return (SR[a.s] != null ? SR[a.s] : 8) - (SR[b.s] != null ? SR[b.s] : 8); });
      var sc = {}; pp.forEach(function (p) { sc[p.s || "기재 불명확"] = (sc[p.s || "기재 불명확"] || 0) + 1; });
      var psum = '<div class="tsum">' + Object.keys(sc).sort(function (a, b) { return (SR[a] != null ? SR[a] : 8) - (SR[b] != null ? SR[b] : 8); }).map(function (k) { return "<span>" + esc(k) + " <b>" + sc[k] + "</b></span>"; }).join("") + "</div>";
      h += section("파이프라인 (신고서 시점)", psum + '<div class="scroll"><table class="mini btbl"><thead><tr><th>자산</th><th class="hide-m">모달리티</th><th>적응증</th><th>단계</th></tr></thead><tbody>' +
        pp.map(function (p) {
          return '<tr><td><b class="as">' + esc(p.asset || "-") + '</b><span class="pt show-m">' + esc(noEn(p.modality)) + "</span></td>" +
            '<td class="hide-m">' + esc(noEn(p.modality) || "-") + "</td><td>" + (nz(p.ind) ? esc(p.ind) : '<span class="dim">-</span>') + "</td>" +
            '<td><span class="stg s' + (SR[p.s] != null ? SR[p.s] : 8) + '"' + (p.stage ? ' title="' + esc("신고서: " + p.stage) + '"' : "") + ">" + esc(p.s || "-") + "</span></td></tr>";
        }).join("") + "</tbody></table></div>" +
        '<p class="snote">앞선 단계 순. 단계는 신고서 문구를 구간으로 분류한 값이며, 단계에 마우스를 올리면 신고서 기재 문구가 보입니다.</p>', true, pp.length);
    }
    if (c.proj) {
      var P = c.proj;
      h += section("추정 손익 (공모가 산정용)", table([P.unit || "단위"].concat(P.years.map(function (y, i) { return esc(y) + (P.ae[i] && /실적|A/.test(P.ae[i]) ? " 실적" : ""); })),
        P.rows.map(function (r) { return [esc(r.item)].concat(r.v.map(function (v) { return esc(v == null ? "-" : v); })); }), P.years.map(function (_, i) { return i + 1; }), "bio-proj") +
        '<p class="snote">' + esc(P.basis || "") + (P.src ? " · 줄 " + esc(P.src) : "") + "</p>", false, P.rows.length);
    } else h += section("추정 손익", '<p class="muted">신고서에 추정 손익표가 없습니다(2005~2010년 상장 구형 신고서 등).</p>', false);
    if (c.val) {
      var VL = { target_year: "추정 기준연도", discount_rate: "할인율", pv_net_income: "현가 순이익", per: "적용 PER", peer_companies: "비교기업", equity_value: "평가 시가총액", value_per_share: "주당 평가가액", ipo_discount: "공모가 할인율", notes: "비고" };
      h += section("공모가 산정", '<dl class="kv">' + Object.keys(VL).filter(function (k) { return c.val[k]; }).map(function (k) { return "<dt>" + VL[k] + "</dt><dd>" + esc(c.val[k]) + "</dd>"; }).join("") + "</dl>", false);
    }
    var att = bio.attempts.filter(function (a) { return a.name === c.n; });
    if (att.length) h += section("상장예비심사 이력", '<ul class="bitems">' + att.map(function (a) {
      return '<li><div class="i1"><span class="ty ' + (a.outcome === "승인" ? "lo" : a.outcome === "미승인" ? "rej" : "etc") + '">' + esc(a.outcome) + '</span><b class="mono">' + esc(a.req) + (a.res ? " → " + esc(a.res) : "") + "</b>" +
        (a.days ? '<span class="dt">' + int(a.days) + "일</span>" : "") + "</div>" +
        '<div class="i2">선두 ' + esc(a.stage) + " · L/O " + (a.lo == null ? "확인 못함" : a.lo ? "있음" : "없음") + "</div>" +
        (a.outcome !== "승인" && a.reason ? '<div class="i3">' + esc(a.reason) + "</div>" : "") + "</li>";
    }).join("") + "</ul>" +
      '<p class="snote">출처: KIND 상장예비심사 결과. 탈락 건 프로필은 언론·공시 조사.</p>', att.length > 1, att.length);
    if (c.caveats && c.caveats.length) h += section("확인이 필요한 점", "<ul class=\"bio-cav\">" + c.caveats.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>", false, c.caveats.length);
    return h;
  }
  function setNav(idx, len, prevFn, nextFn) {
    document.getElementById("sheet-pos").textContent = idx >= 0 ? (idx + 1) + " / " + len : "";
    var pb = document.getElementById("s-prev"), nb = document.getElementById("s-next");
    pb.disabled = !prevFn; nb.disabled = !nextFn;
    pb.onclick = prevFn || null; nb.onclick = nextFn || null;
  }
  function bioChips(c) {
    return (c.cat === "B" ? '<span class="tag b-etc" title="경계 분류: 개량신약·약물전달·세포치료 중심 개발사">경계</span>' : "") +
      (c.prior_fail ? '<span class="tag b-etc" title="상장 전 예비심사 철회·미승인 이력">재도전 ' + c.prior_fail + "회</span>" : "");
  }
  // 신약 개발사 블록: 딜 카드와 바이오 카드가 같은 함수로 그립니다(같은 회사면 같은 내용).
  // withDeal이면 딜 카드에 이미 있는 상장일·희망 밴드는 빼고, hasCompany면 회사 개요도 뺍니다.
  function bioDetail(c, withDeal, hasCompany) {
    var tm = function (k, v, sub) { return '<div><span class="k">' + k + '</span><span class="v">' + v + "</span>" + (sub ? '<span class="s">' + sub + "</span>" : "") + "</div>"; };
    var txt = function (s) { return '<span style="font-family:var(--f-body);font-size:14.5px">' + esc(s || "-") + "</span>"; };
    var h = withDeal ? '<h3 class="bio-hd">신약 개발 · 상장 당시 증권신고서 정리<span>기술특례 신약개발사 케이스 스터디</span></h3>' : "";
    if (c.basis === "최초 증권신고서") h += '<p class="notice warn">최초 증권신고서 기준입니다. 이후 정정 신고서에서 공모가·추정치가 바뀌었을 수 있습니다.</p>';
    if (c.biz && !hasCompany) h += '<section class="company" aria-label="회사 개요"><h3>회사 개요</h3><p>' + esc(c.biz) + '</p><div class="cmeta"><span><b>분류</b>' + esc(c.desc || "-") + "</span>" + (c.kind_name ? "<span><b>현재 사명</b>" + esc(c.kind_name) + "</span>" : "") + '</div><p class="csrc">증권신고서 사업의 개요를 바탕으로 요약' + (c.rcp ? " · " + dartLink(c.rcp) : "") + "</p></section>";
    h += '<div class="terms' + (withDeal ? " t6" : "") + '">' + (withDeal ? "" : tm("상장일", esc(c.list_date)) + tm("희망 밴드", txt(c.band))) +
      tm("기술평가", txt(c.grade && c.grade !== "기재 없음" ? c.grade.replace("+", "·") : "확인 못함"), esc(c.route || "")) +
      tm("심사 소요", c.rev_days ? int(c.rev_days) + "<small>일</small>" : "-", c.req ? "청구 " + esc(c.req) : "") +
      tm("계약(L/O)", int(c.nco) + "<small>(" + c.nlo + ")건</small>", "L/O·공동연구" + (c.glo ? " · 해외 L/O 포함" : "")) + tm("파이프라인", int(c.np) + "<small>개</small>") +
      tm("선두 단계", txt(c.top)) + tm("흑자전환 추정", c.be_year ? c.be_year + "<small>년</small>" : "-", c.disc ? "할인율 " + c.disc + "%" : "") + "</div>";
    return h + bioSections(c);
  }
  function openBioSheet(n) {
    var c = bio && bioByName[n];
    var list = view === "bio" ? bioList() : [], idx = -1;
    for (var i = 0; i < list.length; i++) if (list[i].n === n) { idx = i; break; }
    var prev = idx > 0 ? list[idx - 1] : null, next = idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null;
    var nav = { sid: "bio:" + n, idx: idx, len: list.length,
      prev: prev && function () { goPath("/bio/" + encodeURIComponent(prev.n)); }, next: next && function () { goPath("/bio/" + encodeURIComponent(next.n)); } };
    // 공모 건과 연결된 회사는 딜 목록과 똑같은 카드를 엽니다
    if (c && c.deal_id && data.deals.some(function (x) { return x.deal_id === c.deal_id; })) { openSheet(c.deal_id, nav); return; }
    var wasOpen = !sheet.hidden;
    sheet.hidden = false; shade.hidden = false; sheetId = nav.sid;
    document.documentElement.classList.add("lock");
    if (!wasOpen) { sheet.style.animation = "none"; void sheet.offsetWidth; sheet.style.animation = ""; }
    var titleEl = document.getElementById("sheet-title"), chipEl = document.getElementById("sheet-chip"), subEl = document.getElementById("sheet-sub");
    document.getElementById("sheet-tl").hidden = true;
    if (!c) {
      titleEl.textContent = "회사를 찾을 수 없습니다"; chipEl.innerHTML = ""; subEl.textContent = ""; setNav(-1, 0);
      sbody.innerHTML = '<p class="err">목록으로 돌아가 다시 선택해 주십시오.</p>';
      return;
    }
    document.title = c.n + " · 기술특례 바이오 · IPO 데이터룸";
    titleEl.textContent = c.n;
    chipEl.innerHTML = '<span class="tag b-tech">' + esc(c.route || "기술특례") + "</span>" + bioChips(c);
    subEl.textContent = "상장 " + c.list_date + (c.lead ? " · " + c.lead.replace(/\s*\(.*$/, "") : "") + " · " + c.basis + " 기준";
    setNav(nav.idx, nav.len, nav.prev, nav.next);
    sbody.innerHTML = '<p class="notice">IPO 데이터룸 수집 범위 밖의 공모라 경쟁률·확정가·보호예수 정보는 없습니다. 상장 당시 증권신고서 정리만 보여 드립니다.</p>' + bioDetail(c, false, false);
    sbody.scrollTop = 0;
    if (!wasOpen) focusSheet();
  }

  // ---------------------------------------------------------------- 툴팁
  function showTip(g, x, y) {
    tip.innerHTML = g.getAttribute("data-tip");
    tip.hidden = false;
    var w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.min(Math.max(8, x - w / 2), window.innerWidth - w - 8) + "px";
    tip.style.top = (y - h - 12 < 8 ? y + 16 : y - h - 12) + "px";
  }
  function hideTip() { tip.hidden = true; document.querySelectorAll(".chart .col.on").forEach(function (g) { g.classList.remove("on"); }); }
  function bindChart() {
    document.querySelectorAll(".chart .col").forEach(function (g) {
      var hit = g.querySelector(".hit");
      hit.addEventListener("pointermove", function (e) { g.classList.add("on"); showTip(g, e.clientX, e.clientY); });
      hit.addEventListener("pointerleave", hideTip);
      hit.addEventListener("focus", function () {
        var r = hit.getBoundingClientRect(); g.classList.add("on");
        showTip(g, r.left + r.width / 2, r.top + r.height / 3);
      });
      hit.addEventListener("blur", hideTip);
    });
  }

  // ---------------------------------------------------------------- 테마
  var root = document.documentElement, mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  var tgl = document.getElementById("tgl");
  function isDark() {
    var t = root.getAttribute("data-theme");
    return t ? t === "dark" : !!(mq && mq.matches);
  }
  function paintTheme() {
    var dark = isDark();
    tgl.setAttribute("data-on", dark ? "dark" : "light");
    tgl.querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-pressed", String((b.dataset.t === "dark") === dark)); });
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", dark ? "#0F151C" : "#F4F6F9");
  }
  try { var savedTheme = localStorage.getItem("ipo-db-theme"); if (savedTheme) root.setAttribute("data-theme", savedTheme); } catch (e) { /* 무시 */ }
  tgl.querySelectorAll("button").forEach(function (b) {
    b.addEventListener("click", function () {
      root.setAttribute("data-theme", b.dataset.t);
      try { localStorage.setItem("ipo-db-theme", b.dataset.t); } catch (e) { /* 무시 */ }
      paintTheme();
    });
  });
  if (mq && mq.addEventListener) mq.addEventListener("change", paintTheme);
  new MutationObserver(paintTheme).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  paintTheme();

  // ---------------------------------------------------------------- 시작
  function load() {
    if (EMBED) return Promise.resolve(JSON.parse(embedEl.textContent));
    return fetch("data/deals.json", { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }
  // 기술특례 바이오 자료: 따로 받으며, 실패해도 나머지 화면은 그대로 씁니다.
  function loadBio() {
    var el = document.getElementById("embedded-bio");
    if (el) { try { return Promise.resolve(JSON.parse(el.textContent)); } catch (e) { return Promise.resolve(null); } }
    if (EMBED) return Promise.resolve(null);
    return fetch("data/biotech.json", { cache: "no-cache" }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }
  Promise.all([load(), loadBio()]).then(function (res) {
    bio = res[1]; bioIndex();
    return res[0];
  }).then(function (j) {
    data = j;
    var nIpo = (j.deals || []).length, nAp = (j.approvals || []).length;
    data.deals = (j.deals || []).concat(j.approvals || []);
    indexCorps();
    var upd = document.getElementById("upd"), ga = (j.generated_at || j.last_list_date || "").slice(0, 10);
    if (upd && ga) { upd.textContent = ga.replace(/-/g, ".") + " 업데이트"; upd.title = "DART 공시 " + (j.last_list_date || "-") + (j.kind_as_of ? " · KIND " + j.kind_as_of : "") + " 기준"; }
    if (document.getElementById("asof")) document.getElementById("asof").textContent = "DART 기준 " + (j.last_list_date || "-") + (j.kind_as_of ? " · KIND " + j.kind_as_of : "") + " · IPO " + nIpo + "건" + (nAp ? " · 예심 승인 " + nAp + "건" : "");
    route();
  }).catch(function () {
    app.innerHTML = '<p class="err">데이터를 불러오지 못했습니다. 네트워크 연결을 확인한 뒤 새로 고침해 주십시오. 처음 접속한 기기에서는 오프라인 상태로 열 수 없습니다.</p>';
  });
  // 주소창에서 직접 바꾼 경우(드묾): 기록에 이어 붙이고 화면만 다시 그립니다
  window.addEventListener("hashchange", function () { var p = curPath(); if (hist[hi] !== p) { hist = hist.slice(0, hi + 1); hist.push(p); hi++; } route(); });
  // 링크 클릭: 임베드 모드에서는 메모리 경로로, 목록→상세 이동 시 위치를 기억합니다.
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#/"]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
    var to = a.getAttribute("href").slice(1);
    e.preventDefault(); goPath(to);
  });
  // 상단 고정(P5): 제목줄은 스크롤과 함께 올라가고 탭+검색창이 위에 붙습니다.
  // 아래로 내리면 탭은 숨고 검색창만 남으며, 조금이라도 올리면 탭이 다시 내려옵니다.
  var ROOT = document.documentElement;
  function syncTopH() {
    var t = document.querySelector("header.top"), nav = t && t.querySelector("nav.tabs");
    if (!t) return;
    ROOT.style.setProperty("--toph", t.offsetHeight + "px");
    if (!nav) return;
    var off = nav.offsetTop - 8;                       // 탭이 화면 위 8px에 붙도록 제목줄 높이만큼 위로
    ROOT.style.setProperty("--navoff", off + "px");
    ROOT.style.setProperty("--dock", (t.offsetHeight - off) + "px");
    var sr = document.querySelector("#app .srow");
    ROOT.style.setProperty("--srh", (sr ? sr.offsetHeight : 0) + "px");
  }
  // 토글(.seg 세그먼트, .switch 스위치)이 누른 뒤 화면을 다시 그리면서 새 요소로 바뀌어도
  // 순간이동하지 않도록, 누르기 직전 상태를 기억했다가 새 요소에서 이전 위치 → 새 위치로 움직입니다.
  (function () {
    function segKey(el) { return [].map.call(el.querySelectorAll("button"), function (b) { return b.textContent; }).join("|"); }
    function swKey(el) { return "sw:" + (el.closest("label") || el).textContent.trim() + "#" + (el.className || ""); }
    function findNth(sel, keyFn, key, n) {
      var hit = [].filter.call(document.querySelectorAll(sel), function (x) { return keyFn(x) === key; });
      return hit[n] || null;
    }
    function watch(sel, keyFn, orig, apply) {
      var key = keyFn(orig), n = [].filter.call(document.querySelectorAll(sel), function (x) { return keyFn(x) === key; }).indexOf(orig);
      // 다시 그려지는 순간(화면에 그리기 전)을 잡도록 DOM 변경 감시 + 몇 프레임 동안 확인
      var done = false, tries = 0, mo = null;
      var check = function () {
        if (done) return;
        var el = findNth(sel, keyFn, key, n);
        if (el && el !== orig) { done = true; if (mo) mo.disconnect(); apply(el); return; }
        if (++tries < 15) requestAnimationFrame(check); else if (mo) mo.disconnect();
      };
      if (window.MutationObserver) { mo = new MutationObserver(check); mo.observe(document.body, { childList: true, subtree: true }); }
      Promise.resolve().then(check);
    }
    document.addEventListener("click", function (e) {
      var t = e.target;
      var btn = t.closest && t.closest(".seg button");
      if (btn) {
        var seg = btn.parentElement, oldI = seg.style.getPropertyValue("--i");
        watch(".seg", segKey, seg, function (el) {
          var newI = el.style.getPropertyValue("--i");
          if (oldI === "" || newI === oldI) return;
          if (!el.animate) return;
          try {
            el.animate([{ transform: "translateX(" + (+oldI * 100) + "%)" }, { transform: "translateX(" + (+newI * 100) + "%)" }],
              { duration: 450, easing: "cubic-bezier(.34, 1.4, .5, 1)", pseudoElement: "::before" });
          } catch (er) { /* 지원하지 않는 브라우저는 그대로 */ }
        });
        return;
      }
      var inp = t.closest && t.closest(".switch input");
      if (inp) {
        var was = !inp.checked;
        watch(".switch input", swKey, inp, function (el) {
          var now = el.checked;
          if (now === was) return;
          if (!el.animate) return;
          try {
            el.animate([{ transform: "translateX(" + (was ? 12 : 0) + "px)" }, { transform: "translateX(" + (now ? 12 : 0) + "px)" }],
              { duration: 300, easing: "cubic-bezier(.34, 1.3, .5, 1)", pseudoElement: "::after" });
          } catch (er) { /* 지원하지 않는 브라우저는 그대로 */ }
        });
      }
    }, true);
  })();
  // 목록 상자 안을 내리면 머리행 아래 그림자(L3)
  document.addEventListener("scroll", function (e) {
    var el = e.target;
    var tb = el && el.querySelector && el.querySelector(":scope > table");
    if (!tb || !tb.tHead) return;
    var on = el.scrollTop > 2;
    if (on) el.style.setProperty("--tw", tb.offsetWidth + "px");
    el.classList.toggle("is-scrolled", on);
  }, true);
  var lastSY = window.scrollY || 0, stTick = false;
  function setNavUp(on) { if (ROOT.classList.contains("nav-up") !== on) ROOT.classList.toggle("nav-up", on); }
  window.addEventListener("scroll", function () {
    if (stTick) return;
    stTick = true;
    requestAnimationFrame(function () {
      stTick = false;
      var y = window.scrollY || 0, dy = y - lastSY, ae = document.activeElement;
      var top = document.querySelector("header.top"), lim = top ? top.offsetHeight + 120 : 200;
      if (y < lim) setNavUp(false);
      else if (dy > 6 && !(ae && ae.classList && ae.classList.contains("search"))) setNavUp(true);
      else if (dy < -4) setNavUp(false);
      if (Math.abs(dy) > 4 || y < lim) lastSY = y;
    });
  }, { passive: true });
  syncTopH();
  window.addEventListener("resize", syncTopH);
  if (window.MutationObserver) new MutationObserver(function () { requestAnimationFrame(syncTopH); }).observe(app, { childList: true });
  var lastW = window.innerWidth, rt;
  window.addEventListener("resize", function () {
    clearTimeout(rt);
    rt = setTimeout(function () {
      if (window.innerWidth !== lastW && data) {
        var y0 = window.scrollY;
        if (view === "stats") { renderStats(); window.scrollTo(0, y0); }
        if (view === "bio") { renderBio(); window.scrollTo(0, y0); }
        if (view === "cal") { renderCal(); window.scrollTo(0, y0); }
        if (sheetId) { if (sheetId.indexOf("bio:") === 0) openBioSheet(sheetId.slice(4)); else openSheet(sheetId); }
      }
      placeInd(document.querySelector(".tabs"));
      lastW = window.innerWidth;
    }, 150);
  });
  document.addEventListener("keydown", function (e) {
    if (!sheetId || e.target.closest("input, select, textarea")) return;
    if (e.key === "ArrowLeft") { var b = document.getElementById("s-prev"); if (!b.disabled) b.click(); }
    if (e.key === "ArrowRight") { var n = document.getElementById("s-next"); if (!n.disabled) n.click(); }
    if (e.key === "Escape") closeTo(baseView());
  });

  // 화면 전환은 상단 탭(휴대폰은 페이지 점)으로만 합니다. 좌우 끌기는 통계 그래프의 기간 이동에 씁니다.

  if (!EMBED && "serviceWorker" in navigator) {
    window.addEventListener("load", function () { navigator.serviceWorker.register("sw.js").catch(function () {}); });
  }
})();
