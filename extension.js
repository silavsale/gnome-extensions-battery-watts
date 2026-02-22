import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

const UPOWER_SERVICE = 'org.freedesktop.UPower';
// More stable than battery_BAT0 across machines:
const UPOWER_PATH = '/org/freedesktop/UPower/devices/DisplayDevice';
const UPOWER_IFACE = 'org.freedesktop.UPower.Device';

// Fixed width so "+3W" and "-120W" don't visually shift
const SLOT_WIDTH_PX = 52;

const BatteryWattsIndicator = GObject.registerClass(
class BatteryWattsIndicator extends PanelMenu.Button {
  _init() {
    super._init(0.0, 'Battery Watts');

    // Fixed-width slot + centered label
    this._slot = new St.BoxLayout({
      x_expand: false,
      y_expand: false,
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
      style: `min-width: ${SLOT_WIDTH_PX}px;`,
    });

    this._label = new St.Label({
      text: '…W',
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
    });

    // Ensure optical centering
    this._label.clutter_text.set_x_align(Clutter.ActorAlign.CENTER);

    this._slot.add_child(this._label);
    this.add_child(this._slot);

    this._proxy = Gio.DBusProxy.new_for_bus_sync(
      Gio.BusType.SYSTEM,
      Gio.DBusProxyFlags.NONE,
      null,
      UPOWER_SERVICE,
      UPOWER_PATH,
      UPOWER_IFACE,
      null
    );

    this._changedId = this._proxy.connect('g-properties-changed', () => this._update());

    this._update();
    this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
      this._update();
      return GLib.SOURCE_CONTINUE;
    });
  }

  destroy() {
    if (this._timerId) {
      GLib.source_remove(this._timerId);
      this._timerId = 0;
    }
    if (this._proxy && this._changedId) {
      this._proxy.disconnect(this._changedId);
      this._changedId = 0;
    }
    this._proxy = null;
    super.destroy();
  }

  _update() {
    try {
      const v = this._proxy.get_cached_property('EnergyRate');
      const s = this._proxy.get_cached_property('State');

      if (!v) {
        this._label.set_text('…W');
        return;
      }

      const watts = v.deepUnpack();
      const state = s ? s.deepUnpack() : 0;

      // UPower: 1=charging, 2=discharging (typical)
      let prefix = '';
      if (state === 1) prefix = '+';
      if (state === 2) prefix = '-';

      const absw = Math.abs(watts);
      const text = absw < 10
        ? `${prefix}${absw.toFixed(1)}W`
        : `${prefix}${absw.toFixed(0)}W`;

      this._label.set_text(text);
    } catch (e) {
      this._label.set_text('ERR');
    }
  }
});

export default class BatteryWattsExtension extends Extension {
  enable() {
    this._indicator = new BatteryWattsIndicator();

    // Correct GNOME way to add panel items (prevents GType issues)
    Main.panel.addToStatusArea('battery-watts', this._indicator, 0, 'center');

    // Ensure it's left of the clock in the center box
    const center = Main.panel._centerBox;
    if (center && this._indicator.get_parent() === center) {
      center.remove_child(this._indicator);
      center.insert_child_at_index(this._indicator, 0);
    }
  }

  disable() {
    if (this._indicator) {
      this._indicator.destroy();
      this._indicator = null;
    }
  }
}
