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

export const supportedComponents = [
  'switch',
  'light',
  'rgb',
  'rgbw',
  'em',
  'em1',
  'pm1',
  'temperature',
  'humidity',
  'voltmeter',
  'input',
  'smoke',
  'devicepower'
]
const componentPaths: { [key: string]: any } = {
  switch: 'electrical.switches',
  light: 'electrical.switches',
  rgb: 'electrical.switches',
  rgbw: 'electrical.switches',
  em: 'electrical.energymeter',
  em1: 'electrical.energymeter',
  pm1: 'electrical.powermeter',
  temperature: 'environment',
  humidity: 'environment',
  voltmeter: 'electrical.voltmeter',
  smoke: 'environment.smoke'
}
const componentNames: { [key: string]: any } = {
  switch: 'Switch',
  light: 'Light',
  rgb: 'RGB',
  rgbw: 'RGBW',
  em: 'EM',
  em1: 'EM1',
  pm1: 'PM1',
  temperature: 'Temperature',
  humidity: 'Humidity',
  voltmeter: 'Voltmeter',
  smoke: 'Smoke'
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

  constructor(
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

  private debug(...args: any[]) {
    this.app.debug(...args)
  }

  private createWebSocketConnection(): Promise<WebSocket> {
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

  async connect(): Promise<Device> {
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

        /*
        result['devicepower:0'] = { battery: { V: 3.7, percent: 50 }, external: { present: true } }
        result['smoke:0'] = { alarm: false, mute: false }
        result['smoke:1'] = { alarm: true, mute: true }
        result['pm1:0'] = { freq: 10 }
        result['temperature:0'] = { tC: 22 }
        result['humidity:0'] = { rh: 22 }
        result['em:0'] = { 'a_current': 10 }
        result['input:1'] = { state: true }
        result['rgbw:0'] = { output: true, rgb: [255, 0, 0], brightness: 50, white: 255 }
        result['rgbw:1'] = { output: false, rgb: [255, 255, 0], brightness: 90, white: 198 }
        */

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

  private setupWebSocketHandlers() {
    if (!this.ws) return

    this.ws.on('message', (message) => {
      const parsedMessage = JSON.parse(message.toString())
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

    this.ws.on('error', (error) => {
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
        `WebSocket connection closed for device ${
          this.id || this.address
        }. Code: ${code}, Reason: ${reason}`
      )
      if (this.connected) {
        this.connected = false
        this.attemptReconnection()
      }
    })
  }

  private attemptReconnection() {
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
      `Attempting to reconnect to device ${
        this.id || this.address
      } in ${delay}ms (attempt ${this.reconnectAttempts}/${
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

  disconnect() {
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
    Object.values(this.pendingRequests).forEach((request) => {
      clearTimeout(request.timeout)
      request.reject(new Error('Device disconnected'))
    })
    this.pendingRequests = {}
  }

  /**
   * Manually trigger a reconnection attempt
   */
  forceReconnect() {
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
  get reconnecting(): boolean {
    return this.isReconnecting
  }

  /**
   * Get the current reconnection attempt count
   */
  get reconnectionAttempts(): number {
    return this.reconnectAttempts
  }

  private async send(method: string, params: any = {}): Promise<any> {
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

  async poll() {
    if (!this.connected) {
      return
    }

    const status = await this.send('Shelly.GetStatus')
    this.sendDeltas(status)
  }

  async setComponentValue(
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

  async getComponentStatus(component: string, idx: number): Promise<any> {
    const res = await this.send(`${componentNames[component]}.GetStatus`, {
      id: idx
    })
    return res
  }

  getCapabilities(status: any) {
    supportedComponents.forEach((component) => {
      this.componentCounts[component] = 0

      for (let i = 0; i < 10; i++) {
        if (status[`${component}:${i}`]) {
          this.componentCounts[component]++
        }
      }
    })
  }

  private getMainComponent() {
    for (const component of supportedComponents) {
      if (this.componentCounts[component] > 0) {
        return component
      }
    }
    return null
  }

  getDevicePath(key?: string) {
    const component = this.getMainComponent()
    const deviceRoot = component
      ? componentPaths[component]
      : 'electrical.unknown'
    let name = this.deviceSettings?.devicePath
    if (name !== undefined && name.indexOf('.') === -1) {
      name = `${deviceRoot}.${name}`
    } else if (name === undefined) {
      name = `${deviceRoot}.${this.name ? camelCase(this.name) : this.id}`
    }
    return `${name}${key ? '.' + key : ''}`
  }

  private getComponentProps(component: string, relay: number) {
    return this.deviceSettings
      ? this.deviceSettings[`${component}${relay}`]
      : undefined
  }

  private getComponentPath(
    component: string,
    id: number,
    key: string | undefined,
    flatten: boolean = true
  ) {
    const componentProps = this.getComponentProps(component, id)

    let path = this.getDevicePath()
    const count = this.componentCounts[component]
    if (count > 1) {
      if (flatten === false) {
        path = path + `.${component}`
      }
      path =
        path + `.${componentProps?.path || componentProps?.switchPath || id}`
    } else if (count === 1 && flatten === false) {
      path = path + `.${component}`
    }

    return path + (key ? '.' + key : '')
  }

  private getComponentDeltas(
    status: any,
    component: string,
    onKey: string,
    values: any[]
  ) {
    const count = this.componentCounts[component]
    if (count > 0) {
      for (let i = 0; i < count; i++) {
        const componentProps = this.getComponentProps(component, i)

        if (componentProps?.enabled === false) {
          continue
        }

        const componentStatus = status[`${component}:${i}`]

        if (componentStatus !== undefined) {
          if (component === 'rgb' || component === 'rgbw') {
            const rgb: number[] = componentStatus.rgb

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

          const readPaths = componentReadPaths[component]
          if (readPaths) {
            readPaths.paths.forEach((p: ReadPath) => {
              const val = deepGet(componentStatus, p.key)
              const converter = p.converter
              if (val !== undefined) {
                values.push({
                  path: this.getComponentPath(
                    component,
                    i,
                    p.path || p.key,
                    readPaths.flatten !== undefined ? readPaths.flatten : true
                  ),
                  value: converter ? converter(val) : val
                })
              }
            })
          }
        }
      }
    }
  }

  private getSmokeDeltas(status: any, values: any[]) {
    const component = 'smoke'
    const count = this.componentCounts[component]
    if (count > 0) {
      for (let i = 0; i < count; i++) {
        const componentProps = this.getComponentProps(component, i)

        if (componentProps?.enabled === false) {
          continue
        }

        const componentStatus = status[`${component}:${i}`]

        if (componentStatus !== undefined) {
          const method = ['visual']
          if (componentStatus.mute !== true) {
            method.push('sound')
          }
          values.push({
            path: `notifications.${this.getComponentPath(component, i, undefined)}`,
            value: {
              state: componentStatus.alarm ? 'alarm' : 'normal',
              method,
              message: `${componentStatus.alarm ? 'Smoke detected' : 'No smoke detected'} in ${componentProps?.displayName || this.deviceSettings?.displayName || i}`
            }
          })
        }
      }
    }
  }

  sendDeltas(status: any) {
    const values: any = []

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

      if (this.model) {
        values.push({
          path: this.getDevicePath('model'),
          value: this.model
        })
      }

      this.sentStaticDeltas = true
    }

    supportedComponents.forEach((component) => {
      this.getComponentDeltas(status, component, 'output', values)
    })

    this.getSmokeDeltas(status, values)

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

  private getComponentMeta(status: any, component: string, meta: any[]) {
    const count = this.componentCounts[component]

    for (let i = 0; i < count; i++) {
      const componentProps = this.getComponentProps(component, i)

      if (count > 1 && componentProps?.enabled === false) {
        continue
      }

      const componentStatus = status[`${component}:${i}`]

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

      const readPaths = componentReadPaths[component]
      if (readPaths) {
        readPaths.paths.forEach((p: ReadPath) => {
          const val = deepGet(componentStatus, p.key)
          if (val !== undefined) {
            const metaValue = {
              ...(p.meta || {}),
              displayName:
                componentProps?.displayName || this.deviceSettings?.displayName
            }
            if (Object.keys(metaValue).length > 0) {
              meta.push({
                path: this.getComponentPath(component, i, p.path || p.key),
                value: metaValue
              })
            }
          }
        })
      }

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

  sendMeta(status: any) {
    const meta: any = []

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

    supportedComponents.forEach((component) => {
      this.getComponentMeta(status, component, meta)
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

  private registerComponentPuts(status: any, component: string) {
    const count = this.componentCounts[component]
    if (count > 0) {
      for (let i = 0; i < count; i++) {
        const componentProps = this.getComponentProps(component, i)

        if (componentProps?.enabled === false) {
          continue
        }

        const componentStatus = status[`${component}:${i}`]

        if (componentStatus.output !== undefined) {
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
        }

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

  registerForPuts(status: any) {
    supportedComponents.forEach((component) => {
      this.registerComponentPuts(status, component)
    })
  }

  valueHandler(
    context: string,
    path: string,
    value: any,
    func: (value: any) => Promise<any>,
    cb: any,
    validator?: (result: any) => boolean
  ) {
    func(value)
      .then((status: any) => {
        const code = validator === undefined || validator(status) ? 200 : 400
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

const temperatureConverter = (value: any) => {
  return value + 273.15
}

const humidityConverter = (value: any) => {
  return value / 100
}

const percentConverter = (value: any) => {
  return value / 100
}

type ReadComponent = {
  flatten?: boolean
  paths: ReadPath[]
}

type ReadPath = {
  key: string
  path?: string
  converter?: (value: any) => any
  meta?: any
}

const commonSwitchPaths: ReadPath[] = [
  {
    key: `output`,
    path: `state`,
    meta: {
      units: 'bool'
    }
  },
  {
    key: `voltage`,
    meta: {
      units: 'V'
    }
  },
  {
    path: 'temperature',
    key: `temperature.tC`,
    converter: temperatureConverter,
    meta: {
      units: 'K'
    }
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
    key: 'aenergy.total',
    meta: {
      units: 'Wh'
    }
  },
  {
    key: 'aenergy.by_minute'
  },
  {
    key: 'aenergy.minute_ts'
  }
]

const componentReadPaths: { [key: string]: ReadComponent } = {
  switch: {
    paths: [
      ...commonSwitchPaths,
      {
        key: `pf`,
        meta: {
          units: 'ratio'
        }
      },
      {
        key: `freq`,
        meta: {
          units: 'Hz'
        }
      },

      {
        key: 'ret_aenergy.total',
        meta: {
          units: 'Wh'
        }
      },
      {
        key: 'ret_aenergy.by_minute'
      },
      {
        key: 'ret_aenergy.minute_ts'
      }
    ]
  },
  light: {
    paths: [
      ...commonSwitchPaths,
      {
        key: 'brightness',
        converter: percentConverter,
        meta: {
          units: 'ratio'
        }
      }
    ]
  },
  rgb: {
    paths: [
      ...commonSwitchPaths,
      {
        path: 'dimmingLevel',
        key: 'brightness',
        converter: percentConverter,
        meta: {
          units: 'ratio'
        }
      },
      {
        key: 'rgb'
      }
    ]
  },
  rgbw: {
    paths: [
      ...commonSwitchPaths,
      {
        path: 'dimmingLevel',
        key: 'brightness',
        converter: percentConverter,
        meta: {
          units: 'ratio'
        }
      },
      {
        key: 'rgb'
      },
      {
        key: 'white'
      }
    ]
  },
  input: {
    flatten: false,
    paths: [
      {
        key: 'state',
        meta: {
          units: 'bool'
        }
      },
      {
        key: 'percent',
        converter: (v: any) => (v != undefined ? v / 100 : undefined),
        meta: {
          units: 'ratio'
        }
      },
      {
        key: 'xpercent',
        meta: {
          units: 'ratio'
        }
      },
      {
        key: 'counts.total'
      },
      {
        key: 'counts.xtotal'
      },
      {
        key: 'counts.xby_minute'
      },
      {
        key: 'counts.minute_ts'
      },
      {
        key: 'counts.by_minute'
      },
      {
        key: 'counts.freq',
        meta: {
          units: 'Hz'
        }
      },
      {
        key: 'counts.xfreq',
        meta: {
          units: 'Hz'
        }
      }
    ]
  },
  temperature: {
    paths: [
      {
        key: 'tC',
        path: 'temperature',
        converter: temperatureConverter,
        meta: {
          units: 'K'
        }
      }
    ]
  },
  humidity: {
    paths: [
      {
        key: 'rh',
        path: 'humidity',
        converter: humidityConverter,
        meta: {
          units: 'ratio'
        }
      }
    ]
  },
  voltmeter: {
    paths: [
      {
        key: 'voltage',
        meta: {
          units: 'K'
        }
      }
    ]
  },
  em: {
    paths: [
      {
        key: 'a_current',
        meta: {
          units: 'A'
        }
      },
      {
        key: 'a_voltage',
        meta: {
          units: 'V'
        }
      },
      {
        key: 'a_act_power',
        meta: {
          units: 'W'
        }
      },
      {
        key: 'a_aprt_power',
        meta: {
          units: 'VA'
        }
      },
      {
        key: 'a_pf',
        meta: {
          units: 'ratio'
        }
      },
      {
        key: 'a_freq',
        meta: {
          units: 'Hz'
        }
      },
      {
        key: 'b_current',
        meta: {
          units: 'A'
        }
      },
      {
        key: 'b_voltage',
        meta: {
          units: 'V'
        }
      },
      {
        key: 'b_act_power',
        meta: {
          units: 'W'
        }
      },
      {
        key: 'b_aprt_power',
        meta: {
          units: 'VA'
        }
      },
      {
        key: 'b_pf',
        meta: {
          units: 'ratio'
        }
      },
      {
        key: 'b_freq',
        meta: {
          units: 'Hz'
        }
      },
      {
        key: 'c_current',
        meta: {
          units: 'A'
        }
      },
      {
        key: 'c_voltage',
        meta: {
          units: 'V'
        }
      },
      {
        key: 'c_act_power',
        meta: {
          units: 'W'
        }
      },
      {
        key: 'c_aprt_power',
        meta: {
          units: 'VA'
        }
      },
      {
        key: 'c_pf',
        meta: {
          units: 'ratio'
        }
      },
      {
        key: 'c_freq',
        meta: {
          units: 'Hz'
        }
      },
      {
        key: 'n_current',
        meta: {
          units: 'A'
        }
      },
      {
        key: 'total_current',
        meta: {
          units: 'A'
        }
      },
      {
        key: 'total_act_power',
        meta: {
          units: 'W'
        }
      },
      {
        key: 'total_aprt_power',
        meta: {
          units: 'VA'
        }
      },
      {
        key: 'user_calibrated_phase'
      }
    ]
  },
  em1: {
    paths: [
      {
        key: 'current',
        meta: {
          units: 'A'
        }
      },
      {
        key: 'voltage',
        meta: {
          units: 'V'
        }
      },
      {
        key: 'act_power',
        meta: {
          units: 'W'
        }
      },
      {
        key: 'aprt_power',
        meta: {
          units: 'VA'
        }
      },
      {
        key: 'pf',
        meta: {
          units: 'ratio'
        }
      },
      {
        key: 'freq',
        meta: {
          units: 'Hz'
        }
      }
    ]
  },
  pm1: {
    paths: [
      {
        key: 'voltage',
        meta: {
          units: 'V'
        }
      },
      {
        key: 'current',
        meta: {
          units: 'A'
        }
      },
      {
        key: 'apower',
        meta: {
          units: 'W'
        }
      },
      {
        key: 'aprtpower',
        meta: {
          units: 'VA'
        }
      },
      {
        key: 'pf',
        meta: {
          units: 'ratio'
        }
      },
      {
        key: 'freq',
        meta: {
          units: 'Hz'
        }
      },
      {
        key: 'aenergy.total',
        meta: {
          units: 'Wh'
        }
      },
      {
        key: 'aenergy.by_minute'
      },
      {
        key: 'aenergy.minute_ts'
      },
      {
        key: 'ret_aenergy.total',
        meta: {
          units: 'Wh'
        }
      },
      {
        key: 'ret_aenergy.by_minute'
      },
      {
        key: 'ret_aenergy.minute_ts'
      }
    ]
  },
  devicepower: {
    paths: [
      {
        key: 'battery.V',
        path: 'battery.voltage',
        meta: {
          units: 'V'
        }
      },
      {
        key: 'battery.percent',
        converter: percentConverter,
        meta: {
          units: 'ratio'
        }
      },
      {
        key: 'external.present',
        path: 'externalPower',
        meta: {
          units: 'bool'
        }
      }
    ]
  }
}

type DeepGet<T, P extends string> = P extends `${infer K}.${infer Rest}`
  ? K extends keyof T
    ? DeepGet<T[K], Rest>
    : never
  : P extends keyof T
    ? T[P]
    : never

function deepGet<T, P extends string>(obj: T, path: P): DeepGet<T, P> {
  const parts = path.split('.') as Array<keyof T>
  let current: any = obj

  for (const part of parts) {
    if (current === null || typeof current !== 'object' || !(part in current)) {
      // Handle cases where a part of the path is missing or not an object
      return undefined as DeepGet<T, P> // Or throw an error
    }
    current = current[part]
  }
  return current as DeepGet<T, P>
}
