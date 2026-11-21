// Prefetch is optional. A failed background import must not become an unhandled
// rejection over the screen the user is currently using. Foreground navigation
// still goes through React.lazy and the normal render error boundary.
export const preloadRoutePages = (pages) => Promise.allSettled(
  pages.map((page) => Promise.resolve().then(() => page.preload?.())),
);
