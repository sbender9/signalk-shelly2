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
import { Device } from './device'

const SERVICE_NAME = 'shelly'
const deviceKey = (device: any) => device.id

export default function (app: any) {
  const error = app.error
  const debug = app.debug
  let sentMetaDevices: any = {}
  let props: any
  let onStop: any = []
  let startedOnce = false
  let stopped = true
  let discoveredDevices: { [key: string]: Device } = {}
  let browser: any
  let pollInterval: any = null

  const plugin: Plugin = {
    start: function (properties: any) {
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

          if (discoveredDevices[deviceId]) {
            return
          }

          const gen = data.txt
            .find((txt: any) => txt.startsWith('gen='))
            .split('=')[1]

          if (gen && Number(gen) >= 2) {
            const props = getDeviceProps(deviceId)
            let device = new Device(app, plugin, props, data.addresses[0])
            try {
              discoveredDevices[deviceId] = device
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

      if (props?.poll > 0) {
        pollInterval = setInterval(() => {
          Object.values(discoveredDevices).forEach(async (device: Device) => {
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
      Object.values(discoveredDevices).forEach((device: any) => {
        device.disconnect()
      })
      discoveredDevices = {}
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

      let devices = Object.values(discoveredDevices)

      devices.forEach(device => {
        debug(`adding Device ID ${deviceKey(device)} to schema`)

        let props: any = (schema.properties[
          `Device ID ${deviceKey(device)}`
        ] = {
          type: 'object',
          properties: {
            deviceName: {
              type: 'string',
              title: 'Name',
              default: device.name,
              readOnly: true
            },
            deviceModel: {
              type: 'string',
              title: 'Model',
              default: device.model,
              readOnly: true
            },
            deviceAddress: {
              type: 'string',
              title: 'Address',
              default: device.address,
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

        if (device.numSwitches > 1) {
          for (let i = 0; i < device.numSwitches; i++) {
            const key = `switch${i}`
            let defaultPath
            let description
            defaultPath = i.toString()
            description =
              'Used to generate the path name, ie electrical.switches.${bankPath}.${switchPath}.state'

            props.properties[key] = {
              type: 'object',
              properties: {
                switchPath: {
                  type: 'string',
                  title: 'Switch Path',
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

        /*
        if ( info.readPaths?.find((prop:any) => {
          return typeof prop !== 'string' && prop.notification
        }) ) {
          props.properties.sendNotifications = { 
            type: 'boolean',
            title: 'Send Notifications',
            default: true
          }
        }
        
        if (info.isRGBW) {
          props.properties.presets = {
            title: 'Presets',
            type: 'array',
            items: {
              type: 'object',
              required: ['name', 'red', 'green', 'blue', 'white', 'bright'],
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
                white: {
                  type: 'number',
                  title: 'White',
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
        }
          */
      })

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

      return schema
    },

    uiSchema: () => {
      const uiSchema: any = {}
      let devices = Object.values(discoveredDevices)

      devices.forEach((device: any) => {
        uiSchema[`Device ID ${deviceKey(device)}`] = {
          password: {
            'ui:widget': 'password'
          }
        }
      })

      return uiSchema
    }
  }

  function filterEnabledDevices (devices: any) {
    return Object.values(discoveredDevices).filter((device: any) => {
      const deviceProps = getDeviceProps(device)
      return (
        !deviceProps ||
        typeof deviceProps.enabled === 'undefined' ||
        deviceProps.enabled
      )
    })
  }

  function getDeviceProps (id: string) {
    return props[`Device ID ${id}`]
  }

  const rgbwPutPaths = [
    {
      deviceProp: 'switch',
      name: 'state',
      setter: (device: any, value: any) => {
        return device.setColor({
          turn: boolString(value)
        })
      },
      convertFrom: (value: any) => {
        return value === true ? 1 : 0
      }
    },
    {
      //deviceProp: 'gain',
      name: 'dimmingLevel',
      setter: (device: any, value: any) => {
        if (device.white > 0) {
          let white = device.white / 255
          let gain = device.gain / 100

          if (white < gain) {
            white = white + value - gain
          } else {
            white = value
            value = gain + value - white
          }
          if (white <= 0) {
            white = 0.01
          }
          device.setColor({
            white: white * 255
          })
        }

        if (value <= 0) {
          value = 0.01
        }

        return device.setColor({
          gain: Number((value * 100).toFixed(0))
        })
      },
      getter: (device: any) => {
        let value = device.gain / 100
        if (device.red === 0 && device.green === 0 && device.blue === 0) {
          value = device.white / 255
        } else if (device.gain > 0 && device.white > 0) {
          value = device.white > device.gain ? device.white / 255 : value
        }
        return Number(value.toFixed(2))
      },
      meta: {
        units: 'ratio',
        type: 'dimmer',
        canDimWhenOff: true
      }
    },
    {
      deviceProp: 'red',
      setter: (device: any, value: any) => {
        return device.setColor({
          red: value
        })
      },
      meta: {
        units: 'rgbColor',
        range: [0, 255]
      }
    },
    {
      deviceProp: 'green',
      setter: (device: any, value: any) => {
        return device.setColor({
          green: value
        })
      },
      meta: {
        units: 'rgbColor',
        range: [0, 255]
      }
    },
    {
      deviceProp: 'blue',
      setter: (device: any, value: any) => {
        return device.setColor({
          blue: value
        })
      },
      meta: {
        units: 'rgbColor',
        range: [0, 255]
      }
    },
    {
      deviceProp: 'white',
      setter: (device: any, value: any) => {
        return device.setColor({
          white: value
        })
      },
      meta: {
        units: 'rgbColor',
        range: [0, 255]
      }
    },
    {
      name: 'preset',
      getter: (device: any) => {
        const deviceProps = getDeviceProps(device)
        const preset = deviceProps?.presets?.find((preset: any) => {
          return (
            device.red == preset.red &&
            device.green == preset.green &&
            device.blue == preset.blue &&
            device.white == preset.white &&
            (preset.bright === 0 || device.gain == preset.bright)
          )
        })
        return preset?.name || 'Unknown'
      },
      setter: (device: any, value: any) => {
        const deviceProps = getDeviceProps(device)
        const preset = deviceProps?.presets.find(
          (preset: any) => preset.name == value
        )
        if (value === 'Unknown' || !preset) {
          throw new Error(`invalid value ${value}`)
        } else {
          const params: any = {
            red: preset.red,
            green: preset.green,
            blue: preset.blue,
            white: preset.white,
            turn: 'on'
          }
          if (preset.bright !== 0) {
            params.gain = preset.bright
          }
          return device.setColor(params)
        }
      }
    }
  ]

  const simpleRelayPutPaths = [
    {
      deviceProp: 'relay0',
      name: 'state',
      setter: (device: any, value: any) => {
        return device.setRelay(0, boolValue(value))
      },
      convertFrom: (value: any) => {
        return value ? 1 : 0
      }
    }
  ]

  const simpleRelayReadPaths = ['input0']

  const nextgenSwitchPutPaths = (key: any) => {
    return [
      {
        deviceProp: key,
        name: 'state',
        setter: (device: any, value: any) => {
          return device[key].set(boolValue(value))
        },
        convertFrom: (value: any) => {
          return value.output ? 1 : 0
        }
      }
    ]
  }

  const nextgenSwitchReadPaths = (key: any) => {
    return [
      {
        key: `${key}.voltage`,
        path: 'voltage',
        meta: {
          units: 'V'
        }
      },
      {
        key: `${key}.temperature`,
        path: 'temperature',
        converter: nextgenTemperatureConverter,
        meta: {
          units: 'K'
        }
      },
      {
        key: `${key}.source`,
        path: 'source',
        meta: {
          units: 'string'
        }
      },
      {
        key: `${key}.apower`,
        path: 'apower',
        meta: {
          units: 'W'
        }
      },
      {
        key: `${key}.current`,
        path: 'current',
        meta: {
          units: 'A'
        }
      },
      {
        key: `${key}.pf`,
        path: 'powerFactor',
        converter: (val: any) => {
          return val * 1000
        },
        meta: {
          units: 'W'
        }
      }
    ]
  }

  const nextgenInputPaths = (key: any) => {
    return [
      {
        key: `${key}.state`,
        path: key,
        converter: (value: any) => {
          return value ? 1 : 0
        }
        /*
        notification: {
          handler: (value) => {
            return value === true
            },
          messageOn: 'flood sensor is on',
          messageOff: 'flood sensor is off'
        }
        */
      }
    ]
  }

  const simpleRelay = {
    putPaths: simpleRelayPutPaths,
    readPaths: simpleRelayReadPaths
  }

  const temperatureConverter = (value: any) => {
    if (props?.tempUnits === 'C') {
      return value + 273.15
    } else {
      return ((value - 32) * 5) / 9 + 273.15
    }
  }

  const nextgenTemperatureConverter = (value: any) => {
    return value?.tC + 273.15
  }

  const humidityConverter = (value: any) => {
    return value / 100
  }

  const nextgenHumidityConverter = (value: any) => {
    return value?.rh / 100
  }

  const deviceTypes: any = {
    /* For testing bank stuff */
    /*
    'Shelly Plus 1': {
      nextGen: true,
      isSwitchBank: true,
      switchCount: 1,
      switchKey: 'switch',
      isDimmable: false,
      bankReadPaths: nextgenSwitchReadPaths,
      switchSetter: (device: any, value: any, switchIdx: number) => {
        return device[`switch${switchIdx}`].set(boolValue(value))
      },
      readPaths: [
        ...nextgenInputPaths('input0')
      ]
    },
    */

    'Shelly Plus 1': {
      nextGen: true,
      putPaths: nextgenSwitchPutPaths('switch0'),
      readPaths: [
        ...nextgenSwitchReadPaths('switch0'),
        ...nextgenInputPaths('input0')
      ]
    },
    'Shelly Plus 1 PM': {
      nextGen: true,
      putPaths: nextgenSwitchPutPaths('switch0'),
      readPaths: [
        ...nextgenSwitchReadPaths('switch0'),
        ...nextgenInputPaths('input0')
      ]
    },
    'Shelly Pro 1': {
      nextGen: true,
      putPaths: nextgenSwitchPutPaths('switch0'),
      readPaths: [
        ...nextgenSwitchReadPaths('switch0'),
        ...nextgenInputPaths('input0'),
        ...nextgenInputPaths('input1')
      ]
    },
    'Shelly Pro 1 PM': {
      nextGen: true,
      putPaths: nextgenSwitchPutPaths('switch0'),
      readPaths: [
        ...nextgenSwitchReadPaths('switch0'),
        ...nextgenInputPaths('input0'),
        ...nextgenInputPaths('input1')
      ]
    },
    'Shelly Plus 2 PM': {
      nextGen: true,
      isSwitchBank: true,
      switchCount: 2,
      switchKey: 'switch',
      isDimmable: false,
      bankReadPaths: nextgenSwitchReadPaths,
      switchSetter: (device: any, value: any, switchIdx: number) => {
        return device[`switch${switchIdx}`].set(boolValue(value))
      },
      readPaths: [
        ...nextgenInputPaths('input0'),
        ...nextgenInputPaths('input1')
      ]
    },
    'Shelly Pro 4 PM': {
      nextGen: true,
      isSwitchBank: true,
      switchCount: 4,
      switchKey: 'switch',
      isDimmable: false,
      bankReadPaths: nextgenSwitchReadPaths,
      switchSetter: (device: any, value: any, switchIdx: number) => {
        return device[`switch${switchIdx}`].set(boolValue(value))
      },
      readPaths: [
        ...nextgenInputPaths('input0'),
        ...nextgenInputPaths('input1'),
        ...nextgenInputPaths('input2'),
        ...nextgenInputPaths('input3')
      ]
    },
    'Shelly Plus I4': {
      nextGen: true,
      readPaths: [
        ...nextgenInputPaths('input0'),
        ...nextgenInputPaths('input1'),
        ...nextgenInputPaths('input2'),
        ...nextgenInputPaths('input3')
      ]
    },
    'Shelly Plus Plug US': {
      nextGen: true,
      putPaths: nextgenSwitchPutPaths('switch0'),
      readPaths: [...nextgenSwitchReadPaths('switch0')]
    },

    'SHSW-1': {
      putPaths: simpleRelayPutPaths,
      readPaths: [
        ...simpleRelayReadPaths,
        {
          key: 'externalTemperature0',
          converter: temperatureConverter
        },
        {
          key: 'externalTemperature1',
          converter: temperatureConverter
        },
        {
          key: 'externalTemperature2',
          converter: temperatureConverter
        }
      ]
    },
    'SHRGBWW-01': {
      isRGBW: true,
      putPaths: rgbwPutPaths
    },
    'SHRGBW2:white': {
      isSwitchBank: true,
      switchCount: 4,
      switchKey: 'switch',
      isDimmable: true,
      canDimWhenOff: true,
      switchSetter: (device: any, value: any, switchIdx: number) => {
        return device.setWhite(
          switchIdx,
          undefined,
          value === 1 || value === 'on' || value === 'true' || value === true
        )
      },
      dimmerSetter: (device: any, value: any, switchIdx: number) => {
        return device.setWhite(
          switchIdx,
          Number((value * 100).toFixed(0)),
          device[`switch${switchIdx}`]
        )
      }
    },
    'SHRGBW2:color': {
      isRGBW: true,
      putPaths: rgbwPutPaths,
      readPaths: [
        'mode',
        'overPower',
        'input0',
        'power0',
        'power1',
        'power2',
        'power3'
      ]
    },
    'SHSW-44': {
      isSwitchBank: true,
      switchCount: 4,
      switchKey: 'relay',
      isDimmable: false,
      switchSetter: (device: any, value: any, switchIdx: number) => {
        return device.setRelay(switchIdx, boolValue(value))
      }
    },

    'SHSW-L': {
      putPaths: simpleRelayPutPaths,
      readPaths: [
        ...simpleRelayReadPaths,
        'input1',
        'power0',
        'energyCounter0',
        'deviceTemperature',
        'overTemperature'
      ]
    },

    'SHSW-PM': {
      putPaths: simpleRelayPutPaths,
      readPaths: [
        ...simpleRelayReadPaths,
        'power0',
        'energyCounter0',
        'overPower',
        'overPowerValue',
        'deviceTemperature',
        'overTemperature'
      ]
    },

    'SHSW-21:relay': {
      isSwitchBank: true,
      switchCount: 2,
      switchKey: 'relay',
      isDimmable: false,
      switchSetter: (device: any, value: any, switchIdx: number) => {
        return device.setRelay(switchIdx, boolValue(value))
      },
      readPaths: [
        'mode',
        'energyCounter0',
        'overPower0',
        'overPower1',
        'overPowerValue'
      ]
    },

    'SHUNI-1': {
      isSwitchBank: true,
      switchCount: 2,
      switchKey: 'relay',
      isDimmable: false,
      switchSetter: (device: any, value: any, switchIdx: number) => {
        return device.setRelay(switchIdx, boolValue(value))
      },
      readPaths: [
        'input0',
        'inputEvent0',
        'inputEventCounter0',
        'input1',
        'inputEvent1',
        'inputEventCounter1',
        {
          key: 'externalTemperature0',
          converter: temperatureConverter
        },
        {
          key: 'externalTemperature1',
          converter: temperatureConverter
        },
        {
          key: 'externalTemperature2',
          converter: temperatureConverter
        },
        {
          key: 'externalTemperature3',
          converter: temperatureConverter
        },
        {
          key: 'externalTemperature4',
          converter: temperatureConverter
        },
        'voltage0',
        {
          key: 'externalHumidity',
          converter: humidityConverter,
          meta: {
            units: 'ratio'
          }
        }
      ]
    },

    'SHHT-1': {
      readPaths: [
        {
          key: 'temperature',
          converter: temperatureConverter
        },
        {
          key: 'humidity',
          converter: humidityConverter,
          meta: {
            units: 'ratio'
          }
        },
        'battery'
      ]
    },

    'Shelly Plus H&T': {
      nextGen: true,
      readPaths: [
        {
          key: 'temperature0',
          converter: nextgenTemperatureConverter
        },
        {
          key: 'humidity0',
          converter: nextgenHumidityConverter,
          meta: {
            units: 'ratio'
          }
        }
      ]
    },

    SHEM: {
      isSwitchBank: true,
      switchCount: 1,
      switchKey: 'relay',
      isDimmable: false,
      switchSetter: (device: any, value: any, switchIdx: number) => {
        return device.setRelay(switchIdx, boolValue(value))
      },
      readPaths: [
        'power0',
        'energyCounter0',
        'energyReturned0',
        'voltage0',
        'power1',
        'energyCounter1',
        'energyReturned1',
        'voltage1',
        'overPower'
      ]
    },

    'SHEM-3': {
      isSwitchBank: true,
      switchCount: 1,
      switchKey: 'relay',
      isDimmable: false,
      switchSetter: (device: any, value: any, switchIdx: number) => {
        return device.setRelay(switchIdx, boolValue(value))
      },
      readPaths: [
        'power0',
        'energyCounter0',
        'energyReturned0',
        'powerFactor0',
        'current0',
        'voltage0',
        'power1',
        'energyCounter1',
        'energyReturned1',
        'powerFactor1',
        'current1',
        'voltage1',
        'power2',
        'energyCounter2',
        'energyReturned2',
        'powerFactor2',
        'current2',
        'voltage2',
        'overPower'
      ]
    },

    'SHSW-21:roller': {
      readPaths: [
        'mode',
        'power0',
        'energyCounter0',
        'overPower0',
        'overPower1',
        'overPowerValue'
      ],
      putPaths: [
        {
          deviceProp: 'rollerState',
          setter: (device: any, value: any) => {
            return device.setRollerState(value)
          }
        },
        {
          deviceProp: 'rollerPosition',
          setter: (device: any, value: any) => {
            return device.setRollerPosition(value)
          }
        }
      ]
    },

    'SHSW-22': {
      isSwitchBank: true,
      switchCount: 2,
      switchKey: 'relay',
      isDimmable: false,
      switchSetter: (device: any, value: any, switchIdx: number) => {
        return device.setRelay(switchIdx, boolValue(value))
      }
    },

    'SHPLG2-1': simpleRelay,
    'SHPLG-S': simpleRelay,
    'SHPLG-U1': simpleRelay,

    'SHPLG-1': {
      putPaths: simpleRelayPutPaths,
      readPaths: [
        ...simpleRelayReadPaths,
        'power0',
        'energyCounter0',
        'overPower',
        'overPowerValue'
      ]
    },

    'SHDW-1': {
      readPaths: [
        'state',
        'vibration',
        'illuminance',
        'illuminanceLevel',
        'sensorError',
        'battery',
        'wakeupEvent'
      ]
    },

    'SHDW-2': {
      readPaths: [
        {
          key: 'state',
          notification: {
            handler: (value: any) => {
              return value === 1
            },
            messageOn: 'is open',
            messageOff: 'is closed'
          }
        },
        'vibration',
        'illuminance',
        'illuminanceLevel',
        'sensorError',
        'battery',
        'wakeupEvent',
        {
          key: 'temperature',
          converter: temperatureConverter
        }
      ]
    },

    'SHWT-1': {
      readPaths: [
        {
          key: 'flood',
          notification: {
            handler: (value: any) => {
              return value === 1
            },
            messageOn: 'flood sensor is on',
            messageOff: 'flood sensor is off'
          }
        },
        'sensorError',
        'battery',
        'wakeupEvent',
        {
          key: 'temperature',
          converter: temperatureConverter
        }
      ]
    },

    'SHMOS-01': {
      readPaths: [
        {
          key: 'motion',
          notification: {
            handler: (value: any) => {
              return value === 1
            },
            messageOn: 'motion detected',
            messageOff: 'motion cleared'
          }
        },
        'vibration',
        'battery',
        'illuminance'
      ]
    },

    'SHMOS-02': {
      readPaths: [
        {
          key: 'motion',
          notification: {
            handler: (value: any) => {
              return value === 1
            },
            messageOn: 'motion detected',
            messageOff: 'motion cleared'
          }
        },
        'vibration',
        'battery',
        'illuminance',
        {
          key: 'temperature',
          converter: temperatureConverter
        }
      ]
    }
  }

  deviceTypes['SHSW-25:roller'] = { ...deviceTypes['SHSW-21:roller'] }
  deviceTypes['SHSW-25:roller'].readPaths.push('overTemperature')
  deviceTypes['SHSW-25:roller'].readPaths.push('deviceTemperature')
  deviceTypes['SHSW-25:relay'] = { ...deviceTypes['SHSW-21:relay'] }
  deviceTypes['SHSW-25:relay'].readPaths.push('overTemperature')
  deviceTypes['SHSW-25:relay'].readPaths.push('deviceTemperature')

  deviceTypes['SH2LED-1'] = { ...deviceTypes['SHRGBWW-01'] }
  deviceTypes['SH2LED-1'].switchCount = 2

  deviceTypes['SHBLB-1:color'] = { ...deviceTypes['SHRGBWW-01'] }
  deviceTypes['SHBLB-1:white'] = { ...deviceTypes['SHRGBW2:white'] }

  deviceTypes['SHCB-1:color'] = { ...deviceTypes['SHRGBWW-01'] }
  deviceTypes['SHCB-1:white'] = { ...deviceTypes['SHRGBW2:white'] }

  deviceTypes['SHCL-255:color'] = { ...deviceTypes['SHRGBWW-01'] }
  deviceTypes['SHCL-255:white'] = { ...deviceTypes['SHRGBW2:white'] }

  deviceTypes['Shelly Pro 2'] = { ...deviceTypes['Shelly Plus 2 PM'] }
  deviceTypes['Shelly Pro 2 PM'] = { ...deviceTypes['Shelly Plus 2 PM'] }

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

function boolValue (value: any) {
  return value === 1 || value === 'on' || value === 'true' || value === true
}

function boolString (value: any) {
  return boolValue(value) ? 'on' : 'off'
}

function boolFrom (value: any) {
  return value === 'on' ? 1 : 0
}
