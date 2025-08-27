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

export class EM1 extends Component {
  constructor(device: Device, componentId: number) {
    super(device, componentId, 'em1', 'EM1', 'electrical.energymeter')
  }

  getPaths(): ComponentPath[] {
    return [
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
  }
}
