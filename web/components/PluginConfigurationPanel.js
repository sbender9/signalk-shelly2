import React from 'react'
import { useEffect, useState } from 'react'

export function ShellyConfig(props) {
  // Simple spacing class for buttons and cards
  const spacingStyle = { margin: '8px' }

  const [baseSchema, setBaseSchema] = useState({})

  const [baseData, setBaseData] = useState({})

  const [sensorData, setSensorData] = useState()

  const [selectedComponent, setSelectedComponent] = useState()

  const [enableSchema, setEnableSchema] = useState(true)
  const [deviceMap, setDeviceMap] = useState(new Map())

  const [pluginState, setPluginState] = useState('unknown')
  const [error, setError] = useState()
  const [snackbarOpen, setSnackbarOpen] = useState(false)
  const [snackbarMessage, setSnackbarMessage] = useState('')

  function sendJSONData(cmd, data) {
    const headers = new Headers()
    headers.append('Content-Type', 'application/json')
    return fetch(`/plugins/signalk-shelly2/${cmd}`, {
      credentials: 'include',
      method: 'POST',
      body: JSON.stringify(data),
      headers: headers
    })
  }
  async function fetchJSONData(path, data = {}) {
    let result
    try {
      // Convert data object to query string
      const query = Object.keys(data).length
        ? '?' + new URLSearchParams(data).toString()
        : ''
      result = await fetch(`/plugins/signalk-shelly2/${path}${query}`, {
        credentials: 'include',
        method: 'GET'
      })
    } catch (e) {
      result = {
        status: 500,
        statusText: e.toString()
      }
    }
    return result
  }
  async function getDevices() {
    const response = await fetchJSONData('getDevices')
    if (response.status != 200) {
      throw new Error(
        `Unable get device data: ${response.statusText} (${response.status}) `
      )
    }
    const json = await response.json()

    return json
  }

  async function getBaseData() {
    const response = await fetchJSONData('getBaseData')
    if (response.status != 200) {
      throw new Error(
        `Unable to get base data: ${response.statusText} (${response.status}) `
      )
    }
    const json = await response.json()
    // Store the raw HTML string - it will be rendered via dangerouslySetInnerHTML at render time
    // Don't pre-create JSX here as it causes React version incompatibility
    json.schema._rawHtmlDescription = json.schema.htmlDescription
    json.schema.htmlDescription = undefined
    return json
  }

  function updateSensorData(data) {
    sendJSONData('updateDeviceConfig', data).then((response) => {
      if (response.status != 200) {
        throw new Error(response.statusText)
      }
      /*
      setDeviceMap((dm) => {
        dm.delete(data.id)
        return new Map(dm)
      })
        */
      //setSchema({})
    })
  }

  function undoChanges(id) {
    const device = deviceMap.get(id)
    device._changesMade = false
    device.settings = JSON.parse(JSON.stringify(device.settingsCopy))
    setSensorData({ ...device.settings })
    setSelectedComponent(null)
  }

  function removeDeviceConfig(id) {
    try {
      sendJSONData('removeDeviceConfig', { id: id }).then((response) => {
        if (response.status != 200) {
          throw new Error(response.statusText)
        }
      })
      setDeviceMap((dm) => {
        dm.delete(id)
        return new Map(dm)
      })
      //setSchema({})
      setSensorData(null)
      setSelectedComponent(null)
    } catch {
      ;(e) => setError(`Couldn't remove ${id}: ${e}`)
    }
  }

  function updateBaseData(data) {
    setDeviceMap(new Map())
    //setSensorList({})
    sendJSONData('updateBaseData', data).then((response) => {
      if (response.status != 200) {
        setError(
          `Unable to update base data: ${response.statusText} (${response.status})`
        )
      }
    })
  }

  function handleInputChange(fieldName, value) {
    const updatedSensorData = { ...sensorData, [fieldName]: value }
    setSensorData(updatedSensorData)
    const s = deviceMap.get(sensorData.id)
    if (s) {
      s._changesMade = true
      s.settings[fieldName] = value
    }
  }

  function handleComponenetChange(fieldName, value) {
    const settings = { ...selectedComponent.settings, [fieldName]: value }
    const updatedCompData = { ...selectedComponent, settings: settings }
    console.log(`updating component data: ${JSON.stringify(updatedCompData)}`)
    setSelectedComponent(updatedCompData)
    const s = deviceMap.get(sensorData.id)
    if (s) {
      s._changesMade = true
      s.components[selectedComponent.id].settings = settings
    }
  }

  useEffect(() => {
    let eventSource = null
    fetchJSONData('getPluginState')
      .then(async (response) => {
        function newDeviceEvent(event) {
          let json = JSON.parse(event.data)
          console.log(`New device: ${JSON.stringify(json.id)}`)
          setDeviceMap((_sm) => {
            //if (!_sm.has(json.info.mac))
            _sm.set(json.id, json)

            return new Map(_sm)
          })
        }
        function deviceChangedEvent(event) {
          console.log('devicechanged')
          const json = JSON.parse(event.data)
          console.log(json)
          setDeviceMap((_sm) => {
            const sensor = _sm.get(json.id)
            if (sensor) Object.assign(sensor, json)
            return new Map(_sm)
          })
        }

        if (response.status == 404) {
          setPluginState('unknown')
          throw new Error('unable to get plugin state')
        }
        const json = await response.json()
        eventSource = new EventSource('/plugins/signalk-shelly2/sse', {
          withCredentials: true
        })

        eventSource.addEventListener('resetDevices', (event) => {
          ;(async () => {
            const devices = await getDevices()
            setDeviceMap(new Map(devices.map((device) => [device.id, device])))
          })()
        })

        eventSource.addEventListener('newDevice', (event) => {
          newDeviceEvent(event)
        })

        eventSource.addEventListener('deviceChanged', (event) => {
          deviceChangedEvent(event)
        })

        eventSource.addEventListener('pluginstate', (event) => {
          const json = JSON.parse(event.data)
          setPluginState(json.state)
        })

        setPluginState(json.state)
        ;(async () => {
          const devices = await getDevices()
          setDeviceMap(new Map(devices.map((device) => [device.id, device])))
        })()
      })
      .catch((e) => {
        setError(e.message)
      })
    return () => {
      console.log('Closing connection to SSE')
      if (eventSource) {
        eventSource.close()
      }
    }
  }, [])

  useEffect(() => {
    if (snackbarMessage == '') setSnackbarOpen(false)
    else {
      setSnackbarOpen(true)
    }
  }, [snackbarMessage])

  useEffect(() => {
    if (pluginState == 'started') {
      getBaseData()
        .then((json) => {
          setBaseSchema(json.schema)
          setBaseData(json.data)
        })
        .catch((e) => {
          setError(e.message)
        })
    } else {
      setBaseSchema({})
      setBaseData({})
    }
  }, [pluginState])

  function confirmDelete(id) {
    const sensor = deviceMap.get(id)
    const result =
      !hasConfig(sensor) ||
      window.confirm(`Delete configuration for ${sensor.id}?`)
    if (result) removeDeviceConfig(id)
  }

  function hasConfig(device) {
    return device.isConfigured
  }

  function createListGroupItem(sensor) {
    const config = hasConfig(sensor)
    return (
      <button
        key={sensor.id}
        type="button"
        className="list-group-item list-group-item-action d-flex justify-content-between"
        onClick={() => {
          const settings = {
            ...sensor.settings,
            id: sensor.id,
            address: sensor.address,
            hostname: sensor.hostname,
            name: sensor.name,
            model: sensor.model,
            devicePath: sensor.settings.devicePath || sensor.defaultPath,
            enabled:
              sensor.settings?.enabled !== undefined
                ? sensor.settings.enabled
                : true,
            components: sensor.components
          }
          setSensorData(settings)
          setSelectedComponent(null)
        }}
      >
        <div style={{ flex: 1 }}>
          {`${sensor._changesMade ? '*' : ''}`}
          {sensor.model}
        </div>
        <div style={{ flex: 1 }}>{sensor.name ?? ''}</div>
        <div style={{ flex: 1 }}>{sensor.address}</div>
        <div style={{ flex: 1 }}>{sensor.id}</div>
        <div style={{ flex: 1 }}>{`${sensor.connected ? 'Yes' : 'No'}`}</div>
      </button>
    )
  }

  const [activeTab, setActiveTab] = useState('_configured')

  function getTabs() {
    console.log('loading tabs')
    const cd = Array.from(deviceMap.entries()).filter((entry) =>
      hasConfig(entry[1])
    )
    const notConfigured = Array.from(deviceMap.entries()).filter(
      (entry) => !hasConfig(entry[1])
    )

    const configuredContent =
      cd.length == 0
        ? 'Select a device from Unconfigured and configure it.'
        : cd.map((entry) => {
            console.log(`configured devices: ${entry[0]}`)
            return createListGroupItem(deviceMap.get(entry[0]))
          })

    const unconfiguredContent =
      notConfigured.length == 0
        ? 'No Unconfigured Devices Found'
        : notConfigured.map((entry) => {
            return createListGroupItem(deviceMap.get(entry[0]))
          })

    return (
      <div>
        <ul className="nav nav-tabs mb-3">
          <li className="nav-item">
            <button
              className={`nav-link ${activeTab === '_configured' ? 'active' : ''}`}
              onClick={() => setActiveTab('_configured')}
              type="button"
            >
              Configured
              {typeof configuredContent !== 'string'
                ? ` (${configuredContent.length})`
                : ''}
            </button>
          </li>
          <li className="nav-item">
            <button
              className={`nav-link ${activeTab === '_unconfigured' ? 'active' : ''}`}
              onClick={() => setActiveTab('_unconfigured')}
              type="button"
            >
              Unconfigured
              {typeof unconfiguredContent !== 'string'
                ? ` (${unconfiguredContent.length})`
                : ''}
            </button>
          </li>
        </ul>
        <div className="tab-content">
          <div
            className={`tab-pane fade ${activeTab === '_configured' ? 'show active' : ''}`}
          >
            <div
              className="list-group"
              style={{ maxHeight: '300px', overflowY: 'auto' }}
            >
              <div className="list-group-item d-flex justify-content-between fw-bold">
                <div style={{ flex: 1 }}>Model</div>
                <div style={{ flex: 1 }}>Name</div>
                <div style={{ flex: 1 }}>Address</div>
                <div style={{ flex: 1 }}>Shelly ID</div>
                <div style={{ flex: 1 }}>Connected</div>
              </div>
              {typeof configuredContent === 'string' ? (
                <div className="list-group-item">{configuredContent}</div>
              ) : (
                configuredContent
              )}
            </div>
          </div>
          <div
            className={`tab-pane fade ${activeTab === '_unconfigured' ? 'show active' : ''}`}
          >
            <div
              className="list-group"
              style={{ maxHeight: '300px', overflowY: 'auto' }}
            >
              <div className="list-group-item d-flex justify-content-between fw-bold">
                <div style={{ flex: 1 }}>Model</div>
                <div style={{ flex: 1 }}>Name</div>
                <div style={{ flex: 1 }}>Address</div>
                <div style={{ flex: 1 }}>Shelly ID</div>
                <div style={{ flex: 1 }}>Connected</div>
              </div>
              {typeof unconfiguredContent === 'string' ? (
                <div className="list-group-item">{unconfiguredContent}</div>
              ) : (
                unconfiguredContent
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  function getComponentGroupItem(component) {
    return (
      <button
        key={component.id}
        type="button"
        className="list-group-item list-group-item-action d-flex justify-content-between"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setSelectedComponent(component)
        }}
      >
        <div style={{ flex: 1 }}>{component.name}</div>
        <div style={{ flex: 1 }}>{component.id}</div>
      </button>
    )
  }

  function getComponentList() {
    return (
      <div style={spacingStyle}>
        <div className="card">
          <div
            className="card-header d-flex justify-content-between align-items-center py-2"
            style={{ cursor: 'pointer' }}
          >
            Component
          </div>
          <div className="card-body">
            <div
              className="list-group"
              style={{ maxHeight: '300px', overflowY: 'auto' }}
            >
              <div className="list-group-item d-flex justify-content-between fw-bold">
                <div style={{ flex: 1 }}>Type</div>
                <div style={{ flex: 1 }}>Identifier</div>
              </div>
              {sensorData.components.map((component) =>
                getComponentGroupItem(component)
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  function getComponentForm() {
    console.log(`getting component form : ${JSON.stringify(selectedComponent)}`)
    return (
      <div style={spacingStyle}>
        <div className="card">
          <div
            className="card-header d-flex justify-content-between align-items-center py-2"
            style={{ cursor: 'pointer' }}
          >
            {selectedComponent.name} {selectedComponent.id}
          </div>
          <div className="card-body">
            <div className="row mb-3">
              <div className="col-md-2">
                <label htmlFor="componentEnabled" className="form-label">
                  Enabled
                </label>
              </div>
              <div className="col-12 col-md-10">
                <div className="form-check form-switch">
                  <input
                    type="checkbox"
                    id="componentEnabled"
                    name="componentEnabled"
                    className="form-check-input"
                    checked={
                      selectedComponent?.settings.enabled !== undefined
                        ? selectedComponent.settings.enabled
                        : true
                    }
                    onChange={(e) =>
                      handleComponenetChange('enabled', e.target.checked)
                    }
                  />
                </div>
              </div>
            </div>
            <div className="row mb-3">
              <div className="col-md-2">
                <label htmlFor="componentPath" className="form-label">
                  Path
                </label>
              </div>
              <div className="col-12 col-md-10">
                <input
                  size="50"
                  style={{ width: 'auto' }}
                  type="text"
                  id="componentPath"
                  name="componentPath"
                  className="form-control"
                  value={
                    selectedComponent.settings.path !== undefined
                      ? selectedComponent.settings.path
                      : selectedComponent.id
                  }
                  onChange={(e) =>
                    handleComponenetChange('path', e.target.value)
                  }
                />
                <div className="form-text text-muted">
                  {
                    'Used to generate the path name, ie. electrical.switches.${devicePath}.${path}.state'
                  }
                </div>
              </div>
            </div>
            <div className="row mb-3">
              <div className="col-md-2">
                <label htmlFor="componentDisplayName" className="form-label">
                  Display Name (meta)
                </label>
              </div>
              <div className="col-12 col-md-10">
                <input
                  size="50"
                  style={{ width: 'auto' }}
                  type="text"
                  id="componentDisplayName"
                  name="componentDisplayName"
                  className="form-control"
                  value={selectedComponent?.settings?.displayName || ''}
                  onChange={(e) =>
                    handleComponenetChange('displayName', e.target.value)
                  }
                />
                <div className="form-text text-muted">
                  Display name meta data for the device.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  function getCommonForm() {
    console.log(
      `getting common form for sensorData: ${JSON.stringify(sensorData)}`
    )
    return (
      <div style={spacingStyle}>
        <div className="card">
          <div
            className="card-header d-flex justify-content-between align-items-center py-2"
            style={{ cursor: 'pointer' }}
          >
            Device
          </div>
          <div className="card-body">
            <div className="row mb-3">
              <div className="col-md-2">
                <label htmlFor="deviceEnabled" className="form-label">
                  Enabled
                </label>
              </div>
              <div className="col-12 col-md-10">
                <div className="form-check form-switch">
                  <input
                    type="checkbox"
                    id="deviceEnabled"
                    name="deviceEnabled"
                    className="form-check-input"
                    checked={sensorData?.enabled}
                    onChange={(e) =>
                      handleInputChange('enabled', e.target.checked)
                    }
                  />
                </div>
              </div>
            </div>
            <div className="row mb-3">
              <div className="col-md-2">
                <label htmlFor="devicePath" className="form-label">
                  Path
                </label>
              </div>
              <div className="col-12 col-md-10">
                <input
                  size="50"
                  style={{ width: 'auto' }}
                  type="text"
                  id="devicePath"
                  name="devicePath"
                  className="form-control"
                  value={
                    sensorData?.devicePath || sensorData?.defaultPath || ''
                  }
                  onChange={(e) =>
                    handleInputChange('devicePath', e.target.value)
                  }
                />
                <div className="form-text text-muted">
                  Signal K path to publish data to.
                </div>
              </div>
            </div>
            <div className="row mb-3">
              <div className="col-md-2">
                <label htmlFor="displayName" className="form-label">
                  Display Name (meta)
                </label>
              </div>
              <div className="col-12 col-md-10">
                <input
                  size="50"
                  style={{ width: 'auto' }}
                  type="text"
                  id="displayName"
                  name="displayName"
                  className="form-control"
                  value={sensorData?.displayName || sensorData?.name || ''}
                  onChange={(e) =>
                    handleInputChange('displayName', e.target.value)
                  }
                />
                <div className="form-text text-muted">
                  Display name meta data for the device.
                </div>
              </div>
            </div>
            <div className="row mb-3">
              <div className="col-md-2">
                <label htmlFor="password" className="form-label">
                  Password
                </label>
              </div>
              <div className="col-12 col-md-10">
                <input
                  size="50"
                  style={{ width: 'auto' }}
                  type="password"
                  id="password"
                  name="password"
                  className="form-control"
                  value={sensorData?.password || ''}
                  onChange={(e) =>
                    handleInputChange('password', e.target.value)
                  }
                />
                <div className="form-text text-muted">
                  Password for the device, leave empty if no password is set.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (pluginState == 'stopped' || pluginState == 'unknown')
    return <h3>Enable plugin to see configuration</h3>
  else
    return (
      <div>
        {/* Bootstrap Toast for notifications */}
        {snackbarOpen && (
          <div
            style={{
              position: 'fixed',
              bottom: '20px',
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 1050
            }}
          >
            <div className="toast show" role="alert">
              <div className="toast-body d-flex justify-content-between align-items-center">
                {snackbarMessage}
                <button
                  type="button"
                  className="btn-close ms-2"
                  onClick={() => setSnackbarOpen(false)}
                ></button>
              </div>
            </div>
          </div>
        )}

        {error ? <h2 style={{ color: 'red' }}>{error}</h2> : ''}
        {baseSchema._rawHtmlDescription && (
          <div
            style={{ marginBottom: '1rem' }}
            dangerouslySetInnerHTML={{ __html: baseSchema._rawHtmlDescription }}
          />
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            updateBaseData(baseData)
            setSensorData(null)
            setSelectedComponent(null)
          }}
        >
          <div className="row mb-3">
            <div className="col-md-2">
              <label htmlFor="pollInterval" className="form-label">
                Poll Interval (ms)
              </label>
            </div>
            <div className="col-md-4">
              <input
                type="number"
                id="pollInterval"
                name="pollInterval"
                className="form-control"
                value={baseData?.poll ?? 5000}
                onChange={(e) =>
                  setBaseData({
                    ...baseData,
                    poll: parseInt(e.target.value, 10)
                  })
                }
              />
              <div className="form-text text-muted">
                The interval at which the device is polled for updates, -1 to
                disable
              </div>
            </div>
          </div>
          <button type="submit" className="btn btn-primary">
            Save
          </button>
        </form>
        <hr
          style={{
            width: '100%',
            height: '1px',
            color: 'gray',
            'background-color': 'gray',
            'text-align': 'left',
            'margin-left': 0
          }}
        ></hr>
        {getTabs()}
        <div
          style={{
            paddingLeft: 10,
            paddingTop: 10,
            display: sensorData ? '' : 'none'
          }}
        >
          <fieldset disabled={!enableSchema}>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                updateSensorData(sensorData)
                const s = deviceMap.get(sensorData.id)
                if (s) {
                  s._changesMade = false
                }
                setSensorData(null)
                setSelectedComponent(null)
              }}
            >
              {getCommonForm()}
              {sensorData && sensorData.components ? getComponentList() : ''}
              {selectedComponent ? getComponentForm() : ''}
              <div style={spacingStyle} className="d-flex gap-2">
                <button type="submit" className="btn btn-primary">
                  Save
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    undoChanges(sensorData.id)
                  }}
                >
                  Undo
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={(e) => confirmDelete(sensorData.id)}
                >
                  Delete
                </button>
              </div>
            </form>
          </fieldset>
        </div>
      </div>
    )
}
export default ShellyConfig
