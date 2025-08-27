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
import { Device } from '../device'

export abstract class SwitchBase extends Component {
  getPaths(): ComponentPath[] {
    return [
      {
        key: `output`,
        path: `state`,
        meta: {
          units: 'bool'
        },
        putHandler: (device: Device, id: number, value: any): Promise<void> => {
          return this.setValue(
            'output',
            'on',
            value === 1 || value === 'on' || value === 'true' || value === true
          )
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
        converter: this.temperatureConverter.bind(this),
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
  }
}
