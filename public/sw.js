/* 우리 가족 일정표 - 서비스워커 (오프라인 + 설치 지원) */
var CACHE = "family-schedule-v1";
var CORE = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(CORE); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  // 네이버 등 API 응답은 캐시하지 않음
  if (url.pathname.indexOf("/api/") === 0) return;

  // 페이지 이동: 네트워크 우선, 실패 시 캐시된 앱 셸
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(function () { return caches.match("./index.html"); }));
    return;
  }
  // 그 외 정적 리소스: 캐시 우선, 없으면 네트워크(받으면 캐시)
  e.respondWith(
    caches.match(req).then(function (cached) {
      return cached || fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
        return res;
      }).catch(function () { return cached; });
    })
  );
});
