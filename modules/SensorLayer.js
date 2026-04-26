/**
 * SensorLayer
 * Owns GPS and compass. Emits clean events; rest of app never touches raw APIs.
 *
 * Events emitted on window:
 *   sensor:location  → { lat, lng, accuracy }
 *   sensor:heading   → { heading }   (0–360, 0 = north)
 *   sensor:error     → { code, message }
 */
class SensorLayer {
  // EMA smoothing factor for compass heading (0 = no smoothing, 1 = frozen)
  static HEADING_ALPHA = 0.15;

  constructor() {
    this.lat      = null;
    this.lng      = null;
    this.accuracy = null;
    this.heading  = 0;

    this._watchId       = null;
    this._smoothHeading = null; // EMA state
    this._compassBound  = this._onCompass.bind(this);
  }

  /** Start GPS. Returns Promise that resolves on first fix. */
  start() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation not supported'));
        return;
      }

      let resolved = false;

      this._watchId = navigator.geolocation.watchPosition(
        (pos) => {
          this.lat      = pos.coords.latitude;
          this.lng      = pos.coords.longitude;
          this.accuracy = pos.coords.accuracy;

          this._emit('sensor:location', {
            lat:      this.lat,
            lng:      this.lng,
            accuracy: this.accuracy,
          });

          if (!resolved) {
            resolved = true;
            resolve({ lat: this.lat, lng: this.lng });
          }
        },
        (err) => {
          const msg = this._geoErrorMsg(err.code);
          this._emit('sensor:error', { code: err.code, message: msg });
          if (!resolved) reject(new Error(msg));
        },
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
      );

      this._startCompass();
    });
  }

  stop() {
    if (this._watchId !== null) {
      navigator.geolocation.clearWatch(this._watchId);
      this._watchId = null;
    }
    window.removeEventListener('deviceorientationabsolute', this._compassBound, true);
    window.removeEventListener('deviceorientation',         this._compassBound, true);
  }

  /** Current position snapshot — null until first GPS fix */
  get position() {
    if (this.lat === null) return null;
    return { lat: this.lat, lng: this.lng, accuracy: this.accuracy };
  }

  /**
   * Request iOS 13+ compass permission.
   * Must be called from a user gesture handler (button tap, etc.).
   * Returns Promise<'granted'|'denied'|'unavailable'>.
   */
  async requestCompassPermission() {
    if (typeof DeviceOrientationEvent === 'undefined' ||
        typeof DeviceOrientationEvent.requestPermission !== 'function') {
      return 'unavailable'; // Not needed on this platform
    }
    try {
      const state = await DeviceOrientationEvent.requestPermission();
      return state; // 'granted' | 'denied'
    } catch {
      return 'denied';
    }
  }

  // ── Private ──────────────────────────────────────────────────────────────

  _startCompass() {
    if ('ondeviceorientationabsolute' in window) {
      window.addEventListener('deviceorientationabsolute', this._compassBound, true);
    } else {
      window.addEventListener('deviceorientation', this._compassBound, true);
    }
    // iOS 13+ permission is NOT requested here automatically.
    // Call requestCompassPermission() from a user gesture (e.g. the first btn-add tap).
  }

  _onCompass(e) {
    let raw = null;

    if (e.webkitCompassHeading != null) {
      // iOS — already true north
      raw = e.webkitCompassHeading;
    } else if (e.absolute && e.alpha != null) {
      // Android absolute orientation
      raw = (360 - e.alpha) % 360;
    } else if (e.alpha != null) {
      raw = (360 - e.alpha) % 360;
    }

    if (raw === null) return;

    // Exponential moving average with circular-mean correction to handle 0°/360° wraparound
    if (this._smoothHeading === null) {
      this._smoothHeading = raw;
    } else {
      let diff = raw - this._smoothHeading;
      // Shortest arc
      if (diff >  180) diff -= 360;
      if (diff < -180) diff += 360;
      this._smoothHeading = (this._smoothHeading + SensorLayer.HEADING_ALPHA * diff + 360) % 360;
    }

    this.heading = this._smoothHeading;
    this._emit('sensor:heading', { heading: this.heading });
  }

  _emit(name, detail) {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }

  _geoErrorMsg(code) {
    return {
      1: 'Location permission denied. Enable in browser settings.',
      2: 'Location unavailable. Check GPS signal.',
      3: 'Location request timed out. Move to open area.',
    }[code] ?? 'Unknown location error.';
  }
}
