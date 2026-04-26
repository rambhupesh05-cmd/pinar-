/**
 * PinStore
 * Single source of truth for pin data. All persistence goes through here.
 *
 * Pin schema:
 *   { id, name, emoji, lat, lng, color, createdAt }
 *
 * Events emitted on window:
 *   pins:changed  → { pins }   (fired after every mutation)
 */
class PinStore {
  static STORAGE_KEY = 'pinar_pins_v1';

  static COLORS = [
    '#007aff', // blue
    '#ff9f0a', // amber
    '#30d158', // green
    '#ff453a', // red
    '#bf5af2', // purple
    '#ff375f', // pink
    '#40c8e0', // teal
  ];

  constructor() {
    this._pins = this._load();
  }

  // ── Read ─────────────────────────────────────────────────────────────────

  getAll() {
    return [...this._pins];
  }

  getById(id) {
    return this._pins.find((p) => p.id === id) ?? null;
  }

  get count() {
    return this._pins.length;
  }

  // ── Write ─────────────────────────────────────────────────────────────────

  /**
   * Add a new pin.
   * @param {{ name, emoji, lat, lng }} fields
   * @returns {Pin} the created pin
   */
  add({ name, emoji, lat, lng }) {
    this._validate({ name, lat, lng });

    const pin = {
      id:        this._uid(),
      name:      name.trim(),
      emoji:     emoji || '📍',
      lat:       +lat,
      lng:       +lng,
      color:     this._nextColor(),
      createdAt: Date.now(),
    };

    this._pins.push(pin);
    this._save();
    this._emit();
    return pin;
  }

  /**
   * Remove a pin by id.
   * @returns {boolean} true if removed
   */
  remove(id) {
    const before = this._pins.length;
    this._pins = this._pins.filter((p) => p.id !== id);
    if (this._pins.length === before) return false;
    this._save();
    this._emit();
    return true;
  }

  /**
   * Replace existing pins with an array (used by ShareModule to merge).
   * Skips duplicates by id.
   */
  merge(pinsToMerge) {
    const existingIds = new Set(this._pins.map((p) => p.id));
    for (const p of pinsToMerge) {
      if (!existingIds.has(p.id)) this._pins.push(p);
    }
    this._save();
    this._emit();
  }

  /**
   * Delete all pins — requires explicit confirmation string for safety.
   * @param {string} confirm must equal 'CLEAR_ALL'
   */
  clearAll(confirm) {
    if (confirm !== 'CLEAR_ALL') throw new Error('Pass CLEAR_ALL to confirm.');
    this._pins = [];
    this._save();
    this._emit();
  }

  // ── Private ──────────────────────────────────────────────────────────────

  _validate({ name, lat, lng }) {
    if (!name || !name.trim()) throw new Error('Pin name is required.');
    if (typeof lat !== 'number' || isNaN(lat)) throw new Error('Invalid latitude.');
    if (typeof lng !== 'number' || isNaN(lng)) throw new Error('Invalid longitude.');
    if (lat < -90 || lat > 90)   throw new Error('Latitude out of range.');
    if (lng < -180 || lng > 180) throw new Error('Longitude out of range.');
  }

  _load() {
    try {
      const raw = localStorage.getItem(PinStore.STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  _save() {
    try {
      localStorage.setItem(PinStore.STORAGE_KEY, JSON.stringify(this._pins));
    } catch (e) {
      // Storage quota exceeded — rare but handle gracefully
      console.warn('PinStore: could not save', e);
    }
  }

  _emit() {
    window.dispatchEvent(
      new CustomEvent('pins:changed', { detail: { pins: this.getAll() } })
    );
  }

  _uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  _nextColor() {
    // Rotate through palette — pick based on current count to avoid same consecutive color
    return PinStore.COLORS[this._pins.length % PinStore.COLORS.length];
  }
}
