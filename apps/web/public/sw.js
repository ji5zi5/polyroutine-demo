const CACHE_NAME = "poly-routine-shell-v1"
const SHELL_URLS = ["/", "/manifest.webmanifest", "/icon.svg"]

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS)))
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => {
        const deletions = []
        for (const name of names) {
          if (name !== CACHE_NAME) deletions.push(caches.delete(name))
        }
        return Promise.all(deletions)
      })
      .then(() => self.clients.claim()),
  )
})

self.addEventListener("fetch", (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/v1/")
  ) {
    return
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            void caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()))
          }
          return response
        })
        .catch(async () => (await caches.match(request)) ?? caches.match("/")),
    )
    return
  }

  event.respondWith(
    caches.match(request).then(async (cached) => {
      if (cached !== undefined) return cached
      const response = await fetch(request)
      if (response.ok) {
        void caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()))
      }
      return response
    }),
  )
})
