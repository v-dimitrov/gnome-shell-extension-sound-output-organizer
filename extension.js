/*
    This file is part of Sound Output Organizer

    Sound Output Organizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    Sound Output Organizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with Sound Output Organizer.  If not, see <http://www.gnu.org/licenses/>.

    SPDX-FileCopyrightText: Valentin Dimitrov <valio86@gmail.com>
    SPDX-License-Identifier: GPL-3.0-or-later
*/

import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

export default class SoundOutputOrganizerExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._slider = null;
        this._originalAddDevice = null;
        this._originalSync = null;
        this._originalLabels = new Map(); // device id -> original label
        this._initId = null;
        // wait for quick settings to load async so we can patch them
        this._initId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._initId = null;
            this._initSlider();
            return GLib.SOURCE_REMOVE;
        });
    }

    disable() {
        if (this._initId !== null) {
            GLib.source_remove(this._initId);
            this._initId = null;
        }

        this._restoreSlider();
        this._settings.disconnectObject(this);

        this._originalLabels = null;
        this._settings = null;
    }

    _initSlider() {
        if (!Main.panel.statusArea.quickSettings || !Main.panel.statusArea.quickSettings._volumeOutput) return;

        const slider = Main.panel.statusArea.quickSettings._volumeOutput._output ?? null;
        if (!slider) {
            console.warn('The audio menu is not loaded. Aborting extension start.');
            return;
        }

        this._slider = slider;
        this._originalAddDevice = slider._addDevice.bind(slider);
        this._originalSync = slider._sync.bind(slider);

        // hijack stock GNOME events with our own to enforce the user settings
        slider._addDevice = id => this._onAddDevice(id);
        slider._sync = () => this._onSync();

        // apply current settings to devices that are already in the menu
        this._applyModifications();

        // reapply on settings change
        this._settings.connectObject('changed', () => this._applyModifications(), this);
    }

    _onAddDevice(id) {
        this._originalAddDevice(id);
        const item = this._slider._deviceItems.get(id);
        if (!item) return;

        const device = this._slider._control.lookup_output_id(id);
        if (!device) return;

        const key = this._getDeviceKey(device);

        // keep the original label to restore it on disable() or when custom name is removed
        if (!this._originalLabels.has(id)) this._originalLabels.set(id, item.label.text);

        this._applyToItem(id, item, key);
        this._updateMenuEnabled();
    }

    _onSync() {
        this._originalSync();
        this._updateMenuEnabled();
    }

    _applyModifications() {
        if (!this._slider || !this._slider._deviceItems) return;

        // loop all current device items and apply rename/hide settings
        for (const [id, item] of this._slider._deviceItems) {
            const device = this._slider._control.lookup_output_id(id);
            if (!device) continue;
            const key = this._getDeviceKey(device);
            if (!this._originalLabels.has(id)) this._originalLabels.set(id, item.label.text);
            this._applyToItem(id, item, key);
        }
        this._updateMenuEnabled();
    }

    _applyToItem(id, item, key) {
        const hiddenSinks = this._settings.get_strv('hidden-sinks');
        const renamedSinks = this._settings.get_value('renamed-sinks').deepUnpack();
        item.visible = !hiddenSinks.includes(key);
        const customName = renamedSinks[key];
        if (customName?.trim()) {
            item.label.text = customName.trim();
        }
        else if (this._originalLabels.has(id)) {
            item.label.text = this._originalLabels.get(id);
        }
    }

    _updateMenuEnabled() {
        if (!this._slider || !this._slider._deviceItems) return;
        const visibleCount = [...this._slider._deviceItems.values()].filter(i => i.visible).length;
        this._slider.menuEnabled = visibleCount > 1;
    }

    _getDeviceKey(device) {
        const description = device.get_description();
        const origin = device.get_origin();
        return origin ? `${description}|${origin}` : description;
    }

    _restoreSlider() {
        if (!this._slider) return;

        // revert to the original GNOME methods
        delete this._slider._addDevice;
        delete this._slider._sync;

        // restore devices to their original state
        if (this._slider._deviceItems) {
            for (const [id, item] of this._slider._deviceItems) {
                item.visible = true;
                if (this._originalLabels.has(id)) item.label.text = this._originalLabels.get(id);
            }
            // recalc menuEnabled
            this._slider._sync();
        }
        this._originalAddDevice = null;
        this._originalSync = null;
        this._slider = null;
    }
}

