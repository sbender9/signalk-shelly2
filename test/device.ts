import { expect } from 'chai'
import * as sinon from 'sinon'
import { Device } from '../src/device'

// Sample device status as provided
const sampleDeviceStatus = {
  ble: {},
  cloud: {
    connected: true
  },
  'input:0': {
    id: 0,
    state: false
  },
  mqtt: {
    connected: false
  },
  'switch:0': {
    id: 0,
    source: 'WS_in',
    output: false,
    temperature: {
      tC: 52.8,
      tF: 127.1
    }
  },
  sys: {
    mac: '7C87CE63B954'
  },
  wifi: {
    sta_ip: '192.168.88.116',
    status: 'got ip',
    ssid: 'Wilhelm',
    rssi: -49
  }
}

const sampleDeviceInfo = {
  id: 'shellyplusht-7c87ce63b954',
  mac: '7C87CE63B954',
  model: 'SNSW-001X16EU',
  gen: 2,
  name: 'Test Device'
}

describe('Device Class Unit Tests', () => {
  let mockApp: any
  let mockPlugin: any
  let deviceSettings: any

  beforeEach(() => {
    sinon.restore()

    mockApp = {
      debug: sinon.stub(),
      error: sinon.stub(),
      handleMessage: sinon.stub(),
      registerPutHandler: sinon.stub(),
      setPluginError: sinon.stub()
    }

    mockPlugin = {
      id: 'signalk-shelly2'
    }

    deviceSettings = {
      enabled: true,
      devicePath: 'testDevice',
      displayName: 'Test Shelly Device',
      switch0: {
        enabled: true,
        displayName: 'Main Switch',
        switchPath: 'main'
      }
    }
  })

  afterEach(() => {
    sinon.restore()
  })

  describe('Device Creation', () => {
    it('should create a device with correct initial properties', () => {
      const { Device } = require('../dist/device')
      const device = new Device(
        mockApp,
        mockPlugin,
        '192.168.1.100',
        'host.name',
        '12345'
      )
      device.setDeviceSettings(deviceSettings)

      expect(device.id).to.equal('12345')
      expect(device.connected).to.be.false
      expect(device.address).to.equal('192.168.1.100')
      expect(device.name).to.be.undefined
      expect(device.model).to.be.null
      expect(device.gen).to.be.null
    })
  })

  describe('Device Data Processing', () => {
    let device: Device

    beforeEach(() => {
      const { Device } = require('../dist/device')
      device = new Device(
        mockApp,
        mockPlugin,
        '192.168.1.100',
        'host.name',
        'shellyplusht-7c87ce63b954'
      )
      device.setDeviceSettings(deviceSettings)

      // Simulate connected state
      device.connected = true
      device.id = sampleDeviceInfo.id
      device.name = sampleDeviceInfo.name
      device.model = sampleDeviceInfo.model
      device.gen = sampleDeviceInfo.gen
      device.getCapabilities(sampleDeviceStatus)
    })

    it('should send deltas for device status', () => {
      device.sendDeltas(sampleDeviceStatus)

      expect(mockApp.handleMessage.called).to.be.true
      const handleMessageCall = mockApp.handleMessage.getCall(1)
      const message = handleMessageCall.args[1]

      expect(message).to.have.property('updates')
      expect(message.updates).to.be.an('array')
      expect(message.updates[0]).to.have.property('values')
      const values = message.updates[0].values

      // Check for switch state
      const switchStateValue = values.find(
        (v: any) => v.path === 'electrical.switches.testDevice.state'
      )
      expect(switchStateValue).to.exist
      expect(switchStateValue.value).to.be.false

      // Check for device name
      const nameValue = values.find(
        (v: any) => v.path === 'electrical.switches.testDevice.name'
      )
      expect(nameValue).to.exist
      expect(nameValue.value).to.equal('Test Device')

      // Check for model
      const modelValue = values.find(
        (v: any) => v.path === 'electrical.switches.testDevice.model'
      )
      expect(modelValue).to.exist
      expect(modelValue.value).to.equal('SNSW-001X16EU')
    })

    it('should convert temperature from Celsius to Kelvin', () => {
      device.sendDeltas(sampleDeviceStatus)

      const handleMessageCall = mockApp.handleMessage.getCall(1)
      const values = handleMessageCall.args[1].updates[0].values

      const tempValue = values.find(
        (v: any) => v.path === 'electrical.switches.testDevice.temperature'
      )
      expect(tempValue).to.exist
      expect(tempValue.value).to.equal(52.8 + 273.15) // Celsius to Kelvin conversion
    })

    it('should not send deltas when device is disabled', () => {
      deviceSettings.enabled = false
      const { Device } = require('../dist/device')
      device = new Device(mockApp, mockPlugin, deviceSettings, '192.168.1.100')

      device.sendDeltas(sampleDeviceStatus)

      expect(mockApp.handleMessage.called).to.be.false
    })

    it('should send metadata for device and switches', () => {
      device.sendMeta(sampleDeviceStatus)

      expect(mockApp.handleMessage.called).to.be.true
      const handleMessageCall = mockApp.handleMessage.getCall(0)
      const message = handleMessageCall.args[1]

      expect(message.updates[0]).to.have.property('meta')
      const meta = message.updates[0].meta

      // Check for device displayName
      const deviceMeta = meta.find(
        (m: any) => m.path === 'electrical.switches.testDevice'
      )
      expect(deviceMeta).to.exist
      expect(deviceMeta.value.displayName).to.equal('Test Shelly Device')

      // Check for switch state meta
      const switchMeta = meta.find((m: any) => m.path.endsWith('.state'))
      expect(switchMeta).to.exist
      expect(switchMeta.value.units).to.equal('bool')

      // Check for temperature meta
      const tempMeta = meta.find((m: any) => m.path.endsWith('.temperature'))
      expect(tempMeta).to.exist
      expect(tempMeta.value.units).to.equal('K')
    })

    it('should register put handlers for enabled switches', () => {
      device.registerForPuts(sampleDeviceStatus)

      expect(mockApp.registerPutHandler.called).to.be.true

      const registerCalls = mockApp.registerPutHandler.getCalls()
      expect(registerCalls).to.have.length(1)

      const call = registerCalls[0]
      expect(call.args[0]).to.equal('vessels.self')
      expect(call.args[1]).to.equal('electrical.switches.testDevice.state')
      expect(call.args[2]).to.be.a('function')
    })

    it('should not register handlers for disabled switches', () => {
      deviceSettings.switch0.enabled = false
      const { Device } = require('../dist/device')
      device = new Device(mockApp, mockPlugin, deviceSettings, '192.168.1.100')

      device.registerForPuts(sampleDeviceStatus)

      expect(mockApp.registerPutHandler.called).to.be.false
    })
  })

  /*
  describe('Device Path Generation', () => {
    let device: any

    beforeEach(() => {
      const { Device } = require('../dist/device')
      device = new Device(mockApp, mockPlugin, deviceSettings, '192.168.1.100')
      device.componentCounts = { switch: 1 }
      device.name = 'Test Device'
    })

    it('should use device name when no custom path is specified', () => {
      deviceSettings.devicePath = undefined
      const { Device } = require('../dist/device')
      device = new Device(mockApp, mockPlugin, deviceSettings, '192.168.1.100')
      device.name = 'Test Device'
      device.components = { switch: 1 }

      const devicePath = device.getDevicePath()
      expect(devicePath).to.equal('electrical.switches.testDevice')
    })

    it('should handle multiple switches correctly', () => {
      device.componentCounts['switch'] = 2

      const switch0Path = device.getComponentPath('switch', 0, 'state')
      const switch1Path = device.getComponentPath('switch', 1, 'state')

      // switch0 should use the switchPath from settings ('main')
      // switch1 should use the relay number (1) since no switch1 setting exists
      expect(switch0Path).to.equal('electrical.switches.testDevice.main.state')
      expect(switch1Path).to.equal('electrical.switches.testDevice.1.state')
    })
  })
*/

  describe('Temperature Conversion Utilities', () => {
    it('should convert temperature object correctly', () => {
      const tempObj = { tC: 25.0, tF: 77.0 }
      const expectedKelvin = 25.0 + 273.15

      // Test the temperature converter function
      const { Device } = require('../dist/device')
      const testDevice = new Device(
        mockApp,
        mockPlugin,
        '192.168.1.100',
        'host.name'
      )

      testDevice.setDeviceSettings(deviceSettings)

      // Create a test status with temperature
      const testStatus = {
        'switch:0': {
          temperature: tempObj
        }
      }

      testDevice.getCapabilities(testStatus)

      testDevice.connected = true
      testDevice.sendDeltas(testStatus)

      const values = mockApp.handleMessage.getCall(1).args[1].updates[0].values
      const tempValue = values.find(
        (v: any) => v.path === 'electrical.switches.testDevice.temperature'
      )
      expect(tempValue).to.exist
      expect(tempValue.value).to.equal(expectedKelvin)
    })
  })

  describe('Device Configuration Validation', () => {
    it('should handle device creation with minimal configuration', () => {
      const minimalSettings = {
        enabled: true,
        devicePath: 'minimal'
      }

      const { Device } = require('../dist/device')
      const device = new Device(
        mockApp,
        mockPlugin,
        '192.168.1.100',
        'host.name',
        '123456'
      )

      device.setDeviceSettings(minimalSettings)

      expect(device.address).to.equal('192.168.1.100')
      expect(device.connected).to.be.false
    })
  })

  describe('Reconnection Functionality', () => {
    it('should configure reconnection parameters from settings', () => {
      const settingsWithReconnect = {
        enabled: true,
        maxReconnectAttempts: 5,
        enableReconnection: true
      }

      const { Device } = require('../dist/device')
      const device = new Device(
        mockApp,
        mockPlugin,
        settingsWithReconnect,
        '192.168.1.100'
      )

      expect(device.reconnectionAttempts).to.equal(0)
      expect(device.reconnecting).to.be.false
    })

    it('should use default reconnection parameters when not specified', () => {
      const defaultSettings = {
        enabled: true
      }

      const { Device } = require('../dist/device')
      const device = new Device(
        mockApp,
        mockPlugin,
        defaultSettings,
        '192.168.1.100'
      )

      expect(device.reconnectionAttempts).to.equal(0)
      expect(device.reconnecting).to.be.false
    })

    it('should allow disabling reconnection via settings', () => {
      const settingsWithoutReconnect = {
        enabled: true,
        enableReconnection: false
      }

      const { Device } = require('../dist/device')
      const device = new Device(
        mockApp,
        mockPlugin,
        settingsWithoutReconnect,
        '192.168.1.100'
      )

      expect(device.reconnectionAttempts).to.equal(0)
      expect(device.reconnecting).to.be.false
    })

    it('should expose reconnection status methods', () => {
      const { Device } = require('../dist/device')
      const device = new Device(mockApp, mockPlugin, {}, '192.168.1.100')

      expect(typeof device.forceReconnect).to.equal('function')
      expect(typeof device.reconnecting).to.equal('boolean')
      expect(typeof device.reconnectionAttempts).to.equal('number')
    })
  })
})
