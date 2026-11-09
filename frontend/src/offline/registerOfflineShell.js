let ready = false;
const listeners = new Set();

export function getOfflineShellReady() {
  return ready;
}

export function subscribeOfflineShellReady(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function markReady() {
  if (ready) return;
  ready = true;
  listeners.forEach((listener) => listener(true));
  window.dispatchEvent(new CustomEvent('second-brain:offline-shell-ready'));
}

export async function registerOfflineShell() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/', updateViaCache: 'none',
    });
    const watch = (worker) => {
      if (!worker) return;
      if (worker.state === 'installed' || worker.state === 'activated') markReady();
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' || worker.state === 'activated') markReady();
      });
    };
    watch(registration.installing);
    watch(registration.waiting);
    watch(registration.active);
    registration.addEventListener('updatefound', () => watch(registration.installing));
    navigator.serviceWorker.ready.then(markReady);
  } catch (error) {
    // Storage restrictions or an interrupted install must not block the app.
    console.warn('Offline app shell could not be prepared:', error);
  }
}
