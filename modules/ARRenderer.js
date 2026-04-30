/**
 * ARRenderer
 * Owns the A-Frame scene. Creates/updates/removes AR entities for each pin.
 *
 * Each pin entity (beacon design):
 *   gps-entity-place (world position) → wrapper
 *     a-cylinder   (vertical glowing beam)
 *     a-sphere     (bobbing orb at top of beam)
 *     a-ring       (pulsing ground ring)
 *     a-plane      (frosted glass card background, face-camera)
 *     a-text       (pin name + emoji, face-camera)
 *     a-text       (distance, face-camera)
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

  stop() { clearInterval(this._timer); }

  // ── Entity management ────────────────────────────────────────────────────

  _syncEntities() {
    const pins   = this._store.getAll();
    const pinIds = new Set(pins.map((p) => p.id));

    for (const [id, { el }] of this._entities) {
      if (!pinIds.has(id)) {
        el.parentNode?.removeChild(el);
        this._entities.delete(id);
      }
    }

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
    wrap.setAttribute('distance-scale', '');

    // ── Vertical glowing beam ────────────────────────────────────────────
    const beam = document.createElement('a-cylinder');
    beam.setAttribute('radius',   '0.04');
    beam.setAttribute('height',   '3.5');
    beam.setAttribute('position', '0 1.75 0');
    beam.setAttribute('material',
      `color: ${pin.color}; emissive: ${pin.color}; emissiveIntensity: 0.9;` +
      `opacity: 0.65; transparent: true; side: double`);
    beam.setAttribute('animation__glow',
      'property: material.opacity; from: 0.45; to: 0.78; dir: alternate; dur: 1600; easing: easeInOutSine; loop: true');
    beam.classList.add('pin-beam');

    // ── Bobbing orb at top of beam ────────────────────────────────────────
    const orb = document.createElement('a-sphere');
    orb.setAttribute('radius',   '0.18');
    orb.setAttribute('position', '0 3.7 0');
    orb.setAttribute('material',
      `color: ${pin.color}; emissive: ${pin.color}; emissiveIntensity: 1.1;` +
      `opacity: 0.92; transparent: true`);
    orb.setAttribute('animation__bob',
      'property: position; from: 0 3.7 0; to: 0 4.1 0; dir: alternate; dur: 1300; easing: easeInOutSine; loop: true');
    orb.setAttribute('animation__pulse',
      'property: scale; from: 1 1 1; to: 1.22 1.22 1.22; dir: alternate; dur: 1300; easing: easeInOutSine; loop: true');
    orb.classList.add('pin-orb');

    // ── Pulsing ground ring ───────────────────────────────────────────────
    const ring = document.createElement('a-ring');
    ring.setAttribute('radius-inner', '0.28');
    ring.setAttribute('radius-outer', '0.55');
    ring.setAttribute('position',     '0 0.05 0');
    ring.setAttribute('rotation',     '-90 0 0');
    ring.setAttribute('material',
      `color: ${pin.color}; emissive: ${pin.color}; emissiveIntensity: 0.5;` +
      `opacity: 0.55; transparent: true; side: double`);
    ring.setAttribute('animation__scale',
      'property: scale; from: 1 1 1; to: 1.7 1.7 1.7; dir: alternate; dur: 1600; easing: easeInOutSine; loop: true');
    ring.setAttribute('animation__fade',
      'property: material.opacity; from: 0.55; to: 0; dir: alternate; dur: 1600; easing: easeInOutSine; loop: true');
    ring.classList.add('pin-ring');

    // ── Label background card (frosted glass effect via dark plane) ──────
    const card = document.createElement('a-plane');
    card.setAttribute('width',    '2.8');
    card.setAttribute('height',   '0.72');
    card.setAttribute('position', '0 5.0 -0.01');
    card.setAttribute('material',
      'color: #111114; opacity: 0.78; transparent: true; side: double');
    card.setAttribute('face-camera', '');
    card.classList.add('pin-card');

    // ── Name + emoji label ────────────────────────────────────────────────
    const nameText = document.createElement('a-text');
    nameText.setAttribute('value',    `${pin.emoji}  ${pin.name}`);
    nameText.setAttribute('color',    '#ffffff');
    nameText.setAttribute('align',    'center');
    nameText.setAttribute('width',    '5.5');
    nameText.setAttribute('position', '0 5.05 0.01');
    nameText.setAttribute('side',     'double');
    nameText.setAttribute('face-camera', '');
    nameText.classList.add('pin-name');

    // ── Distance label ────────────────────────────────────────────────────
    const distText = document.createElement('a-text');
    distText.setAttribute('value',    '…');
    distText.setAttribute('color',    'rgba(200,200,210,0.85)');
    distText.setAttribute('align',    'center');
    distText.setAttribute('width',    '3.5');
    distText.setAttribute('position', '0 4.55 0.01');
    distText.setAttribute('side',     'double');
    distText.setAttribute('face-camera', '');
    distText.classList.add('pin-dist');

    wrap.appendChild(beam);
    wrap.appendChild(orb);
    wrap.appendChild(ring);
    wrap.appendChild(card);
    wrap.appendChild(nameText);
    wrap.appendChild(distText);

    return wrap;
  }

  // ── Label updates + arrived state ─────────────────────────────────────────

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
      const beamEl  = el.querySelector('.pin-beam');
      const orbEl   = el.querySelector('.pin-orb');
      const ringEl  = el.querySelector('.pin-ring');

      if (distEl) distEl.setAttribute('value', nav.distanceStr);

      if (nav.arrived !== wasArrived) {
        entry.arrived = nav.arrived;

        if (nav.arrived) {
          // Turn everything green on arrival
          const arrivedMat = 'color: #32d74b; emissive: #32d74b;';
          if (beamEl) {
            beamEl.setAttribute('material', `${arrivedMat} emissiveIntensity: 1.1; opacity: 0.8; transparent: true; side: double`);
            beamEl.setAttribute('animation__glow', 'property: material.opacity; from: 0.6; to: 0.95; dir: alternate; dur: 500; easing: easeInOutSine; loop: true');
          }
          if (orbEl) {
            orbEl.setAttribute('material', `${arrivedMat} emissiveIntensity: 1.3; opacity: 0.96; transparent: true`);
            orbEl.setAttribute('animation__pulse', 'property: scale; from: 1 1 1; to: 1.5 1.5 1.5; dir: alternate; dur: 500; easing: easeInOutSine; loop: true');
          }
          if (ringEl) {
            ringEl.setAttribute('material', `${arrivedMat} emissiveIntensity: 0.8; opacity: 0.7; transparent: true; side: double`);
          }
        } else {
          // Restore pin color
          const mat = `color: ${pin.color}; emissive: ${pin.color};`;
          if (beamEl) {
            beamEl.setAttribute('material', `${mat} emissiveIntensity: 0.9; opacity: 0.65; transparent: true; side: double`);
            beamEl.setAttribute('animation__glow', 'property: material.opacity; from: 0.45; to: 0.78; dir: alternate; dur: 1600; easing: easeInOutSine; loop: true');
          }
          if (orbEl) {
            orbEl.setAttribute('material', `${mat} emissiveIntensity: 1.1; opacity: 0.92; transparent: true`);
            orbEl.setAttribute('animation__pulse', 'property: scale; from: 1 1 1; to: 1.22 1.22 1.22; dir: alternate; dur: 1300; easing: easeInOutSine; loop: true');
          }
          if (ringEl) {
            ringEl.setAttribute('material', `${mat} emissiveIntensity: 0.5; opacity: 0.55; transparent: true; side: double`);
          }
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
      AFRAME.registerComponent('distance-scale', {
        schema: {
          minDist:   { default: 10  },
          maxDist:   { default: 500 },
          scaleBase: { default: 50  },
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
