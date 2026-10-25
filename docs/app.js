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
  function goPath(p) { if (EMBED) { memPath = p; route(); } else { location.hash = p; } }

  var DEFAULTS = { status: "all", cand: "ipo", spac: false, year: "", board: "", q: "", sortKey: "date", sortDir: -1 };
  var state = Object.assign({}, DEFAULTS, { sYear: "", sPeriod: "all", sUnit: "year", sWin: null, metric: "count", league: "count", listScroll: 0 });
  try {
    var saved = JSON.parse(localStorage.getItem("ipo-db-view") || "null");
    if (saved) ["status", "spac", "year", "board", "sortKey", "sortDir", "sPeriod", "sUnit", "sWin", "metric", "league"].forEach(function (k) {
      if (k in saved) state[k] = saved[k];
    });
  } catch (e) { /* 저장소를 쓸 수 없으면 기본값으로 시작 */ }
  function persist() {
    try {
      var o = {};
      ["status", "cand", "spac", "year", "board", "sortKey", "sortDir", "sPeriod", "sUnit", "sWin", "metric", "league"].forEach(function (k) { o[k] = state[k]; });
      localStorage.setItem("ipo-db-view", JSON.stringify(o));
    } catch (e) { /* 무시 */ }
  }

  // ---------------------------------------------------------------- 공통 표기
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function int(n) { return n == null ? "-" : Number(n).toLocaleString("ko-KR"); }
  function eok(n) {
    if (n == null) return "-";
    var v = n / 1e8;
    return v >= 100 ? Math.round(v).toLocaleString("ko-KR") : v.toLocaleString("ko-KR", { maximumFractionDigits: 1 });
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
  var BOARDS = { KOSPI: "유가증권", KOSDAQ: "코스닥 일반", KOSDAQ_TECH: "코스닥 기술특례" };
  var BOARD_SHORT = { KOSPI: "유가증권", KOSDAQ: "코스닥", KOSDAQ_TECH: "기술특례" };
  function boardOk(d, b) {
    if (!b) return true;
    if (d.tech_unknown && d.board === "KOSDAQ") return b === "KOSDAQ" || b === "KOSDAQ_TECH";
    return d.board === b;
  }
  // 배지: 시장(유가·코스닥)과 상장 경로(기술특례·성장성 특례·이익미실현)를 따로 붙입니다.
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
  function highlight(text, q) {
    var t = esc(text);
    var m = findMatch(text, q);
    if (m === -1) return t;
    return esc(text.slice(0, m.i)) + "<mark>" + esc(text.slice(m.i, m.i + m.n)) + "</mark>" + esc(text.slice(m.i + m.n));
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
    return Number(v).toLocaleString("ko-KR", { maximumFractionDigits: digits == null ? 0 : digits, minimumFractionDigits: digits || 0 }) + ":1";
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
  function route() {
    var h = curPath();
    var m = h.match(/^\/deal\/(.+)$/);
    var tab = h.indexOf("/stats") === 0 ? "stats" : m ? (view || "list") : "list";
    setTabs(tab);
    hideTip();
    if (!data) return;
    if (m) {
      if (!view) renderList();
      openSheet(decodeURIComponent(m[1]));
      return;
    }
    closeSheet();
    if (tab === "stats") { if (view !== "stats") { renderStats(); window.scrollTo(0, 0); } }
    else if (view !== "list") { renderList(); window.scrollTo(0, 0); }
    document.title = (tab === "stats" ? "통계" : "딜 목록") + " · IPO 데이터룸";
  }
  function baseView() { return view === "stats" ? "/stats" : "/"; }

  // ---------------------------------------------------------------- 목록
  function baseRows(ignoreStatus) {
    var q = state.q.trim().toLowerCase();
    return data.deals.filter(function (d) {
      if (!candOk(d, state.cand)) return false;
      if (!state.spac && isSpac(d)) return false;
      if (!ignoreStatus && state.status !== "all" && d.status !== state.status) return false;
      if (state.year && d.first_filing_dt.slice(0, 4) !== state.year) return false;
      if (!boardOk(d, state.board)) return false;
      if (q && findMatch(name(d), q) === -1 && findMatch((d.lead_underwriters || "") + "," + uwSet(d).join(","), q) === -1) return false;
      return true;
    });
  }
  var SORTERS = {
    date: function (d) { return d.listing_dt || d.first_filing_dt; },
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

  var ST_LABEL = { all: "전체", approved: "예심 승인", filed: "신고서 제출", price_fixed: "가격 확정", completed: "상장", withdrawn: "철회" };
  function activeFilters() {
    var a = [];
    if (state.status !== DEFAULTS.status) a.push({ k: "status", t: ST_LABEL[state.status] || state.status });
    if (state.board) a.push({ k: "board", t: BOARDS[state.board] });
    if (state.year) a.push({ k: "year", t: state.year + "년 신고" });
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
      "</div>" +
      '<button type="button" class="fbtn' + (act.length ? " on" : "") + '" id="f-menu" aria-haspopup="dialog" aria-expanded="false" aria-label="필터' + (act.length ? " " + act.length + "개 적용" : "") + '">' + FILTER_ICON +
      (act.length ? '<span class="fb-n">' + act.length + "</span>" : "") + "</button></div>" +
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
    var counts = { all: 0, approved: 0, filed: 0, price_fixed: 0, completed: 0, withdrawn: 0 };
    baseRows(true).forEach(function (d) { counts.all++; counts[d.status] = (counts[d.status] || 0) + 1; });
    var opt2 = function (k, v, label, n) {
      return '<button type="button" class="fo" data-k="' + k + '" data-v="' + esc(v) + '" aria-pressed="' + (String(state[k]) === String(v)) + '">' + esc(label) +
        (n != null ? '<span class="n">' + n + "</span>" : "") + "</button>";
    };
    var st = ["all", "approved", "filed", "price_fixed", "completed", "withdrawn"].filter(function (k) { return k !== "approved" || counts.approved; });
    return '<div class="fp-sec"><div class="fp-h">진행 상태</div><div class="fp-opts">' + st.map(function (k) { return opt2("status", k, ST_LABEL[k], counts[k]); }).join("") + "</div></div>" +
      '<div class="fp-sec"><div class="fp-h">상장 시장</div><div class="fp-opts">' + opt2("board", "", "전체") +
      Object.keys(BOARDS).map(function (k) { return opt2("board", k, BOARDS[k]); }).join("") + "</div></div>" +
      '<div class="fp-sec"><div class="fp-h">신고 연도</div><div class="fp-opts grid">' + opt2("year", "", "전체") +
      years().map(function (y) { return opt2("year", y, y + "년"); }).join("") + "</div></div>" +
      '<div class="fp-sec fp-row"><label class="switch"><input type="checkbox" id="fp-spac"' + (state.spac ? " checked" : "") + ">스팩 포함</label></div>" +
      '<div class="fp-foot"><button type="button" class="linkbtn" id="fp-reset">초기화</button>' +
      '<button type="button" class="fp-done" id="fp-done">' + filtered().length.toLocaleString("ko-KR") + "건 보기</button></div>";
  }
  function fpBind() {
    var o = fpOpen; if (!o) return;
    o.body.querySelectorAll(".fo").forEach(function (b) {
      b.addEventListener("click", function () {
        state[b.dataset.k] = b.dataset.v; persist(); fpRefresh();
      });
    });
    o.body.querySelector("#fp-spac").addEventListener("change", function (e) { state.spac = e.target.checked; persist(); fpRefresh(); });
    o.body.querySelector("#fp-reset").addEventListener("click", function () {
      ["status", "spac", "year", "board"].forEach(function (k) { state[k] = DEFAULTS[k]; }); persist(); fpRefresh();
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
    fpOpen.body.innerHTML = fpBody(); fpBind();
    btn.setAttribute("aria-expanded", "true"); btn.classList.add("open");
    if (!mobile) {
      var r = btn.getBoundingClientRect();
      panel.style.width = Math.min(380, window.innerWidth - 16) + "px";
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
    ["status", "spac", "year", "board", "q"].forEach(function (k) { state[k] = DEFAULTS[k]; });
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
      var tags = boardTag(d) + (isSpac(d) ? '<span class="tag b-spac">스팩</span>' : "") + refileTag(d);
      var bandCell = d.offer_price_low ? bandText(d) : (d.filed_price ? '<span class="dim" title="신고서 기재 기준가">' + int(d.filed_price) + "*</span>" : "-");
      var href = "#/deal/" + encodeURIComponent(d.deal_id);
      html += '<tr data-id="' + esc(d.deal_id) + '">' +
        '<td class="c-date">' + (d.listing_dt ? esc(d.listing_dt) : d.demand_start && d.status !== "withdrawn" ? '<span class="dim">수요예측 </span>' + esc(demandText(d, true)) : '<span class="dim">' + (d.status === "approved" ? "승인 " : "신고 ") + esc(d.first_filing_dt) + "</span>") + "</td>" +
        '<td class="c-name"><a class="nm" href="' + href + '">' + highlight(name(d), q) + "</a>" + tags + "</td>" +
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
      cards += '<a class="card" href="' + href + '" data-id="' + esc(d.deal_id) + '">' +
        '<div class="r1"><span class="nmw"><span class="nm">' + highlight(name(d), q) + '</span>' + (tags ? '<span class="tags">' + tags + "</span>" : "") + "</span>" + chip(d) + "</div>" +
        '<div class="r2">' + (d.listing_dt ? '상장 <span class="mono">' + esc(d.listing_dt) + "</span>" : d.demand_start && d.status !== "withdrawn" ? '수요예측 <span class="mono">' + esc(demandText(d, true)) + "</span>" : (d.status === "approved" ? "예심 승인 " : "신고 ") + '<span class="mono">' + esc(d.first_filing_dt) + "</span>") + " · " + (d.lead_underwriters ? highlight(d.lead_underwriters, q) : "주관사 미확인") + "</div>" +
        '<div class="r3"><span class="price">' + price + '</span><span class="amt">' + (d.offer_amount != null ? eok(d.offer_amount) + "억" : "") + "</span></div>" +
        (d.inst_demand_ratio != null || d.retail_ratio != null
          ? '<div class="r4">' + (d.inst_demand_ratio != null ? "<span>수요예측<b>" + ratio(d.inst_demand_ratio) + "</b></span>" : "") +
            (d.retail_ratio != null ? "<span>일반청약<b>" + ratio(d.retail_ratio) + "</b></span>" : "") + "</div>" : "") + "</a>";
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
  function lockupBlock(d) {
    var L = d.lockup;
    if (!L || (!L.float0 && !L.schedule && !L.commit)) return "";
    var listed = L.listed, f0 = L.float0, c = L.commit;
    var tile = function (k, v, sub) { return '<div><span class="k">' + k + '</span><span class="v">' + v + "</span>" + (sub ? '<span class="s">' + sub + "</span>" : "") + "</div>"; };
    var h = '<div class="terms lk-terms">' +
      tile("상장일 유통가능", f0 ? pct1(f0.pct) : '<span class="dim">-</span>', f0 ? int(f0.shares) + "주" : "") +
      tile("기관 의무보유확약", c ? pct1(c.ratio) : '<span class="dim">-</span>', c ? "수요예측 신청수량 기준" : (d.status === "filed" ? "수요예측 결과가 나오면 표시" : "원문에서 찾지 못함")) +
      tile("상장예정주식수", listed ? int(listed) + "<small>주</small>" : '<span class="dim">-</span>') + "</div>";
    // 해제 일정(누적)
    var sch = (L.schedule || []).slice();
    if (f0 || sch.length) {
      var pts = [{ m: 0, shares: f0 ? f0.shares : null, pct: f0 ? f0.pct : null }].concat(sch.map(function (x) { return { m: x.months, shares: x.shares, pct: x.pct }; }));
      pts = pts.filter(function (x, i) { return x.pct != null && (i === 0 || x.pct !== pts[i - 1].pct || i === pts.length - 1); });
      h += '<div class="lk-sub">보호예수 해제 일정 <span class="dim">(누적 유통가능)</span></div><ol class="lk-sched">' + pts.map(function (x, i) {
        var prev = i ? pts[i - 1].pct : 0, add = i ? x.pct - prev : x.pct;
        var when = x.m === 0 ? "상장일" : periodText(x.m) + " 후";
        var dt = d.listing_dt ? addPeriod(d.listing_dt, x.m) : "";
        return '<li><span class="w">' + when + (dt ? '<small>' + dt + "</small>" : "") + '</span><span class="bar"><i class="base" style="width:' + Math.min(100, prev).toFixed(2) + '%"></i><i class="add" style="left:' + Math.min(100, prev).toFixed(2) + "%;width:" + Math.max(0, Math.min(100 - prev, add)).toFixed(2) + '%"></i></span>' +
          '<span class="p">' + pct1(x.pct) + (i ? '<small>+' + pct1(add) + "</small>" : "") + "</span></li>";
      }).join("") + "</ol>" + (sch.some(function (x) { return x.derived; }) ? '<p class="snote">해제 일정은 주주별 매각제한 내역으로 계산했습니다.</p>' : "");
    }
    if (L.groups && L.groups.length) {
      h += '<div class="lk-sub">보호예수·의무보유 내역</div>' + table(["구분", "기간", "주식수", "상장주식 대비"],
        L.groups.map(function (g) { return [esc(g.category), esc(periodText(g.months)), int(g.shares), g.pct != null ? pct1(g.pct) : "-"]; }), [2, 3]);
      if (L.groups_full === false) h += '<p class="snote">원문 표에 실린 주주 기준입니다. 표 밖의 물량(공모주 배정분 등)은 빠져 있을 수 있습니다.</p>';
    }
    if (c && c.by && c.by.length) {
      h += '<div class="lk-sub">기관 의무보유확약 기간별 <span class="dim">(신청수량)</span></div>' + table(["확약 기간", "신청수량", c.total ? "참여수량 대비" : "확약 내 비중"],
        c.by.slice().sort(function (a, b) { return b.months - a.months; }).map(function (b) {
          return [esc(periodText(b.months)), int(b.qty), pct1(b.qty / (c.total || c.committed) * 100)];
        }), [1, 2]);
    }
    var src = [];
    if (L.src_float) src.push("유통물량 " + dartLink(L.src_float));
    if (L.src_commit) src.push("확약 " + dartLink(L.src_commit));
    h += '<p class="snote">상장일 유통가능 물량은 공모주 배정분의 기관 의무보유확약을 반영하지 않은 투자설명서 기준입니다. 원문의 표를 규칙으로 읽은 값이며, 검증이 맞지 않은 항목은 비워 둡니다.' +
      (src.length ? " 출처: " + src.join(" · ") : "") + "</p>";
    return section("유통물량·보호예수", h, true);
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
  function openSheet(id) {
    var d = data.deals.filter(function (x) { return x.deal_id === id; })[0];
    var wasOpen = !sheet.hidden;
    sheet.hidden = false; shade.hidden = false; sheetId = id;
    document.documentElement.classList.add("lock");
    if (!wasOpen) { sheet.style.animation = "none"; void sheet.offsetWidth; sheet.style.animation = ""; }
    var titleEl = document.getElementById("sheet-title"), chipEl = document.getElementById("sheet-chip"), subEl = document.getElementById("sheet-sub");
    if (!d) {
      titleEl.textContent = "공모 건을 찾을 수 없습니다"; chipEl.innerHTML = ""; subEl.textContent = "";
      sbody.innerHTML = '<p class="err">목록으로 돌아가 다시 선택해 주십시오.</p>';
      return;
    }
    document.title = name(d) + " · IPO 데이터룸";
    var list = view === "list" ? filtered() : [], idx = -1;
    for (var i = 0; i < list.length; i++) if (list[i].deal_id === id) { idx = i; break; }
    var prev = idx > 0 ? list[idx - 1] : null, next = idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null;
    titleEl.textContent = name(d);
    chipEl.innerHTML = chip(d) + boardTag(d) + (isSpac(d) ? '<span class="tag b-spac">스팩</span>' : "") + refileTag(d);
    subEl.textContent = d.status === "approved" ? "예심 승인 " + (d.first_filing_dt || "-") + (d.prelim && d.prelim.market ? " · " + d.prelim.market : "") + (d.lead_underwriters ? " · " + d.lead_underwriters : "") : (d.listing_dt ? "상장" + (d.listing_dt > asOf() ? " 예정" : "") + " " + d.listing_dt + " · " : "") + "최초 신고 " + d.first_filing_dt +
      (d.demand_start ? " · 수요예측 " + demandText(d) : "") +
      (pricingDate(d) ? " · 확정 " + pricingDate(d) : "") + " · 정정 " + (d.amendment_count || 0) + "회";
    document.getElementById("sheet-pos").textContent = idx >= 0 ? (idx + 1) + " / " + list.length : "";
    var pb = document.getElementById("s-prev"), nb = document.getElementById("s-next");
    pb.disabled = !prev; nb.disabled = !next;
    pb.onclick = prev ? function () { goPath("/deal/" + encodeURIComponent(prev.deal_id)); } : null;
    nb.onclick = next ? function () { goPath("/deal/" + encodeURIComponent(next.deal_id)); } : null;

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
      if (!wasOpen) document.getElementById("s-close").focus({ preventScroll: true });
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
    html += companyBlock(d);
    var amtLabel = srcMethod(d, "offer_amount") === "DOC" ? "공모액 · 확정" : "공모액 · 신고서 기재";
    var shrLabel = srcMethod(d, "shares_offered") === "DOC" ? "공모주식수 · 확정" : "공모주식수 · 신고서 기재";
    var term = function (k, v, sub, cls) { return '<div><span class="k">' + k + '</span><span class="v' + (cls ? " " + cls : "") + '">' + v + "</span>" + (sub ? '<span class="s">' + sub + "</span>" : "") + "</div>"; };
    html += '<div class="terms">' +
      term("확정 공모가", d.final_price ? int(d.final_price) + "<small>원</small>" : '<span class="dim">' + (d.status === "price_fixed" ? "확인 필요" : "미확정") + "</span>", p ? pill(p) : "", d.final_price ? "hl" : "") +
      term("희망 밴드", d.offer_price_low ? bandText(d) + "<small>원</small>" : "-", d.offer_price_low && d.offer_price_low === d.offer_price_high ? "단일 희망가" : "") +
      term("수요예측 경쟁률", d.inst_demand_ratio != null ? ratio(d.inst_demand_ratio, 2) : '<span class="dim">-</span>', [demandText(d, true), d.inst_demand_count ? int(d.inst_demand_count) + "건 참여" : ""].filter(Boolean).join(" · ")) +
      term("일반청약 경쟁률", d.retail_ratio != null ? ratio(d.retail_ratio, 2) : '<span class="dim">-</span>', d.retail_count ? int(d.retail_count) + "건" : "") +
      term("상장일", d.listing_dt ? esc(d.listing_dt) : '<span class="dim">-</span>', d.listing_dt && d.listing_dt > asOf() ? "예정" : "") +
      term(amtLabel, d.offer_amount != null ? eok(d.offer_amount) + "<small>억원</small>" : "-") +
      term(shrLabel, d.shares_offered != null ? int(d.shares_offered) + "<small>주</small>" : "-", d.secondary_shares ? "구주 " + int(d.secondary_shares) + "주" : "") +
      term("대표주관", '<span style="font-family:var(--f-body);font-size:14.5px;font-weight:600">' + esc(d.lead_underwriters || "-") + "</span>", d.co_underwriters ? "공동 " + esc(d.co_underwriters) : "") +
      "</div>";
    html += '<div id="bandviz-slot"></div>';
    html += lockupBlock(d);

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
    if (!wasOpen) document.getElementById("s-close").focus({ preventScroll: true });
  }
  document.getElementById("s-close").addEventListener("click", function () { goPath(baseView()); });
  shade.addEventListener("click", function () { goPath(baseView()); });

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
    if (!ys.length) { app.innerHTML = '<div class="content">' + head + '<div class="ledger"><div class="empty">상장 건이 없습니다.</div></div></div>'; bindStats(); return; }
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

    var techPanel = "", leaguePanel = "";
    if (!statFast) (function () {   // 기술특례·주관사 표는 제스처가 끝난 뒤에만 다시 계산
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
      return '<tr class="go" tabindex="0" data-uw="' + esc(r.name) + '"><td class="rank">' + (i + 1) + "</td><td>" + esc(r.name) + '</td><td class="num">' + r.count + '</td><td class="num">' + r.tech +
        '</td><td class="num">' + eok(r.amount) +
        '</td><td class="bar-cell"><div class="hbar" style="width:' + (r[lk] / maxL * 100).toFixed(1) + '%"></div></td></tr>';
    }).join("");
    leaguePanel = '<section class="panel league"><header><div><h2>대표주관사 순위</h2><p>' + periodText + " 상장 기준. 공동 대표주관은 건수 각 1건, 공모액은 사 수로 나눔. 사명 변경·합병사는 현재 사명으로 합산. 행을 누르면 해당 딜 목록으로 이동합니다.</p></div>" +
      segBtns("data-l", [["count", "건수순"], ["amount", "공모액순"], ["tech", "기술특례순"]], lk) + '</header><div class="pbody">' +
      '<div class="scroll"><table class="mini"><thead><tr><th>순위</th><th>대표주관</th><th class="num">건수</th><th class="num">기술특례</th><th class="num">공모액(억)</th><th class="bar-cell"><span class="sr">막대</span></th></tr></thead><tbody>' + leagueRows + "</tbody></table></div>" +
      '<p class="snote">상위 ' + topN.length + "개사 / 전체 " + leag.length + "개사</p></div></section>";

    })();
    var unitWord = unit === "year" ? "연도별" : unit === "quarter" ? "분기별" : "월별";
    setStatsHtml('<div class="content">' + head + kpi +
      '<section class="panel"><header><div><h2>' + unitWord + " 상장 추이</h2><p>상장일 기준(상장 완료 건). 공모액은 확정 금액입니다." + (estN ? " 상장일을 원문에서 읽지 못한 " + estN + "건은 증권발행실적보고서 제출일로 추정했습니다." : "") + "</p></div>" +
      segBtns("data-m", [["count", "건수"], ["amount", "공모액"]], isAmt ? "amount" : "count") + '</header><div class="pbody chart zoomable">' + legend1 + svg1 +
      '<p class="zhint">' + (COARSE ? "두 손가락으로 벌리거나 모아 기간 조정 · 확대 후 좌우로 끌어 이동 · 두 번 탭하면 원래대로" : "트랙패드 핀치 또는 Ctrl+스크롤로 기간 조정 · 확대 후 드래그로 이동 · 더블클릭하면 원래대로") + "</p>" +
      '<details class="tv"><summary>표로 보기</summary>' + tbl1 + "</details></div></section>" +
      '<div class="panels even">' +
      '<section class="panel"><header><div><h2>경쟁률 추이</h2><p>' + unitWord + " 상장 건의 수요예측·일반청약 경쟁률 중앙값(스팩 제외).</p></div></header>" +
      '<div class="pbody chart zoomable">' + legend2 + svg2 + "</div></section>" +
      '<section class="panel"><header><div><h2>밴드 대비 확정가 위치</h2><p>' + unitWord + " 상장 건의 비중. 단일 희망가(스팩 등)는 제외. 위로 갈수록 높은 가격입니다.</p></div></header>" +
      '<div class="pbody chart zoomable">' + legend3 + svg3 + "</div></section></div>" +
      (statFast ? '<div class="keep"></div>' : '<div class="panels even">' + techPanel + leaguePanel + "</div>") + "</div>");
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
  load().then(function (j) {
    data = j;
    var nIpo = (j.deals || []).length, nAp = (j.approvals || []).length;
    data.deals = (j.deals || []).concat(j.approvals || []);
    indexCorps();
    if (document.getElementById("asof")) document.getElementById("asof").textContent = "DART 기준 " + (j.last_list_date || "-") + (j.kind_as_of ? " · KIND " + j.kind_as_of : "") + " · IPO " + nIpo + "건" + (nAp ? " · 예심 승인 " + nAp + "건" : "");
    route();
  }).catch(function () {
    app.innerHTML = '<p class="err">데이터를 불러오지 못했습니다. 네트워크 연결을 확인한 뒤 새로 고침해 주십시오. 처음 접속한 기기에서는 오프라인 상태로 열 수 없습니다.</p>';
  });
  window.addEventListener("hashchange", route);
  // 링크 클릭: 임베드 모드에서는 메모리 경로로, 목록→상세 이동 시 위치를 기억합니다.
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#/"]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
    var to = a.getAttribute("href").slice(1);
    if (EMBED) { e.preventDefault(); goPath(to); }
  });
  function syncTopH() {
    var t = document.querySelector(".top");
    if (t) document.documentElement.style.setProperty("--toph", t.offsetHeight + "px");
  }
  syncTopH();
  window.addEventListener("resize", syncTopH);
  var lastW = window.innerWidth, rt;
  window.addEventListener("resize", function () {
    clearTimeout(rt);
    rt = setTimeout(function () {
      if (window.innerWidth !== lastW && data) {
        var y0 = window.scrollY;
        if (view === "stats") { renderStats(); window.scrollTo(0, y0); }
        if (sheetId) openSheet(sheetId);
      }
      placeInd(document.querySelector(".tabs"));
      lastW = window.innerWidth;
    }, 150);
  });
  document.addEventListener("keydown", function (e) {
    if (!sheetId || e.target.closest("input, select, textarea")) return;
    if (e.key === "ArrowLeft") { var b = document.getElementById("s-prev"); if (!b.disabled) b.click(); }
    if (e.key === "ArrowRight") { var n = document.getElementById("s-next"); if (!n.disabled) n.click(); }
    if (e.key === "Escape") goPath(baseView());
  });

  // 화면 전환은 상단 탭(휴대폰은 페이지 점)으로만 합니다. 좌우 끌기는 통계 그래프의 기간 이동에 씁니다.

  if (!EMBED && "serviceWorker" in navigator) {
    window.addEventListener("load", function () { navigator.serviceWorker.register("sw.js").catch(function () {}); });
  }
})();
