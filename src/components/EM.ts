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

export class EM extends Component {
  constructor(device: Device, componentId: number) {
    super(device, componentId, 'em', 'EM', 'electrical.energymeter')
  }

  getPaths(): ComponentPath[] {
    return [
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
  }
}
