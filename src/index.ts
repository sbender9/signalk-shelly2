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

import { ServerAPI, Plugin } from '@signalk/server-api'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mdns = require('mdns-js')
import { Device } from './device'
import { getSupportedComponents } from './components'

const SERVICE_NAME = 'shelly'
const deviceKey = (device: any) => device.id
const createMockDevices = false

const start = (app: ServerAPI) => {
  let props: any
  let onStop: any = []
  let devices: { [key: string]: Device } = {}
  let browser: any
  let pollInterval: any = null

  const plugin: Plugin = {
    start: (properties: any) => {
      props = properties

      browser = mdns.createBrowser(mdns.tcp(SERVICE_NAME))

      browser.on('ready', () => {
        browser.discover()
      })

      browser.on('update', async (data: any) => {
        if (
          Array.isArray(data.type) &&
          data.type[0].name === SERVICE_NAME &&
          data.fullname
        ) {
          const deviceId = data.fullname.split('.', 1)[0]

          if (devices[deviceId]) {
            return
          }

          const gen = data.txt
            .find((txt: any) => txt.startsWith('gen='))
            .split('=')[1]

          if (gen && Number(gen) >= 2) {
            const props = getDeviceProps(deviceId)
            const device = new Device(
              app,
              plugin,
              props,
              deviceId,
              data.addresses[0],
              data.host
            )
            try {
              devices[deviceId] = device
              if (props?.enabled === false) {
                return
              }

              await device.connect()
            } catch (error) {
              console.error(`Failed to connect to device ${deviceId}`)
              console.error(error)
              return
            }
          }
        }
      })

      if (props) {
        Object.keys(props).forEach((key) => {
          if (key.startsWith('Device ID ')) {
            const devProps = props[key]
            const id = devProps.deviceId
            if (devices[id] === undefined) {
              devices[id] = new Device(
                app,
                plugin,
                devProps,
                devProps.deviceId,
                devProps.deviceAddress,
                devProps.deviceHostname,
                devProps.deviceName
              )
              if (devProps?.enabled === undefined || devProps?.enabled) {
                devices[id].connect().catch((error) => {
                  console.error(`Failed to connect to configured device ${id}`)
                  console.error(error)
                })
              }
            }
          }
        })
      }

      if (createMockDevices) {
        const mockedDevices = mockDevices(app, plugin, getDeviceProps)
        mockedDevices.forEach(({ device, status }) => {
          devices[device.id!] = device
          device.getCapabilities(status)
          device.registerForPuts()
          device.sendDeltas(status)
        })
      }

      if (props?.poll > 0) {
        pollInterval = setInterval(() => {
          Object.values(devices).forEach(async (device: Device) => {
            if (props?.enabled !== false) {
              try {
                await device.poll()
              } catch (error) {
                console.error(
                  `Failed to poll device ${device.id || device.address}`
                )
                console.error(error)
              }
            }
          })
        }, props.poll)
      }
    },

    stop: function () {
      onStop.forEach((f: any) => f())
      onStop = []
      Object.values(devices).forEach((device: any) => {
        device.disconnect()
      })
      devices = {}
      if (browser) {
        browser.stop()
        browser = null
      }
      if (pollInterval) {
        clearInterval(pollInterval)
        pollInterval = null
      }
    },

    id: 'signalk-shelly2',
    name: 'Shelly 2',
    description: 'Signal K Plugin For Shelly Gen2+ devices',

    schema: () => {
      const schema: any = {
        type: 'object',
        properties: {
          poll: {
            type: 'number',
            title: 'Poll Interval (ms)',
            description:
              'The interval at which the device is polled for updates, -1 to disable',
            default: 5000
          }
        }
      }

      Object.values(devices).forEach((device) => {
        //debug(`adding Device ID ${deviceKey(device)} to schema`)

        const props: any = (schema.properties[`Device ID ${device.id}`] = {
          type: 'object',
          properties: {
            deviceId: {
              type: 'string',
              title: 'Device ID',
              default: device.id,
              readOnly: true
            },
            deviceName: {
              type: 'string',
              title: 'Name',
              default: device.name || '',
              readOnly: true
            },
            deviceModel: {
              type: 'string',
              title: 'Model',
              default: device.model || '',
              readOnly: true
            },
            deviceGeneration: {
              type: 'string',
              title: 'Generation',
              default: `${device.gen || ''}`,
              readOnly: true
            },
            deviceAddress: {
              type: 'string',
              title: 'Address',
              default: device.address,
              readOnly: true
            },
            deviceHostname: {
              type: 'string',
              title: 'Hostname',
              default: device.hostname,
              readOnly: true
            },
            enabled: {
              type: 'boolean',
              title: 'Enabled',
              default: true
            }
          }
        })

        if (device.authFailed === false) {
          props.properties = {
            ...props.properties,
            devicePath: {
              type: 'string',
              title: 'Device Path',
              default: device.getDevicePath(),
              description: `Used to generate the path name, default`
            },
            displayName: {
              type: 'string',
              title: 'Display Name (meta)',
              default: device.name || ''
            }
          }
        }
        props.properties = {
          ...props.properties,
          password: {
            type: 'string',
            title: 'Password',
            description:
              'The password for the device, leave empty if no password is set'
          }
        }

        getSupportedComponents().forEach((component) => {
          const count = device.components[component]?.length || 0
          if (count > 1) {
            for (let i = 0; i < count; i++) {
              const key = `${component}${i}`
              const defaultPath = i.toString()
              const description =
                'Used to generate the path name, ie. electrical.switches.${bankPath}.${switchPath}.state'

              props.properties[key] = {
                type: 'object',
                properties: {
                  path: {
                    type: 'string',
                    title: 'Path',
                    default: defaultPath,
                    description
                  },
                  displayName: {
                    type: 'string',
                    title: 'Display Name (meta)'
                  },
                  enabled: {
                    type: 'boolean',
                    title: 'Enabled',
                    default: true
                  }
                }
              }
            }
          }
          if (count > 0 && (component === 'rgb' || component === 'rgbw')) {
            const required = ['name', 'red', 'green', 'blue', 'bright']
            if (component === 'rgbw') {
              required.push('white')
            }
            props.properties.presets = {
              title: 'Presets',
              type: 'array',
              items: {
                type: 'object',
                required,
                properties: {
                  name: {
                    type: 'string',
                    title: 'Name'
                  },
                  red: {
                    type: 'number',
                    title: 'Red',
                    default: 255
                  },
                  green: {
                    type: 'number',
                    title: 'Green',
                    default: 255
                  },
                  blue: {
                    type: 'number',
                    title: 'Blue',
                    default: 255
                  },
                  bright: {
                    type: 'number',
                    title: 'Brightness',
                    description:
                      'Number between 1-100. Set to 0 to preserve current brightness',
                    default: 100
                  }
                }
              }
            }
            if (component === 'rgbw') {
              props.properties.presets.items.properties.white = {
                type: 'number',
                title: 'White',
                default: 255
              }
            }
          }
        })
      })

      return schema
    },

    uiSchema: () => {
      const uiSchema: any = {}

      Object.values(devices).forEach((device: any) => {
        uiSchema[`Device ID ${deviceKey(device)}`] = {
          password: {
            'ui:widget': 'password'
          }
        }
      })

      return uiSchema
    }
  }

  function getDeviceProps(id: string) {
    return props[`Device ID ${id}`]
  }

  return plugin
}

export const mockDevices = (
  app: ServerAPI,
  plugin: any,
  getDeviceProps?: (id: string) => any
) => {
  return [
    {
      device: new Device(
        app,
        plugin,
        undefined,
        'shelly-smokeDetector1',
        '192.168.99.100'
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
        undefined,
        'shelly-smokeDetector2',
        '192.168.99.100'
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
        undefined,
        'shelly-powerMeter',
        '192.168.99.100'
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
      device: new Device(app, plugin, undefined, 'shelly-hm', '192.168.99.100'),
      status: {
        'temperature:0': { tC: 22 },
        'humidity:0': { rh: 22 }
      }
    },
    {
      device: new Device(
        app,
        plugin,
        undefined,
        'shelly-entergyMeter1',
        '192.168.99.100'
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
        undefined,
        'shelly-energyMeter',
        '192.168.99.100'
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
        undefined,
        'shelly-rgb',
        '192.168.99.100'
      ),
      status: {
        'rgb:0': { output: true, rgb: [255, 0, 0], brightness: 50 }
      }
    },
    {
      device: new Device(
        app,
        plugin,
        getDeviceProps?.(`shelly-rgbw`),
        'shelly-rgbw',
        '192.168.99.100'
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
        undefined,
        'shelly-light',
        '192.168.99.100'
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
    }
  ]
}
module.exports = start
export default start
