import { expect } from 'chai'
import * as sinon from 'sinon'
import { mockDevices } from '../src/index'
import { Device } from '../src/device'

describe('Mock Devices Tests', () => {
  let mockApp: any
  let mockPlugin: any
  let sandbox: sinon.SinonSandbox

  beforeEach(() => {
    sandbox = sinon.createSandbox()

    // Mock Signal K app
    mockApp = {
      handleMessage: sandbox.stub(),
      getSelfPath: sandbox.stub().returns('vessels.self'),
      setProviderStatus: sandbox.stub(),
      setProviderError: sandbox.stub(),
      debug: sandbox.stub(),
      error: sandbox.stub(),
      registerPutHandler: sandbox.stub()
    }

    // Mock plugin
    mockPlugin = {
      id: 'signalk-shelly2',
      name: 'Shelly 2'
    }
  })

  afterEach(() => {
    sandbox.restore()
  })

  describe('Mock Device Creation', () => {
    it('should create all expected mock devices', () => {
      const mockedDevices = mockDevices(mockApp, mockPlugin)

      expect(mockedDevices).to.have.length(9)

      const deviceIds = mockedDevices.map(({ device }) => device.id)
      expect(deviceIds).to.include.members([
        'shelly-smokeDetector1',
        'shelly-smokeDetector2',
        'shelly-powerMeter',
        'shelly-hm',
        'shelly-entergyMeter1',
        'shelly-energyMeter',
        'shelly-rgb',
        'shelly-rgbw',
        'shelly-light'
      ])
    })

    it('should create devices with correct addresses', () => {
      const mockedDevices = mockDevices(mockApp, mockPlugin)

      mockedDevices.forEach(({ device }) => {
        expect(device.address).to.equal('192.168.99.100')
      })
    })

    it('should create Device instances', () => {
      const mockedDevices = mockDevices(mockApp, mockPlugin)

      mockedDevices.forEach(({ device }) => {
        expect(device).to.be.instanceOf(Device)
      })
    })
  })

  describe('Smoke Detector Mock Devices', () => {
    let smokeDetector1: any
    let smokeDetector2: any

    beforeEach(() => {
      const mockedDevices = mockDevices(mockApp, mockPlugin)
      smokeDetector1 = mockedDevices.find(
        ({ device }) => device.id === 'shelly-smokeDetector1'
      )
      smokeDetector2 = mockedDevices.find(
        ({ device }) => device.id === 'shelly-smokeDetector2'
      )
    })

    it('should have correct smoke detector 1 status', () => {
      expect(smokeDetector1.status).to.deep.equal({
        'devicepower:0': {
          battery: { V: 3.7, percent: 50 },
          external: { present: true }
        },
        'smoke:0': { alarm: false, mute: false }
      })
    })

    it('should have correct smoke detector 2 status with multiple smoke sensors', () => {
      expect(smokeDetector2.status).to.deep.equal({
        'devicepower:0': {
          battery: { V: 3.7, percent: 50 },
          external: { present: true }
        },
        'smoke:0': { alarm: false, mute: false },
        'smoke:1': { alarm: true, mute: true }
      })
    })

    it('should have battery information in devicepower component', () => {
      expect(smokeDetector1.status['devicepower:0'].battery.V).to.equal(3.7)
      expect(smokeDetector1.status['devicepower:0'].battery.percent).to.equal(
        50
      )
      expect(smokeDetector1.status['devicepower:0'].external.present).to.be.true
    })

    it('should have smoke alarm status', () => {
      expect(smokeDetector1.status['smoke:0'].alarm).to.be.false
      expect(smokeDetector1.status['smoke:0'].mute).to.be.false

      expect(smokeDetector2.status['smoke:1'].alarm).to.be.true
      expect(smokeDetector2.status['smoke:1'].mute).to.be.true
    })
  })

  describe('Power Meter Mock Device', () => {
    let powerMeter: any

    beforeEach(() => {
      const mockedDevices = mockDevices(mockApp, mockPlugin)
      powerMeter = mockedDevices.find(
        ({ device }) => device.id === 'shelly-powerMeter'
      )
    })

    it('should have correct power meter status', () => {
      const expectedStatus = {
        'pm1:0': {
          freq: 10,
          voltage: 12.2,
          current: 1.5,
          apower: 18.3,
          aprtpower: 5.0,
          pf: 0.8,
          aenergy: {
            total: 100,
            by_minute: 10,
            minute_ts: 1696111230
          },
          ret_aenergy: {
            total: 500,
            by_minute: 50,
            minute_ts: 16230
          }
        }
      }
      expect(powerMeter.status).to.deep.equal(expectedStatus)
    })

    it('should have electrical measurements', () => {
      const pm1 = powerMeter.status['pm1:0']
      expect(pm1.freq).to.equal(10)
      expect(pm1.voltage).to.equal(12.2)
      expect(pm1.current).to.equal(1.5)
      expect(pm1.apower).to.equal(18.3)
      expect(pm1.aprtpower).to.equal(5.0)
      expect(pm1.pf).to.equal(0.8)
    })

    it('should have energy measurements', () => {
      const pm1 = powerMeter.status['pm1:0']
      expect(pm1.aenergy.total).to.equal(100)
      expect(pm1.aenergy.by_minute).to.equal(10)
      expect(pm1.ret_aenergy.total).to.equal(500)
      expect(pm1.ret_aenergy.by_minute).to.equal(50)
    })
  })

  describe('Temperature and Humidity Mock Device', () => {
    let hmDevice: any

    beforeEach(() => {
      const mockedDevices = mockDevices(mockApp, mockPlugin)
      hmDevice = mockedDevices.find(({ device }) => device.id === 'shelly-hm')
    })

    it('should have correct temperature and humidity status', () => {
      expect(hmDevice.status).to.deep.equal({
        'temperature:0': { tC: 22 },
        'humidity:0': { rh: 22 }
      })
    })

    it('should have temperature in Celsius', () => {
      expect(hmDevice.status['temperature:0'].tC).to.equal(22)
    })

    it('should have relative humidity', () => {
      expect(hmDevice.status['humidity:0'].rh).to.equal(22)
    })
  })

  describe('Energy Meter Mock Devices', () => {
    let energyMeter1: any
    let energyMeter: any

    beforeEach(() => {
      const mockedDevices = mockDevices(mockApp, mockPlugin)
      energyMeter1 = mockedDevices.find(
        ({ device }) => device.id === 'shelly-entergyMeter1'
      )
      energyMeter = mockedDevices.find(
        ({ device }) => device.id === 'shelly-energyMeter'
      )
    })

    it('should have correct energy meter 1 status', () => {
      expect(energyMeter1.status).to.deep.equal({
        'em1:0': {
          freq: 10,
          voltage: 12.2,
          current: 1.5,
          act_power: 18.3,
          aprt_power: 5.0,
          pf: 0.8
        }
      })
    })

    it('should have correct three-phase energy meter status', () => {
      const expectedStatus = {
        'em:0': {
          a_current: 10,
          a_voltage: 220,
          a_act_power: 100,
          a_aprt_power: 120,
          a_pf: 0.8,
          a_freq: 50,
          b_current: 10,
          b_voltage: 220,
          b_act_power: 100,
          b_aprt_power: 120,
          b_pf: 0.8,
          b_freq: 50,
          c_current: 24,
          c_voltage: 221,
          c_act_power: 100,
          c_aprt_power: 120,
          c_pf: 0.8,
          c_freq: 50,
          n_current: 0.3,
          n_voltage: 0,
          n_act_power: 0,
          n_aprt_power: 0,
          n_pf: 0,
          n_freq: 0,
          total_current: 200,
          total_act_power: 100,
          total_aprt_power: 120,
          user_calibrated_phase: ['A']
        }
      }
      expect(energyMeter.status).to.deep.equal(expectedStatus)
    })

    it('should have three-phase measurements', () => {
      const em = energyMeter.status['em:0']

      // Phase A
      expect(em.a_current).to.equal(10)
      expect(em.a_voltage).to.equal(220)
      expect(em.a_act_power).to.equal(100)

      // Phase B
      expect(em.b_current).to.equal(10)
      expect(em.b_voltage).to.equal(220)
      expect(em.b_act_power).to.equal(100)

      // Phase C
      expect(em.c_current).to.equal(24)
      expect(em.c_voltage).to.equal(221)
      expect(em.c_act_power).to.equal(100)

      // Neutral
      expect(em.n_current).to.equal(0.3)
      expect(em.n_voltage).to.equal(0)

      // Totals
      expect(em.total_current).to.equal(200)
      expect(em.total_act_power).to.equal(100)
    })
  })

  describe('RGB/RGBW Light Mock Devices', () => {
    let rgbDevice: any
    let rgbwDevice: any

    beforeEach(() => {
      const mockedDevices = mockDevices(mockApp, mockPlugin)
      rgbDevice = mockedDevices.find(({ device }) => device.id === 'shelly-rgb')
      rgbwDevice = mockedDevices.find(
        ({ device }) => device.id === 'shelly-rgbw'
      )
    })

    it('should have correct RGB device status', () => {
      expect(rgbDevice.status).to.deep.equal({
        'rgb:0': { output: true, rgb: [255, 0, 0], brightness: 50, white: 255 }
      })
    })

    it('should have correct RGBW device status with multiple channels', () => {
      expect(rgbwDevice.status).to.deep.equal({
        'rgbw:0': {
          output: true,
          rgb: [255, 0, 0],
          brightness: 50,
          white: 255
        },
        'rgbw:1': {
          output: false,
          rgb: [255, 255, 0],
          brightness: 90,
          white: 198
        }
      })
    })

    it('should have RGB color values', () => {
      expect(rgbDevice.status['rgb:0'].rgb).to.deep.equal([255, 0, 0])
      expect(rgbwDevice.status['rgbw:0'].rgb).to.deep.equal([255, 0, 0])
      expect(rgbwDevice.status['rgbw:1'].rgb).to.deep.equal([255, 255, 0])
    })

    it('should have brightness values', () => {
      expect(rgbDevice.status['rgb:0'].brightness).to.equal(50)
      expect(rgbwDevice.status['rgbw:0'].brightness).to.equal(50)
      expect(rgbwDevice.status['rgbw:1'].brightness).to.equal(90)
    })

    it('should have white channel values for RGBW', () => {
      expect(rgbwDevice.status['rgbw:0'].white).to.equal(255)
      expect(rgbwDevice.status['rgbw:1'].white).to.equal(198)
    })

    it('should have output states', () => {
      expect(rgbDevice.status['rgb:0'].output).to.be.true
      expect(rgbwDevice.status['rgbw:0'].output).to.be.true
      expect(rgbwDevice.status['rgbw:1'].output).to.be.false
    })
  })

  describe('Light Mock Device', () => {
    let lightDevice: any

    beforeEach(() => {
      const mockedDevices = mockDevices(mockApp, mockPlugin)
      lightDevice = mockedDevices.find(
        ({ device }) => device.id === 'shelly-light'
      )
    })

    it('should have correct light device status with multiple channels', () => {
      expect(lightDevice.status).to.deep.equal({
        'light:0': {
          output: true,
          brightness: 50,
          pf: 0.8,
          freq: 50,
          ret_aenergy: {
            total: 100,
            by_minute: 10
          }
        },
        'light:1': { output: false, brightness: 90 }
      })
    })

    it('should have light control properties', () => {
      expect(lightDevice.status['light:0'].output).to.be.true
      expect(lightDevice.status['light:0'].brightness).to.equal(50)
      expect(lightDevice.status['light:1'].output).to.be.false
      expect(lightDevice.status['light:1'].brightness).to.equal(90)
    })

    it('should have electrical measurements for light 0', () => {
      expect(lightDevice.status['light:0'].pf).to.equal(0.8)
      expect(lightDevice.status['light:0'].freq).to.equal(50)
      expect(lightDevice.status['light:0'].ret_aenergy.total).to.equal(100)
      expect(lightDevice.status['light:0'].ret_aenergy.by_minute).to.equal(10)
    })

    it('should not have electrical measurements for light 1', () => {
      expect(lightDevice.status['light:1'].pf).to.be.undefined
      expect(lightDevice.status['light:1'].freq).to.be.undefined
      expect(lightDevice.status['light:1'].ret_aenergy).to.be.undefined
    })
  })

  describe('Mock Device Interactions', () => {
    let mockedDevices: any[]

    beforeEach(() => {
      mockedDevices = mockDevices(mockApp, mockPlugin)
    })

    it('should have devices with methods for capability handling', () => {
      mockedDevices.forEach(({ device }) => {
        expect(device).to.have.property('getCapabilities')
        expect(device).to.have.property('registerForPuts')
        expect(device).to.have.property('sendDeltas')
        expect(typeof device.getCapabilities).to.equal('function')
        expect(typeof device.registerForPuts).to.equal('function')
        expect(typeof device.sendDeltas).to.equal('function')
      })
    })

    it('should send correct deltas for smoke detector', () => {
      const smokeDetector1 = mockedDevices.find(
        ({ device }) => device.id === 'shelly-smokeDetector1'
      )
      const smokeDetector2 = mockedDevices.find(
        ({ device }) => device.id === 'shelly-smokeDetector2'
      )

      // Clear any previous calls
      mockApp.handleMessage.resetHistory()

      // Initialize capabilities first
      smokeDetector1.device.getCapabilities(smokeDetector1.status)

      // Send deltas for smoke detector 1
      smokeDetector1.device.sendDeltas(smokeDetector1.status)

      // Verify handleMessage was called
      expect(mockApp.handleMessage.called).to.be.true

      const calls = mockApp.handleMessage.getCalls()
      const deltaCall = calls.find(
        (call) => call.args[1].updates && call.args[1].updates[0].values
      )

      expect(deltaCall).to.exist
      if (deltaCall) {
        const values = deltaCall.args[1].updates[0].values

        // Should include battery voltage
        const batteryVoltage = values.find((v: any) =>
          v.path.includes('battery.voltage')
        )
        expect(batteryVoltage).to.exist
        expect(batteryVoltage.value).to.equal(3.7)

        // Should include battery percentage
        const batteryPercent = values.find((v: any) =>
          v.path.includes('battery.percent')
        )
        expect(batteryPercent).to.exist
        expect(batteryPercent.value).to.equal(0.5) // Converted from 50% to ratio

        // Should include external power
        const externalPower = values.find((v: any) =>
          v.path.includes('externalPower')
        )
        expect(externalPower).to.exist
        expect(externalPower.value).to.be.true
      }

      // Clear calls and test smoke detector 2 with multiple sensors
      mockApp.handleMessage.resetHistory()
      smokeDetector2.device.getCapabilities(smokeDetector2.status)
      smokeDetector2.device.sendDeltas(smokeDetector2.status)

      const calls2 = mockApp.handleMessage.getCalls()
      const deltaCall2 = calls2.find(
        (call) => call.args[1].updates && call.args[1].updates[0].values
      )

      expect(deltaCall2).to.exist
      if (deltaCall2) {
        const values = deltaCall2.args[1].updates[0].values

        // Should have notifications for both smoke sensors
        const notifications = values.filter((v: any) =>
          v.path.startsWith('notifications.')
        )
        expect(notifications).to.have.length.greaterThan(1)

        // Check for alarm states
        const alarmNotification = notifications.find(
          (v: any) => v.value.state === 'alarm'
        )
        expect(alarmNotification).to.exist
        if (alarmNotification) {
          expect(alarmNotification.value.message).to.include('Smoke detected')
        }
      }
    })

    it('should send correct deltas for power meter', () => {
      const powerMeter = mockedDevices.find(
        ({ device }) => device.id === 'shelly-powerMeter'
      )

      mockApp.handleMessage.resetHistory()
      powerMeter.device.getCapabilities(powerMeter.status)
      powerMeter.device.sendDeltas(powerMeter.status)

      const calls = mockApp.handleMessage.getCalls()
      const deltaCall = calls.find(
        (call) => call.args[1].updates && call.args[1].updates[0].values
      )

      expect(deltaCall).to.exist
      if (deltaCall) {
        const values = deltaCall.args[1].updates[0].values

        // Should include voltage
        const voltage = values.find((v: any) => v.path.includes('voltage'))
        expect(voltage).to.exist
        expect(voltage.value).to.equal(12.2)

        // Should include current
        const current = values.find((v: any) => v.path.includes('current'))
        expect(current).to.exist
        expect(current.value).to.equal(1.5)

        // Should include active power
        const apower = values.find((v: any) => v.path.includes('apower'))
        expect(apower).to.exist
        expect(apower.value).to.equal(18.3)

        // Should include power factor
        const pf = values.find((v: any) => v.path.includes('pf'))
        expect(pf).to.exist
        expect(pf.value).to.equal(0.8)

        // Should include frequency
        const freq = values.find((v: any) => v.path.includes('freq'))
        expect(freq).to.exist
        expect(freq.value).to.equal(10)

        // Should include energy totals
        const energyTotal = values.find((v: any) =>
          v.path.includes('aenergy.total')
        )
        expect(energyTotal).to.exist
        expect(energyTotal.value).to.equal(100)
      }
    })

    it('should send correct deltas for temperature and humidity device', () => {
      const hmDevice = mockedDevices.find(
        ({ device }) => device.id === 'shelly-hm'
      )

      mockApp.handleMessage.resetHistory()
      hmDevice.device.getCapabilities(hmDevice.status)
      hmDevice.device.sendDeltas(hmDevice.status)

      const calls = mockApp.handleMessage.getCalls()
      const deltaCall = calls.find(
        (call) => call.args[1].updates && call.args[1].updates[0].values
      )

      expect(deltaCall).to.exist
      if (deltaCall) {
        const values = deltaCall.args[1].updates[0].values

        // Should include temperature in Kelvin (converted from Celsius)
        const temperature = values.find((v: any) =>
          v.path.includes('temperature')
        )
        expect(temperature).to.exist
        expect(temperature.value).to.equal(295.15) // 22°C + 273.15

        // Should include humidity as ratio (converted from percentage)
        const humidity = values.find((v: any) => v.path.includes('humidity'))
        expect(humidity).to.exist
        expect(humidity.value).to.equal(0.22) // 22% / 100
      }
    })

    it('should send correct deltas for RGB device', () => {
      const rgbDevice = mockedDevices.find(
        ({ device }) => device.id === 'shelly-rgb'
      )

      mockApp.handleMessage.resetHistory()
      rgbDevice.device.getCapabilities(rgbDevice.status)
      rgbDevice.device.sendDeltas(rgbDevice.status)

      const calls = mockApp.handleMessage.getCalls()
      const deltaCall = calls.find(
        (call) => call.args[1].updates && call.args[1].updates[0].values
      )

      expect(deltaCall).to.exist
      if (deltaCall) {
        const values = deltaCall.args[1].updates[0].values

        // Should include switch state (look for 'output' not 'state')
        const output = values.find((v: any) => 
          v.path.includes('state') && typeof v.value === 'boolean'
        )
        expect(output).to.exist
        expect(output.value).to.be.true

        // Should include RGB values
        const rgb = values.find((v: any) => 
          v.path.includes('rgb') && Array.isArray(v.value)
        )
        expect(rgb).to.exist
        expect(rgb.value).to.deep.equal([255, 0, 0])

        // Should include brightness as ratio
        const brightness = values.find((v: any) =>
          v.path.includes('dimmingLevel')
        )
        expect(brightness).to.exist
        expect(brightness.value).to.equal(0.5) // 50% converted to ratio
      }
    })

    it('should send correct deltas for RGBW device with multiple channels', () => {
      const rgbwDevice = mockedDevices.find(
        ({ device }) => device.id === 'shelly-rgbw'
      )

      mockApp.handleMessage.resetHistory()
      rgbwDevice.device.getCapabilities(rgbwDevice.status)
      rgbwDevice.device.sendDeltas(rgbwDevice.status)

      const calls = mockApp.handleMessage.getCalls()
      const deltaCall = calls.find(
        (call) => call.args[1].updates && call.args[1].updates[0].values
      )

      expect(deltaCall).to.exist
      if (deltaCall) {
        const values = deltaCall.args[1].updates[0].values

        // Should have RGB values for both RGBW channels
        const rgbValues = values.filter((v: any) => 
          v.path.includes('rgb') && Array.isArray(v.value)
        )
        expect(rgbValues).to.have.length(2)

        // Should have white channel values
        const whiteValues = values.filter((v: any) => 
          v.path.includes('white') && typeof v.value === 'number'
        )
        expect(whiteValues).to.have.length(2)

        // Check specific values for channel 0
        const rgb0 = rgbValues.find((v: any) => v.path.includes('.0.'))
        expect(rgb0).to.exist
        expect(rgb0.value).to.deep.equal([255, 0, 0])

        const white0 = whiteValues.find((v: any) => v.path.includes('.0.'))
        expect(white0).to.exist
        expect(white0.value).to.equal(255)
      }
    })

    it('should send correct deltas for energy meter with three-phase measurements', () => {
      const energyMeter = mockedDevices.find(
        ({ device }) => device.id === 'shelly-energyMeter'
      )

      mockApp.handleMessage.resetHistory()
      energyMeter.device.getCapabilities(energyMeter.status)
      energyMeter.device.sendDeltas(energyMeter.status)

      const calls = mockApp.handleMessage.getCalls()
      const deltaCall = calls.find(
        (call) => call.args[1].updates && call.args[1].updates[0].values
      )

      expect(deltaCall).to.exist
      if (deltaCall) {
        const values = deltaCall.args[1].updates[0].values

        // Should include phase A measurements
        const aVoltage = values.find((v: any) => v.path.includes('a_voltage'))
        expect(aVoltage).to.exist
        expect(aVoltage.value).to.equal(220)

        const aCurrent = values.find((v: any) => v.path.includes('a_current'))
        expect(aCurrent).to.exist
        expect(aCurrent.value).to.equal(10)

        // Should include phase B measurements
        const bVoltage = values.find((v: any) => v.path.includes('b_voltage'))
        expect(bVoltage).to.exist
        expect(bVoltage.value).to.equal(220)

        // Should include phase C measurements
        const cCurrent = values.find((v: any) => v.path.includes('c_current'))
        expect(cCurrent).to.exist
        expect(cCurrent.value).to.equal(24)

        // Should include total measurements
        const totalCurrent = values.find((v: any) =>
          v.path.includes('total_current')
        )
        expect(totalCurrent).to.exist
        expect(totalCurrent.value).to.equal(200)

        // Should include neutral current
        const nCurrent = values.find((v: any) => v.path.includes('n_current'))
        expect(nCurrent).to.exist
        expect(nCurrent.value).to.equal(0.3)
      }
    })

    it('should send correct deltas for light device', () => {
      const lightDevice = mockedDevices.find(
        ({ device }) => device.id === 'shelly-light'
      )

      mockApp.handleMessage.resetHistory()
      lightDevice.device.getCapabilities(lightDevice.status)
      lightDevice.device.sendDeltas(lightDevice.status)

      const calls = mockApp.handleMessage.getCalls()
      const deltaCall = calls.find(
        (call) => call.args[1].updates && call.args[1].updates[0].values
      )

      expect(deltaCall).to.exist
      if (deltaCall) {
        const values = deltaCall.args[1].updates[0].values

        // Should have state values for both light channels
        const stateValues = values.filter((v: any) => 
          v.path.includes('state') && typeof v.value === 'boolean'
        )
        expect(stateValues).to.have.length(2)

        // Check channel 0 (on)
        const state0 = stateValues.find((v: any) => v.path.includes('shelly-light.0.'))
        expect(state0).to.exist
        expect(state0.value).to.be.true

        // Check channel 1 (off)
        const state1 = stateValues.find((v: any) => v.path.includes('shelly-light.1.'))
        expect(state1).to.exist
        expect(state1.value).to.be.false

        // Should have brightness values (look for the brightness key specifically)
        const brightnessValues = values.filter((v: any) =>
          v.path.includes('brightness') && typeof v.value === 'number'
        )
        expect(brightnessValues).to.have.length(2)

        // Channel 0 brightness
        const brightness0 = brightnessValues.find((v: any) =>
          v.path.includes('shelly-light.0.')
        )
        expect(brightness0).to.exist
        expect(brightness0.value).to.equal(0.5) // 50% converted to ratio

        // Channel 1 brightness
        const brightness1 = brightnessValues.find((v: any) =>
          v.path.includes('shelly-light.1.')
        )
        expect(brightness1).to.exist
        expect(brightness1.value).to.equal(0.9) // 90% converted to ratio
      }
    })

    it('should handle component detection from status', () => {
      const powerMeterDevice = mockedDevices.find(
        ({ device }) => device.id === 'shelly-powerMeter'
      )
      const rgbwDevice = mockedDevices.find(
        ({ device }) => device.id === 'shelly-rgbw'
      )
      const energyMeterDevice = mockedDevices.find(
        ({ device }) => device.id === 'shelly-energyMeter'
      )

      // Power meter should have pm1 component
      expect(powerMeterDevice.status).to.have.property('pm1:0')

      // RGBW device should have multiple rgbw components
      expect(rgbwDevice.status).to.have.property('rgbw:0')
      expect(rgbwDevice.status).to.have.property('rgbw:1')

      // Energy meter should have em component with three-phase data
      expect(energyMeterDevice.status).to.have.property('em:0')
    })

    it('should provide comprehensive test coverage for all component types', () => {
      const allComponents = new Set()

      mockedDevices.forEach(({ status }) => {
        Object.keys(status).forEach((key) => {
          const componentType = key.split(':')[0]
          allComponents.add(componentType)
        })
      })

      // Verify we have test coverage for major component types
      expect(Array.from(allComponents)).to.include.members([
        'devicepower',
        'smoke',
        'pm1',
        'temperature',
        'humidity',
        'em1',
        'em',
        'rgb',
        'rgbw',
        'light'
      ])
    })
  })

  describe('Mock Device Status Validation', () => {
    let mockedDevices: any[]

    beforeEach(() => {
      mockedDevices = mockDevices(mockApp, mockPlugin)
    })

    it('should have valid numeric values for electrical measurements', () => {
      const powerMeter = mockedDevices.find(
        ({ device }) => device.id === 'shelly-powerMeter'
      )
      const pm1 = powerMeter.status['pm1:0']

      expect(pm1.freq).to.be.a('number')
      expect(pm1.voltage).to.be.a('number')
      expect(pm1.current).to.be.a('number')
      expect(pm1.apower).to.be.a('number')
      expect(pm1.pf).to.be.a('number')

      expect(pm1.freq).to.be.greaterThan(0)
      expect(pm1.voltage).to.be.greaterThan(0)
      expect(pm1.current).to.be.greaterThan(0)
      expect(pm1.pf).to.be.at.most(1)
    })

    it('should have valid boolean values for switch states', () => {
      const smokeDetector = mockedDevices.find(
        ({ device }) => device.id === 'shelly-smokeDetector1'
      )
      const lightDevice = mockedDevices.find(
        ({ device }) => device.id === 'shelly-light'
      )

      expect(smokeDetector.status['smoke:0'].alarm).to.be.a('boolean')
      expect(smokeDetector.status['smoke:0'].mute).to.be.a('boolean')
      expect(lightDevice.status['light:0'].output).to.be.a('boolean')
      expect(lightDevice.status['light:1'].output).to.be.a('boolean')
    })

    it('should have valid array values for RGB colors', () => {
      const rgbDevice = mockedDevices.find(
        ({ device }) => device.id === 'shelly-rgb'
      )
      const rgbwDevice = mockedDevices.find(
        ({ device }) => device.id === 'shelly-rgbw'
      )

      expect(rgbDevice.status['rgb:0'].rgb).to.be.an('array')
      expect(rgbDevice.status['rgb:0'].rgb).to.have.length(3)
      expect(rgbwDevice.status['rgbw:0'].rgb).to.be.an('array')
      expect(rgbwDevice.status['rgbw:0'].rgb).to.have.length(3)

      // RGB values should be between 0-255
      rgbDevice.status['rgb:0'].rgb.forEach((value: number) => {
        expect(value).to.be.at.least(0)
        expect(value).to.be.at.most(255)
      })
    })

    it('should have valid percentage values for battery and brightness', () => {
      const smokeDetector = mockedDevices.find(
        ({ device }) => device.id === 'shelly-smokeDetector1'
      )
      const lightDevice = mockedDevices.find(
        ({ device }) => device.id === 'shelly-light'
      )

      expect(
        smokeDetector.status['devicepower:0'].battery.percent
      ).to.be.at.least(0)
      expect(
        smokeDetector.status['devicepower:0'].battery.percent
      ).to.be.at.most(100)
      expect(lightDevice.status['light:0'].brightness).to.be.at.least(0)
      expect(lightDevice.status['light:0'].brightness).to.be.at.most(100)
    })
  })
})
