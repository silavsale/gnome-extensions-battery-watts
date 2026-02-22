import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const UPOWER_SERVICE = 'org.freedesktop.UPower';
const UPOWER_PATH = '/org/freedesktop/UPower/devices/DisplayDevice';
const UPOWER_IFACE = 'org.freedesktop.UPower.Device';

const SLOT_WIDTH_PX = 52;

function formatWh(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return `${v.toFixed(1)} Wh`;
}

function formatPct(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return `${v.toFixed(0)}%`;
}

function formatSeconds(sec) {
  if (!sec || sec <= 0 || !Number.isFinite(sec)) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h <= 0) return `${m} min`;
  return `${h} h ${m} min`;
}

const BatteryWattsIndicator = GObject.registerClass(
class BatteryWattsIndicator extends PanelMenu.Button {
  _init() {
    super._init(0.0, 'Battery Watts');

    // Top-bar label
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
    this._label.clutter_text.set_x_align(Clutter.ActorAlign.CENTER);

    this._slot.add_child(this._label);
    this.add_child(this._slot);

    // Menu items (click dropdown)
    this._titleItem = new PopupMenu.PopupMenuItem('Battery', { reactive: false });
    this.menu.addMenuItem(this._titleItem);
    this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    this._energyLeftItem = new PopupMenu.PopupMenuItem('Energy left: …', { reactive: false });
    this._energyFullItem = new PopupMenu.PopupMenuItem('Full capacity: …', { reactive: false });
    this._percentItem = new PopupMenu.PopupMenuItem('Percent: …', { reactive: false });
    this._timeItem = new PopupMenu.PopupMenuItem('Time: …', { reactive: false });
    this._rateItem = new PopupMenu.PopupMenuItem('Rate: …', { reactive: false });

    this.menu.addMenuItem(this._energyLeftItem);
    this.menu.addMenuItem(this._energyFullItem);
    this.menu.addMenuItem(this._percentItem);
    this.menu.addMenuItem(this._timeItem);
    this.menu.addMenuItem(this._rateItem);

    // Optional: quick “Open Power Settings”
    this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    this.menu.addAction('Power Settings…', () => {
      Gio.AppInfo.launch_default_for_uri('gnome-control-center://power', null);
    });

    // UPower proxy
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
      const energyRateV = this._proxy.get_cached_property('EnergyRate');   // W
      const stateV = this._proxy.get_cached_property('State');            // 1=charging, 2=discharging
      const energyV = this._proxy.get_cached_property('Energy');          // Wh remaining
      const energyFullV = this._proxy.get_cached_property('EnergyFull');  // Wh full
      const percentV = this._proxy.get_cached_property('Percentage');     // %
      const tteV = this._proxy.get_cached_property('TimeToEmpty');        // seconds
      const ttfV = this._proxy.get_cached_property('TimeToFull');         // seconds

      const watts = energyRateV ? energyRateV.deepUnpack() : null;
      const state = stateV ? stateV.deepUnpack() : 0;
      const energy = energyV ? energyV.deepUnpack() : null;
      const energyFull = energyFullV ? energyFullV.deepUnpack() : null;
      const pct = percentV ? percentV.deepUnpack() : null;
      const tte = tteV ? tteV.deepUnpack() : 0;
      const ttf = ttfV ? ttfV.deepUnpack() : 0;

      // Top bar label (rate)
      if (watts === null) {
        this._label.set_text('…W');
      } else {
        let prefix = '';
        if (state === 1) prefix = '+';
        if (state === 2) prefix = '-';

        const absw = Math.abs(watts);
        const text = absw < 10
          ? `${prefix}${absw.toFixed(1)}W`
          : `${prefix}${absw.toFixed(0)}W`;
        this._label.set_text(text);
      }

      // Menu title + details
      const stateText =
        state === 1 ? 'Charging' :
        state === 2 ? 'Discharging' :
        'Idle';

      this._titleItem.label.set_text(`Battery (${stateText})`);
      this._energyLeftItem.label.set_text(`Energy left: ${formatWh(energy)}`);
      this._energyFullItem.label.set_text(`Full capacity: ${formatWh(energyFull)}`);
      this._percentItem.label.set_text(`Percent: ${formatPct(pct)}`);

      let timeText = '—';
      if (state === 2) timeText = formatSeconds(tte);
      if (state === 1) timeText = formatSeconds(ttf);
      this._timeItem.label.set_text(`Time: ${timeText}`);

      this._rateItem.label.set_text(
        `Rate: ${watts === null ? '—' : `${Math.abs(watts).toFixed(1)} W`}`
      );

    } catch (e) {
      this._label.set_text('ERR');
      // Avoid crashing menu updates if something goes wrong
      this._titleItem?.label?.set_text('Battery (Error)');
    }
  }
});

export default class BatteryWattsExtension extends Extension {
  enable() {
    this._indicator = new BatteryWattsIndicator();

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