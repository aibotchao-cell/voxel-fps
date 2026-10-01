// ---------------------------------------------------------------------------
// Input: iPad touch (left = joystick, right = look, buttons) + desktop KB/M.
// ---------------------------------------------------------------------------

const LOOK_SENS = 0.0032;     // radians per pixel
const JOY_RADIUS = 52;        // px

export class Controls {
  constructor(root, canvas) {
    this.root = root;
    this.canvas = canvas;

    this.state = {
      moveX: 0, moveZ: 0,   // -1..1
      firing: false,
      jump: false,
      reloadQueued: false,
      switchQueued: -1,
      aiming: false,        // sniper scope
    };
    this.onLook = null; // (dYaw, dPitch)

    this._aimToggle = false;   // tap-to-toggle (iPad)
    this._aimHold = false;     // hold (right mouse / Shift)
    this._aimBtn = document.getElementById('btn-aim');

    this._pointers = new Map();   // pointerId -> role info
    this._joyId = null;
    this._joyOrigin = { x: 0, y: 0 };

    this._bindTouch();
    this._bindKeyboard();
    this._bindButtons();
  }

  // ------------------------------- touch ---------------------------------
  _bindTouch() {
    const el = this.root;

    el.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.tbtn') || e.target.closest('.wbtn')) return; // buttons handle themselves
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (e.clientX < w * 0.45) {
        // joystick
        if (this._joyId !== null) return;
        this._joyId = e.pointerId;
        this._joyOrigin = { x: e.clientX, y: e.clientY };
        this._pointers.set(e.pointerId, { role: 'joy' });
        this._showJoy(e.clientX, e.clientY);
      } else {
        // look
        this._pointers.set(e.pointerId, { role: 'look', x: e.clientX, y: e.clientY });
      }
      e.preventDefault();
    }, { passive: false });

    el.addEventListener('pointermove', (e) => {
      const p = this._pointers.get(e.pointerId);
      if (!p) return;
      if (p.role === 'joy') {
        let dx = e.clientX - this._joyOrigin.x;
        let dy = e.clientY - this._joyOrigin.y;
        const len = Math.hypot(dx, dy);
        if (len > JOY_RADIUS) { dx = (dx / len) * JOY_RADIUS; dy = (dy / len) * JOY_RADIUS; }
        this._moveKnob(dx, dy);
        this.state.moveX = dx / JOY_RADIUS;
        this.state.moveZ = -dy / JOY_RADIUS;   // up on screen = forward
      } else if (p.role === 'look') {
        const ddx = e.clientX - p.x;
        const ddy = e.clientY - p.y;
        p.x = e.clientX; p.y = e.clientY;
        if (this.onLook) this.onLook(-ddx * LOOK_SENS, -ddy * LOOK_SENS);
      }
      e.preventDefault();
    }, { passive: false });

    const end = (e) => {
      const p = this._pointers.get(e.pointerId);
      if (!p) return;
      if (p.role === 'joy') {
        this._joyId = null;
        this.state.moveX = 0; this.state.moveZ = 0;
        this._hideJoy();
      }
      this._pointers.delete(e.pointerId);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('pointerleave', end);
  }

  _showJoy(x, y) {
    const base = document.getElementById('joy-base');
    if (!base) return;
    base.classList.remove('hidden');
    base.style.left = x + 'px';
    base.style.top = y + 'px';
    this._moveKnob(0, 0);
  }
  _moveKnob(dx, dy) {
    const k = document.getElementById('joy-knob');
    if (!k) return;
    k.style.transform = `translate(${dx}px, ${dy}px)`;
  }
  _hideJoy() {
    const base = document.getElementById('joy-base');
    if (base) base.classList.add('hidden');
  }

  // ------------------------------ buttons --------------------------------
  _bindButtons() {
    const hold = (id, on, off) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('pointerdown', (e) => { e.stopPropagation(); el.classList.add('active'); on(); e.preventDefault(); }, { passive: false });
      el.addEventListener('pointerup', (e) => { e.stopPropagation(); el.classList.remove('active'); if (off) off(); });
      el.addEventListener('pointercancel', (e) => { e.stopPropagation(); el.classList.remove('active'); if (off) off(); });
      el.addEventListener('pointerleave', (e) => { el.classList.remove('active'); if (off) off(); });
    };

    hold('btn-fire', () => { this.state.firing = true; }, () => { this.state.firing = false; });
    hold('btn-jump', () => { this.state.jump = true; }, () => { this.state.jump = false; });
    hold('btn-reload', () => { this.state.reloadQueued = true; });

    // 瞄準 / scope: a TAP toggles it (you can't hold two buttons + aim on a tablet)
    const aim = this._aimBtn;
    if (aim) {
      aim.addEventListener('pointerdown', (e) => {
        e.stopPropagation(); e.preventDefault();
        this._aimToggle = !this._aimToggle;
        aim.classList.toggle('active', this._aimToggle);
      }, { passive: false });
    }

    document.querySelectorAll('.wbtn').forEach((el) => {
      el.addEventListener('pointerdown', (e) => {
        e.stopPropagation(); e.preventDefault();
        this.state.switchQueued = parseInt(el.dataset.w, 10);
      }, { passive: false });
    });
  }

  setActiveWeapon(i) {
    document.querySelectorAll('.wbtn').forEach((el) => {
      el.classList.toggle('active', parseInt(el.dataset.w, 10) === i);
    });
  }

  // ------------------------------ keyboard -------------------------------
  _bindKeyboard() {
    const keys = {};
    this._keys = keys;

    window.addEventListener('keydown', (e) => {
      keys[e.code] = true;
      if (e.code === 'KeyR') this.state.reloadQueued = true;
      if (e.code === 'Digit1') this.state.switchQueued = 0;
      if (e.code === 'Digit2') this.state.switchQueued = 1;
      if (e.code === 'Digit3') this.state.switchQueued = 2;
      if (e.code === 'Digit4') this.state.switchQueued = 3;
      if (e.code === 'Digit5') this.state.switchQueued = 4;
      if (e.code === 'Digit6') this.state.switchQueued = 5;
      if (e.code === 'Digit7') this.state.switchQueued = 6;
      if (e.code === 'Digit8') this.state.switchQueued = 7;
      if (e.code === 'Digit9') this.state.switchQueued = 8;
      if (e.code === 'Digit0') this.state.switchQueued = 9;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this._aimHold = true;
    });
    window.addEventListener('keyup', (e) => {
      keys[e.code] = false;
      if (e.code === 'Space') this.state.jump = false;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this._aimHold = false;
    });

    // mouse look via pointer lock
    this.canvas.addEventListener('click', () => {
      if (!document.pointerLockElement) this.canvas.requestPointerLock?.();
    });
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === this.canvas && this.onLook) {
        this.onLook(-e.movementX * 0.0022, -e.movementY * 0.0022);
      }
    });
    document.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.state.firing = true;
      if (e.button === 2) this._aimHold = true;      // right mouse = scope
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.state.firing = false;
      if (e.button === 2) this._aimHold = false;
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // merge keyboard into state (called each frame)
  poll() {
    const k = this._keys;
    if (!k) return this.state;
    let kx = 0, kz = 0;
    if (k['KeyW'] || k['ArrowUp']) kz += 1;
    if (k['KeyS'] || k['ArrowDown']) kz -= 1;
    if (k['KeyA'] || k['ArrowLeft']) kx -= 1;
    if (k['KeyD'] || k['ArrowRight']) kx += 1;
    // keyboard takes over only if no touch joystick active
    if (this._joyId === null && (kx !== 0 || kz !== 0)) {
      this.state.moveX = kx;
      this.state.moveZ = kz;
    }
    // keyboard jump mirror
    if (k['Space']) this.state.jump = true;

    // sniper scope: right mouse / Shift held, or the on-screen 瞄準 toggle
    this.state.aiming = this._aimHold || this._aimToggle;

    return this.state;
  }

  // called by main.js whenever the sniper is NOT the active weapon
  clearAim() {
    if (!this._aimHold && !this._aimToggle) return;
    this._aimHold = false;
    this._aimToggle = false;
    this.state.aiming = false;
    if (this._aimBtn) this._aimBtn.classList.remove('active');
  }

  setAimAvailable(on) {
    if (this._aimBtn) this._aimBtn.classList.toggle('hidden', !on);
  }

  consumeReload() { const v = this.state.reloadQueued; this.state.reloadQueued = false; return v; }
  consumeSwitch() { const v = this.state.switchQueued; this.state.switchQueued = -1; return v; }
}
