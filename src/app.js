/**
 * app.js — boots PinAR
 * Instantiates all modules, wires dependencies, starts the app.
 */

(async () => {
  const loading    = document.getElementById('loading');
  const loadingSub = document.getElementById('loading-sub');

  // ── 1. Instantiate modules ────────────────────────────────────────────────
  const sensor = new SensorLayer();
  const store  = new PinStore();
  const share  = new ShareModule(store);
  const ar     = new ARRenderer(store, sensor);
  const ui     = new UILayer(store, sensor, share);

  // ── 2. Detect incoming shared pin before UI start ─────────────────────────
  let pendingSharedPin = null;
  share.checkIncoming((pin) => { pendingSharedPin = pin; });

  // ── 3. Start UI (no GPS needed) ───────────────────────────────────────────
  ui.start();

  // ── 4. Start AR renderer ──────────────────────────────────────────────────
  ar.start();

  // ── 5. Request sensors ────────────────────────────────────────────────────
  loadingSub.textContent = 'Requesting location…';

  try {
    await sensor.start();
    loadingSub.textContent = 'GPS locked ✓';
  } catch (err) {
    loadingSub.textContent = 'Location unavailable';
    ui.toast(err.message, 'error');
    // Don't block — user can browse saved pins without GPS
  }

  // ── 6. Hide loading screen ────────────────────────────────────────────────
  await new Promise((r) => setTimeout(r, 500));
  loading.classList.add('hidden');
  setTimeout(() => loading.remove(), 600);

  // ── 7. Show incoming shared pin prompt (custom sheet, not window.confirm) ──
  if (pendingSharedPin) {
    const pin = pendingSharedPin;
    pendingSharedPin = null;

    // Small delay so the sheet animation has a surface to appear on
    setTimeout(() => {
      ui.promptSharedPin(pin, () => {
        store.add({ name: pin.name, emoji: pin.emoji, lat: pin.lat, lng: pin.lng });
        ui.toast(`📍 "${pin.name}" saved — look for the arrow!`);
      });
    }, 700);
  }

  // ── 8. Dev helpers ────────────────────────────────────────────────────────
  if (location.hostname === 'localhost') {
    window._pinar = { sensor, store, share, ar, ui };
    console.info('[PinAR] Dev mode — window._pinar exposed');
  }
})();
