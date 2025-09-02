import { expect } from 'chai'
import * as sinon from 'sinon'
import pluginFactory from '../src/index'
import mockDevices from '../src/mockDevices'

describe('Mock Device Integration Tests', () => {
  let sandbox: sinon.SinonSandbox
  let mockApp: any
  let plugin: any

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

    plugin = pluginFactory(mockApp)
  })

  afterEach(() => {
    sandbox.restore()
    if (plugin && typeof plugin.stop === 'function') {
      plugin.stop()
    }
  })

  describe('Plugin with Mock Devices', () => {
    it('should export mockDevices function', () => {
      expect(mockDevices).to.be.a('function')
    })

    it('should create mock devices with correct structure', () => {
      const mockedDevices = mockDevices(mockApp, plugin)

      expect(mockedDevices).to.have.length(10)

      // Test that each mock device has the expected structure
      mockedDevices.forEach(({ device, status }) => {
        expect(device).to.have.property('id')
        expect(device).to.have.property('address')
        expect(status).to.be.an('object')

        // Verify status has component keys in the expected format
        Object.keys(status).forEach((key) => {
          expect(key).to.match(/^[a-z0-9]+:\d+$/)
        })
      })
    })

    it('should create schema with proper structure', () => {
      const schema = plugin.schema()

      expect(schema).to.have.property('type', 'object')
      expect(schema).to.have.property('properties')
      expect(schema.properties).to.have.property('poll')
    })

    it('should handle device capabilities and interactions', () => {
      const mockedDevices = mockDevices(mockApp, plugin)

      // Test that we can call device methods without errors
      mockedDevices.forEach(({ device, status }) => {
        expect(() => {
          device.getCapabilities(status)
          device.registerForPuts(status)
          device.sendDeltas(status)
        }).to.not.throw()
      })
    })

    it('should send correct delta messages to Signal K app', () => {
      const mockedDevices = mockDevices(mockApp, plugin)

      // Test with a temperature/humidity device
      const hmDevice = mockedDevices.find(
        ({ device }) => device.id === 'shelly-hm'
      )

      expect(hmDevice).to.exist
      if (!hmDevice) return

      mockApp.handleMessage.resetHistory()
      hmDevice.device.getCapabilities(hmDevice.status)
      hmDevice.device.sendDeltas(hmDevice.status)

      // Verify handleMessage was called with correct structure
      expect(mockApp.handleMessage.called).to.be.true

      const calls = mockApp.handleMessage.getCalls()

      // Find the call with values (not meta)
      const valuesCall = calls.find(
        (call) => call.args[1].updates && call.args[1].updates[0].values
      )

      expect(valuesCall).to.exist
      if (valuesCall) {
        expect(valuesCall.args).to.have.length(2)
        expect(valuesCall.args[0]).to.equal('signalk-shelly2') // plugin ID
        expect(valuesCall.args[1]).to.have.property('updates')
        expect(valuesCall.args[1].updates).to.be.an('array')
        expect(valuesCall.args[1].updates[0]).to.have.property('values')

        const values = valuesCall.args[1].updates[0].values
        expect(values).to.be.an('array')
        expect(values.length).to.be.greaterThan(0)

        // Each value should have path and value properties
        values.forEach((value: any) => {
          expect(value).to.have.property('path')
          expect(value).to.have.property('value')
          expect(value.path).to.be.a('string')
        })
      }
    })

    it('should send meta data for devices', () => {
      const mockedDevices = mockDevices(mockApp, plugin)
      const powerMeter = mockedDevices.find(
        ({ device }) => device.id === 'shelly-powerMeter'
      )

      expect(powerMeter).to.exist
      if (!powerMeter) return

      mockApp.handleMessage.resetHistory()

      // Initialize capabilities and force meta to be sent by calling sendDeltas
      powerMeter.device.getCapabilities(powerMeter.status)
      powerMeter.device.sendDeltas(powerMeter.status)

      const calls = mockApp.handleMessage.getCalls()
      const metaCall = calls.find(
        (call) => call.args[1].updates && call.args[1].updates[0].meta
      )

      expect(metaCall).to.exist
      if (metaCall) {
        const meta = metaCall.args[1].updates[0].meta
        expect(meta).to.be.an('array')
        expect(meta.length).to.be.greaterThan(0)

        // Each meta entry should have path and value properties
        meta.forEach((entry: any) => {
          expect(entry).to.have.property('path')
          expect(entry).to.have.property('value')
          expect(entry.path).to.be.a('string')
        })
      }
    })

    it('should convert units correctly in deltas', () => {
      const mockedDevices = mockDevices(mockApp, plugin)

      // Test temperature conversion (Celsius to Kelvin)
      const hmDevice = mockedDevices.find(
        ({ device }) => device.id === 'shelly-hm'
      )

      expect(hmDevice).to.exist
      if (!hmDevice) return

      mockApp.handleMessage.resetHistory()
      hmDevice.device.getCapabilities(hmDevice.status)
      hmDevice.device.sendDeltas(hmDevice.status)

      const calls = mockApp.handleMessage.getCalls()
      const deltaCall = calls.find(
        (call) => call.args[1].updates && call.args[1].updates[0].values
      )

      if (deltaCall) {
        const values = deltaCall.args[1].updates[0].values
        const temperature = values.find((v: any) =>
          v.path.includes('temperature')
        )
        expect(temperature).to.exist
        expect(temperature.value).to.equal(295.15) // 22°C converted to Kelvin

        const humidity = values.find((v: any) => v.path.includes('humidity'))
        expect(humidity).to.exist
        expect(humidity.value).to.equal(0.22) // 22% converted to ratio
      }

      // Test brightness conversion (percentage to ratio)
      const rgbDevice = mockedDevices.find(
        ({ device }) => device.id === 'shelly-rgb'
      )

      expect(rgbDevice).to.exist
      if (!rgbDevice) return

      mockApp.handleMessage.resetHistory()
      rgbDevice.device.getCapabilities(rgbDevice.status)
      rgbDevice.device.sendDeltas(rgbDevice.status)

      const calls2 = mockApp.handleMessage.getCalls()
      const deltaCall2 = calls2.find(
        (call) => call.args[1].updates && call.args[1].updates[0].values
      )

      if (deltaCall2) {
        const values = deltaCall2.args[1].updates[0].values
        const brightness = values.find((v: any) =>
          v.path.includes('dimmingLevel')
        )
        expect(brightness).to.exist
        expect(brightness.value).to.equal(0.5) // 50% converted to ratio
      }
    })
  })

  describe('Mock Device Schema Generation', () => {
    it('should generate schema for RGB/RGBW devices with presets', () => {
      const mockedDevices = mockDevices(mockApp, plugin)

      const rgbDevice = mockedDevices.find(
        ({ device }) => device.id === 'shelly-rgb'
      )
      const rgbwDevice = mockedDevices.find(
        ({ device }) => device.id === 'shelly-rgbw'
      )

      expect(rgbDevice).to.exist
      expect(rgbwDevice).to.exist

      // Verify the devices have RGB/RGBW components
      if (rgbDevice) {
        expect(rgbDevice.status).to.have.property('rgb:0')
      }
      if (rgbwDevice) {
        expect(rgbwDevice.status).to.have.property('rgbw:0')
        expect(rgbwDevice.status).to.have.property('rgbw:1')
      }
    })

    it('should handle different component types correctly', () => {
      const mockedDevices = mockDevices(mockApp, plugin)

      const componentTypes = new Set()
      mockedDevices.forEach(({ status }) => {
        Object.keys(status).forEach((key) => {
          const componentType = key.split(':')[0]
          componentTypes.add(componentType)
        })
      })

      // Verify we have a good variety of component types for testing
      expect(componentTypes.size).to.be.greaterThan(5)
      expect(Array.from(componentTypes)).to.include.members([
        'smoke',
        'devicepower',
        'pm1',
        'temperature',
        'humidity'
      ])
    })
  })

  describe('Mock Device Error Handling', () => {
    it('should handle mock device creation gracefully', () => {
      // Test with invalid app parameter
      expect(() => {
        mockDevices(null as any, plugin)
      }).to.not.throw()

      // Test with invalid plugin parameter
      expect(() => {
        mockDevices(mockApp, null as any)
      }).to.not.throw()
    })

    it('should provide consistent mock data', () => {
      // Create mock devices multiple times and verify consistency
      const mockedDevices1 = mockDevices(mockApp, plugin)
      const mockedDevices2 = mockDevices(mockApp, plugin)

      expect(mockedDevices1).to.have.length(mockedDevices2.length)

      // Compare device IDs
      const ids1 = mockedDevices1.map(({ device }) => device.id).sort()
      const ids2 = mockedDevices2.map(({ device }) => device.id).sort()
      expect(ids1).to.deep.equal(ids2)
    })
  })

  describe('Mock Device Data Validation', () => {
    let mockedDevices: any[]

    beforeEach(() => {
      mockedDevices = mockDevices(mockApp, plugin)
    })

    it('should have realistic electrical values', () => {
      const powerMeter = mockedDevices.find(
        ({ device }) => device.id === 'shelly-powerMeter'
      )
      const energyMeter = mockedDevices.find(
        ({ device }) => device.id === 'shelly-energyMeter'
      )

      // Power meter validation
      const pm1 = powerMeter.status['pm1:0']
      expect(pm1.voltage).to.be.within(0, 300) // Reasonable voltage range
      expect(pm1.current).to.be.within(0, 100) // Reasonable current range
      expect(pm1.pf).to.be.within(0, 1) // Power factor must be 0-1

      // Energy meter validation
      const em = energyMeter.status['em:0']
      expect(em.a_voltage).to.be.within(100, 300) // Typical AC voltage
      expect(em.b_voltage).to.be.within(100, 300)
      expect(em.c_voltage).to.be.within(100, 300)
    })

    it('should have valid environmental sensor readings', () => {
      const hmDevice = mockedDevices.find(
        ({ device }) => device.id === 'shelly-hm'
      )

      const temp = hmDevice.status['temperature:0'].tC
      const humidity = hmDevice.status['humidity:0'].rh

      expect(temp).to.be.within(-40, 80) // Reasonable temperature range in Celsius
      expect(humidity).to.be.within(0, 100) // Humidity percentage
    })

    it('should have consistent RGB color values', () => {
      const rgbDevice = mockedDevices.find(
        ({ device }) => device.id === 'shelly-rgb'
      )
      const rgbwDevice = mockedDevices.find(
        ({ device }) => device.id === 'shelly-rgbw'
      )

      // Check RGB values are in valid range (0-255)
      rgbDevice.status['rgb:0'].rgb.forEach((value: number) => {
        expect(value).to.be.within(0, 255)
        expect(Number.isInteger(value)).to.be.true
      })

      rgbwDevice.status['rgbw:0'].rgb.forEach((value: number) => {
        expect(value).to.be.within(0, 255)
        expect(Number.isInteger(value)).to.be.true
      })

      // Check brightness values
      expect(rgbDevice.status['rgb:0'].brightness).to.be.within(0, 100)
      expect(rgbwDevice.status['rgbw:0'].brightness).to.be.within(0, 100)
      expect(rgbwDevice.status['rgbw:1'].brightness).to.be.within(0, 100)
    })

    it('should have proper battery status format', () => {
      const smokeDetector1 = mockedDevices.find(
        ({ device }) => device.id === 'shelly-smokeDetector1'
      )
      const smokeDetector2 = mockedDevices.find(
        ({ device }) => device.id === 'shelly-smokeDetector2'
      )

      const detectors = [smokeDetector1, smokeDetector2]
      detectors.forEach((detector) => {
        const battery = detector.status['devicepower:0'].battery
        const external = detector.status['devicepower:0'].external

        expect(battery).to.have.property('V')
        expect(battery).to.have.property('percent')
        expect(battery.V).to.be.a('number')
        expect(battery.percent).to.be.a('number')
        expect(battery.percent).to.be.within(0, 100)

        expect(external).to.have.property('present')
        expect(external.present).to.be.a('boolean')
      })
    })
  })
})
