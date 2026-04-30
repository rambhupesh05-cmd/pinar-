/**
 * UILayer — owns all DOM interaction.
 */
class UILayer {
  static EMOJIS = ['📍','🚲','🎒','🍕','🏠','⭐','🏫','🚗','🏋️','☕','🧪','🛒'];
  static COMPASS_FOV = 120;

  constructor(store, sensor, share) {
    this._store  = store;
    this._sensor = sensor;
    this._share  = share;
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
    this._navStopBtn  = document.getElementById('nav-stop-btn');
    this._navStartBtn = document.getElementById('nav-start-btn');
    this._progressFill = document.getElementById('nav-progress-fill');

    this._toastTimer      = null;
    this._currentHeading  = 0;
    this._compassReady    = false;
    this._navPin          = null;
    this._navStartDist    = null;
    this._navArriving     = false;
    this._activeTab       = 'ar';
    this._listSort        = 'nearest'; // 'nearest' | 'newest'
  }

  setMapView(mapView) {
    this._mapView = mapView;
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
    this._navStopBtn.addEventListener('click',  () => this.stopNavigation());
    this._overlay.addEventListener('click', () => this._closeSheet());

    // Tap passive banner (nearest pin hint) to start navigation
    this._navBanner.addEventListener('click', () => {
      if (this._navPin) return;
      const pos  = this._sensor.position;
      const info = NavEngine.nearestPin(pos, this._store.getAll());
      if (info) this.startNavigation(info.pin);
    });
    this._navStartBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const pos  = this._sensor.position;
      const info = NavEngine.nearestPin(pos, this._store.getAll());
      if (info) this.startNavigation(info.pin);
    });

    window.addEventListener('sensor:location', (e) => this._onLocation(e.detail));
    window.addEventListener('sensor:heading',  (e) => this._onHeading(e.detail));
    window.addEventListener('sensor:error',    (e) => this.toast(e.detail.message, 'error'));
    window.addEventListener('pins:changed',    (e) => this._onPinsChanged(e.detail.pins));

    this._initCompassCanvas();
    window.addEventListener('resize', () => this._initCompassCanvas());

    // Position tab indicator on AR tab at startup
    requestAnimationFrame(() => this._updateTabIndicator('ar'));

    this._onPinsChanged(this._store.getAll());
  }

  // ── Tab switching ─────────────────────────────────────────────────────────

  _switchTab(tab) {
    if (this._activeTab === tab) {
      if (tab === 'map') this._openListSheet();
      return;
    }
    this._activeTab = tab;

    const mapEl = document.getElementById('map-view');

    if (tab === 'map') {
      document.body.classList.add('view-map');
      mapEl.classList.add('visible');
      document.getElementById('tab-ar').classList.remove('active');
      document.getElementById('tab-map').classList.add('active');
      this._mapView?.show();
    } else {
      document.body.classList.remove('view-map');
      mapEl.classList.remove('visible');
      document.getElementById('tab-map').classList.remove('active');
      document.getElementById('tab-ar').classList.add('active');
    }

    this._updateTabIndicator(tab);
  }

  _updateTabIndicator(tab) {
    const indicator = document.getElementById('tab-indicator');
    const btn       = document.getElementById(tab === 'ar' ? 'tab-ar' : 'tab-map');
    const bar       = document.getElementById('tab-bar');
    if (!indicator || !btn || !bar) return;

    const btnRect = btn.getBoundingClientRect();
    const barRect = bar.getBoundingClientRect();
    const left    = btnRect.left - barRect.left + (btnRect.width - indicator.offsetWidth) / 2;
    indicator.style.left = `${left}px`;
  }

  // ── Toast ────────────────────────────────────────────────────────────────

  toast(msg, type = 'info') {
    clearTimeout(this._toastTimer);
    this._toast.textContent = type === 'error' ? '⚠️  ' + msg : msg;
    this._toast.classList.add('show');
    this._toastTimer = setTimeout(() => this._toast.classList.remove('show'), 3200);
  }

  // ── Shared pin prompt ─────────────────────────────────────────────────────

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
      this._closeSheet(); onAccept();
    });
    this._sheetBody.querySelector('#btn-dismiss-shared').addEventListener('click', () => this._closeSheet());
  }

  // ── Active navigation ─────────────────────────────────────────────────────

  startNavigation(pin) {
    this._navPin = pin;
    this._navBanner.classList.add('navigating', 'visible');
    this._navEmoji.textContent = pin.emoji;
    this._navName.textContent  = pin.name;

    const pos = this._sensor.position;
    const nav = pos ? NavEngine.computeNav(pos, pin) : null;
    this._navStartDist = nav ? nav.distanceM : null;
    if (this._progressFill) this._progressFill.style.width = '0%';

    this._updateNavBannerArrow();
    this._updateNavDistanceLabel();
    if (this._activeTab !== 'ar') this._switchTab('ar');
  }

  stopNavigation() {
    this._navPin       = null;
    this._navStartDist = null;
    this._navArriving  = false;
    if (this._progressFill) this._progressFill.style.width = '0%';
    this._navBanner.classList.remove('navigating', 'arrived');
    this._updateNavBanner();
  }

  // ── GPS badge ─────────────────────────────────────────────────────────────

  _onLocation({ accuracy }) {
    this._gpsDot.classList.remove('locating', 'active', 'weak');

    if (accuracy > 30) {
      this._gpsDot.classList.add('weak');
      this._gpsLabel.textContent = 'GPS (weak)';
    } else {
      this._gpsDot.classList.add('active');
      this._gpsLabel.textContent = accuracy < 10
        ? `GPS ±${Math.round(accuracy)} m`
        : `GPS ~${Math.round(accuracy)} m`;
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

    this._badge.textContent = pins.length;
    this._badge.classList.toggle('visible', pins.length > 0);

    if (this._navPin && !this._store.getById(this._navPin.id)) {
      this.stopNavigation();
    }

    this._updateNavBanner();
    this._drawCompass();
  }

  // ── Nav banner ────────────────────────────────────────────────────────────

  _updateNavBanner() {
    if (this._navPin) {
      this._updateNavDistanceLabel();
      return;
    }

    const pos  = this._sensor.position;
    const info = NavEngine.nearestPin(pos, this._store.getAll());

    if (!info) { this._navBanner.classList.remove('visible'); return; }

    this._navBanner.classList.add('visible');
    this._navEmoji.textContent = info.pin.emoji;
    this._navName.textContent  = info.pin.name;
    this._navDist.textContent  = info.distanceStr;
    this._updateNavBannerArrow(info.bearing);
  }

  _updateNavDistanceLabel() {
    if (!this._navPin) return;
    const nav = NavEngine.computeNav(this._sensor.position, this._navPin);
    if (!nav) return;

    this._navDist.textContent = nav.distanceStr;
    this._updateNavBannerArrow(nav.bearing);

    if (this._navStartDist && this._progressFill) {
      const pct = Math.max(0, Math.min(100,
        (1 - nav.distanceM / this._navStartDist) * 100
      ));
      this._progressFill.style.width = `${pct}%`;
    }

    if (nav.arrived && !this._navArriving) {
      this._navArriving = true;
      this._navBanner.classList.add('arrived');
      this.toast(`🎉 You've arrived at "${this._navPin.name}"!`);
      this._haptic('heavy');
      setTimeout(() => this.stopNavigation(), 1800);
    }
  }

  _updateNavBannerArrow(pinBearing) {
    if (pinBearing === undefined) {
      const pos = this._sensor.position;
      const pin = this._navPin ?? NavEngine.nearestPin(pos, this._store.getAll())?.pin;
      if (!pos || !pin) return;
      pinBearing = NavEngine.bearing(pos.lat, pos.lng, pin.lat, pin.lng);
    }
    const rel = NavEngine.relativeBearing(pinBearing, this._currentHeading);
    this._navArrow.style.transform = `rotate(${rel}deg)`;
  }

  // ── Compass strip (pill) ──────────────────────────────────────────────────

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
    const H   = canvas.offsetHeight; // ~46px pill
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);

    const heading      = this._currentHeading;
    const FOV          = UILayer.COMPASS_FOV;
    const pixPerDeg    = W / FOV;
    const cx           = W / 2;

    // Subtle background
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, 'rgba(255,255,255,0.03)');
    bg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const cardinals = { 0:'N', 45:'NE', 90:'E', 135:'SE', 180:'S', 225:'SW', 270:'W', 315:'NW' };

    // Ticks and cardinal labels — adapted for 46px height
    for (let deg = -180; deg <= 180 + FOV; deg += 5) {
      const absolute = ((heading - FOV / 2 + deg) + 360) % 360;
      const roundAbs = Math.round(absolute / 5) * 5 % 360;
      const x        = cx + (deg - FOV / 2) * pixPerDeg;

      if (x < -20 || x > W + 20) continue;

      const isMajor    = roundAbs % 45 === 0;
      const isCardinal = roundAbs % 90 === 0;
      const tickH      = isMajor ? 10 : 5;
      const tickBase   = H - 12; // leave room for pin dots at bottom

      ctx.beginPath();
      ctx.moveTo(x, tickBase - tickH);
      ctx.lineTo(x, tickBase);
      ctx.strokeStyle = isMajor
        ? 'rgba(255,255,255,0.65)'
        : 'rgba(255,255,255,0.25)';
      ctx.lineWidth = isMajor ? 1.5 : 1;
      ctx.stroke();

      if (isCardinal && cardinals[roundAbs]) {
        ctx.fillStyle    = roundAbs === 0 ? '#ff453a' : 'rgba(255,255,255,0.75)';
        ctx.font         = `bold ${isMajor ? 10 : 9}px -apple-system, sans-serif`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(cardinals[roundAbs], x, tickBase - tickH - 3);
      }
    }

    // Pin bearing dots — coloured circles at bottom of pill
    const pos  = this._sensor.position;
    const pins = this._store.getAll();

    for (const pin of pins) {
      if (!pos) continue;

      const pinBearing = NavEngine.bearing(pos.lat, pos.lng, pin.lat, pin.lng);
      let diff = pinBearing - heading;
      if (diff >  180) diff -= 360;
      if (diff < -180) diff += 360;

      const x = cx + diff * pixPerDeg;
      if (x < -8 || x > W + 8) continue;

      const isNav = this._navPin?.id === pin.id;
      const r     = isNav ? 4.5 : 3.5;

      ctx.beginPath();
      ctx.arc(x, H - 6, r, 0, Math.PI * 2);
      ctx.fillStyle = isNav ? '#0a84ff' : pin.color;
      ctx.fill();

      if (isNav) {
        ctx.beginPath();
        ctx.arc(x, H - 6, r + 2, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(10,132,255,0.35)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    // Centre reticle
    ctx.beginPath();
    ctx.moveTo(cx, 4);
    ctx.lineTo(cx, H - 4);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth   = 1;
    ctx.setLineDash([2, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Heading triangle at bottom centre
    ctx.beginPath();
    ctx.moveTo(cx - 5, H);
    ctx.lineTo(cx + 5, H);
    ctx.lineTo(cx, H - 8);
    ctx.closePath();
    ctx.fillStyle = '#0a84ff';
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
    setTimeout(() => { this._sheetBody.innerHTML = ''; }, 360);
  }

  // ── Add pin ───────────────────────────────────────────────────────────────

  _onAddTap() {
    this._sensor.requestCompassPermission().then((state) => {
      if (state === 'denied')
        this.toast('Compass access denied — directions may be inaccurate.', 'error');
    });

    const pos = this._sensor.position;
    if (!pos) { this.toast('Waiting for GPS fix…', 'error'); return; }

    this._openSheet('Drop a pin', this._addSheetHTML(pos));

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

  _addSheetHTML(pos) {
    const emojiBtns = UILayer.EMOJIS.map((e) =>
      `<button class="emoji-btn" data-emoji="${e}">${e}</button>`
    ).join('');

    return `
      <input id="pin-name" class="pin-name-input" type="text"
             placeholder="Name this pin…" maxlength="32" autocomplete="off" />
      <div class="emoji-grid">${emojiBtns}</div>
      <p class="coords-hint">📍 ${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}</p>
      <button id="btn-save-pin" class="btn-primary">Save pin</button>
    `;
  }

  _savePin(pos) {
    const nameEl  = this._sheetBody.querySelector('#pin-name');
    const emojiEl = this._sheetBody.querySelector('.emoji-btn.selected');
    const name    = nameEl?.value.trim();
    const emoji   = emojiEl?.dataset.emoji ?? '📍';

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
    if (!pins.length) { this.toast('No pins saved yet.'); return; }

    this._openSheet('My pins', this._listSheetHTML(pins));
    this._wireListButtons();
  }

  _refreshListInPlace() {
    const pins = this._getSortedPins();
    if (!pins.length) { this._closeSheet(); return; }
    this._sheetBody.innerHTML = this._listSheetHTML(pins);
    this._wireListButtons();
  }

  _getSortedPins() {
    const pins = this._store.getAll();
    const pos  = this._sensor.position;

    if (this._listSort === 'nearest' && pos) {
      return [...pins].sort((a, b) => {
        const da = NavEngine.distance(pos.lat, pos.lng, a.lat, a.lng);
        const db = NavEngine.distance(pos.lat, pos.lng, b.lat, b.lng);
        return da - db;
      });
    }
    return [...pins].sort((a, b) => b.createdAt - a.createdAt);
  }

  _listSheetHTML(pins) {
    const pos   = this._sensor.position;
    const sorted = this._getSortedPins();

    const items = sorted.map((p) => {
      const nav  = NavEngine.computeNav(pos, p);
      const dist = nav ? `<span class="pin-dist-label">${nav.distanceStr}</span>` : '';
      const age  = this._timeAgo(p.createdAt);
      // Convert hex color to rgba with low opacity for the emoji chip background
      const bgColor = this._hexToRgba(p.color, 0.18);

      return `
        <div class="pin-row">
          <div class="pin-emoji-wrap" style="--pin-row-color:${bgColor}">
            <span class="pin-emoji">${p.emoji}</span>
          </div>
          <div class="pin-info">
            <div class="pin-info-name">${this._esc(p.name)}</div>
            <div class="pin-info-meta">${dist}<span>${age}</span></div>
          </div>
          <div class="pin-actions">
            <button class="btn-navigate" data-navigate="${p.id}" aria-label="Navigate">
              <svg viewBox="0 0 24 24"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
            </button>
            <button class="btn-share" data-share="${p.id}" aria-label="Share">
              <svg viewBox="0 0 24 24"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
            </button>
            <button class="btn-delete" data-delete="${p.id}" aria-label="Delete">
              <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
            </button>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="list-sort-bar">
        <button class="sort-btn ${this._listSort === 'nearest' ? 'active' : ''}" data-sort="nearest">Nearest first</button>
        <button class="sort-btn ${this._listSort === 'newest'  ? 'active' : ''}" data-sort="newest">Newest first</button>
      </div>
      <div class="pin-list">${items}</div>
    `;
  }

  _wireListButtons() {
    // Sort toggle
    this._sheetBody.querySelectorAll('.sort-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this._listSort = btn.dataset.sort;
        this._refreshListInPlace();
      });
    });

    this._sheetBody.querySelectorAll('[data-navigate]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const pin = this._store.getById(btn.dataset.navigate);
        if (!pin) return;
        this._closeSheet();
        this.startNavigation(pin);
      });
    });

    this._sheetBody.querySelectorAll('[data-share]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const pin = this._store.getById(btn.dataset.share);
        if (pin) await this._doShare(pin);
      });
    });

    this._sheetBody.querySelectorAll('[data-delete]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const pin = this._store.getById(btn.dataset.delete);
        if (!pin) return;
        this._store.remove(pin.id);
        this.toast(`🗑 "${pin.name}" removed`);
        this._refreshListInPlace();
      });
    });
  }

  // ── Info sheet ────────────────────────────────────────────────────────────

  _openInfoSheet() {
    const rows = [
      ['📍', 'Tap <strong>+</strong> to save your current GPS location as a named pin.'],
      ['🎯',  'Floating beacons in the camera view point toward each saved pin.'],
      ['🧭', 'The compass pill shows all your pins\' directions relative to where you\'re facing.'],
      ['🗺',  'Tap <strong>Map</strong> to see all pins on a map. Tap Map again for the pin list.'],
      ['🔗', 'Tap <strong>Share</strong> on any pin to send a link — recipients get instant AR navigation.'],
      ['🟢', 'Banner and beacon turn green when you\'re within 5 m of your destination.'],
      ['🔒', 'All data stored locally on your device. No account, no backend.'],
    ];

    this._openSheet('About PinAR', rows.map(([icon, text]) => `
      <div class="info-row">
        <div class="info-icon">${icon}</div>
        <div class="info-text">${text}</div>
      </div>
    `).join(''));
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
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
  }

  _timeAgo(ts) {
    const m = Math.floor((Date.now() - ts) / 60_000);
    if (m < 1)  return 'Just now';
    if (m < 60) return `${m} min ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} hr ago`;
    return `${Math.floor(h / 24)} days ago`;
  }

  _hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
}
