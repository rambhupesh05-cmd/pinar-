/**
 * MapView
 * Owns the Leaflet map. Syncs pin markers, tracks user position,
 * and fires navigation/share/delete actions back through UILayer callbacks.
 *
 * Shows itself when body has class 'view-map'; hidden otherwise.
 * Pins:changed and sensor:location update the map only while visible.
 */
class MapView {
  constructor(store, sensor) {
    this._store  = store;
    this._sensor = sensor;

    this._map        = null;
    this._userMarker = null;
    this._pinMarkers = new Map(); // pinId → L.Marker
    this._initialized = false;

    // Callbacks wired by UILayer after construction
    this.onNavigate = null; // (pin) → void
    this.onShare    = null; // (pin) → void
    this.onDelete   = null; // (pin) → void
  }

  start() {
    window.addEventListener('sensor:location', (e) => {
      if (!this._isVisible()) return;
      this._updateUserMarker(e.detail);
    });

    window.addEventListener('pins:changed', (e) => {
      if (!this._isVisible()) return;
      this._syncPins(e.detail.pins);
    });
  }

  /** Called each time the map tab is activated. */
  show() {
    if (!this._initialized) this._init();
    // Let the DOM render before calling invalidateSize
    requestAnimationFrame(() => {
      this._map.invalidateSize();
      this._syncPins();
      const pos = this._sensor.position;
      if (pos) this._updateUserMarker(pos);
    });
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  _init() {
    this._initialized = true;

    this._map = L.map('map-container', {
      zoomControl: true,
      attributionControl: true,
      tap: false, // prevent Leaflet double-event on iOS
    });

    L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' +
          ' contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19,
      }
    ).addTo(this._map);

    document.getElementById('btn-recenter').addEventListener('click', () => {
      const pos = this._sensor.position;
      if (pos) this._map.setView([pos.lat, pos.lng], 17, { animate: true });
    });
  }

  // ── User position ─────────────────────────────────────────────────────────

  _updateUserMarker(pos) {
    const latlng = [pos.lat, pos.lng];

    if (!this._userMarker) {
      const icon = L.divIcon({
        className: '',
        html: '<div class="user-dot"></div>',
        iconSize:   [20, 20],
        iconAnchor: [10, 10],
      });
      this._userMarker = L.marker(latlng, { icon, zIndexOffset: 1000 }).addTo(this._map);
      this._map.setView(latlng, 17, { animate: true });
    } else {
      this._userMarker.setLatLng(latlng);
    }
  }

  // ── Pin markers ───────────────────────────────────────────────────────────

  _syncPins(pins = this._store.getAll()) {
    const pinIds = new Set(pins.map((p) => p.id));

    for (const [id, marker] of this._pinMarkers) {
      if (!pinIds.has(id)) {
        marker.remove();
        this._pinMarkers.delete(id);
      }
    }

    for (const pin of pins) {
      if (!this._pinMarkers.has(pin.id)) {
        const marker = this._buildMarker(pin);
        marker.addTo(this._map);
        this._pinMarkers.set(pin.id, marker);
      }
    }
  }

  _buildMarker(pin) {
    const icon = L.divIcon({
      className: '',
      html: `<div class="map-pin-wrap">
               <div class="map-pin-dot" style="--pin-color:${pin.color}">
                 <span class="map-pin-emoji">${pin.emoji}</span>
               </div>
               <div class="map-pin-tip" style="--pin-color:${pin.color}"></div>
             </div>`,
      iconSize:    [42, 52],
      iconAnchor:  [21, 52],
      popupAnchor: [0, -56],
    });

    const marker = L.marker([pin.lat, pin.lng], { icon });

    marker.bindPopup(this._buildPopupHTML(pin), {
      className: 'pinar-popup',
      minWidth:  210,
      closeButton: false,
    });

    marker.on('popupopen', () => this._wirePopup(marker, pin));

    return marker;
  }

  _buildPopupHTML(pin) {
    const pos    = this._sensor.position;
    const nav    = pos ? NavEngine.computeNav(pos, pin) : null;
    const meta   = nav ? `${nav.distanceStr} away` : pin.emoji;

    return `
      <div class="popup-inner">
        <div class="popup-header">
          <span class="popup-big-emoji">${pin.emoji}</span>
          <div>
            <div class="popup-title">${this._esc(pin.name)}</div>
            <div class="popup-meta">${meta}</div>
          </div>
        </div>
        <div class="popup-actions">
          <button class="popup-btn nav  js-nav">Navigate</button>
          <button class="popup-btn      js-share">Share</button>
          <button class="popup-btn del  js-del">Delete</button>
        </div>
      </div>`;
  }

  _wirePopup(marker, pin) {
    const el = marker.getPopup().getElement();
    if (!el) return;

    el.querySelector('.js-nav')?.addEventListener('click', () => {
      marker.closePopup();
      this.onNavigate?.(pin);
    });
    el.querySelector('.js-share')?.addEventListener('click', () => {
      marker.closePopup();
      this.onShare?.(pin);
    });
    el.querySelector('.js-del')?.addEventListener('click', () => {
      marker.closePopup();
      this.onDelete?.(pin);
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  _isVisible() {
    return document.body.classList.contains('view-map');
  }

  _esc(str) {
    return String(str).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }
}
