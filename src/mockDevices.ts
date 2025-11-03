/*
 * Copyright 2025 Scott Bender <scott@scottbender.net>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Device, DeviceSettings } from './device'
import { ServerAPI } from '@signalk/server-api'

const minimalSettings: DeviceSettings = {
  enabled: true,
  displayName: undefined,
  devicePath: undefined
}

export default (
  app: ServerAPI,
  plugin: any,
  _getDeviceProps?: (id: string) => any
) => {
  return [
    {
      device: new Device(
        app,
        plugin,
        '192.168.99.100',
        'host.name',
        'shelly-smokeDetector1',
        minimalSettings
      ),
      status: {
        'devicepower:0': {
          battery: { V: 3.7, percent: 50 },
          external: { present: true }
        },
        'smoke:0': { alarm: false, mute: false }
      }
    },
    {
      device: new Device(
        app,
        plugin,
        '192.168.99.102',
        'host.name',
        'shelly-smokeDetector2',
        minimalSettings
      ),
      status: {
        'devicepower:0': {
          battery: { V: 3.7, percent: 50 },
          external: { present: true }
        },
        'smoke:0': { alarm: false, mute: false },
        'smoke:1': { alarm: true, mute: true }
      }
    },
    {
      device: new Device(
        app,
        plugin,
        '192.168.99.103',
        'host.name',
        'shelly-powerMeter',
        minimalSettings
      ),
      status: {
        'pm1:0': {
          freq: 10,
          voltage: 12.2,
          current: 1.5,
          apower: 18.3,
          aprtpower: 5.0,
          pf: 0.8,
          aenergy: {
            total: 100,
            by_minute: 10,
            minute_ts: 1696111230
          },
          ret_aenergy: {
            total: 500,
            by_minute: 50,
            minute_ts: 16230
          }
        }
      }
    },
    {
      device: new Device(
        app,
        plugin,
        '192.168.99.104',
        'host.name',
        'shelly-hm',
        minimalSettings
      ),
      status: {
        'temperature:0': { tC: 22 },
        'humidity:0': { rh: 22 }
      }
    },
    {
      device: new Device(
        app,
        plugin,
        '192.168.99.105',
        'host.name',
        'shelly-entergyMeter1',
        minimalSettings
      ),
      status: {
        'em1:0': {
          freq: 10,
          voltage: 12.2,
          current: 1.5,
          act_power: 18.3,
          aprt_power: 5.0,
          pf: 0.8
        }
      }
    },
    {
      device: new Device(
        app,
        plugin,
        '192.168.99.106',
        'host.name',
        'shelly-energyMeter',
        minimalSettings
      ),
      status: {
        'em:0': {
          a_current: 10,
          a_voltage: 220,
          a_act_power: 100,
          a_aprt_power: 120,
          a_pf: 0.8,
          a_freq: 50,
          b_current: 10,
          b_voltage: 220,
          b_act_power: 100,
          b_aprt_power: 120,
          b_pf: 0.8,
          b_freq: 50,
          c_current: 24,
          c_voltage: 221,
          c_act_power: 100,
          c_aprt_power: 120,
          c_pf: 0.8,
          c_freq: 50,
          n_current: 0.3,
          n_voltage: 0,
          n_act_power: 0,
          n_aprt_power: 0,
          n_pf: 0,
          n_freq: 0,
          total_current: 200,
          total_act_power: 100,
          total_aprt_power: 120,
          user_calibrated_phase: ['A']
        }
      }
    },
    {
      device: new Device(
        app,
        plugin,
        '192.168.99.107',
        'host.name',
        'shelly-rgb',
        minimalSettings
      ),
      status: {
        'rgb:0': { output: true, rgb: [255, 0, 0], brightness: 50 }
      }
    },
    {
      device: new Device(
        app,
        plugin,
        //getDeviceProps?.(`shelly-rgbw`),
        '192.168.99.108',
        'host.name',
        'shelly-rgbw',
        minimalSettings
      ),
      status: {
        'rgbw:0': {
          output: true,
          rgb: [255, 0, 0],
          brightness: 50,
          white: 255
        },
        'rgbw:1': {
          output: false,
          rgb: [255, 255, 0],
          brightness: 90,
          white: 198
        }
      }
    },
    {
      device: new Device(
        app,
        plugin,
        '192.168.99.109',
        'host.name',
        'shelly-light',
        minimalSettings
      ),
      status: {
        'light:0': {
          output: true,
          brightness: 50,
          pf: 0.8,
          freq: 50,
          ret_aenergy: {
            total: 100,
            by_minute: 10
          }
        },
        'light:1': { output: false, brightness: 90 }
      }
    },
    {
      device: new Device(
        app,
        plugin,
        '192.168.99.110',
        'host.name',
        'shelly-uni',
        minimalSettings
      ),
      status: {
        'voltmeter:100': {
          id: 100,
          voltage: 12.41
        },
        'temperature:100': {
          id: 100,
          tC: 19.9,
          tF: 67.9
        },
        'switch:0': {
          id: 0,
          source: 'HTTP_in',
          output: false
        },
        'switch:1': {
          id: 1,
          source: 'SHC',
          output: false
        },
        'input:0': {
          id: 0,
          state: false
        },
        'input:1': {
          id: 1,
          state: false
        },
        'input:2': {
          id: 2,
          counts: null,
          freq: null
        }
      }
    }
  ]
}
