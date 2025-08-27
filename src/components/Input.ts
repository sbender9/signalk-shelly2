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

export class Input extends Component {
  constructor(device: Device, componentId: number) {
    super(device, componentId, 'input', 'Input', 'electrical.inputs', true)
  }

  getPaths(): ComponentPath[] {
    return [
      {
        key: 'state',
        path: 'on',
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
  }
}
