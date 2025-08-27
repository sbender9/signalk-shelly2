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
import { RGB } from './RGB'
import { Device } from '../device'

export class RGBW extends RGB {
  constructor(device: Device, componentId: number) {
    super(device, componentId, 'rgbw', 'RGBW', 'electrical.switches')
  }

  getPaths(): ComponentPath[] {
    const paths: ComponentPath[] = [
      {
        key: 'white',
        putHandler: (device: Device, id: number, value: any): Promise<void> => {
          return this.setValue(
            'white',
            'white',
            Math.round(value * 100)
          )
        }
      }
    ]
    return [...super.getPaths(), ...paths]
  }
}
