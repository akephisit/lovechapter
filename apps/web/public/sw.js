/* global self, caches */

const VERSION = "lovechapter-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("lovechapter-") && key !== VERSION)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// Deliberately no fetch handler: invitation URLs, token-derived API responses,
// authenticated workspace data, and mutations must never enter a shared cache.
