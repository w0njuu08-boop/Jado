// Jado service worker
// 배포할 때마다 이 버전 문자열만 바꿔주면(v1 -> v2 ...) 오래된 캐시가 자동 정리돼요.
const CACHE_NAME = 'jado-cache-v41';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).catch(() => {})
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

// 네트워크 우선: 온라인이면 항상 최신 파일을 받아오고, 오프라인일 때만 캐시를 씀
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).origin !== self.location.origin) return;   // Worker 등 외부 요청은 건드리지 않음
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

// ---- 푸시 알림 (Cloudflare Worker가 보낸 신호를 받아서 알림 표시) ----
self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    // 앱이 화면에 떠 있으면 앱 안 팝업이 대신 알려주니까 알림은 생략
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.some((c) => c.visibilityState === 'visible')) return;
    let items = [];
    // 1) 푸시에 알림 내용이 실려 왔으면 그대로 사용
    try {
      const d = e.data ? e.data.json() : null;
      if (d && d.title) items = [d];
    } catch (err) {}
    // 2) 내용이 없으면 Worker에서 가져오기 (저장소 반영이 늦을 수 있어서 몇 번 다시 시도)
    if (!items.length) {
      try {
        const cache = await caches.open('push-config');
        const r = await cache.match('/__cfg');
        if (r) {
          const cfg = await r.json();
          for (let i = 0; i < 4 && !items.length; i++) {
            if (i) await new Promise((res) => setTimeout(res, 1500));
            const res = await fetch(cfg.url + '/pending', { headers: { 'X-Key': cfg.key } });
            items = (await res.json()).items || [];
          }
        }
      } catch (err) {}
    }
    if (!items.length) items = [{ id: 'generic', title: '일정 알림', body: '확인할 일정이 있어요' }];
    await Promise.all(items.map((it) => self.registration.showNotification(it.title, {
      body: it.body,
      icon: './icon-192.png',          // 오른쪽에 자동으로 생기던 'W' 글자 아이콘 대신 앱 아이콘을 보여줌
      tag: it.id || ('p' + Date.now()),
      renotify: true,
      vibrate: [200, 100, 200],        // 진동이 있는 알림은 화면 위 팝업으로 뜨기 쉬워요
      data: { url: './' },
    })));
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ('focus' in c) return c.focus(); }
    return self.clients.openWindow('./');
  }));
});
