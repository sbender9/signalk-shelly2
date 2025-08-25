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
  numLights: number = 0
  address: string
  hostname: string | undefined
  name: string | undefined = undefined
  model: string | null = null
  gen: number | null = null

  private ws: WebSocket | null = null
  private next_id: number = 1
  private pendingRequests: { [key: number]: PendingRequest } = {}
  private deviceSettings: any | undefined
  private sentMeta: boolean = false
  private app: any
  private plugin: any
  private reconnectAttempts: number = 0
  private maxReconnectAttempts: number = -1
  private reconnectTimeout: NodeJS.Timeout | null = null
  private shouldReconnect: boolean = true
  private isReconnecting: boolean = false

  constructor (
    app: any,
    plugin: any,
    deviceSettings: any,
    id: string,
    address: string,
    hostname?: string,
    name?: string
  ) {
    this.address = address
    this.deviceSettings = deviceSettings
    this.app = app
    this.plugin = plugin
    this.hostname = hostname
    this.name = name
    this.id = id

    // Configure reconnection parameters from device settings or use defaults
    this.maxReconnectAttempts = deviceSettings?.maxReconnectAttempts ?? -1
    this.shouldReconnect = deviceSettings?.enableReconnection !== false // Default to true unless explicitly disabled
  }

  private debug (...args: any[]) {
    this.app.debug(...args)
  }

  private createWebSocketConnection (): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      try {
        const ws = new WebSocket(`ws://${this.hostname || this.address}/rpc`)

        const onOpen = () => {
          this.debug(`Connected to device at ${this.address}`)
          ws.removeListener('error', onError)
          resolve(ws)
        }

        const onError = (error: any) => {
          ws.removeListener('open', onOpen)
          reject(error)
        }

        ws.once('open', onOpen)
        ws.once('error', onError)
      } catch (error) {
        reject(error)
      }
    })
  }

  async connect (): Promise<Device> {
    this.shouldReconnect = true
    this.reconnectAttempts = 0

    return new Promise(async (resolve, reject) => {
      try {
        this.debug(`Connecting to device at ${this.address}`)
        this.ws = await this.createWebSocketConnection()
        this.setupWebSocketHandlers()

        // Reset reconnection state on successful connection
        this.reconnectAttempts = 0
        this.isReconnecting = false

        const deviceInfo = await this.send('Shelly.GetDeviceInfo')
        this.id = deviceInfo.id
        this.name = deviceInfo.name || null
        this.model = deviceInfo.model
        this.gen = deviceInfo.gen

        this.debug(
          `Initial device information retrieved successfully from ${this.address}: ${this.id} (${this.model}, Gen ${this.gen})`
        )
        this.debug(JSON.stringify(deviceInfo, null, 2))

        const result = await this.send('Shelly.GetStatus')
        this.debug(
          `Initial device status retrieved successfully from ${this.id}`
        )
        this.debug(JSON.stringify(result, null, 2))
        this.getCapabilities(result)
        this.registerForPuts(result)
        this.sendDeltas(result)
        this.connected = true
        resolve(this)
      } catch (error) {
        this.app.error(`Failed to connect to device ${this.address}: ${error}`)
        reject(error)
      }
    })
  }

  private setupWebSocketHandlers () {
    if (!this.ws) return

    this.ws.on('message', message => {
      let parsedMessage = JSON.parse(message.toString())
      //this.debug(`Received message from device ${this.id}: ${JSON.stringify(parsedMessage)}`)

      if (parsedMessage.method === 'NotifyStatus') {
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

    this.ws.on('error', error => {
      this.app.error(
        `WebSocket error for device ${this.id || this.address}: ${error}`
      )
      if (this.connected) {
        this.connected = false
        this.attemptReconnection()
      }
    })

    this.ws.on('close', (code, reason) => {
      this.debug(
        `WebSocket connection closed for device ${this.id ||
          this.address}. Code: ${code}, Reason: ${reason}`
      )
      if (this.connected) {
        this.connected = false
        this.attemptReconnection()
      }
    })
  }

  private attemptReconnection () {
    if (!this.shouldReconnect || this.isReconnecting) {
      return
    }

    if (
      this.maxReconnectAttempts != -1 &&
      this.reconnectAttempts >= this.maxReconnectAttempts
    ) {
      this.app.error(
        `Max reconnection attempts (${
          this.maxReconnectAttempts
        }) reached for device ${this.id || this.address}. Giving up.`
      )
      return
    }

    this.isReconnecting = true
    this.reconnectAttempts++

    // Calculate exponential backoff delay (1s, 2s, 4s, 8s, 16s, max 10s)
    const delay = Math.min(
      1000 * Math.pow(2, this.reconnectAttempts - 1),
      10000
    )

    this.debug(
      `Attempting to reconnect to device ${this.id ||
        this.address} in ${delay}ms (attempt ${this.reconnectAttempts}/${
        this.maxReconnectAttempts
      })`
    )

    this.reconnectTimeout = setTimeout(async () => {
      try {
        this.debug(`Reconnecting to device ${this.id || this.address}...`)
        this.ws = await this.createWebSocketConnection()
        this.setupWebSocketHandlers()

        // Re-register for status updates after reconnection
        const result = await this.send('Shelly.GetStatus')
        this.registerForPuts(result)

        this.connected = true
        this.reconnectAttempts = 0
        this.isReconnecting = false
        this.debug(
          `Successfully reconnected to device ${this.id || this.address}`
        )
      } catch (error) {
        this.debug(
          `Reconnection attempt ${
            this.reconnectAttempts
          } failed for device ${this.id || this.address}: ${error}`
        )
        this.isReconnecting = false

        // Schedule next reconnection attempt
        this.attemptReconnection()
      }
    }, delay)
  }

  disconnect () {
    // Stop any reconnection attempts
    this.shouldReconnect = false
    this.isReconnecting = false

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }

    if (this.ws) {
      this.connected = false
      this.ws.close()
      this.ws = null
    }

    // Clear any pending requests
    Object.values(this.pendingRequests).forEach(request => {
      clearTimeout(request.timeout)
      request.reject(new Error('Device disconnected'))
    })
    this.pendingRequests = {}
  }

  /**
   * Manually trigger a reconnection attempt
   */
  forceReconnect () {
    if (this.connected) {
      this.debug(`Force reconnecting device ${this.id || this.address}`)
      this.disconnect()
    }

    this.shouldReconnect = true
    this.reconnectAttempts = 0
    this.attemptReconnection()
  }

  /**
   * Check if the device is currently attempting to reconnect
   */
  get reconnecting (): boolean {
    return this.isReconnecting
  }

  /**
   * Get the current reconnection attempt count
   */
  get reconnectionAttempts (): number {
    return this.reconnectAttempts
  }

  private async send (method: string, params: any = {}): Promise<any> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error(
        `WebSocket is not connected (state: ${this.ws?.readyState || 'null'})`
      )
    }

    const id = this.next_id++
    const message = JSON.stringify({
      jsonrpc: '2.0',
      src: 'signalk-shelly2',
      id,
      method,
      params
    })

    try {
      this.ws.send(message)
    } catch (error) {
      throw new Error(`Failed to send WebSocket message: ${error}`)
    }

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

  async poll () {
    if (!this.connected) {
      return
    }

    const status = await this.send('Shelly.GetStatus')
    this.sendDeltas(status)
  }

  async setSwitch (value: any, switchIdx: number) {
    const expected =
      value === 1 || value === 'on' || value === 'true' || value === true
    await this.send('Switch.Set', { id: switchIdx, on: expected })
    const status = await this.getSwitch(switchIdx)
    if (status.output !== expected) {
      throw new Error(`Failed to set switch ${switchIdx} to ${expected}`)
    }
    this.sendDeltas({ [`switch:${switchIdx}`]: status })
  }

  async getSwitch (switchIdx: number): Promise<any> {
    const res = await this.send('Switch.GetStatus', { id: switchIdx })
    return res
  }

  async setLight (value: any, lightIdx: number) {
    const expected =
      value === 1 || value === 'on' || value === 'true' || value === true
    await this.send('Light.Set', { id: lightIdx, on: expected })
    const status = await this.getLight(lightIdx)
    if (status.output !== expected) {
      throw new Error(`Failed to set light ${lightIdx} to ${expected}`)
    }
    this.sendDeltas({ [`light:${lightIdx}`]: status })
  }

  async setDimmer (value: any, lightIdx: number) {
    const expected = Math.round(value * 100)
    await this.send('Light.Set', { id: lightIdx, brightness: expected })
    const status = await this.getLight(lightIdx)
    if (status.brightness !== expected) {
      throw new Error(`Failed to set light ${lightIdx} to ${expected}`)
    }
    this.sendDeltas({ [`light:${lightIdx}`]: status })
  }

  async getLight (lightIdx: number): Promise<any> {
    const res = await this.send('Light.GetStatus', { id: lightIdx })
    return res
  }

  private getCapabilities (status: any) {
    this.numSwitches = 0
    this.numLights = 0
    for (let i = 0; i < 10; i++) {
      if (status[`switch:${i}`]) {
        this.numSwitches++
      }
      if (status[`light:${i}`]) {
        this.numLights++
      }
    }
  }

  private getDevicePath (key?: string) {
    let name = this.deviceSettings?.devicePath
    if (name === undefined) {
      name = this.name ? camelCase(this.name) : this.id
    }
    return `electrical.switches.${name}${key ? '.' + key : ''}`
  }

  private getSwitchProps (relay: number) {
    return this.deviceSettings
      ? this.deviceSettings[`switch${relay}`]
      : undefined
  }

  private getLightProps (light: number) {
    return this.deviceSettings
      ? this.deviceSettings[`light${light}`]
      : undefined
  }

  private getSwitchPath (relay: number, key: any = 'state') {
    const switchProps = this.getSwitchProps(relay)

    let path = this.getDevicePath()
    if (this.numSwitches > 1) {
      path = path + `.${switchProps?.switchPath || relay}`
    }

    return path + (key ? '.' + key : '')
  }

  private getLightPath (light: number, key: any = 'state') {
    const lightProps = this.getLightProps(light)

    let path = this.getDevicePath()
    if (this.numLights > 1) {
      path = path + `.${lightProps?.lightPath || light}`
    }

    return path + (key ? '.' + key : '')
  }

  sendDeltas (status: any) {
    let values: any = []

    if (this.deviceSettings?.enabled === false) {
      return
    }

    if (!this.sentMeta) {
      this.sendMeta(status)
      this.sentMeta = true
    }

    if (this.name) {
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
      }
    }

    if (this.numLights > 0) {
      for (let i = 0; i < this.numLights; i++) {
        const lightProps = this.getLightProps(i)

        if (lightProps?.enabled === false) {
          continue
        }

        const lightStatus = status[`light:${i}`]

        if (lightStatus !== undefined) {
          values.push({
            path: this.getLightPath(i),
            value: lightStatus?.output ? true : false
          })

          values.push({
            path: this.getLightPath(i, 'dimmingLevel'),
            value: lightStatus?.brightness / 100
          })

          let readPaths = switchReadPaths()
          readPaths?.forEach((p: any) => {
            const path = p.path || p.key
            const converter = p.converter
            const val = lightStatus[p.key]
            if (val !== undefined) {
              values.push({
                path: this.getLightPath(i, path),
                value: converter ? converter(val) : val
              })
            }
          })
        }
      }
    }

    readKeys.forEach((p: any) => {
      for (let i = 0; i < MAX_INPUTS; i++) {
        const key = p.key
        const path = p.path ? `.${p.path}` : ''
        const converter = p.converter
        const val = status[`${key}:${i}`]
        if (val !== undefined) {
          const converted = converter ? converter(val) : val
          if (converted !== undefined) {
            values.push({
              path: this.getSwitchPath(i, `${key}.${i}${path}`),
              value: converted
            })
          }
        }
      }
    })

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

  sendMeta (status: any) {
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
            displayName: switchProps?.displayName
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

        if (switchProps?.displayName) {
          meta.push({
            path: this.getSwitchPath(i, null),
            value: {
              displayName: switchProps?.displayName
            }
          })
        }
      }
    } else {
      meta.push({
        path: this.getSwitchPath(0),
        value: {
          units: 'bool',
          displayName: this.deviceSettings?.displayName || this.name
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

    if (this.numLights > 1) {
      for (let i = 0; i < this.numLights; i++) {
        const lightProps = this.getLightProps(i)

        if (lightProps?.enabled === false) {
          continue
        }

        meta.push({
          path: this.getLightPath(i),
          value: {
            units: 'bool',
            displayName: lightProps?.displayName
          }
        })

        meta.push({
          path: this.getLightPath(i, 'dimmingLevel'),
          value: {
            units: 'ratio',
            displayName: lightProps?.displayName
          }
        })

        let readPaths = switchReadPaths()
        readPaths?.forEach((p: any) => {
          if (p.meta && status[`light:${i}`][p.key] !== undefined) {
            meta.push({
              path: this.getLightPath(i, p.path || p.key),
              value: p.meta
            })
          }
        })

        if (lightProps?.displayName) {
          meta.push({
            path: this.getLightPath(i, null),
            value: {
              displayName: lightProps?.displayName
            }
          })
        }
      }
    } else {
      meta.push({
        path: this.getLightPath(0),
        value: {
          units: 'bool',
          displayName: this.deviceSettings?.displayName || this.name
        }
      })

      meta.push({
        path: this.getLightPath(0, 'dimmingLevel'),
        value: {
          units: 'ratio',
          displayName: this.deviceSettings?.displayName
        }
      })

      let readPaths = switchReadPaths()
      readPaths?.forEach((p: any) => {
        if (p.meta && status[`light:${0}`][p.key] !== undefined) {
          meta.push({
            path: this.getLightPath(0, p.path || p.key),
            value: p.meta,
            displayName: this.deviceSettings?.displayName || this.name
          })
        }
      })
    }

    readKeys.forEach((p: any) => {
      for (let i = 0; i < MAX_INPUTS; i++) {
        const key = p.key
        const path = p.path ? `.${p.path}` : ''
        const converter = p.converter
        const val = status[`${key}:${i}`]
        if (val !== undefined && p.meta) {
          const converted = converter ? converter(val) : val
          if (converted !== undefined) {
            meta.push({
              path: this.getSwitchPath(i, `${key}.${i}${path}`),
              value: p.meta
            })
          }
        }
      }
    })

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

  registerForPuts (status: any): boolean {
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
      }
    }

    if (this.numLights > 0) {
      for (let i = 0; i < this.numLights; i++) {
        const lightProps = this.getLightProps(i)

        if (lightProps?.enabled === false) {
          continue
        }

        const path = this.getLightPath(i)

        this.app.registerPutHandler(
          'vessels.self',
          path,
          (context: string, path: string, value: any, cb: any) => {
            return this.valueHandler(
              context,
              path,
              value,
              (device: Device, value: any) => {
                return device.setLight(value, i)
              },
              cb
            )
          }
        )
        const dimmerPath = this.getLightPath(i, 'dimmingLevel')

        this.app.registerPutHandler(
          'vessels.self',
          dimmerPath,
          (context: string, path: string, value: any, cb: any) => {
            return this.valueHandler(
              context,
              path,
              value,
              (device: any, value: any) => {
                return this.setDimmer(value, i)
              },
              cb
            )
          }
        )
      }
    }

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
      key: `source`
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
      converter: (val: any) => {
        return val * 1000
      },
      meta: {
        units: 'W'
      }
    },
    {
      key: `freq`,
      meta: {
        units: 'Hz'
      }
    },
    {
      key: `aenergy`,
      path: 'aenergy.total',
      meta: {
        units: 'Wh'
      }
    },
    {
      key: `aenergy`,
      path: 'aenergy.by_minute'
    },
    {
      key: `aenergy`,
      path: 'aenergy.minute_ts'
    },
    {
      key: `ret_aenergy`,
      path: 'ret_aenergy.total',
      meta: {
        units: 'Wh'
      }
    },
    {
      key: `ret_aenergy`,
      path: 'ret_aenergy.by_minute'
    },
    {
      key: `ret_aenergy`,
      path: 'ret_aenergy.minute_ts'
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
    path: 'state',
    converter: (v: any) => v.state,
    meta: {
      units: 'bool'
    }
  },
  {
    key: 'input',
    path: 'percent',
    converter: (v: any) =>
      v.percent != undefined ? v.percent / 100 : undefined,
    meta: {
      units: 'ratio'
    }
  },
  {
    key: 'input',
    path: 'xpercent',
    converter: (v: any) => v.xpercent,
    meta: {
      units: 'ratio'
    }
  },
  {
    key: 'input',
    path: 'counts.total',
    converter: (v: any) => v.counts?.total
  },
  {
    key: 'input',
    path: 'counts.xtotal',
    converter: (v: any) => v.counts?.xtotal
  },
  {
    key: 'input',
    path: 'counts.xby_minute',
    converter: (v: any) => v.counts?.xby_minute
  },
  {
    key: 'input',
    path: 'counts.minute_ts',
    converter: (v: any) => v.counts?.minute_ts
  },
  {
    key: 'input',
    path: 'counts.by_minute',
    converter: (v: any) => v.counts?.by_minute
  },
  {
    key: 'input',
    path: 'counts.freq',
    converter: (v: any) => v.counts?.freq,
    meta: {
      units: 'Hz'
    }
  },
  {
    key: 'input',
    path: 'counts.xfreq',
    converter: (v: any) => v.counts?.xfreq,
    meta: {
      units: 'Hz'
    }
  },
  {
    key: 'input',
    path: 'counts.errors',
    converter: (v: any) => v.counts?.errors
  },
  {
    key: 'temperature',
    converter: (v: any) => temperatureConverter(v.tC),
    meta: {
      units: 'K'
    }
  },
  {
    key: 'humidity',
    converter: (v: any) => humidityConverter(v.rh),
    meta: {
      units: 'K'
    }
  },
  {
    key: 'voltmeter',
    converter: (v: any) => v.voltage,
    meta: {
      units: 'K'
    }
  }
]
