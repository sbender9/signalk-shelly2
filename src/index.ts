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

import camelCase from 'camelcase'
import path from 'path'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mdns = require('mdns-js')
import { Device, supportedComponents } from './device'
import p from 'proxyquire'

const SERVICE_NAME = 'shelly'
const deviceKey = (device: any) => device.id

export default function (app: any) {
  const error = app.error
  const debug = app.debug
  let sentMetaDevices: any = {}
  let props: any
  let onStop: any = []
  let stopped = true
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
          let deviceId = data.fullname.split('.', 1)[0]

          if (devices[deviceId]) {
            return
          }

          const gen = data.txt
            .find((txt: any) => txt.startsWith('gen='))
            .split('=')[1]

          if (gen && Number(gen) >= 2) {
            const props = getDeviceProps(deviceId)
            let device = new Device(
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
        Object.keys(props).forEach(key => {
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
                devices[id].connect().catch(error => {
                  console.error(`Failed to connect to configured device ${id}`)
                  console.error(error)
                })
              }
            }
          }
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
      sentMetaDevices = {}
      onStop.forEach((f: any) => f())
      onStop = []
      stopped = true
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

      Object.values(devices).forEach(device => {
        //debug(`adding Device ID ${deviceKey(device)} to schema`)

        let props: any = (schema.properties[`Device ID ${device.id}`] = {
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
            },
            devicePath: {
              type: 'string',
              title: 'Device Path',
              default: device.name ? camelCase(device.name) : deviceKey(device),
              description:
                'Used to generate the path name, ie. electrical.switches.${devicePath}'
            },
            displayName: {
              type: 'string',
              title: 'Display Name (meta)',
              default: device.name
            }
          }
        })

        supportedComponents.forEach(component => {
          const count = device.componentCounts[component] || 0
          if (count > 1) {
            for (let i = 0; i < count; i++) {
              const key = `${component}${i}`
              let defaultPath
              let description
              defaultPath = i.toString()
              description =
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

      /*
      schema.properties.nextGenPassswords = {
        title: 'Next Gen Device Passwords',
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'password'],
          properties: {
            id: {
              type: 'string',
              title: 'Device Id'
            },
            password: {
              type: 'string',
              title: 'Password'
            }
          }
        }
      }
        */

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

  function getDeviceProps (id: string) {
    return props[`Device ID ${id}`]
  }

  return plugin
}

interface Plugin {
  start: (app: any) => void
  stop: () => void
  id: string
  name: string
  description: string
  schema: any
  uiSchema: any
}
