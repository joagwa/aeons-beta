/**
 * TiltController — manages device accelerometer/orientation tilt controls.
 * Provides a movement vector for MoteController based on device beta/gamma angles.
 * Can be toggled in settings.
 */

export class TiltController {
  constructor(EventBus) {
    this.eventBus = EventBus;
    this._enabled = false;
    this._permissionGranted = false;
    this._beta = 0;            // rotation around X-axis (-180 to 180)
    this._gamma = 0;           // rotation around Y-axis (-90 to 90)
    this._calibrationBeta = 45;  // neutral beta when holding device upright
    this._calibrationGamma = 0;  // neutral gamma (centred)
    this._needsCalibration = false;
    this._isSupported = 'DeviceOrientationEvent' in window;
    // iOS 13+ requires an explicit permission prompt
    this._needsPermission = typeof DeviceOrientationEvent !== 'undefined' &&
                            typeof DeviceOrientationEvent.requestPermission === 'function';
    this._onDeviceOrientation = this._handleOrientation.bind(this);
  }

  init() {
    if (!this._isSupported) {
      console.log('ℹ TiltController: DeviceOrientationEvent not supported');
      return;
    }
    this.eventBus.on('settings:changed', (data) => this._onSettingsChanged(data));
  }

  /**
   * Request permission (iOS 13+) and enable tilt controls.
   * Returns a Promise<boolean> resolving true when permission is granted.
   */
  async requestPermissionAndEnable() {
    if (!this._isSupported) {
      console.warn('TiltController: DeviceOrientationEvent not supported');
      return false;
    }

    if (this._needsPermission) {
      try {
        const permission = await DeviceOrientationEvent.requestPermission();
        if (permission === 'granted') {
          this._permissionGranted = true;
          this.setEnabled(true);
          return true;
        } else {
          console.log('TiltController: Permission denied by user');
          return false;
        }
      } catch (e) {
        console.warn('TiltController: Permission request failed', e);
        return false;
      }
    } else {
      // Android and non-permission browsers: enable directly
      this.setEnabled(true);
      this._permissionGranted = true;
      return true;
    }
  }

  setEnabled(enabled) {
    if (!this._isSupported) return;

    if (enabled && !this._enabled) {
      this._enabled = true;
      this._needsCalibration = true; // capture neutral on first event
      window.addEventListener('deviceorientation', this._onDeviceOrientation);
      console.log('ℹ Tilt controls enabled');
    } else if (!enabled && this._enabled) {
      this._enabled = false;
      window.removeEventListener('deviceorientation', this._onDeviceOrientation);
      console.log('ℹ Tilt controls disabled');
    }
  }

  /** Recapture the current device angle as the neutral (zero-movement) position. */
  calibrate() {
    this._needsCalibration = true;
  }

  isEnabled() {
    return this._enabled;
  }

  isSupported() {
    return this._isSupported;
  }

  /**
   * Returns a movement vector {x, y} in [-1, 1] representing desired movement direction.
   * Dead zone: ±3°.  Full speed at ±25° tilt from calibrated neutral.
   * x = left/right (gamma), y = forward/back (beta, forward = up in game).
   */
  getMovementVector() {
    if (!this._enabled) return { x: 0, y: 0 };

    const DEAD_ZONE = 3;
    const FULL_TILT = 25;
    const RANGE = FULL_TILT - DEAD_ZONE;

    const rawX = this._gamma - this._calibrationGamma;
    // Tilt top of phone away (increasing beta) → move up → negative y in game coords
    const rawY = -(this._beta - this._calibrationBeta);

    const applyDeadZone = (v) => {
      if (Math.abs(v) < DEAD_ZONE) return 0;
      return Math.max(-1, Math.min(1, (v - Math.sign(v) * DEAD_ZONE) / RANGE));
    };

    return { x: applyDeadZone(rawX), y: applyDeadZone(rawY) };
  }

  _handleOrientation(event) {
    this._beta = event.beta || 0;
    this._gamma = event.gamma || 0;
    if (this._needsCalibration) {
      this._calibrationBeta = this._beta;
      this._calibrationGamma = this._gamma;
      this._needsCalibration = false;
    }
  }

  _onSettingsChanged({ key, value }) {
    if (key === 'tiltEnabled') {
      if (value && !this._enabled) {
        this.requestPermissionAndEnable();
      } else if (!value) {
        this.setEnabled(false);
      }
    }
  }
}
