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

import { Device } from '../device'
import {
  ServerAPI,
  ActionResult,
  Meta,
  Path,
  PathValue
} from '@signalk/server-api'

export type ComponentPath = {
  key: string
  path?: string
  converter?: (value: any) => any
  putHandler?: (device: Device, id: number, value: any) => Promise<void>
  meta?: any
}

export abstract class Component {
  device: Device
  componentId: number
  componentName: string
  skPath: string
  apiName: string
  flatten: boolean

  constructor(
    device: Device,
    componentId: number,
    componentName: string,
    apiName: string,
    skPath: string,
    flatten: boolean = true
  ) {
    this.device = device
    this.componentName = componentName
    this.skPath = skPath
    this.apiName = apiName
    this.flatten = flatten
    this.componentId = componentId
  }

  abstract getPaths(): ComponentPath[]

  registerPuts(app: ServerAPI) {
    this.getPaths().forEach((p: ComponentPath) => {
      if (p.putHandler !== undefined) {
        app.registerPutHandler(
          'vessels.self',
          this.getComponentPath(p.path || p.key),
          (
            context: string,
            path: string,
            value: any,
            cb: (result: ActionResult) => void
          ): ActionResult => {
            p.putHandler!(this.device, this.componentId, value)
              .then(() => {
                cb({
                  state: 'COMPLETED',
                  statusCode: 200
                })
              })
              .catch((err: any) => {
                app.error(err.message)
                app.setPluginError(err.message)
                cb({
                  state: 'COMPLETED',
                  statusCode: 400,
                  message: err.message
                })
              })
            return { state: 'PENDING' }
          }
        )
      }
    })
  }

  getDeltaValues(status: any): PathValue[] {
    const values: PathValue[] = []
    const componentStatus = status[`${this.componentName}:${this.componentId}`]

    if (componentStatus) {
      this.getPaths().forEach((p: ComponentPath) => {
        const val = deepGet(componentStatus, p.key)
        const converter = p.converter
        if (val !== undefined) {
          values.push({
            path: this.getComponentPath(p.path || p.key),
            value: converter ? converter(val) : val
          })
        }
      })
    }
    return values
  }

  getMeta(): Meta[] {
    const meta: Meta[] = []

    const componentProps = this.device.getComponentProps(
      this.componentName,
      this.componentId
    )

    this.getPaths().forEach((path) => {
      const metaValue = {
        ...(path.meta || {}),
        displayName:
          componentProps?.displayName || this.device.deviceSettings?.displayName
      }
      if (Object.keys(metaValue).length > 0) {
        meta.push({
          path: this.getComponentPath(path.path || path.key),
          value: metaValue
        })
      }
    })

    return meta
  }

  async setValue(getKey: string, setKey: string, value: any) {
    await this.device.send(`${this.apiName}.Set`, {
      id: this.componentId,
      [setKey]: value
    })
    const status = await this.getStatus()
    if (status[getKey] !== value) {
      throw new Error(
        `Failed to set ${this.componentName} ${this.componentId} to ${value}`
      )
    }
    this.device.sendDeltas({
      [`${this.componentName}:${this.componentId}`]: status
    })
  }

  async getStatus(): Promise<any> {
    const res = await this.device.send(`${this.apiName}.GetStatus`, {
      id: this.componentId
    })
    return res
  }

  getComponentPath(key: string | undefined): Path {
    const componentProps = this.device.getComponentProps(
      this.componentName,
      this.componentId
    )

    let path = this.device.getDevicePath() as string
    const count = this.device.components[this.componentName].length
    if (count > 1) {
      if (this.flatten === false) {
        path = path + `.${this.componentName}`
      }
      path =
        path +
        `.${componentProps?.path || componentProps?.switchPath || this.componentId}`
    } else if (count === 1 && this.flatten === false) {
      path = path + `.${this.componentName}`
    }

    return (path + (key ? '.' + key : '')) as Path
  }

  temperatureConverter(value: number) {
    return value + 273.15
  }

  percentConverter(value: number) {
    return value / 100
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
