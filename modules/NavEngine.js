/**
 * NavEngine
 * Pure math for distance and bearing. No state, no DOM, no events.
 * Every method is a static pure function — trivially testable.
 */
class NavEngine {

  /**
   * Haversine great-circle distance between two GPS points.
   * @returns distance in metres
   */
  static distance(lat1, lng1, lat2, lng2) {
    const R  = 6_371_000;
    const φ1 = NavEngine._rad(lat1);
    const φ2 = NavEngine._rad(lat2);
    const Δφ = NavEngine._rad(lat2 - lat1);
    const Δλ = NavEngine._rad(lng2 - lng1);

    const a =
      Math.sin(Δφ / 2) ** 2 +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;

    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /**
   * Initial bearing from point A → point B (0–360°, clockwise from north).
   */
  static bearing(lat1, lng1, lat2, lng2) {
    const φ1 = NavEngine._rad(lat1);
    const φ2 = NavEngine._rad(lat2);
    const Δλ = NavEngine._rad(lng2 - lng1);

    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x =
      Math.cos(φ1) * Math.sin(φ2) -
      Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);

    return (NavEngine._deg(Math.atan2(y, x)) + 360) % 360;
  }

  /**
   * Human-readable distance string.
   * <1 km  → "47 m"
   * ≥1 km  → "1.2 km"
   */
  static formatDistance(metres) {
    if (metres < 1000) return `${Math.round(metres)} m`;
    return `${(metres / 1000).toFixed(1)} km`;
  }

  /**
   * Is the user "arrived" at the pin?
   * Threshold: 5 m (GPS drift makes sub-5 m meaningless).
   */
  static isArrived(metres) {
    return metres <= 5;
  }

  /**
   * Compute all navigation info for a pin given current user position.
   * Returns null if user position unknown.
   *
   * @param {{ lat, lng }} userPos
   * @param {{ lat, lng }} pin
   * @returns {{ distanceM, distanceStr, bearing, arrived } | null}
   */
  static computeNav(userPos, pin) {
    if (!userPos) return null;

    const distanceM = NavEngine.distance(userPos.lat, userPos.lng, pin.lat, pin.lng);
    const bearing   = NavEngine.bearing(userPos.lat, userPos.lng, pin.lat, pin.lng);

    return {
      distanceM,
      distanceStr: NavEngine.formatDistance(distanceM),
      bearing,
      arrived: NavEngine.isArrived(distanceM),
    };
  }

  /**
   * Find the nearest pin to userPos.
   * @param {{ lat, lng }} userPos
   * @param {Array}        pins
   * @returns {{ pin, distanceM, distanceStr, bearing } | null}
   */
  static nearestPin(userPos, pins) {
    if (!userPos || !pins.length) return null;

    let nearest  = null;
    let minDist  = Infinity;

    for (const pin of pins) {
      const d = NavEngine.distance(userPos.lat, userPos.lng, pin.lat, pin.lng);
      if (d < minDist) {
        minDist = d;
        nearest = pin;
      }
    }

    const bearing = NavEngine.bearing(userPos.lat, userPos.lng, nearest.lat, nearest.lng);

    return {
      pin:         nearest,
      distanceM:   minDist,
      distanceStr: NavEngine.formatDistance(minDist),
      bearing,
    };
  }

  /**
   * Signed angle (degrees) from deviceHeading to pinBearing.
   * Positive = clockwise (right of forward), negative = counter-clockwise (left).
   * Range: -180 to +180.
   */
  static relativeBearing(pinBearing, deviceHeading) {
    let diff = pinBearing - deviceHeading;
    if (diff >  180) diff -= 360;
    if (diff < -180) diff += 360;
    return diff;
  }

  // ── Internals ─────────────────────────────────────────────────────────────
  static _rad(deg) { return (deg * Math.PI) / 180; }
  static _deg(rad) { return (rad * 180) / Math.PI; }
}
