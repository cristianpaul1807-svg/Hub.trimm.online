const CACHE_NAME = 'trimm-hub-v2';
const OFFLINE_URL = '/index.html';

// Durante la instalación, solo guardamos el index.html esencial
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll([OFFLINE_URL, '/manifest.json', '/favicon.ico']);
    })
  );
  self.skipWaiting();
});

// Limpieza de cachés antiguas
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Estrategia de red primero (Network First) para evitar pantallas en blanco
self.addEventListener('fetch', (event) => {
  // Solo manejamos peticiones GET
  if (event.request.method !== 'GET') return;

  // Si es una navegación (una ruta de la app), intentamos red y si falla, devolvemos el index.html
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match(OFFLINE_URL);
      })
    );
    return;
  }

  // Para otros recursos (imágenes, scripts), intentamos caché y luego red
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request).then((fetchResponse) => {
        // Guardamos dinámicamente en caché si la respuesta es válida
        if (fetchResponse.status === 200 && fetchResponse.type === 'basic') {
          const responseToCache = fetchResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return fetchResponse;
      }).catch(() => {
        // Si falla todo para imágenes, podríamos devolver un placeholder, 
        // pero para scripts/estilos simplemente dejamos que falle.
      });
    })
  );
});
