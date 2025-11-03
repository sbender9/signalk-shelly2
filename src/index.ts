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
import mockDevices from './mockDevices'

const SERVICE_NAME = 'shelly'
const deviceKey = (device: any) => device.id

const start = (app: ServerAPI) => {
  let props: any
  let onStop: any = []
  let devices: { [key: string]: Device } = {}
  let deviceConfigs: any[] = []
  let foundConfiguredDevices = 0
  let browser: any
  let pollInterval: any = null
  let connectTimeout: any = null
  let started = false

  const plugin: Plugin = {
    start: (properties: any) => {
      props = properties
      started = true
      deviceConfigs = props?.peripherals ?? []

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
          const gen = data.txt
            .find((txt: any) => txt.startsWith('gen='))
            .split('=')[1]

          if (gen && Number(gen) >= 2) {
            let device = devices[data.addresses[0]]
            if (device) {
              app.debug(
                `ignoring known device ${device.id} at ${data.host}/${data.addresses[0]}`
              )
              // already known device, ignore
              return
            }

            app.debug(
              `Discovered Shelly gen 2+ device at ${data.host}/${data.addresses[0]}`
            )

            device = new Device(app, plugin, data.addresses[0], data.host)
            devices[device.address] = device
            try {
              await device.connect()
              const devProps = getDeviceProps(device.id!)
              if (devProps && devProps?.enabled !== false) {
                app.debug(
                  `Found enabled settings for device ${device.id} at ${data.host}/${data.addresses[0]}`
                )
                device.setDeviceSettings(devProps)
              } else {
                app.debug(
                  `No enabled settings for device ${device.id} at ${data.host}/${data.addresses[0]}, disconnecting`
                )
                device.disconnect()
              }
              if (devProps) {
                devProps.deviceName = device.name
                devProps.deviceAddress = device.address
                devProps.deviceHostname = device.hostname
                app.savePluginOptions(properties, (error: any) => {
                  if (error) {
                    app.error(
                      'Failed to save plugin options after device discovery'
                    )
                    app.error(error)
                  }
                })
              }
            } catch (error: any) {
              app.error(`Failed to connect to device ${device.id}`)
              app.error(error)
              return
            }
          }
        }
      })

      if (props) {
        connectTimeout = setTimeout(() => {
          Object.keys(props).forEach((key) => {
            if (key.startsWith('Device ID ')) {
              const devProps = props[key]
              let device = Object.values(devices).find(
                (d) => d.id === devProps.deviceId
              )
              if (device) {
                return
              }
              const address = devProps.deviceAddress
              device = new Device(
                app,
                plugin,
                devProps.deviceAddress,
                devProps.deviceHostname,
                devProps.deviceId,
                devProps
              )
              app.debug(
                `Did not get discovery for device ${device.id} at ${device.hostname}/${device.address}, connecting based on configured settings`
              )
              devices[address] = device
              if (devProps?.enabled === undefined || devProps?.enabled) {
                device.connect().catch((error) => {
                  app.error(
                    `Failed to connect to configured device ${device.id} ${address}`
                  )
                  app.error(error)
                })
              }
            }
          })
        }, 5000)
      }

      if ((plugin as any).createMockDevices) {
        const mockedDevices = mockDevices(app, plugin, getDeviceProps)
        mockedDevices.forEach(({ device, status }) => {
          devices[device.address] = device
          device.authFailed = false
          device.getCapabilities(status)
          device.registerForPuts()
          device.sendDeltas(status)
        })
      }

      if (props?.poll > 0) {
        pollInterval = setInterval(() => {
          Object.values(devices).forEach(async (device: Device) => {
            const devProps = getDeviceProps(device.id!)
            if (devProps?.enabled === true) {
              try {
                await device.poll()
              } catch (error: any) {
                app.error(
                  `Failed to poll device ${device.id || device.address}`
                )
                app.error(error)
              }
            }
          })
        }, props.poll)
      }
    },

    stop: function () {
      started = false
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
      if (connectTimeout) {
        clearTimeout(connectTimeout)
        connectTimeout = null
      }
      if (pollInterval) {
        clearInterval(pollInterval)
        pollInterval = null
      }
    },

    id: 'signalk-shelly2',
    name: 'Shelly 2',
    description: 'Signal K Plugin For Shelly Gen2+ devices',

    schema: {
        type: 'object',
        htmlDescription: '',
        properties: {
          poll: {
            type: 'number',
            title: 'Poll Interval (ms)',
            description:
              'The interval at which the device is polled for updates, -1 to disable',
            default: 5000
          }
        }
      },
/*
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
        } else {
          props.title = `Failed to ${device.triedAuth ? 'authenticate with' : 'connect to'} this device`
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
    },*/

    /*
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
    },
    */

    registerWithRouter: (router) => {
      router.get('/getPluginState', async (_req: any, res: any) => {
        res.status(200).json({
          "connectionId": Date.now(),
          "state": (started ? "started" : "stopped")
        })
      })

      router.get('/getBaseData', (_req: any, res: any) => {
        res.status(200).json(
          {
            schema: plugin.schema,
            data: {
              poll: props.poll
            }
          }
        );
      })

      router.get('/getProgress', (_req: any, res: any) => {
        let deviceCount = deviceConfigs.filter((dc) => dc.active).length
        const json = {
          "progress": foundConfiguredDevices / deviceCount, "maxTimeout": 1,
          "deviceCount": foundConfiguredDevices,
          "totalDevices": deviceCount
        }
        res.status(200).json(json)
      })
      
      router.get('/getSensors', (_req: any, res: any) => {
        const t = sensorsToJSON()
        res.status(200).json(t)
      })
    }
  }

  function getDeviceProps(id: string) {
    return props[`Device ID ${id}`]
  }

  ;(plugin as any).createMockDevices = false

  return plugin
}

module.exports = start
export default start
