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

import { ComponentPath } from './Component'
import { Light } from './Light'
import { Device } from '../device'
import { Meta, PathValue, ServerAPI, ActionResult } from '@signalk/server-api'

export class RGB extends Light {
  constructor(
    device: Device,
    componentId: number,
    componentName?: string,
    apiName?: string,
    skPath?: string,
    flatten?: boolean
  ) {
    super(
      device,
      componentId,
      componentName || 'rgb',
      apiName || 'RGB',
      skPath || 'electrical.switches',
      flatten
    )
  }
  getDeltaValues(status: any): PathValue[] {
    const values: PathValue[] = super.getDeltaValues(status)
    if (
      this.device.deviceSettings?.presets &&
      this.device.deviceSettings.presets.length > 0
    ) {
      let preset = null
      const componentStatus = status[`${this.componentName}:${this.componentId}`]
      if (componentStatus) {
        const rgb: number[] = componentStatus.rgb
        if (rgb !== undefined) {
          preset = this.device.deviceSettings.presets.find((preset: any) => {
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
          path: this.getComponentPath('preset'),
          value: preset ? preset.name : 'Unknown'
        })
      }
    }
    return values
  }

  getMeta(): Meta[] {
    const meta: Meta[] = super.getMeta()
    const componentProps = this.device.getComponentProps(this.componentName, this.componentId)
    if (
      this.device.deviceSettings?.presets &&
      this.device.deviceSettings.presets.length > 0
      ) {
        meta.push({
          path: this.getComponentPath('preset'),
          value: {
            displayName: componentProps?.displayName,
            possibleValues: [
              ...this.device.deviceSettings.presets.map((preset: any) => {
                return {
                  title: preset.name,
                  value: preset.name
                }
              })
            ],
            enum: [
              ...this.device.deviceSettings.presets.map((preset: any) => preset.name)
            ]
          } as any
        })
      }
    return meta
  }

  getPaths(): ComponentPath[] {
    const paths: ComponentPath[] = [
      {
        key: 'rgb',
        putHandler: (device: Device, id: number, value: any): Promise<void> => {
          return this.setValue(
            'rgb',
            'rgb',
            value
          )
        }
      }
    ]
    return [...super.getPaths(), ...paths]
  }

  registerPuts(app: ServerAPI): void {
    super.registerPuts(app)
    if (
      this.device.deviceSettings &&
      this.device.deviceSettings.presets &&
      this.device.deviceSettings.presets.length > 0
    ) {
      app.registerPutHandler(
        'vessels.self',
        this.getComponentPath('preset'),
        (
          context: string,
          path: string,
          value: any,
          cb: (result: ActionResult) => void
        ): ActionResult => {
          const preset = this.device.deviceSettings!.presets.find(
            (preset: any) => preset.name == value
          )
          if (!preset || value === 'Unknown') {
            return {
              state: 'COMPLETED',
              statusCode: 400,
              message: `invalid preset ${value}`
            }
          }
          const rgb = [preset.red, preset.green, preset.blue]
          if (preset.white !== undefined) {
            rgb.push(preset.white)
          }
          this.device.send(`${this.apiName}.Set`, {
            id: this.componentId,
            rgb
          })
            .then(() => {
              if (
                preset.bright === undefined ||
                preset.bright === 0
              ) {
                cb({
                  state: 'COMPLETED',
                  statusCode: 200
                })
              } else {
                this.device.send(`${this.apiName}.Set`, {
                  id: this.componentId,
                  brightness: preset.bright
                })
                  .then(() => {
                    cb({
                      state: 'COMPLETED',
                      statusCode: 200
                    })
                  })
                  .catch((err) => {
                    cb({
                      state: 'COMPLETED',
                      statusCode: 400,
                      message: err.message
                    })
                  })
              }
            })
            .catch((err) => {
              cb({
                state: 'COMPLETED',
                statusCode: 400,
                message: err.message
              })
            })
         return { state: 'PENDING' }
        },
      )
    }
  }
}
