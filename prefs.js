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
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class SoundOutputOrganizerPreferences extends ExtensionPreferences {

    fillPreferencesWindow(window) {
        window.set_default_size(640, 480);
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage({
            title: 'Devices',
            icon_name: 'audio-speakers-symbolic',
        });
        window.add(page);

        const group = new Adw.PreferencesGroup({
            title: 'Sound Output Devices',
            description: 'Hide or rename audio devices in your Quick Settings menu:',
        });
        page.add(group);

        let devices = [];
        if (GLib.find_program_in_path('pactl')) {
            const proc = Gio.Subprocess.new(['pactl', '--format=json', 'list', 'cards'], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
            const stdout = proc.communicate_utf8(null, null)[1];
            if (stdout && stdout.trimStart().startsWith('[')) {
                devices = this._parseCards(stdout);
            }
        }
        if (devices.length < 1) {
            group.add(new Adw.ActionRow({
                title: 'No sound output devices found',
                subtitle: 'Make sure PipeWire / PulseAudio is running',
            }));
            return;
        }

        this._buildRows(group, devices, settings);
    }

    _parseCards(json) {
        const devices = [];
        const cards = JSON.parse(json);
        for (const card of cards) {
            const cardProps = card.properties ?? {};
            const cardDesc = cardProps['device.description'] ?? card.name;
            const cardPorts = card.ports ?? {};
            if (typeof cardPorts !== 'object' || Array.isArray(cardPorts)) continue;

            for (const portName in cardPorts) {
                const portInfo = cardPorts[portName];
                if (typeof portInfo !== 'object') continue;

                // skip unavailable ports
                if (portInfo.availability === 'not available') continue;

                // skip ports with no pure output profile
                const profiles = portInfo.profiles ?? [];
                if (!profiles.some(p => p.startsWith('output:') && !p.includes('input:'))) continue;

                const portDesc = portInfo.description ?? portInfo.name;
                const key = `${portDesc}|${cardDesc}`;

                devices.push({
                    key,
                    displayName: `${portDesc} - ${cardDesc}`,
                    subtitle: cardDesc,
                });
            }
        }
        return devices;
    }

    _buildRows(group, devices, settings) {
        const hiddenSinks = settings.get_strv('hidden-sinks');
        const renamedSinks = settings.get_value('renamed-sinks').deepUnpack();

        for (const {key, displayName, subtitle} of devices) {
            const expanderRow = new Adw.ExpanderRow({
                title: renamedSinks[key] ?? displayName,
                subtitle,
            });
            // show or hide device in quick settings
            const visibilityToggle = new Gtk.Switch({
                active: !hiddenSinks.includes(key),
                valign: Gtk.Align.CENTER,
                tooltip_text: 'Show this device in Quick Settings',
            });
            visibilityToggle.connect('notify::active', () => {
                const current = settings.get_strv('hidden-sinks');
                if (visibilityToggle.active) {
                    const i = current.indexOf(key);
                    if (i > -1) {
                        current.splice(i, 1);
                        settings.set_strv('hidden-sinks', current);
                    }
                }
                else if (!current.includes(key)) {
                    settings.set_strv('hidden-sinks', [...current, key]);
                }
            });
            expanderRow.add_suffix(visibilityToggle);

            // allow assigning a custom name to the device
            const entryRow = new Adw.EntryRow({
                title: 'Custom display name',
                text: renamedSinks[key] ?? '',
            });
            entryRow.connect('changed', () => {
                const current = settings.get_value('renamed-sinks').deepUnpack();
                const text = entryRow.text.trim();
                if (text) {
                    current[key] = text;
                    expanderRow.title = text;
                }
                else {
                    delete current[key];
                    expanderRow.title = displayName;
                }
                settings.set_value(
                    'renamed-sinks',
                    new GLib.Variant('a{ss}', current),
                );
            });
            expanderRow.add_row(entryRow);
            group.add(expanderRow);
        }
    }
}
