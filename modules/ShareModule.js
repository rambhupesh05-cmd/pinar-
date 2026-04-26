/**
 * ShareModule
 * Encodes a pin as a URL query param and decodes incoming shared URLs.
 * Handles native share sheet + clipboard fallback.
 *
 * URL format:  https://pinar.app/?pin=<base64url_encoded_json>
 *
 * Payload shape (compact keys to keep URL short):
 *   { n: name, e: emoji, a: lat, o: lng }
 *   Note: color is NOT included — the receiver's PinStore assigns a fresh palette color.
 */
class ShareModule {

  constructor(store) {
    this._store = store;
  }

  /**
   * Encode a pin into a shareable URL string.
   * @param {object} pin
   * @returns {string} full URL
   */
  encode(pin) {
    const payload = {
      n: pin.name,
      e: pin.emoji,
      a: +pin.lat.toFixed(7),
      o: +pin.lng.toFixed(7),
    };

    const b64  = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    const url  = new URL(window.location.href);
    url.search = '';
    url.hash   = '';
    url.searchParams.set('pin', b64);

    return url.toString();
  }

  /**
   * Decode a shared URL. Returns a partial pin object (no id/color/createdAt).
   * Returns null if URL has no valid pin param.
   */
  decode(urlStr = window.location.href) {
    try {
      const url = new URL(urlStr);
      const b64 = url.searchParams.get('pin');
      if (!b64) return null;

      const json    = decodeURIComponent(escape(atob(b64)));
      const payload = JSON.parse(json);

      if (typeof payload.n !== 'string' || payload.a == null || payload.o == null) return null;

      const lat = +payload.a;
      const lng = +payload.o;

      if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return null;
      }

      return {
        name:  payload.n.slice(0, 64), // guard against absurdly long names
        emoji: typeof payload.e === 'string' ? payload.e : '📍',
        lat,
        lng,
      };
    } catch {
      return null;
    }
  }

  /**
   * Check if the current page was opened with a shared pin URL.
   * Cleans the URL immediately so a refresh doesn't re-trigger.
   * @param {Function} onFound  called with (pin) when a shared pin is detected
   */
  checkIncoming(onFound) {
    const pin = this.decode();
    if (!pin) return;

    // Remove ?pin= from history before any async work
    const clean = new URL(window.location.href);
    clean.searchParams.delete('pin');
    window.history.replaceState({}, '', clean.toString());

    onFound(pin);
  }

  /**
   * Native share sheet with clipboard fallback.
   * @returns {Promise<'shared'|'copied'|'cancelled'|'failed'>}
   */
  async share(pin) {
    const url  = this.encode(pin);
    const text = `Find "${pin.name}" — open PinAR to navigate there in AR`;

    if (navigator.share) {
      try {
        await navigator.share({ title: 'PinAR', text, url });
        return 'shared';
      } catch (e) {
        if (e.name === 'AbortError') return 'cancelled';
        // Fall through to clipboard on other errors
      }
    }

    const copied = await this.copyToClipboard(url);
    return copied ? 'copied' : 'failed';
  }

  /**
   * Copy text to clipboard. Returns Promise<boolean>.
   */
  async copyToClipboard(text) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
      // Fallback for older browsers / non-HTTPS dev environments
      const el = document.createElement('textarea');
      el.value = text;
      el.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
      document.body.appendChild(el);
      el.focus();
      el.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(el);
      return ok;
    } catch {
      return false;
    }
  }
}
