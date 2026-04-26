/**
 * ARRenderer
 * Owns the A-Frame scene. Creates / updates / removes AR entities for each pin.
 * Listens to pins:changed and sensor:location to keep entities in sync.
 *
 * Each pin entity:
 *   gps-entity-place (world position) → wrapper
 *     a-cone  (arrow)      — pulses, turns green on arrival
 *     a-text  (name label) — face-camera component keeps it billboard
 *     a-text  (distance)   — face-camera component keeps it billboard
 */
class ARRenderer {
  static ENTITY_PREFIX = 'ar-pin-';
  static UPDATE_MS     = 500;

  constructor(store, sensor) {
    this._store    = store;
    this._sensor   = sensor;
    this._scene    = document.getElementById('ar-scene');
    this._timer    = null;
    this._entities = new Map(); // pinId → { el, arrived }
  }

  start() {
    this._registerComponents();

    window.addEventListener('pins:changed',    () => this._syncEntities());
    window.addEventListener('sensor:location', () => this._updateLabels());

    this._syncEntities();
    this._timer = setInterval(() => this._updateLabels(), ARRenderer.UPDATE_MS);
  }

  stop() {
    clearInterval(this._timer);
  }

  // ── Entity management ────────────────────────────────────────────────────

  _syncEntities() {
    const pins   = this._store.getAll();
    const pinIds = new Set(pins.map((p) => p.id));

    // Remove stale entities
    for (const [id, { el }] of this._entities) {
      if (!pinIds.has(id)) {
        el.parentNode?.removeChild(el);
        this._entities.delete(id);
      }
    }

    // Add new entities
    for (const pin of pins) {
      if (!this._entities.has(pin.id)) {
        const el = this._buildEntity(pin);
        this._scene.appendChild(el);
        this._entities.set(pin.id, { el, arrived: false });
      }
    }

    this._updateLabels();
  }

  _buildEntity(pin) {
    const wrap = document.createElement('a-entity');
    wrap.id = ARRenderer.ENTITY_PREFIX + pin.id;
    wrap.setAttribute('gps-entity-place', `latitude: ${pin.lat}; longitude: ${pin.lng}`);
    // distance-scale applied to wrapper so entire pin scales with GPS distance
    wrap.setAttribute('distance-scale', '');

    // Arrow — tip points upward (rotated cone), colored per pin
    const arrow = document.createElement('a-cone');
    arrow.setAttribute('color',         pin.color);
    arrow.setAttribute('radius-bottom', '0.5');
    arrow.setAttribute('radius-top',    '0');
    arrow.setAttribute('height',        '1.5');
    arrow.setAttribute('position',      '0 2.5 0');
    arrow.setAttribute('rotation',      '0 0 180');
    arrow.setAttribute('material',
      `color: ${pin.color}; emissive: ${pin.color}; emissiveIntensity: 0.3; opacity: 0.92; transparent: true`);
    arrow.setAttribute('animation__pulse',
      'property: scale; to: 1.15 1.15 1.15; dir: alternate; dur: 900; easing: easeInOutSine; loop: true');
    arrow.classList.add('pin-arrow');

    // Name label — face-camera makes it always face the user
    const nameText = document.createElement('a-text');
    nameText.setAttribute('value',    `${pin.emoji}  ${pin.name}`);
    nameText.setAttribute('color',    '#ffffff');
    nameText.setAttribute('align',    'center');
    nameText.setAttribute('width',    '6');
    nameText.setAttribute('position', '0 4.2 0');
    nameText.setAttribute('side',     'double');
    nameText.setAttribute('face-camera', '');
    nameText.classList.add('pin-name');

    // Distance label — face-camera keeps it readable
    const distText = document.createElement('a-text');
    distText.setAttribute('value',    '…');
    distText.setAttribute('color',    'rgba(255,255,255,0.8)');
    distText.setAttribute('align',    'center');
    distText.setAttribute('width',    '4');
    distText.setAttribute('position', '0 3.5 0');
    distText.setAttribute('side',     'double');
    distText.setAttribute('face-camera', '');
    distText.classList.add('pin-dist');

    wrap.appendChild(arrow);
    wrap.appendChild(nameText);
    wrap.appendChild(distText);

    return wrap;
  }

  _updateLabels() {
    const pos  = this._sensor.position;
    const pins = this._store.getAll();

    for (const pin of pins) {
      const entry = this._entities.get(pin.id);
      if (!entry) continue;

      const nav = NavEngine.computeNav(pos, pin);
      if (!nav) continue;

      const { el, arrived: wasArrived } = entry;
      const distEl  = el.querySelector('.pin-dist');
      const arrowEl = el.querySelector('.pin-arrow');

      if (distEl) distEl.setAttribute('value', nav.distanceStr);

      if (arrowEl && nav.arrived !== wasArrived) {
        // Only update material when arrived state changes — avoids thrashing
        entry.arrived = nav.arrived;

        if (nav.arrived) {
          arrowEl.setAttribute('material',
            'color: #30d158; emissive: #30d158; emissiveIntensity: 0.6; opacity: 0.95; transparent: true');
          arrowEl.setAttribute('animation__pulse',
            'property: scale; to: 1.3 1.3 1.3; dir: alternate; dur: 400; easing: easeInOutSine; loop: true');
        } else {
          arrowEl.setAttribute('material',
            `color: ${pin.color}; emissive: ${pin.color}; emissiveIntensity: 0.3; opacity: 0.92; transparent: true`);
          arrowEl.setAttribute('animation__pulse',
            'property: scale; to: 1.15 1.15 1.15; dir: alternate; dur: 900; easing: easeInOutSine; loop: true');
        }
      }
    }
  }

  // ── A-Frame custom components ─────────────────────────────────────────────

  _registerComponents() {
    if (!AFRAME.components['face-camera']) {
      AFRAME.registerComponent('face-camera', {
        tick() {
          const cam = document.querySelector('[gps-camera]');
          if (cam) this.el.object3D.lookAt(cam.object3D.position);
        },
      });
    }

    if (!AFRAME.components['distance-scale']) {
      // Scales the entity so pins far away stay legible and close pins aren't overwhelming.
      // Uses GPS world-space distance from camera. Clamped to [minDist, maxDist].
      AFRAME.registerComponent('distance-scale', {
        schema: {
          minDist:   { default: 10  },
          maxDist:   { default: 500 },
          scaleBase: { default: 50  }, // world units at which scale = 1
        },
        tick() {
          const cam = document.querySelector('[gps-camera]');
          if (!cam) return;
          const dist = this.el.object3D.position.distanceTo(cam.object3D.position);
          if (dist === 0) return;
          const clamped = Math.max(this.data.minDist, Math.min(this.data.maxDist, dist));
          const s = clamped / this.data.scaleBase;
          this.el.object3D.scale.set(s, s, s);
        },
      });
    }
  }
}
