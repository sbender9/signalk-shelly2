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
import WebSocket from 'ws'
import { ServerAPI, Plugin, ActionResult, Path, PathValue, Meta } from '@signalk/server-api'
import { Component, getSupportedComponents, createComponent } from './components'

type PendingRequest = {
  resolve: (value: any) => void
  reject: (reason?: any) => void
  timeout: NodeJS.Timeout
}

export type DeviceSettings = {
  enabled: boolean
  displayName: string
  devicePath: string
  [key: string]: any
}

export class Device {
  id: string | null = null
  connected: boolean = false
  address: string
  hostname: string | undefined
  name: string | undefined = undefined
  model: string | null = null
  gen: number | null = null
  components: { [key: string]: Component[] } = {}

  private ws: WebSocket | null = null
  private next_id: number = 1
  private pendingRequests: { [key: number]: PendingRequest } = {}
  deviceSettings: DeviceSettings | undefined
  private sentMeta: boolean = false
  private app: ServerAPI
  private plugin: Plugin
  private reconnectAttempts: number = 0
  private maxReconnectAttempts: number = -1
  private reconnectTimeout: NodeJS.Timeout | null = null
  private shouldReconnect: boolean = true
  private isReconnecting: boolean = false
  private sentStaticDeltas: boolean = false

  constructor(
    app: ServerAPI,
    plugin: Plugin,
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

  private debug(msg: string, ...args: any[]) {
    this.app.debug(msg, ...args)
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

  async send(method: string, params: any = {}): Promise<any> {
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

  getCapabilities(status: any) {
    getSupportedComponents().forEach((name) => {
      for (let i = 0; i < 10; i++) {
        if (status[`${name}:${i}`]) {
          const component = createComponent(name, this, i)
          if (component) {
            if (this.components[name] === undefined) {
              this.components[name] = []
            }
            this.components[name].push(component)
          }
        }
      }
    })
  }

  getMainComponent(): Component | null {
    for (const component of Object.keys(this.components)) {
      if (this.components[component].length > 0) {
        return this.components[component][0]
      }
    }
    return null
  }

  getDevicePath(key?: string): Path {
    const component = this.getMainComponent()
    const deviceRoot = component != null ? component.skPath : 'electrical.unknown'
    let name = this.deviceSettings?.devicePath
    if (name !== undefined && name.indexOf('.') === -1) {
      name = `${deviceRoot}.${name}`
    } else if (name === undefined) {
      name = `${deviceRoot}.${this.name ? camelCase(this.name) : this.id}`
    }
    return `${name}${key ? '.' + key : ''}` as Path
  }

  getComponentProps(component: string, relay: number) {
    return this.deviceSettings
      ? this.deviceSettings[`${component}${relay}`]
      : undefined
  }

  sendDeltas(status: any) {
    let values: PathValue[] = []

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

    Object.values(this.components).forEach((components) => {
      components.forEach((component) => {
        const componentProps = this.getComponentProps(component.componentName, component.componentId)

        if (componentProps?.enabled === false) {
          return
        }

        values = [...values, ...component.getDeltaValues(status)]
      })
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

  sendMeta(status: any) {
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

    Object.values(this.components).forEach((components) => {
      components.forEach((component) => {
        const componentProps = this.getComponentProps(component.componentName, component.componentId)

        if (componentProps?.enabled === false) {
          return
        }

        meta = [...meta, ...component.getMeta()]
      })
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

  registerForPuts(status: any) {
    Object.values(this.components).forEach((components) => {
      components.forEach((component) => {
        const componentProps = this.getComponentProps(component.componentName, component.componentId)

        if (componentProps?.enabled === false) {
          return
        }

        component.registerPuts(this.app)
      })
    })
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
