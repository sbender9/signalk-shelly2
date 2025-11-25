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
import mockDevices from './mockDevices'
import { createChannel, createSession } from 'better-sse'
import fs from 'fs'

const SERVICE_NAME = 'shelly'

const start = (app: ServerAPI) => {
  let props: any
  let onStop: any = []
  let devices: Device[] = []
  let browser: any
  let pollInterval: any = null
  let connectTimeout: any = null
  let started = false
  let restartPlugin: any = null
  const channel = createChannel()

  const plugin: Plugin = {
    start: (properties: any, restartPluginParam) => {
      restartPlugin = restartPluginParam
      props = properties
      started = true

      if (Object.keys(props).length == 0) {
        //empty config means initial startup. save defaults and enabled=true.
        const json = {
          configuration: { poll: 5000 },
          enabled: true,
          enableDebug: false
        }
        const appDataDirPath = app.getDataDirPath()
        const jsonFile = appDataDirPath + '.json'
        try {
          fs.writeFileSync(jsonFile, JSON.stringify(json, null, 2))
          props = json.configuration
        } catch (err: any) {
          console.log(`Error writing initial config: ${err.message} `)
          console.log(err)
        }
      }

      if (!props.deviceConfigs) {
        props.deviceConfigs = []
      }

      convertLegacySettings()

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
            let device = findDeviceWithAddress(data.addresses[0])
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

            device = new Device(
              app,
              plugin,
              channel,
              data.addresses[0],
              data.host
            )
            devices.push(device)
            try {
              await device.connect()
              channel.broadcast(device.toJSON(), 'newDevice')
              const devProps = getDeviceProps(device.id!)
              if (devProps && devProps?.enabled !== false) {
                app.debug(
                  `Found enabled settings for device ${device.id} at ${data.host}/${data.addresses[0]}`
                )
                device.setDeviceSettings(devProps)
                await device.resendDeltas()
              } else {
                app.debug(
                  `No enabled settings for device ${device.id} at ${data.host}/${data.addresses[0]}, disconnecting`
                )
                device.disconnect()
              }
              if (devProps) {
                devProps.name = device.name
                devProps.address = device.address
                devProps.hostname = device.hostname
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
          props.deviceConfigs.forEach((devProps: any) => {
            let device = findDeviceWithId(devProps.id)
            if (device) {
              return
            }
            const address = devProps.address
            device = new Device(
              app,
              plugin,
              devProps.address,
              devProps.hostname,
              devProps.id,
              devProps,
              devProps.model
            )
            device.name = devProps.name
            app.debug(
              `Did not get discovery for device ${device.id} at ${device.hostname}/${device.address}, connecting based on configured settings`
            )
            devices.push(device)
            channel.broadcast(device.toJSON(), 'newDevice')
            if (devProps?.enabled === undefined || devProps?.enabled) {
              device.connect().catch((error) => {
                app.error(
                  `Failed to connect to configured device ${device.id} ${address}`
                )
                app.error(error)
              })
            }
          })
        }, 5000)
      }

      if (props.createMockDevices) {
        const mockedDevices = mockDevices(app, plugin, channel, false)
        mockedDevices.forEach(({ device, status }) => {
          const devProps = getDeviceProps(device.id!)
          devices.push(device)
          device.connected = true
          device.authFailed = false
          device.getCapabilities(status)
          if (devProps) {
            device.setDeviceSettings(devProps)
            device.registerForPuts()
            device.sendDeltas(status)
          } 
          channel.broadcast(device.toJSON(), 'newDevice')
        })
      }

      if (props?.poll > 0) {
        app.debug(`Setting poll interval to ${props.poll} ms`)
        pollInterval = setInterval(() => {
          devices.forEach(async (device: Device) => {
            app.debug(`Trying Polling device ${device.id}`)
            const devProps = getDeviceProps(device.id!)
            if (devProps?.enabled === true) {
              app.debug(`Polling device ${device.id}`)
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
      devices.forEach((device: any) => {
        device.disconnect()
      })
      devices = []
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
          connectionId: Date.now(),
          state: started ? 'started' : 'stopped'
        })
      })

      router.get('/getBaseData', (_req: any, res: any) => {
        res.status(200).json({
          schema: plugin.schema,
          data: {
            poll: props.poll
          }
        })
      })

      router.get('/getDevices', (_req: any, res: any) => {
        const t = devicesToJSON()
        res.status(200).json(t)
      })

      router.post('/updateDeviceConfig', async (req: any, res: any) => {
        const device = findDeviceWithId(req.body.id)

        const settingsCopy = JSON.parse(JSON.stringify(req.body))
        const components = settingsCopy.components
        delete settingsCopy.components

        components?.forEach((component: any) => {
          if (component.settings.enabled === undefined) {
            component.settings.enabled = true
          }
          if (component.settings.path === undefined) {
            component.settings.path = component.id.toString()
          }
          settingsCopy[component.key] = component.settings
        })

        const i = props.deviceConfigs.findIndex((p: any) => p.id == req.body.id)
        if (i < 0) {
          props.deviceConfigs.push(settingsCopy)
        } else {
          props.deviceConfigs[i] = settingsCopy
        }
        app.savePluginOptions(props, async () => {
          res.status(200).json({ message: 'Devices updated' })
          if (device) {
            device.setDeviceSettings(settingsCopy)
            try {
              if (device.connected) {
                device.disconnect()
              }

              if (req.body.enabled) {
                await device.connect()
              }
            } catch (e: any) {
              app.error(e)
            }
            channel.broadcast(device.toJSON(), 'deviceChanged')
          }
        })
      })

      router.post('/removeDeviceConfig', async (req: any, res: any) => {
        const device = findDeviceWithId(req.body.id)
        if (!device) {
          res.status(404).json({ message: 'Device not found' })
          return
        }
        const i = props.deviceConfigs.findIndex((p: any) => p.id == req.body.id)
        if (i >= 0) {
          props.deviceConfigs.splice(i, 1)
        }

        if (device.connected) device.disconnect()

        app.savePluginOptions(props, () => {
          res.status(200).json({ message: 'Devices updated' })
          channel.broadcast({}, 'resetDevices')
        })
      })

      router.post('/updateBaseData', async (req: any, res: any) => {
        Object.assign(props, req.body)
        app.savePluginOptions(props, () => {
          res.status(200).json({ message: 'Plugin updated' })
          channel.broadcast({}, 'pluginRestarted')
          restartPlugin(props)
        })
      })

      router.get('/sse', async (req: any, res: any) => {
        const session = await createSession(req, res)
        channel.register(session)
        req.on('close', () => {
          channel.deregister(session)
        })
      })
    }
  }

  function devicesToJSON() {
    const list: any[] = []
    devices.forEach((device) => {
      if (device.id) {
        list.push(device.toJSON())
      }
    })
    return list
  }

  function convertLegacySettings() {
    let changed = false
    Object.keys(props).forEach((key) => {
      if (key.startsWith('Device ID ')) {
        const oldProps = JSON.parse(JSON.stringify(props[key]))
        if (getDeviceProps(oldProps.deviceId)) {
          // already have this device under new format
          return
        }
        const newProps: any = {}
        newProps.id = oldProps.deviceId
        delete oldProps.deviceId
        newProps.address = oldProps.deviceAddress
        delete oldProps.deviceAddress
        newProps.hostname = oldProps.deviceHostname
        delete oldProps.deviceHostname
        newProps.name = oldProps.deviceName
        delete oldProps.deviceName
        newProps.model = oldProps.deviceModel
        delete oldProps.deviceModel
        delete oldProps.deviceGeneration

        Object.assign(newProps, oldProps)

        props.deviceConfigs.push(newProps)
        changed = true
      }
    })
    if (changed) {
      app.savePluginOptions(props, () => {})
    }
  }

  function getDeviceProps(id: string) {
    return props.deviceConfigs.find((d: any) => d.id === id)
  }

  function findDeviceWithId(id: string) {
    return devices.find((d) => d.id === id)
  }

  function findDeviceWithAddress(address: string) {
    return devices.find((d) => d.address === address)
  }

  //;(plugin as any).createMockDevices = true

  return plugin
}

module.exports = start
export default start
