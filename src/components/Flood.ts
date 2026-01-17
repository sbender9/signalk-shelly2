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
import { Component, ComponentPath } from './Component'
import { Path, PathValue } from '@signalk/server-api'

export class Flood extends Component {
  constructor(device: Device, componentId: number) {
    super(device, componentId, 'flood', 'Flood', 'environment.flood', false)
  }

  getDeltaValues(status: any): PathValue[] {
    const values: PathValue[] = super.getDeltaValues(status)
    const componentProps = this.device.getComponentProps(
      this.componentName,
      this.componentId
    )
    const componentStatus = status[`${this.componentName}:${this.componentId}`]

    if (componentStatus !== undefined) {
      const method = ['visual']
      if (componentStatus.mute !== true) {
        method.push('sound')
      }
      values.push({
        path: `notifications.${this.getComponentPath(undefined)}` as Path,
        value: {
          state: componentStatus.alarm ? 'alarm' : 'normal',
          method,
          message: `${componentStatus.alarm ? 'Water detected' : 'No water detected'} in ${componentProps?.displayName || this.device.deviceSettings?.displayName || this.componentId}`
        }
      })
    }
    return values
  }

  getPaths(): ComponentPath[] {
    return [
      {
        key: 'alarm',
        meta: {
          units: 'bool'
        }
      },
      {
        key: 'mute',
        meta: {
          units: 'bool'
        }
      }
    ]
  }
}
