/**
 * app.js — boots PinAR
 * Instantiates all modules, wires dependencies, starts the app.
 */

(async () => {
  const loading    = document.getElementById('loading');
  const loadingSub = document.getElementById('loading-sub');

  // ── 1. Instantiate modules ────────────────────────────────────────────────
  const sensor  = new SensorLayer();
  const store   = new PinStore();
  const share   = new ShareModule(store);
  const ar      = new ARRenderer(store, sensor);
  const mapView = new MapView(store, sensor);
  const ui      = new UILayer(store, sensor, share);

  // Wire MapView into UILayer so tab switching and map callbacks work
  ui.setMapView(mapView);

  // ── 2. Detect incoming shared pin before UI start ─────────────────────────
  let pendingSharedPin = null;
  share.checkIncoming((pin) => { pendingSharedPin = pin; });

  // ── 3. Start modules ──────────────────────────────────────────────────────
  ui.start();
  ar.start();
  mapView.start();

  // ── 4. Request sensors ────────────────────────────────────────────────────
  loadingSub.textContent = 'Requesting location…';

  try {
    await sensor.start();
    loadingSub.textContent = 'GPS locked ✓';
  } catch (err) {
    loadingSub.textContent = 'Location unavailable';
    ui.toast(err.message, 'error');
    // Don't block — user can browse saved pins without GPS
  }

  // ── 5. Hide loading screen ────────────────────────────────────────────────
  await new Promise((r) => setTimeout(r, 500));
  loading.classList.add('hidden');
  setTimeout(() => loading.remove(), 600);

  // ── 6. Show incoming shared pin prompt ───────────────────────────────────
  if (pendingSharedPin) {
    const pin = pendingSharedPin;
    pendingSharedPin = null;

    setTimeout(() => {
      ui.promptSharedPin(pin, () => {
        const saved = store.add({ name: pin.name, emoji: pin.emoji, lat: pin.lat, lng: pin.lng });
        ui.toast(`📍 "${pin.name}" saved — look for the arrow!`);
        ui.startNavigation(saved);
      });
    }, 700);
  }

  // ── 7. Dev helpers ────────────────────────────────────────────────────────
  if (location.hostname === 'localhost') {
    window._pinar = { sensor, store, share, ar, mapView, ui };
    console.info('[PinAR] Dev mode — window._pinar exposed');
  }
})();
