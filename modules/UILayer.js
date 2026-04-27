/**
 * UILayer
 * Owns all DOM interaction. Never does data work directly — delegates to store/share.
 *
 * Responsibilities:
 *  - Tab switching (AR ↔ Map) and keeping MapView in sync
 *  - Bottom sheet (add pin, pin list, about, shared-pin confirm)
 *  - GPS badge
 *  - Nav banner (nearest pin in passive mode; chosen pin in active navigation)
 *  - Compass strip (canvas)
 *  - Empty state
 *  - Toast notifications
 *  - Pin count badge on map tab
 */
class UILayer {
  static EMOJIS = ['📍','🚲','🎒','🍕','🏠','⭐','🏫','🚗','🏋️','☕','🧪','🛒'];
  static COMPASS_FOV = 120;

  constructor(store, sensor, share) {
    this._store  = store;
    this._sensor = sensor;
    this._share  = share;

    // MapView injected after construction (avoids circular dep)
    this._mapView = null;

    this._overlay    = document.getElementById('sheet-overlay');
    this._sheet      = document.getElementById('bottom-sheet');
    this._sheetTitle = document.getElementById('sheet-title');
    this._sheetBody  = document.getElementById('sheet-content');
    this._emptyState = document.getElementById('empty-state');
    this._gpsDot     = document.getElementById('gps-dot');
    this._gpsLabel   = document.getElementById('gps-label');
    this._toast      = document.getElementById('toast');
    this._badge      = document.getElementById('pin-count-badge');
    this._navBanner  = document.getElementById('nav-banner');
    this._navArrow   = document.getElementById('nav-banner-arrow');
    this._navEmoji   = document.getElementById('nav-banner-emoji');
    this._navName    = document.getElementById('nav-banner-name');
    this._navDist    = document.getElementById('nav-banner-dist');
    this._navStopBtn = document.getElementById('nav-stop-btn');

    this._toastTimer     = null;
    this._currentHeading = 0;
    this._compassReady   = false;

    // Active navigation state (null = passive "show nearest" mode)
    this._navPin = null;

    // Which tab is active: 'ar' | 'map'
    this._activeTab = 'ar';
  }

  /** Inject MapView reference so UILayer can call show/hide on tab switch. */
  setMapView(mapView) {
    this._mapView = mapView;

    // Wire map action callbacks
    mapView.onNavigate = (pin) => this.startNavigation(pin);
    mapView.onShare    = (pin) => this._doShare(pin);
    mapView.onDelete   = (pin) => {
      this._store.remove(pin.id);
      this.toast(`🗑 "${pin.name}" removed`);
    };
  }

  start() {
    document.getElementById('btn-add').addEventListener('click',  () => this._onAddTap());
    document.getElementById('btn-info').addEventListener('click', () => this._openInfoSheet());
    document.getElementById('tab-ar').addEventListener('click',   () => this._switchTab('ar'));
    document.getElementById('tab-map').addEventListener('click',  () => this._switchTab('map'));
    this._navStopBtn.addEventListener('click', () => this.stopNavigation());
    this._overlay.addEventListener('click', () => this._closeSheet());

    window.addEventListener('sensor:location', (e) => this._onLocation(e.detail));
    window.addEventListener('sensor:heading',  (e) => this._onHeading(e.detail));
    window.addEventListener('sensor:error',    (e) => this.toast(e.detail.message, 'error'));
    window.addEventListener('pins:changed',    (e) => this._onPinsChanged(e.detail.pins));

    this._initCompassCanvas();
    window.addEventListener('resize', () => this._initCompassCanvas());

    this._onPinsChanged(this._store.getAll());
  }

  // ── Tab switching ─────────────────────────────────────────────────────────

  _switchTab(tab) {
    if (this._activeTab === tab) {
      // Tapping active map tab again shows pin list sheet
      if (tab === 'map') this._openListSheet();
      return;
    }

    this._activeTab = tab;

    const arBtn  = document.getElementById('tab-ar');
    const mapBtn = document.getElementById('tab-map');
    const mapEl  = document.getElementById('map-view');

    if (tab === 'map') {
      document.body.classList.add('view-map');
      mapEl.classList.add('visible');
      arBtn.classList.remove('active');
      mapBtn.classList.add('active');
      this._mapView?.show();
    } else {
      document.body.classList.remove('view-map');
      mapEl.classList.remove('visible');
      mapBtn.classList.remove('active');
      arBtn.classList.add('active');
    }
  }

  // ── Toast ────────────────────────────────────────────────────────────────

  toast(msg, type = 'info') {
    clearTimeout(this._toastTimer);
    this._toast.textContent = type === 'error' ? '⚠️  ' + msg : msg;
    this._toast.classList.add('show');
    this._toastTimer = setTimeout(() => this._toast.classList.remove('show'), 3200);
  }

  // ── Shared pin prompt ────────────────────────────────────────────────────

  promptSharedPin(pin, onAccept) {
    const coordStr = `${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}`;

    this._openSheet('Shared pin', `
      <div class="shared-pin-preview">
        <div class="big-emoji">${pin.emoji}</div>
        <div class="shared-pin-preview-info">
          <div class="shared-pin-preview-name">${this._esc(pin.name)}</div>
          <div class="shared-pin-preview-coords">${coordStr}</div>
        </div>
      </div>
      <button class="btn-primary green" id="btn-accept-shared">Save &amp; navigate</button>
      <button class="btn-secondary"     id="btn-dismiss-shared">Dismiss</button>
    `);

    this._sheetBody.querySelector('#btn-accept-shared').addEventListener('click', () => {
      this._closeSheet();
      onAccept();
    });
    this._sheetBody.querySelector('#btn-dismiss-shared').addEventListener('click', () => {
      this._closeSheet();
    });
  }

  // ── Active navigation ────────────────────────────────────────────────────

  /**
   * Start navigating to a specific pin.
   * The nav banner enters "navigating" mode, showing "Navigating" label + stop button.
   */
  startNavigation(pin) {
    this._navPin = pin;
    this._navBanner.classList.add('navigating', 'visible');
    this._navEmoji.textContent = pin.emoji;
    this._navName.textContent  = pin.name;
    this._updateNavBannerArrow();
    this._updateNavDistanceLabel();

    // Switch to AR view so user can see the arrows
    if (this._activeTab !== 'ar') this._switchTab('ar');
  }

  /** Stop active navigation, return to passive "nearest pin" mode. */
  stopNavigation() {
    this._navPin = null;
    this._navBanner.classList.remove('navigating');
    this._updateNavBanner();
  }

  // ── GPS badge ────────────────────────────────────────────────────────────

  _onLocation({ accuracy }) {
    this._gpsDot.classList.add('active');
    if (accuracy < 10) {
      this._gpsLabel.textContent = `GPS ±${Math.round(accuracy)} m`;
    } else if (accuracy < 30) {
      this._gpsLabel.textContent = `GPS ~${Math.round(accuracy)} m`;
    } else {
      this._gpsLabel.textContent = 'GPS (weak)';
    }

    this._updateNavBanner();
    this._drawCompass();
  }

  // ── Compass heading ───────────────────────────────────────────────────────

  _onHeading({ heading }) {
    this._currentHeading = heading;
    this._compassReady   = true;
    this._drawCompass();
    this._updateNavBannerArrow();
  }

  // ── Empty state + badge ───────────────────────────────────────────────────

  _onPinsChanged(pins) {
    this._emptyState.style.display = pins.length ? 'none' : 'block';

    const count = pins.length;
    this._badge.textContent = count;
    this._badge.classList.toggle('visible', count > 0);

    // If the pinned navigation target was deleted, stop navigation
    if (this._navPin && !this._store.getById(this._navPin.id)) {
      this.stopNavigation();
    }

    this._updateNavBanner();
    this._drawCompass();
  }

  // ── Nav banner ────────────────────────────────────────────────────────────

  _updateNavBanner() {
    if (this._navPin) {
      // Active navigation — just refresh the distance
      this._updateNavDistanceLabel();
      return;
    }

    // Passive mode: show nearest pin
    const pos  = this._sensor.position;
    const pins = this._store.getAll();
    const info = NavEngine.nearestPin(pos, pins);

    if (!info) {
      this._navBanner.classList.remove('visible');
      return;
    }

    this._navBanner.classList.add('visible');
    this._navEmoji.textContent = info.pin.emoji;
    this._navName.textContent  = info.pin.name;
    this._navDist.textContent  = info.distanceStr;
    this._updateNavBannerArrow(info.bearing);
  }

  _updateNavDistanceLabel() {
    if (!this._navPin) return;
    const pos = this._sensor.position;
    const nav = NavEngine.computeNav(pos, this._navPin);
    if (!nav) return;

    this._navDist.textContent = nav.distanceStr;
    this._updateNavBannerArrow(nav.bearing);

    // Arrived celebration
    if (nav.arrived) {
      this.toast(`🎉 You've arrived at "${this._navPin.name}"!`);
      this._haptic('heavy');
      this.stopNavigation();
    }
  }

  _updateNavBannerArrow(pinBearing) {
    if (pinBearing === undefined) {
      // Derive from current navPin or nearest pin
      const pos  = this._sensor.position;
      const pin  = this._navPin ?? NavEngine.nearestPin(pos, this._store.getAll())?.pin;
      if (!pos || !pin) return;
      pinBearing = NavEngine.bearing(pos.lat, pos.lng, pin.lat, pin.lng);
    }

    const rel = NavEngine.relativeBearing(pinBearing, this._currentHeading);
    this._navArrow.style.transform = `rotate(${rel}deg)`;
  }

  // ── Compass strip ─────────────────────────────────────────────────────────

  _initCompassCanvas() {
    const canvas = document.getElementById('compass-canvas');
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = canvas.offsetWidth  * dpr;
    canvas.height = canvas.offsetHeight * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    this._drawCompass();
  }

  _drawCompass() {
    const canvas = document.getElementById('compass-canvas');
    if (!canvas || canvas.width === 0) return;

    const W   = canvas.offsetWidth;
    const H   = canvas.offsetHeight;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);

    const heading      = this._currentHeading;
    const FOV          = UILayer.COMPASS_FOV;
    const pixelsPerDeg = W / FOV;
    const centerX      = W / 2;

    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, 'rgba(0,0,0,0)');
    bg.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const cardinals = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };

    for (let deg = -180; deg <= 180 + FOV; deg += 5) {
      const absolute = ((heading - FOV / 2 + deg) + 360) % 360;
      const roundAbs = Math.round(absolute / 5) * 5 % 360;
      const x        = centerX + (deg - FOV / 2) * pixelsPerDeg;

      if (x < -20 || x > W + 20) continue;

      const isMajor    = roundAbs % 45 === 0;
      const isCardinal = roundAbs % 90 === 0;
      const tickH      = isMajor ? 14 : 7;

      ctx.beginPath();
      ctx.moveTo(x, H - tickH - 14);
      ctx.lineTo(x, H - 14);
      ctx.strokeStyle = isMajor ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.3)';
      ctx.lineWidth   = isMajor ? 1.5 : 1;
      ctx.stroke();

      if (isCardinal && cardinals[roundAbs]) {
        ctx.fillStyle    = roundAbs === 0 ? '#ff453a' : 'rgba(255,255,255,0.8)';
        ctx.font         = `bold 11px -apple-system, sans-serif`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(cardinals[roundAbs], x, H - 28);
      }
    }

    // Pin markers on compass
    const pos  = this._sensor.position;
    const pins = this._store.getAll();

    for (const pin of pins) {
      if (!pos) continue;

      const pinBearing = NavEngine.bearing(pos.lat, pos.lng, pin.lat, pin.lng);
      let diff = pinBearing - heading;
      if (diff >  180) diff -= 360;
      if (diff < -180) diff += 360;

      const x = centerX + diff * pixelsPerDeg;
      if (x < -10 || x > W + 10) continue;

      // Highlight the active nav pin
      const isNav = this._navPin?.id === pin.id;

      ctx.beginPath();
      ctx.arc(x, H - 7, isNav ? 6 : 5, 0, Math.PI * 2);
      ctx.fillStyle = isNav ? '#007aff' : pin.color;
      ctx.fill();

      if (Math.abs(diff) < FOV / 2 + 5) {
        ctx.font         = '13px serif';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(pin.emoji, x, H - 14);
      }
    }

    // Centre reticle
    ctx.beginPath();
    ctx.moveTo(centerX, 0);
    ctx.lineTo(centerX, H);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth   = 1;
    ctx.setLineDash([3, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Heading triangle
    ctx.beginPath();
    ctx.moveTo(centerX - 6, H);
    ctx.lineTo(centerX + 6, H);
    ctx.lineTo(centerX,     H - 10);
    ctx.closePath();
    ctx.fillStyle = '#007aff';
    ctx.fill();
  }

  // ── Sheet helpers ─────────────────────────────────────────────────────────

  _openSheet(title, contentHTML) {
    this._sheetTitle.textContent = title;
    this._sheetBody.innerHTML    = contentHTML;
    this._overlay.classList.add('visible');
    this._sheet.classList.add('visible');
  }

  _closeSheet() {
    this._overlay.classList.remove('visible');
    this._sheet.classList.remove('visible');
    setTimeout(() => { this._sheetBody.innerHTML = ''; }, 350);
  }

  // ── Add pin sheet ─────────────────────────────────────────────────────────

  _onAddTap() {
    this._sensor.requestCompassPermission().then((state) => {
      if (state === 'denied') {
        this.toast('Compass access denied — directions may be inaccurate.', 'error');
      }
    });

    const pos = this._sensor.position;
    if (!pos) {
      this.toast('Waiting for GPS fix…', 'error');
      return;
    }

    this._openSheet('Drop a pin', this._addSheetHTML());

    this._sheetBody.querySelectorAll('.emoji-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this._sheetBody.querySelectorAll('.emoji-btn').forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
      });
    });
    this._sheetBody.querySelector('.emoji-btn')?.classList.add('selected');

    setTimeout(() => this._sheetBody.querySelector('#pin-name')?.focus(), 350);

    this._sheetBody.querySelector('#btn-save-pin').addEventListener('click', () => this._savePin(pos));
    this._sheetBody.querySelector('#pin-name').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._savePin(pos);
    });
  }

  _addSheetHTML() {
    const emojiBtns = UILayer.EMOJIS.map((e) =>
      `<button class="emoji-btn" data-emoji="${e}">${e}</button>`
    ).join('');

    return `
      <input id="pin-name" class="pin-name-input" type="text"
             placeholder="Name this pin…" maxlength="32" autocomplete="off" />
      <div class="emoji-grid">${emojiBtns}</div>
      <p class="coords-hint">Dropping at your current location</p>
      <button id="btn-save-pin" class="btn-primary">Save pin</button>
    `;
  }

  _savePin(pos) {
    const nameEl  = this._sheetBody.querySelector('#pin-name');
    const emojiEl = this._sheetBody.querySelector('.emoji-btn.selected');

    const name  = nameEl?.value.trim();
    const emoji = emojiEl?.dataset.emoji ?? '📍';

    if (!name) {
      nameEl?.classList.remove('shake');
      void nameEl?.offsetWidth;
      nameEl?.classList.add('shake');
      nameEl?.addEventListener('animationend', () => nameEl.classList.remove('shake'), { once: true });
      nameEl?.focus();
      return;
    }

    try {
      this._store.add({ name, emoji, lat: pos.lat, lng: pos.lng });
      this._closeSheet();
      this.toast(`📍 "${name}" saved`);
      this._haptic('medium');
    } catch (err) {
      this.toast(err.message, 'error');
    }
  }

  // ── Pin list sheet ────────────────────────────────────────────────────────

  _openListSheet() {
    const pins = this._store.getAll();

    if (!pins.length) {
      this.toast('No pins saved yet.');
      return;
    }

    this._openSheet('My pins', this._listSheetHTML(pins));
    this._wireListButtons();
  }

  _refreshListInPlace() {
    const pins = this._store.getAll();
    if (!pins.length) {
      this._closeSheet();
      return;
    }
    this._sheetBody.innerHTML = this._listSheetHTML(pins);
    this._wireListButtons();
  }

  _wireListButtons() {
    this._sheetBody.querySelectorAll('[data-navigate]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id  = btn.dataset.navigate;
        const pin = this._store.getById(id);
        if (!pin) return;
        this._closeSheet();
        this.startNavigation(pin);
      });
    });

    this._sheetBody.querySelectorAll('[data-share]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id  = btn.dataset.share;
        const pin = this._store.getById(id);
        if (!pin) return;
        await this._doShare(pin);
      });
    });

    this._sheetBody.querySelectorAll('[data-delete]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id  = btn.dataset.delete;
        const pin = this._store.getById(id);
        if (!pin) return;
        this._store.remove(id);
        this.toast(`🗑 "${pin.name}" removed`);
        this._refreshListInPlace();
      });
    });
  }

  _listSheetHTML(pins) {
    const pos   = this._sensor.position;
    const items = pins.map((p) => {
      const nav  = NavEngine.computeNav(pos, p);
      const dist = nav ? `<span class="pin-dist-label">${nav.distanceStr}</span>` : '';
      const age  = this._timeAgo(p.createdAt);

      return `
        <div class="pin-row">
          <span class="pin-emoji">${p.emoji}</span>
          <div class="pin-info">
            <div class="pin-info-name">${this._esc(p.name)}</div>
            <div class="pin-info-meta">${dist}<span>${age}</span></div>
          </div>
          <div class="pin-actions">
            <button class="btn-navigate" data-navigate="${p.id}" title="Navigate">🧭</button>
            <button class="btn-share"    data-share="${p.id}">Share</button>
            <button class="btn-delete"   data-delete="${p.id}">Delete</button>
          </div>
        </div>
      `;
    }).join('');

    return `<div class="pin-list">${items}</div>`;
  }

  // ── Info sheet ────────────────────────────────────────────────────────────

  _openInfoSheet() {
    this._openSheet('About PinAR', `
      <div class="info-row"><div class="info-icon">📍</div><div class="info-text">Tap <strong style="color:#fff">+</strong> to save your current location as a named pin.</div></div>
      <div class="info-row"><div class="info-icon">↑</div><div class="info-text">Floating arrows in the camera view point toward each saved pin.</div></div>
      <div class="info-row"><div class="info-icon">🧭</div><div class="info-text">The compass strip shows all your pins' directions relative to where you're facing.</div></div>
      <div class="info-row"><div class="info-icon">🗺</div><div class="info-text">Tap <strong style="color:#fff">Map</strong> to see all pins on a satellite map. Tap Map again to list your pins.</div></div>
      <div class="info-row"><div class="info-icon">🔗</div><div class="info-text">Tap <strong style="color:#fff">Share</strong> on any pin to send a link — recipients open it and get instant AR navigation.</div></div>
      <div class="info-row"><div class="info-icon">🟢</div><div class="info-text">Arrow and banner turn green when you're within 5 m of your destination.</div></div>
      <div class="info-row"><div class="info-icon">🔒</div><div class="info-text">All data stored locally on your device. No account, no backend.</div></div>
    `);
  }

  // ── Haptic ────────────────────────────────────────────────────────────────

  _haptic(style = 'light') {
    if (!navigator.vibrate) return;
    const patterns = { light: [10], medium: [20], heavy: [30, 10, 30] };
    navigator.vibrate(patterns[style] ?? patterns.light);
  }

  // ── Share helper ──────────────────────────────────────────────────────────

  async _doShare(pin) {
    const result = await this._share.share(pin);
    if (result === 'shared')    this.toast('📤 Shared!');
    else if (result === 'copied') this.toast('🔗 Link copied!');
    else if (result === 'failed') this.toast('Could not copy link.', 'error');
  }

  // ── Utils ─────────────────────────────────────────────────────────────────

  _esc(str) {
    return String(str).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  _timeAgo(ts) {
    const m = Math.floor((Date.now() - ts) / 60_000);
    if (m < 1)  return 'Just now';
    if (m < 60) return `${m} min ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} hr ago`;
    return `${Math.floor(h / 24)} days ago`;
  }
}
