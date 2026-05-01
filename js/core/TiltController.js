/**
 * TiltController — manages device accelerometer/orientation tilt controls.
 * Applies device beta/gamma angles as orbital tumble on mobile.
 * Can be toggled in settings.
 */

export class TiltController {
  constructor(EventBus) {
    this.eventBus = EventBus;
    this._enabled = false;
    this._permissionGranted = false;
    this._beta = 0;  // rotation around X-axis (-180 to 180)
    this._gamma = 0; // rotation around Y-axis (-90 to 90)
    this._isSupported = 'DeviceOrientationEvent' in window;
    this._isIOS13Plus = this._detectIOS13Plus();
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
   * Returns a Promise that resolves when permission is handled.
   */
  async requestPermissionAndEnable() {
    if (!this._isSupported) {
      console.warn('TiltController: DeviceOrientationEvent not supported');
      return false;
    }

    // iOS 13+ requires explicit user permission
    if (this._isIOS13Plus && typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
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
      // Non-iOS or older iOS: try to enable directly
      this.setEnabled(true);
      this._permissionGranted = true;
      return true;
    }
  }

  setEnabled(enabled) {
    if (!this._isSupported) return;

    if (enabled && !this._enabled) {
      this._enabled = true;
      window.addEventListener('deviceorientation', this._onDeviceOrientation);
      console.log('ℹ Tilt controls enabled');
    } else if (!enabled && this._enabled) {
      this._enabled = false;
      window.removeEventListener('deviceorientation', this._onDeviceOrientation);
      console.log('ℹ Tilt controls disabled');
    }
  }

  isEnabled() {
    return this._enabled;
  }

  isSupported() {
    return this._isSupported;
  }

  /**
   * Get current tilt as a rotation factor [0, 1] to apply to orbital tumble.
   * Beta/gamma are normalized: beta [-180, 180], gamma [-90, 90].
   * Combined magnitude (0 to ~180) is clamped to [0, 1].
   */
  getTiltFactor() {
    if (!this._enabled) return 0;
    const mag = Math.sqrt(this._beta * this._beta + this._gamma * this._gamma);
    return Math.min(1, mag / 180);
  }

  /**
   * Get the orientation angles.
   */
  getOrientation() {
    return { beta: this._beta, gamma: this._gamma };
  }

  _handleOrientation(event) {
    this._beta = event.beta || 0;   // X-axis tilt
    this._gamma = event.gamma || 0; // Y-axis tilt
  }

  _detectIOS13Plus() {
    if (!/iPad|iPhone|iPod/.test(navigator.userAgent)) return false;
    const match = navigator.userAgent.match(/OS (\d+)_/);
    if (!match) return false;
    const version = parseInt(match[1], 10);
    return version >= 13;
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
