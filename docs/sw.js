"use strict";
// 앱 파일을 바꾸면 VERSION을 올려 이전 캐시를 비웁니다.
var VERSION = "v48";
var SHELL = "ipo-shell-" + VERSION;
var DATA = "ipo-data";
var FILES = ["./", "index.html", "style.css", "app.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"];

self.addEventListener("install", function (e) {
  e.waitUntil(Promise.all([
    caches.open(SHELL).then(function (c) { return c.addAll(FILES); }),
    // 첫 방문 직후 오프라인이 되어도 열리도록 데이터도 미리 받아 둡니다.
    caches.open(DATA).then(function (c) { return c.add("data/deals.json"); })
  ]).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== SHELL && k !== DATA; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // 데이터는 최신 우선, 오프라인이면 마지막으로 받은 본을 사용
  if (url.pathname.endsWith("/data/deals.json")) {
    e.respondWith(fetch(req).then(function (res) {
      var copy = res.clone();
      caches.open(DATA).then(function (c) { c.put(req, copy); });
      return res;
    }).catch(function () { return caches.match(req); }));
    return;
  }
  // 앱 파일은 캐시를 먼저 쓰고 뒤에서 갱신
  e.respondWith(caches.match(req).then(function (hit) {
    var net = fetch(req).then(function (res) {
      if (res.ok) { var copy = res.clone(); caches.open(SHELL).then(function (c) { c.put(req, copy); }); }
      return res;
    }).catch(function () { return hit; });
    return hit || net;
  }));
});
