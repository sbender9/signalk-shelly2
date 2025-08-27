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

import { Component, ComponentPath } from './Component'
import { Device, DeviceSettings } from '../device'
import { Path, PathValue } from '@signalk/server-api'

export class Smoke extends Component {
  constructor(device: Device, componentId: number) {
    super(device, componentId, 'smoke', 'Smoke', 'environment.smoke')
  }

  getDeltaValues(
    status: any
  ): PathValue[] {
    const componentProps = this.device.getComponentProps(this.componentName, this.componentId)
    const componentStatus = status[`${this.componentName}:${this.componentId}`]

    if (componentStatus !== undefined) {
      const method = ['visual']
      if (componentStatus.mute !== true) {
        method.push('sound')
      }
      return [
        {
          path: `notifications.${this.getComponentPath(undefined)}` as Path,
          value: {
            state: componentStatus.alarm ? 'alarm' : 'normal',
            method,
            message: `${componentStatus.alarm ? 'Smoke detected' : 'No smoke detected'} in ${componentProps?.displayName || this.device.deviceSettings?.displayName || this.componentId}`
          }
        }
      ]
    }
    return []
  }

  getPaths(): ComponentPath[] {
    return []
  }
}
