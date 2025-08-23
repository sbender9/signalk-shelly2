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

import WebSocket from 'ws'
import camelCase from 'camelcase'

type PendingRequest = {
  resolve: (value: any) => void
  reject: (reason?: any) => void
  timeout: NodeJS.Timeout
}

const MAX_INPUTS = 10

export class Device {
  id: string | null = null
  connected: boolean = false
  numSwitches: number = 0
  address: string
  name: string | null = null
  model: string | null = null
  gen: number | null = null

  private ws: WebSocket | null = null
  private next_id: number = 1
  private pendingRequests: { [key: number]: PendingRequest } = {}
  private deviceSettings: any | undefined
  private sentMeta: boolean = false
  private app: any
  private plugin: any

  constructor(app:any, plugin:any, deviceSettings: any, address: string) {
    this.address = address
    this.deviceSettings = deviceSettings
    this.app = app
    this.plugin = plugin
  }

  private debug(...args: any[]) {
    console.log(...args)
  }

  async connect() : Promise<Device> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(`ws://${this.address}/rpc`)
      } catch (error) {
        reject(`Failed to connect to device ${this.id}: ${error}`)
        return
      }

      this.debug(`Connecting to device at ${this.address}`)
      this.ws.on('open', () => {
        this.debug(`Connected to device at ${this.address}`)

        this.send("Shelly.GetDeviceInfo")
          .catch((error) => {
            this.debug(`Error getting initial device information from ${this.address}: ${error}`)
            reject(error)
          })
          .then((deviceInfo) => {
            this.id = deviceInfo.id
            this.name = deviceInfo.name || null
            this.model = deviceInfo.model
            this.gen = deviceInfo.gen

            this.debug(`Initial device information retrieved successfully from ${this.address}: ${this.id} (${this.model}, Gen ${this.gen})`)
            //console.log(JSON.stringify(deviceInfo, null, 2))

            this.send("Shelly.GetStatus")
              .then((result) => {
                this.debug(`Initial device status retrieved successfully from ${this.id}`)
                console.log(JSON.stringify(result, null, 2))
                this.getCapabilities(result)
                this.registerForPuts(result)
                this.sendDeltas(result)
                this.connected = true
                resolve(this)
              })
              .catch((error) => {
                this.debug(`Error getting initial device status: ${error}`)
                reject(error)
              })
          })
      })

      this.ws.on('message', (message) => {
        let parsedMessage = JSON.parse(message.toString())
        //this.debug(`Received message from device ${this.id}: ${JSON.stringify(parsedMessage)}`)

        if ( parsedMessage.method === 'NotifyStatus') {
          this.sendDeltas(parsedMessage.params)
        } else {
          const pendingRequest = this.pendingRequests[parsedMessage.id]
          if (pendingRequest) {
            clearTimeout(pendingRequest.timeout)
            if (parsedMessage.error) {
              pendingRequest.reject(parsedMessage.error)
            } else {
              pendingRequest.resolve(parsedMessage.result)
            }
            delete this.pendingRequests[parsedMessage.id]
          }
        }
      })

      this.ws.on('error', (error) => {
        //console.error(`Error occurred while connecting to device ${this.id}: ${error}`)
        reject(error)
      })

      this.ws.on('close', () => {
        //console.log(`Connection to device ${this.id} closed`)
      })
    })
  }

  disconnect() {
    if (this.ws) {
      this.connected = false
      this.ws.close()
      this.ws = null
    }
  }

  private async send(method: string, params: any = {}): Promise<any> {
    if (!this.ws) {
      throw new Error(`WebSocket is not connected`)
    }

    const id = this.next_id++
    const message = JSON.stringify({
      jsonrpc: "2.0",
      src: "signalk-shelly2",
      id,
      method,
      params
    })

    this.ws.send(message)

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        delete this.pendingRequests[id]
        reject(new Error(`Request ${id} for ${method} timed out`))
      }, 5000)

      this.pendingRequests[id] = {
        resolve,
        reject,
        timeout
      }
    })
  }

  async setSwitch(value: any, switchIdx: number) {
    const expected = value === 1 || value === 'on' || value === 'true' || value === true
    await this.send("Switch.Set", { id: switchIdx, on: expected })
    const status = await this.getSwitch(switchIdx)
    if (status.output !== expected) {
      throw new Error(`Failed to set switch ${switchIdx} to ${expected}`)
    }
    this.sendDeltas({[`switch:${switchIdx}`]: status })
  }

  async getSwitch(switchIdx: number): Promise<any> {
    const res = await this.send("Switch.GetStatus", { id: switchIdx })
    return res
  }

  private getCapabilities(status: any) {
    this.numSwitches = 0
    for (let i = 0; i < 10; i++) {
      if (status[`switch:${i}`]) {
        this.numSwitches++
      }
    }
  }

  private getDevicePath(key?: string) {
    let name = this.deviceSettings?.devicePath
    if ( name === undefined ) {
      name = this.name ? camelCase(this.name) : this.id
    }
    return `electrical.switches.${name}${key ? '.' + key : ''}`
  }

  private getSwitchProps (relay: number) {
    return this.deviceSettings ? this.deviceSettings[`switch${relay}`] : undefined
  }

  private getSwitchPath(relay: number, key: any = 'state') {
    const switchProps = this.getSwitchProps(relay)

    let path = this.getDevicePath()
    if ( this.numSwitches > 1 ) {
      path = path + `.${switchProps?.switchPath || relay}`
    }

    return path + (key ? '.' + key : '')
  }

  sendDeltas(status: any) {
    let values: any = []

    if (this.deviceSettings?.enabled === false) {
      return
    }

    if (!this.sentMeta) {
      this.sendMeta(status)
      this.sentMeta = true
    }

    if ( this.name ) {
      values.push({
        path: this.getDevicePath('name'),
        value: this.name
      })
    }

    values.push({
      path: this.getDevicePath('model'),
      value: this.model
    })

    if (this.numSwitches > 0) {
      for (let i = 0; i < this.numSwitches; i++) {
        const switchProps = this.getSwitchProps(i)

        if (switchProps?.enabled === false) {
          continue
        }

        const switchStatus = status[`switch:${i}`]

        if (switchStatus !== undefined) {
          values.push({
            path: this.getSwitchPath(i),
            value: switchStatus?.output ? true : false
          })

          let readPaths = switchReadPaths()
          readPaths?.forEach((p: any) => {
            const path = p.path || p.key
            const converter = p.converter
            const val = switchStatus[p.key]
            if (val !== undefined) {
              values.push({
                path: this.getSwitchPath(i, path),
                value: converter ? converter(val) : val
              })
            }
          })
        }

        /* 
        if (info.isDimmable) {
          const dimmerKey = `brightness${i}`
          values.push({
            path: getSwitchPath(device, i, 'dimmingLevel'),
            value: Number((device[dimmerKey] / 100).toFixed(2))
          })
        }
        const powerKey = `power${i}`
        if (typeof device[powerKey] !== 'undefined') {
          values.push({
            path: getSwitchPath(device, i, 'power'),
            value: device[powerKey]
          })
        }
          */
      }
    }

    readKeys.forEach((p: any) => {
      for (let i = 0; i < MAX_INPUTS; i++) {
        const key = p.key
        const converter = p.converter
        const val = status[`${key}:${i}`]
        if (val !== undefined) {
          values.push({
            path: this.getSwitchPath(i, `${key}${i}`),
            value: converter ? converter(val) : val
          })
        }
      }
    })
    /*
    if ( this.numInputs > 0) {
      for (let i = 0; i < this.numInputs; i++) {
        const inputStatus = status[`input:${i}`]
        if (inputStatus !== undefined) {
          values.push({
            path: this.getSwitchPath(i, `input${i}`),
            value: inputStatus?.state ? true : false
          })
        }
      }
    }
      */
    /*
    info.putPaths?.forEach((prop: any) => {
      const path = `${getDevicePath(device)}.${prop.name || prop.deviceProp}`
      let value
      if (!prop.deviceProp) {
        value = prop.getter(device)
      } else {
        value = prop.convertFrom
          ? prop.convertFrom(device[prop.deviceProp], device)
          : device[prop.deviceProp]
      }
      values.push({
        path,
        value
      })
    })
 
    info.readPaths?.forEach((info: any) => {
      let path, key, converter
      if (typeof info === 'string') {
        path = key = info
      } else {
        key = info.key
        path = info.path ? info.path : info.key
        converter = info.converter
      }
      let val: any
      if ( key.indexOf('.') !== -1 ) {
        let split =  key.split('.')
        val = device
        split.forEach((k: any) => {
          if ( typeof val === 'undefined' ) {
            val = undefined
          } else {
            val = val[k]
          }
        })
      } else {
        val = device[key]
      }
      if (val != null) {
        values.push({
          path: `${getDevicePath(device)}.${path}`,
          value: converter ? converter(val) : val
        })
        if ( info.notification && (typeof deviceProps?.sendNotifications === 'undefined' || deviceProps?.sendNotifications) ) {
          let state, message
          if ( info.notification.handler(val) ) {
            state = 'alarm'
            message = info.notification.messageOn
          } else {
            state = 'normal'
            message = info.notification.messageOff
          }
          values.push({
            path: `notifications.${getDevicePath(device)}.${path}`,
            value: {
              state,
              message: `${deviceProps?.devicePath || deviceKey(device)} ${message}`,
              method: [ 'sound', 'visual']
            }
          })
        }
      }
    })
      */

    if (values.length > 0) {
      this.debug('sending deltas %j', values)
      this.app.handleMessage(this.plugin.id, {
        updates: [
          {
            values
          }
        ]
      })
    }
  }

  sendMeta(status:any) {
    let meta: any = []

    const devicePath = this.getDevicePath()

    if (this.deviceSettings?.enabled === false) {
      return
    }

    if (this.deviceSettings?.displayName || this.name) {
      meta.push({
        path: devicePath,
        value: {
          displayName: this.deviceSettings?.displayName || this.name
        }
      })
    }

    if (this.numSwitches > 1) {
      for (let i = 0; i < this.numSwitches; i++) {
        const switchProps = this.getSwitchProps(i)

        if (switchProps?.enabled === false) {
          continue
        }

        meta.push({
          path: this.getSwitchPath(i),
          value: {
            units: 'bool',
            displayName: switchProps?.displayName,
            //timeout: this.ttl ? (this.ttl / 1000) : undefined
          }
        })

        let readPaths = switchReadPaths()
        readPaths?.forEach((p: any) => {
          if (p.meta && status[`switch:${i}`][p.key] !== undefined) {
            meta.push({
              path: this.getSwitchPath(i, p.path || p.key),
              value: p.meta
            })
          }
        })
        /*
        if ( info.bankReadPaths ) {
          let readPaths = info.bankReadPaths(`${info.switchKey}${i}`)
          readPaths?.forEach((p: any) => {
            if ( p.meta ) {
              meta.push({
                path: getSwitchPath(device, i, p.path),
                value: p.meta
              })
            }
          })
        }
        if (info.isDimmable) {
          meta.push({
            path: getSwitchPath(device, i, 'dimmingLevel'),
            value: {
              units: 'ratio',
              displayName: switchProps?.displayName,
              type: 'dimmer',
              canDimWhenOff: info.canDimWhenOff
            }
          })
        }
          */
        if (switchProps?.displayName) {
          meta.push({
            path: this.getSwitchPath(i, null),
            value: {
              displayName: switchProps?.displayName
            }
          })
        }
        const powerKey = `power${i}`
        if (status[powerKey] !== 'undefined') {
          meta.push({
            path: this.getSwitchPath(i, 'power'),
            value: {
              units: 'W'
            }
          })
        }
      }
    } else {
      meta.push({
        path: this.getSwitchPath(0),
        value: {
          units: 'bool',
          displayName: this.deviceSettings?.displayName || this.name,
        }
      })

      let readPaths = switchReadPaths()
      readPaths?.forEach((p: any) => {
        if (p.meta && status[`switch:${0}`][p.key] !== undefined) {
          meta.push({
            path: this.getSwitchPath(0, p.path || p.key),
            value: p.meta,
            displayName: this.deviceSettings?.displayName || this.name
          })
        }
      })
    }

    /*
    if (this.numInputs > 0) {
      for (let i = 0; i < this.numInputs; i++) {
        const inputStatus = status[`input:${i}`]
        if (inputStatus !== undefined) {
          meta.push({
            path: this.getSwitchPath(i, `input${i}`),
            value: {units: 'bool'}
          })
        }
      }
    }
      */


    /*
    info.putPaths?.forEach((prop: any) => {
      if ( device.ttl ) {
        meta.push({
          path: `${devicePath}.${prop.name || prop.deviceProp}`,
          value: {
            timeout: device.ttl / 1000
          }
        })
      }
      if (deviceProps?.displayName || prop.meta) {
        meta.push({
          path: `${devicePath}.${prop.name || prop.deviceProp}`,
          value: {
            ...prop.meta,
            displayName: deviceProps?.displayName
          }
        })
        if (deviceProps?.displayName) {
          meta.push({
            path: devicePath,
            value: {
              displayName: deviceProps?.displayName
            }
          })
        }
        if (deviceProps?.presets && deviceProps.presets.length > 0) {
          meta.push({
            path: `${devicePath}.preset`,
            value: {
              displayName: deviceProps?.displayName,
              possibleValues: [
                ...deviceProps.presets.map((preset: any) => {
                  return {
                    title: preset.name,
                    value: preset.name
                  }
                })
              ],
              enum: [...deviceProps.presets.map((preset: any) => preset.name)]
            }
          })
        }
      }
    })
   
    info.readPaths?.forEach((prop: any) => {
      let key, path
      
      if (typeof prop === 'string') {
        path = key = prop
      } else {
        key = prop.key
        path = prop.path ? prop.path : prop.key
      }
   
      let split = key.split('.')
      key = split[split.length-1]
      
      if ( device.ttl ) {
        meta.push({
          path: `${devicePath}.${path}`,
          value: {
            timeout: device.ttl / 1000
          }
        })
      }
      if ( typeof prop !== 'string' && prop.meta) {
        meta.push({
          path: `${devicePath}.${path}`,
          value: prop.meta
        })
      }
      if (key.startsWith('power')) {
        meta.push({
          path: `${devicePath}.${path}`,
          value: {
            units: 'W'
          }
        })
      }
      if (key.startsWith('externalTemperature') || key.startsWith('temperature') || key === 'deviceTemperature') {
        meta.push({
          path: `${devicePath}.${path}`,
          value: {
            units: 'K'
          }
        })
      }
    })
  */

    if (meta.length) {
      this.debug('sending meta: %j', meta)
      this.app.handleMessage(this.plugin.id, {
        updates: [
          {
            meta
          }
        ]
      })
    }
  }

  registerForPuts (status:any): boolean {
      if (this.numSwitches > 0) {
        for (let i = 0; i < this.numSwitches; i++) {
          const switchProps = this.getSwitchProps(i)

          if (switchProps?.enabled === false) {
            continue
          }

          const path = this.getSwitchPath(i)

          this.app.registerPutHandler(
            'vessels.self',
            path,
            (context: string, path: string, value: any, cb: any) => {
              return this.valueHandler(
                context,
                path,
                value,
                (device: Device, value: any) => {
                  return device.setSwitch(value, i)
                },
                cb
              )
            }
          )
  
          /*
          if ( info.bankReadPaths ) {
            let readPaths = info.bankReadPaths(`${info.switchKey}${i}`)
            readPaths?.forEach((prop: any) => {
              let key, path
        
              if (typeof prop === 'string') {
                path = key = info
              } else {
                key = prop.key
                path = prop.path ? prop.path : prop.key
              }
              
              let split = key.split('.')
              let attrName = split[split.length-1]
              
              if ( split.length > 1 ) {
                if ( device[split[0]] ) {
                  device[split[0]].on(`change:${attrName}`, (newValue: any) => {
                    if ( !stopped ) {
                      debug(
                        `${device.id} ${key} changed to ${JSON.stringify(newValue)}`
                      )
                      sendDeltas(device)
                    }
                  })
                }
              } else {
                device.on(`change:${attrName}`, (newValue: any) => {
                  if ( !stopped ) {
                    debug(
                      `${device.id} ${key} changed to ${newValue}`
                    )
                    sendDeltas(device)
                  }
                })
              }
            })
          }
  
          if (info.isDimmable) {
            const dimmerPath = getSwitchPath(device, i, 'dimmingLevel')
  
            app.registerPutHandler(
              'vessels.self',
              dimmerPath,
              (context: string, path: string, value: any, cb: any) => {
                return valueHandler(
                  context,
                  path,
                  value,
                  device,
                  (device: any, value: any) => {
                    return info.dimmerSetter(device, value, i)
                  },
                  cb
                )
              }
            )
          }
            */
        }
      }
  
      /*
      info.putPaths?.forEach((prop: any) => {
        const path = `${getDevicePath(device)}.${prop.name || prop.deviceProp}`
        app.registerPutHandler(
          'vessels.self',
          path,
          (context: string, path: string, value: any, cb: any) => {
            return valueHandler(context, path, value, device, prop.setter, cb)
          }
        )
        if ( info.nextGen ) {
          device[prop.deviceProp].on('change:output', (newValue:any) => {
            if ( !stopped ) {
              debug(
                `${device.id} ${prop.deviceProp} changed to ${newValue}`
              )
              sendDeltas(device)
            }
          })
        }
      })
  
      info.readPaths?.forEach((prop: any) => {
        if ( info.nextGen ) {
          let key, path
        
          if (typeof prop === 'string') {
            path = key = info
          } else {
            key = prop.key
            path = prop.path ? prop.path : prop.key
          }
  
          let split = key.split('.')
          let attrName = split[split.length-1]
  
          if ( split.length > 1 ) {
            if ( device[split[0]] ) {
              device[split[0]].on(`change:${attrName}`, (newValue: any) => {
                if ( !stopped ) {
                  debug(
                    `${device.id} ${key} changed to ${newValue}`
                  )
                  sendDeltas(device)
                }
              })
            }
          } else {
            device.on(`change:${attrName}`, (newValue: any) => {
              if ( !stopped ) {
                debug(
                  `${device.id} ${key} changed to ${newValue}`
                )
                sendDeltas(device)
              }
            })
          }
        }
        
      })*/
  
      return true
    }
  
    valueHandler (
      context: string,
      path: string,
      value: any,
      func: (device: Device, value: any) => Promise<any>,
      cb: any,
      validator?: (result: any) => boolean
    ) {
      func(this, value)
        .then((status: any) => {
          let code = validator === undefined || validator(status) ? 200 : 400
          cb({
            state: 'COMPLETED',
            statusCode: code
          })
        })
        .catch((err: any) => {
          this.app.error(err.message)
          this.app.setPluginError(err.message)
          cb({ state: 'COMPLETED', statusCode: 400, message: err.message })
        })
      return { state: 'PENDING' }
    }
  

}

  const switchReadPaths = () => {
    return [
      {
        key: `voltage`,
        meta: {
          units: 'V'
        }
      },
      {
        key: `temperature`,
        converter: temperatureConverter,
        meta: {
          units: 'K'
        }
      },
      {
        key: `source`,
        /*meta: {
          units: 'string'
        }*/
      },
      {
        key: `apower`,
        meta: {
          units: 'W'
        }
      },
      {
        key: `current`,
        meta: {
          units: 'A'
        }
      },
      {
        key: `pf`,
        path: 'powerFactor',
        converter: (val:any) => {
          return val * 1000
        },
        meta: {
          units: 'W'
        }
      }
    ]
  }

const temperatureConverter = (value: any) => {
  return value?.tC + 273.15
}

const humidityConverter = (value: any) => {
    return value / 100
}

const readKeys = [
  {
    key: 'input',
    converter: (v:any) => v.state,
    meta: {
      units: 'bool'
    }
  },
  {
    key: 'temperature',
    converter: (v:any) => temperatureConverter(v.tC),
    meta: {
      units: 'K'
    }
  },
  {
    key: 'humidity',
    converter: (v:any) => humidityConverter(v.rh),
    meta: {
      units: 'K'
    }
  },
  {
    key: 'voltmeter',
    converter: (v:any) => v.voltage,
    meta: {
      units: 'K'
    }
  }
]
