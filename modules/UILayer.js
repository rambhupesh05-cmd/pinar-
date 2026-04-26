/**
 * UILayer
 * Owns all DOM interaction. Never does data work directly — delegates to store/share.
 *
 * Responsibilities:
 *  - Bottom sheet (add pin, pin list, about, shared-pin confirm)
 *  - GPS badge
 *  - Nav banner (nearest pin name + distance + bearing arrow)
 *  - Compass strip (canvas, showing pin directions)
 *  - Empty state
 *  - Toast notifications
 *  - Pin count badge on list button
 */
class UILayer {
  static EMOJIS = ['📍','🚲','🎒','🍕','🏠','⭐','🏫','🚗','🏋️','☕','🧪','🛒'];

  // Compass strip field-of-view in degrees
  static COMPASS_FOV = 120;

  constructor(store, sensor, share) {
    this._store  = store;
    this._sensor = sensor;
    this._share  = share;

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

    this._toastTimer    = null;
    this._currentHeading = 0;
    this._compassReady  = false; // becomes true after first heading event
  }

  start() {
    document.getElementById('btn-add').addEventListener('click',  () => this._onAddTap());
    document.getElementById('btn-list').addEventListener('click', () => this._openListSheet());
    document.getElementById('btn-info').addEventListener('click', () => this._openInfoSheet());
    this._overlay.addEventListener('click', () => this._closeSheet());

    window.addEventListener('sensor:location', (e) => this._onLocation(e.detail));
    window.addEventListener('sensor:heading',  (e) => this._onHeading(e.detail));
    window.addEventListener('sensor:error',    (e) => this.toast(e.detail.message, 'error'));
    window.addEventListener('pins:changed',    (e) => this._onPinsChanged(e.detail.pins));

    // Size the compass canvas to device pixels
    this._initCompassCanvas();
    window.addEventListener('resize', () => this._initCompassCanvas());

    // Initial render
    this._onPinsChanged(this._store.getAll());
  }

  toast(msg, type = 'info') {
    clearTimeout(this._toastTimer);
    this._toast.textContent = type === 'error' ? '⚠️  ' + msg : msg;
    this._toast.classList.add('show');
    this._toastTimer = setTimeout(() => this._toast.classList.remove('show'), 3200);
  }

  /**
   * Open the "Someone shared a pin with you" confirmation sheet.
   * Called from app.js instead of window.confirm().
   */
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
      <button class="btn-secondary" id="btn-dismiss-shared">Dismiss</button>
    `);

    this._sheetBody.querySelector('#btn-accept-shared').addEventListener('click', () => {
      this._closeSheet();
      onAccept();
    });
    this._sheetBody.querySelector('#btn-dismiss-shared').addEventListener('click', () => {
      this._closeSheet();
    });
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

    this._updateNavBanner();
    this._drawCompass();
  }

  // ── Nav banner (nearest pin) ──────────────────────────────────────────────

  _updateNavBanner() {
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

  _updateNavBannerArrow(pinBearing) {
    if (pinBearing === undefined) {
      // Recalculate from current nearest pin
      const pos  = this._sensor.position;
      const pins = this._store.getAll();
      const info = NavEngine.nearestPin(pos, pins);
      if (!info) return;
      pinBearing = info.bearing;
    }

    const rel = NavEngine.relativeBearing(pinBearing, this._currentHeading);
    // Rotate the arrow glyph to point toward the pin relative to current heading
    this._navArrow.style.transform = `rotate(${rel}deg)`;
  }

  // ── Compass strip (canvas) ────────────────────────────────────────────────

  _initCompassCanvas() {
    const canvas = document.getElementById('compass-canvas');
    if (!canvas) return;
    // Match physical pixel ratio for sharp rendering on retina screens
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

    const dpr = window.devicePixelRatio || 1;
    const W   = canvas.offsetWidth;
    const H   = canvas.offsetHeight;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);

    const heading       = this._currentHeading;
    const FOV           = UILayer.COMPASS_FOV;
    const pixelsPerDeg  = W / FOV;
    const centerX       = W / 2;

    // Background strip
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, 'rgba(0,0,0,0)');
    bg.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Compass ticks and cardinal labels
    const cardinals = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    for (let deg = -180; deg <= 180 + FOV; deg += 5) {
      const absolute = ((heading - FOV / 2 + deg) + 360) % 360;
      const roundAbs = Math.round(absolute / 5) * 5 % 360;
      const x = centerX + (deg - FOV / 2) * pixelsPerDeg;

      if (x < -20 || x > W + 20) continue;

      const isMajor    = roundAbs % 45 === 0;
      const isCardinal = roundAbs % 90 === 0;
      const tickH      = isMajor ? 14 : 7;

      ctx.beginPath();
      ctx.moveTo(x, H - tickH - 14);
      ctx.lineTo(x, H - 14);
      ctx.strokeStyle = isMajor
        ? 'rgba(255,255,255,0.7)'
        : 'rgba(255,255,255,0.3)';
      ctx.lineWidth = isMajor ? 1.5 : 1;
      ctx.stroke();

      if (isCardinal && cardinals[roundAbs]) {
        ctx.fillStyle  = roundAbs === 0 ? '#ff453a' : 'rgba(255,255,255,0.8)';
        ctx.font       = `bold 11px -apple-system, sans-serif`;
        ctx.textAlign  = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(cardinals[roundAbs], x, H - 28);
      }
    }

    // Pin markers on the compass
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

      // Dot
      ctx.beginPath();
      ctx.arc(x, H - 7, 5, 0, Math.PI * 2);
      ctx.fillStyle = pin.color;
      ctx.fill();

      // Emoji above dot (only when there's horizontal room)
      if (Math.abs(diff) < FOV / 2 + 5) {
        ctx.font         = '13px serif';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(pin.emoji, x, H - 14);
      }
    }

    // Centre reticle line
    ctx.beginPath();
    ctx.moveTo(centerX, 0);
    ctx.lineTo(centerX, H);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth   = 1;
    ctx.setLineDash([3, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Centre triangle pointer (your heading)
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

  /** Called on btn-add tap — also requests compass permission on iOS if needed. */
  _onAddTap() {
    // Request iOS compass permission on first user gesture
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
      // Force reflow to restart animation
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

  /** Refresh the list content in-place without re-opening the sheet. */
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

    this._sheetBody.querySelectorAll('[data-share]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id  = btn.dataset.share;
        const pin = this._store.getById(id);
        if (!pin) return;

        const result = await this._share.share(pin);
        if (result === 'shared')    this.toast('📤 Shared!');
        else if (result === 'copied') this.toast('🔗 Link copied!');
        else if (result === 'failed') this.toast('Could not copy link.', 'error');
        // 'cancelled' = user dismissed native sheet; no toast needed
      });
    });
  }

  _listSheetHTML(pins) {
    const pos   = this._sensor.position;
    const items = pins.map((p) => {
      const nav    = NavEngine.computeNav(pos, p);
      const dist   = nav ? `<span class="pin-dist">${nav.distanceStr}</span>` : '';
      const age    = this._timeAgo(p.createdAt);

      return `
        <div class="pin-row">
          <span class="pin-emoji">${p.emoji}</span>
          <div class="pin-info">
            <div class="pin-info-name">${this._esc(p.name)}</div>
            <div class="pin-info-meta">${dist}<span>${age}</span></div>
          </div>
          <div class="pin-actions">
            <button class="btn-share"  data-share="${p.id}">Share</button>
            <button class="btn-delete" data-delete="${p.id}">Delete</button>
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
      <div class="info-row"><div class="info-icon">🧭</div><div class="info-text">The compass strip at the bottom shows all your pins' directions relative to where you're facing.</div></div>
      <div class="info-row"><div class="info-icon">🔗</div><div class="info-text">Tap <strong style="color:#fff">Share</strong> on any pin to send a link. Your friend opens it and gets instant AR navigation.</div></div>
      <div class="info-row"><div class="info-icon">🟢</div><div class="info-text">Arrow turns green when you're within 5 m of the pin.</div></div>
      <div class="info-row"><div class="info-icon">🔒</div><div class="info-text">All data stored locally on your device. No account, no backend.</div></div>
    `);
  }

  // ── Haptic feedback ───────────────────────────────────────────────────────

  _haptic(style = 'light') {
    // Vibration API — supported on Android, ignored on iOS (uses Haptic Engine natively)
    if (!navigator.vibrate) return;
    const patterns = { light: [10], medium: [20], heavy: [30, 10, 30] };
    navigator.vibrate(patterns[style] ?? patterns.light);
  }

  // ── Utils ─────────────────────────────────────────────────────────────────

  _esc(str) {
    return String(str).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  _timeAgo(ts) {
    const m = Math.floor((Date.now() - ts) / 60_000);
    if (m < 1)   return 'Just now';
    if (m < 60)  return `${m} min ago`;
    const h = Math.floor(m / 60);
    if (h < 24)  return `${h} hr ago`;
    return `${Math.floor(h / 24)} days ago`;
  }
}
