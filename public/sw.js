const CACHE_NAME = 'readit-cache-v2';

const APP_SHELL = [
    '/',
    '/index.html',
    '/manifest.json',
    '/favicon.ico',
    '/icon-192.svg',
    '/icon-512.svg'
];

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            // Eagerly cache core shell (swallows errors if run in dev mode where paths differ)
            return cache.addAll(APP_SHELL).catch(() => console.warn('Some shell assets failed to precache.'));
        })
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    // Handle Share Target POST requests
    if (event.request.method === 'POST' && event.request.url.endsWith('/')) {
        event.respondWith((async () => {
            try {
                const formData = await event.request.formData();
                const file = formData.get('file');
                
                if (file) {
                    // Send to client
                    const clientList = await clients.matchAll({ type: 'window', includeUncontrolled: true });
                    for (const client of clientList) {
                        client.postMessage({ type: 'SHARED_FILE', file: file });
                    }
                }
                // Redirect back to root to load the app
                return Response.redirect('/', 303);
            } catch (err) {
                return Response.redirect('/', 303);
            }
        })());
        return;
    }

    // Only cache GET requests
    if (event.request.method !== 'GET') {
        event.respondWith(fetch(event.request));
        return;
    }

    // Skip Chrome Extensions or unsupported schemes
    if (!event.request.url.startsWith('http')) {
        event.respondWith(fetch(event.request));
        return;
    }

    // Cache-First for huge ONNX and WASM files
    if (event.request.url.includes('.onnx') || event.request.url.includes('.wasm') || event.request.url.includes('voice_styles')) {
        event.respondWith(
            caches.match(event.request).then((cachedResponse) => {
                if (cachedResponse) return cachedResponse;
                
                return fetch(event.request).then((networkResponse) => {
                    // Only cache valid responses
                    if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
                        const responseToCache = networkResponse.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(event.request, responseToCache);
                        });
                    }
                    return networkResponse;
                }).catch(() => {
                    // Offline and no cache fallback
                });
            })
        );
        return;
    }

    // Stale-While-Revalidate for everything else (HTML, CSS, JS, etc.)
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            const fetchPromise = fetch(event.request).then((networkResponse) => {
                // Only cache valid basic or cors responses
                if (networkResponse && (networkResponse.status === 200 || networkResponse.status === 0)) {
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseToCache);
                    });
                }
                return networkResponse;
            }).catch(() => {
                // Ignore network errors offline
            });
            return cachedResponse || fetchPromise;
        })
    );
});
