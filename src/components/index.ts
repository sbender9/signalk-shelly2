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

import { Component } from './Component'
import { Switch } from './Switch'
import { Light } from './Light'
import { RGB } from './RGB'
import { RGBW } from './RGBW'
import { Input } from './Input'
import { Temperature } from './Temperature'
import { Humidity } from './Humidity'
import { Voltmeter } from './Voltmeter'
import { EM } from './EM'
import { EM1 } from './EM1'
import { PM1 } from './PM1'
import { Smoke } from './Smoke'
import { Device } from '../device'
import { Devicepower } from './Devicepower'

export * from './Component'
/*
export * from './Switch'
export * from './Light'
export * from './RGB'
export * from './RGBW'
*/

/*
const supportedComponents = [
    new Switch(),
    new Light(),
    new RGB(),
    new RGBW(),
    new Input(),
    new Temperature(),
    new Humidity(),
    new Voltmeter(),
    new EM(),
    new EM1(),
    new PM1(),
    new Smoke()
  ]

export function getSupportedComponents(): Component[] {
  return supportedComponents
}
  */

export const supportedComponents = [
  'switch',
  'light',
  'rgb',
  'rgbw',
  'em',
  'em1',
  'pm1',
  'temperature',
  'humidity',
  'voltmeter',
  'input',
  'smoke',
  'devicepower'
]

export function getSupportedComponents(): string[] {
  return supportedComponents
}

export const componentCreators: {[key:string]: (device:Device, id:number) => Component} = {
  'switch': (device:Device, id:number) => new Switch(device, id),
  'light': (device:Device, id:number) => new Light(device, id),
  'rgb': (device:Device, id:number) => new RGB(device, id),
  'rgbw': (device:Device, id:number) => new RGBW(device, id),
  'em': (device:Device, id:number) => new EM(device, id),
  'em1': (device:Device, id:number) => new EM1(device, id),
  'pm1': (device:Device, id:number) => new PM1(device, id),
  'temperature': (device:Device, id:number) => new Temperature(device, id),
  'humidity': (device:Device, id:number) => new Humidity(device, id),
  'voltmeter': (device:Device, id:number) => new Voltmeter(device, id),
  'input': (device:Device, id:number) => new Input(device, id),
  'smoke': (device:Device, id:number) => new Smoke(device, id),
  'devicepower': (device:Device, id:number) => new Devicepower(device, id)
}

export function createComponent(componentName: string, device: Device, id: number): Component | null {
  const creator = componentCreators[componentName]
  if (creator) {
    return creator(device, id)
  }
  return null
}