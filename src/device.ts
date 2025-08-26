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
export const supportedComponents = ['switch', 'light', 'rgb', 'rgbw']
const componentNames: { [key: string]: any } = {
  switch: 'Switch',
  light: 'Light',
  rgb: 'RGB',
  rgbw: 'RGBW'
}

export class Device {
  id: string | null = null
  connected: boolean = false
  componentCounts: { [key: string]: number } = {}
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
  private sentStaticDeltas: boolean = false

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
          this.attemptReconnection()
        }

        ws.once('open', onOpen)
        ws.once('error', onError)
      } catch (error) {
        reject(error)
        this.attemptReconnection()
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

  async setComponentValue (
    component: string,
    idx: number,
    getKey: string,
    setKey: string,
    value: any
  ) {
    await this.send(`${componentNames[component]}.Set`, {
      id: idx,
      [setKey]: value
    })
    const status = await this.getComponentStatus(component, idx)
    if (status[getKey] !== value) {
      throw new Error(`Failed to set ${component} ${idx} to ${value}`)
    }
    this.sendDeltas({ [`${component}:${idx}`]: status })
  }

  async getComponentStatus (component: string, idx: number): Promise<any> {
    const res = await this.send(`${componentNames[component]}.GetStatus`, {
      id: idx
    })
    return res
  }

  getCapabilities (status: any) {
    supportedComponents.forEach(component => {
      this.componentCounts[component] = 0

      for (let i = 0; i < 10; i++) {
        if (status[`${component}:${i}`]) {
          this.componentCounts[component]++
        }
      }
    })
  }

  private getDevicePath (key?: string) {
    let name = this.deviceSettings?.devicePath
    if (name === undefined) {
      name = this.name ? camelCase(this.name) : this.id
    }
    return `electrical.switches.${name}${key ? '.' + key : ''}`
  }

  private getComponentProps (component: string, relay: number) {
    return this.deviceSettings
      ? this.deviceSettings[`${component}${relay}`]
      : undefined
  }

  private getComponentPath (
    component: string,
    relay: number,
    key: string | undefined
  ) {
    const componentProps = this.getComponentProps(component, relay)

    let path = this.getDevicePath()
    if (this.componentCounts[component] > 1) {
      path =
        path + `.${componentProps?.path || componentProps?.switchPath || relay}`
    }

    return path + (key ? '.' + key : '')
  }

  private getComponentDeltas (
    status: any,
    component: string,
    onKey: string,
    values: any[]
  ) {
    let count = this.componentCounts[component]
    if (count > 0) {
      for (let i = 0; i < count; i++) {
        const componentProps = this.getComponentProps(component, i)

        if (componentProps?.enabled === false) {
          continue
        }

        const componentStatus = status[`${component}:${i}`]

        if (componentStatus !== undefined) {
          values.push({
            path: this.getComponentPath(component, i, 'state'),
            value: componentStatus[onKey] ? true : false
          })

          if (componentStatus.brightness !== undefined) {
            values.push({
              path: this.getComponentPath(component, i, 'dimmingLevel'),
              value: componentStatus.brightness / 100
            })
          }

          if (componentStatus.rgb !== undefined) {
            let rgb: number[] = componentStatus.rgb
            values.push({
              path: this.getComponentPath(component, i, 'rgb'),
              value: rgb
            })

            if (
              this.deviceSettings?.presets &&
              this.deviceSettings.presets.length > 0
            ) {
              let preset = null
              if (rgb !== undefined) {
                preset = this.deviceSettings.presets.find((preset: any) => {
                  return (
                    rgb[0] == preset.red &&
                    rgb[1] == preset.green &&
                    rgb[2] == preset.blue &&
                    (preset.white === undefined || rgb[3] == preset.white) &&
                    (preset.bright === 0 ||
                      componentStatus.brightness == preset.bright)
                  )
                })
              }
              values.push({
                path: this.getComponentPath(component, i, 'preset'),
                value: preset
              })
            }
          }

          if (componentStatus.white !== undefined) {
            values.push({
              path: this.getComponentPath(component, i, 'white'),
              value: componentStatus.white
            })
          }

          let readPaths = switchReadPaths()
          readPaths?.forEach((p: any) => {
            const path = p.path || p.key
            const converter = p.converter
            const val = componentStatus[p.key]
            if (val !== undefined) {
              values.push({
                path: this.getComponentPath(component, i, path),
                value: converter ? converter(val) : val
              })
            }
          })
        }
      }
    }
  }

  private getReadKeys (status: any, values: any[]) {
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
              path: this.getComponentPath('input', i, `${key}.${i}${path}`),
              value: converted
            })
          }
        }
      }
    })
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

    if (this.sentStaticDeltas === false) {
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
      this.sentStaticDeltas = true
    }

    this.getComponentDeltas(status, 'switch', 'output', values)
    this.getComponentDeltas(status, 'light', 'output', values)
    this.getComponentDeltas(status, 'rgb', 'output', values)
    this.getComponentDeltas(status, 'rgbw', 'output', values)
    this.getReadKeys(status, values)

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

  private getComponentMeta (status: any, component: string, meta: any[]) {
    let count = this.componentCounts[component]

    for (let i = 0; i < count; i++) {
      const componentProps = this.getComponentProps(component, i)

      if (count > 1 && componentProps?.enabled === false) {
        continue
      }

      const componentStatus = status[`${component}:${i}`]

      meta.push({
        path: this.getComponentPath(component, i, 'state'),
        value: {
          units: 'bool',
          displayName: componentProps?.displayName
          //timeout: this.ttl ? (this.ttl / 1000) : undefined
        }
      })

      if (
        this.deviceSettings?.presets &&
        this.deviceSettings.presets.length > 0
      ) {
        meta.push({
          path: this.getComponentPath(component, i, 'preset'),
          value: {
            displayName: componentProps?.displayName,
            possibleValues: [
              ...this.deviceSettings.presets.map((preset: any) => {
                return {
                  title: preset.name,
                  value: preset.name
                }
              })
            ],
            enum: [
              ...this.deviceSettings.presets.map((preset: any) => preset.name)
            ]
          }
        })
      }

      if (componentStatus?.brightness !== undefined) {
        meta.push({
          path: this.getComponentPath('light', i, 'dimmingLevel'),
          value: {
            units: 'ratio',
            displayName: componentProps.displayName
          }
        })
      }

      let readPaths = switchReadPaths()
      readPaths?.forEach((p: any) => {
        if (p.meta && componentStatus && componentStatus[p.key] !== undefined) {
          meta.push({
            path: this.getComponentPath(component, i, p.path || p.key),
            value: p.meta
          })
        }
      })

      if (count > 1 && componentProps?.displayName) {
        meta.push({
          path: this.getComponentPath(component, i, undefined),
          value: {
            displayName: componentProps?.displayName
          }
        })
      }
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

    this.getComponentMeta(status, 'switch', meta)
    this.getComponentMeta(status, 'light', meta)
    this.getComponentMeta(status, 'rgb', meta)
    this.getComponentMeta(status, 'rgbw', meta)

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
              path: this.getComponentPath('input', i, `${key}.${i}${path}`),
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

  private registerComponentPuts (status: any, component: string) {
    let count = this.componentCounts[component]
    if (count > 0) {
      for (let i = 0; i < count; i++) {
        const componentProps = this.getComponentProps(component, i)

        if (componentProps?.enabled === false) {
          continue
        }

        const path = this.getComponentPath(component, i, 'state')

        this.app.registerPutHandler(
          'vessels.self',
          path,
          (context: string, path: string, value: any, cb: any) => {
            return this.valueHandler(
              context,
              path,
              value,
              (value: any) => {
                return this.setComponentValue(
                  component,
                  i,
                  'output',
                  'on',
                  value === 1 ||
                    value === 'on' ||
                    value === 'true' ||
                    value === true
                )
              },
              cb
            )
          }
        )

        const componentStatus = status[`${component}:${i}`]

        if (componentStatus?.brightness !== undefined) {
          this.app.registerPutHandler(
            'vessels.self',
            this.getComponentPath(component, i, 'dimmingLevel'),
            (context: string, path: string, value: any, cb: any) => {
              return this.valueHandler(
                context,
                path,
                value,
                (value: any) => {
                  return this.setComponentValue(
                    component,
                    i,
                    'brightness',
                    'brightness',
                    Math.round(value * 100)
                  )
                },
                cb
              )
            }
          )
        }

        if (componentStatus?.rgb !== undefined) {
          this.app.registerPutHandler(
            'vessels.self',
            this.getComponentPath(component, i, 'rgb'),
            (context: string, path: string, value: any, cb: any) => {
              return this.valueHandler(
                context,
                path,
                value,
                (value: any) => {
                  return this.setComponentValue(
                    component,
                    i,
                    'rgb',
                    'rgb',
                    value
                  )
                },
                cb
              )
            }
          )

          if (
            this.deviceSettings?.presets &&
            this.deviceSettings.presets.length > 0
          ) {
            this.app.registerPutHandler(
              'vessels.self',
              this.getComponentPath(component, i, 'rgb'),
              (context: string, path: string, value: any, cb: any) => {
                return this.valueHandler(
                  context,
                  path,
                  value,
                  (value: any) => {
                    return new Promise((resolve, reject) => {
                      const preset = this.deviceSettings.presets.find(
                        (preset: any) => preset.name == value
                      )
                      if (!preset || value === 'Unknown') {
                        reject(new Error(`invalid preset ${value}`))
                        return
                      }
                      const rgb = [preset.red, preset.green, preset.blue]
                      if (preset.white !== undefined) {
                        rgb.push(preset.white)
                      }
                      this.send(`${componentNames[component]}.Set`, {
                        id: i,
                        rgb
                      })
                        .then(() => {
                          if (
                            preset.bright === undefined ||
                            preset.bright === 0
                          ) {
                            resolve(true)
                          } else {
                            this.send(`${componentNames[component]}.Set`, {
                              id: i,
                              brightness: preset.bright
                            })
                              .then(resolve)
                              .catch(reject)
                          }
                        })
                        .catch(reject)
                    })
                  },
                  cb
                )
              }
            )
          }
        }
        if (componentStatus?.white !== undefined) {
          this.app.registerPutHandler(
            'vessels.self',
            this.getComponentPath(component, i, 'white'),
            (context: string, path: string, value: any, cb: any) => {
              return this.valueHandler(
                context,
                path,
                value,
                (value: any) => {
                  return this.setComponentValue(
                    component,
                    i,
                    'white',
                    'white',
                    Math.round(value * 100)
                  )
                },
                cb
              )
            }
          )
        }
      }
    }
  }

  registerForPuts (status: any) {
    this.registerComponentPuts(status, 'switch')
    this.registerComponentPuts(status, 'light')
    this.registerComponentPuts(status, 'rgb')
    this.registerComponentPuts(status, 'rgbw')
  }

  valueHandler (
    context: string,
    path: string,
    value: any,
    func: (value: any) => Promise<any>,
    cb: any,
    validator?: (result: any) => boolean
  ) {
    func(value)
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
  },
  // EM (Energy Meter) component status fields
  {
    key: 'em',
    path: 'a_current',
    converter: (v: any) => v.a_current,
    meta: {
      units: 'A'
    }
  },
  {
    key: 'em',
    path: 'a_voltage',
    converter: (v: any) => v.a_voltage,
    meta: {
      units: 'V'
    }
  },
  {
    key: 'em',
    path: 'a_act_power',
    converter: (v: any) => v.a_act_power,
    meta: {
      units: 'W'
    }
  },
  {
    key: 'em',
    path: 'a_aprt_power',
    converter: (v: any) => v.a_aprt_power,
    meta: {
      units: 'VA'
    }
  },
  {
    key: 'em',
    path: 'a_pf',
    converter: (v: any) => v.a_pf,
    meta: {
      units: 'ratio'
    }
  },
  {
    key: 'em',
    path: 'a_freq',
    converter: (v: any) => v.a_freq,
    meta: {
      units: 'Hz'
    }
  },
  {
    key: 'em',
    path: 'b_current',
    converter: (v: any) => v.b_current,
    meta: {
      units: 'A'
    }
  },
  {
    key: 'em',
    path: 'b_voltage',
    converter: (v: any) => v.b_voltage,
    meta: {
      units: 'V'
    }
  },
  {
    key: 'em',
    path: 'b_act_power',
    converter: (v: any) => v.b_act_power,
    meta: {
      units: 'W'
    }
  },
  {
    key: 'em',
    path: 'b_aprt_power',
    converter: (v: any) => v.b_aprt_power,
    meta: {
      units: 'VA'
    }
  },
  {
    key: 'em',
    path: 'b_pf',
    converter: (v: any) => v.b_pf,
    meta: {
      units: 'ratio'
    }
  },
  {
    key: 'em',
    path: 'b_freq',
    converter: (v: any) => v.b_freq,
    meta: {
      units: 'Hz'
    }
  },

  {
    key: 'em',
    path: 'c_current',
    converter: (v: any) => v.c_current,
    meta: {
      units: 'A'
    }
  },
  {
    key: 'em',
    path: 'c_voltage',
    converter: (v: any) => v.c_voltage,
    meta: {
      units: 'V'
    }
  },
  {
    key: 'em',
    path: 'c_act_power',
    converter: (v: any) => v.c_act_power,
    meta: {
      units: 'W'
    }
  },
  {
    key: 'em',
    path: 'c_aprt_power',
    converter: (v: any) => v.c_aprt_power,
    meta: {
      units: 'VA'
    }
  },
  {
    key: 'em',
    path: 'c_pf',
    converter: (v: any) => v.c_pf,
    meta: {
      units: 'ratio'
    }
  },
  {
    key: 'em',
    path: 'c_freq',
    converter: (v: any) => v.c_freq,
    meta: {
      units: 'Hz'
    }
  },
  {
    key: 'em',
    path: 'n_current',
    converter: (v: any) => v.n_current,
    meta: {
      units: 'A'
    }
  },
  {
    key: 'em',
    path: 'total_current',
    converter: (v: any) => v.total_current,
    meta: {
      units: 'A'
    }
  },
  {
    key: 'em',
    path: 'total_act_power',
    converter: (v: any) => v.total_act_power,
    meta: {
      units: 'W'
    }
  },
  {
    key: 'em',
    path: 'total_aprt_power',
    converter: (v: any) => v.total_aprt_power,
    meta: {
      units: 'VA'
    }
  },
  {
    key: 'em',
    path: 'user_calibrated_phase',
    converter: (v: any) => v.user_calibrated_phase
  },
  // EM1 component status fields
  {
    key: 'em1',
    path: 'current',
    converter: (v: any) => v.current,
    meta: {
      units: 'A'
    }
  },
  {
    key: 'em1',
    path: 'voltage',
    converter: (v: any) => v.voltage,
    meta: {
      units: 'V'
    }
  },
  {
    key: 'em1',
    path: 'act_power',
    converter: (v: any) => v.act_power,
    meta: {
      units: 'W'
    }
  },
  {
    key: 'em1',
    path: 'aprt_power',
    converter: (v: any) => v.aprt_power,
    meta: {
      units: 'VA'
    }
  },
  {
    key: 'em1',
    path: 'pf',
    converter: (v: any) => v.pf,
    meta: {
      units: 'ratio'
    }
  },
  {
    key: 'em1',
    path: 'freq',
    converter: (v: any) => v.freq,
    meta: {
      units: 'Hz'
    }
  },
  // PM1 component status fields
  {
    key: 'pm1',
    path: 'voltage',
    converter: (v: any) => v.voltage,
    meta: {
      units: 'V'
    }
  },
  {
    key: 'pm1',
    path: 'current',
    converter: (v: any) => v.current,
    meta: {
      units: 'A'
    }
  },
  {
    key: 'pm1',
    path: 'apower',
    converter: (v: any) => v.apower,
    meta: {
      units: 'W'
    }
  },
  {
    key: 'pm1',
    path: 'aprtpower',
    converter: (v: any) => v.aprtpower,
    meta: {
      units: 'VA'
    }
  },
  {
    key: 'pm1',
    path: 'pf',
    converter: (v: any) => v.pf,
    meta: {
      units: 'ratio'
    }
  },
  {
    key: 'pm1',
    path: 'freq',
    converter: (v: any) => v.freq,
    meta: {
      units: 'Hz'
    }
  },
  {
    key: 'pm1',
    path: 'aenergy.total',
    converter: (v: any) => v.aenergy?.total,
    meta: {
      units: 'Wh'
    }
  },
  {
    key: 'pm1',
    path: 'aenergy.by_minute',
    converter: (v: any) => v.aenergy?.by_minute
  },
  {
    key: 'pm1',
    path: 'aenergy.minute_ts',
    converter: (v: any) => v.aenergy?.minute_ts
  },
  {
    key: 'pm1',
    path: 'ret_aenergy.total',
    converter: (v: any) => v.ret_aenergy?.total,
    meta: {
      units: 'Wh'
    }
  },
  {
    key: 'pm1',
    path: 'ret_aenergy.by_minute',
    converter: (v: any) => v.ret_aenergy?.by_minute
  },
  {
    key: 'pm1',
    path: 'ret_aenergy.minute_ts',
    converter: (v: any) => v.ret_aenergy?.minute_ts
  }
]
