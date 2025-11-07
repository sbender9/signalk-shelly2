import Form from '@rjsf/core'
import validator from '@rjsf/validator-ajv8'
import ReactHtmlParser from 'react-html-parser'
import React from 'react'
import { useEffect, useState } from 'react'

import { Button, Grid, Snackbar } from '@material-ui/core'
import { makeStyles } from '@material-ui/core/styles'

const log = (type) => console.log.bind(console, type)

import ListGroup from 'react-bootstrap/ListGroup'
import Tabs from 'react-bootstrap/Tabs'
import Tab from 'react-bootstrap/Tab'

import { ListGroupItem, Row, Col } from 'react-bootstrap'

import ProgressBar from 'react-bootstrap/ProgressBar'

export function BTConfig(props) {
  const _uiSchema = {
    'ui:options': { label: false },
    paths: {
      enableMarkdownInDescription: true
    },
    title: { 'ui:widget': 'hidden' }
  }

  const baseUISchema = {
    'ui:field': 'LayoutGridField',
    'ui:layoutGrid': {
      'ui:row': [
        {
          'ui:row': {
            className: 'row',
            children: [
              {
                'ui:columns': {
                  className: 'col-xs-4',
                  children: ['poll']
                }
              }
            ]
          }
        }
      ]
    }
  }

  const useStyles = makeStyles((theme) => ({
    root: {
      '& > *': {
        margin: theme.spacing(1)
      }
    }
  }))

  const [baseSchema, setBaseSchema] = useState({})

  const [baseData, setBaseData] = useState({})

  const [schema, setSchema] = useState({})
  const [uiSchema, setUISchema] = useState(_uiSchema)

  const [sensorData, setSensorData] = useState()

  const [enableSchema, setEnableSchema] = useState(true)
  const [deviceMap, setDeviceMap] = useState(new Map())

  const [progress, setProgress] = useState({
    progress: 0,
    maxTimeout: 100,
    deviceCount: 0,
    totalDevices: 0
  })

  const [pluginState, setPluginState] = useState('unknown')
  const [error, setError] = useState()
  const [snackbarOpen, setSnackbarOpen] = useState(false)
  const [snackbarMessage, setSnackbarMessage] = useState('')
  const classes = useStyles()

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
    json.schema.htmlDescription = (
      <div>
        {ReactHtmlParser(json.schema.htmlDescription)}
        <p></p>
      </div>
    )
    return json
  }

  async function getProgress() {
    const response = await fetchJSONData('getProgress')
    if (response.status != 200) {
      throw new Error(
        `Unable to get progress: ${response.statusText} (${response.status}) `
      )
    }
    const json = await response.json()
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
      setSchema({})
    })
  }

  function undoChanges(id) {
    deviceMap.get(id)._changesMade = false
    deviceMap.get(id).settings = JSON.parse(
      JSON.stringify(deviceMap.get(id).settingsCopy)
    )
    setSensorData(deviceMap.get(id).settings)
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
      setSchema({})
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

        eventSource.addEventListener('progress', (event) => {
          const json = JSON.parse(event.data)
          setProgress(json)
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
      eventSource.close()
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

      getProgress()
        .then((json) => {
          setProgress(json)
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

  function hasConfig(sensor) {
    return Object.keys(sensor.settingsCopy).length > 0
  }

  function createListGroupItem(sensor) {
    const config = hasConfig(sensor)
    return (
      <ListGroupItem className="d-flex justify-content-between"
        action
        onClick={() => {  
          sensor.settings.id = sensor.id
          sensor.settings.address = sensor.address
          sensor.settings.hostname = sensor.hostname
          sensor.settings.name = sensor.name
          sensor.settings.model = sensor.model
          setSchema(sensor.schema)
          setSensorData(sensor.settings)
        }}
      >
            <div style={{ flex: 1 }}>{`${sensor._changesMade ? '*' : ''}`}{sensor.model}</div>
            <div style={{ flex: 1 }}>{sensor.name ?? ''}</div>
            <div style={{ flex: 1 }}>{sensor.address}</div>
            <div style={{ flex: 1 }}>{sensor.id}</div>
            <div style={{ flex: 1 }}>{`${sensor.connected ? 'Yes' : 'No'}`}</div>
      </ListGroupItem>
    )
  }

  function getTabs() {
    console.log('loading tabs')
    const cd = Array.from(deviceMap.entries()).filter((entry) =>
      hasConfig(entry[1])
    )
    const notConfigured = Array.from(deviceMap.entries()).filter(
      (entry) => !hasConfig(entry[1])
    )
    let sensorList = {}
    sensorList['_configured'] =
      cd.length == 0
        ? 'Select a device from Unconfigured and configure it.'
        : cd.map((entry) => {
            console.log(`configured devices: ${entry[0]}`)
            return createListGroupItem(deviceMap.get(entry[0]))
          })

    sensorList['_unconfigured'] =
      notConfigured.length == 0
        ? 'No Unconfigured Devices Found'
        : notConfigured.map((entry) => {
            return createListGroupItem(deviceMap.get(entry[0]))
          })

    return Object.keys(sensorList).map((domain) => {
      return getTab(domain, sensorList[domain])
    })
  }

  function getTab(key, sensorList) {
    let title = key.slice(key.charAt(0) === '_' ? 1 : 0)

    return (
      <Tab
        eventKey={key}
        title={`${title.charAt(0).toUpperCase()}${title.slice(1)}${typeof sensorList == 'string' ? '' : ' (' + sensorList.length + ')'}`}
      >
        <ListGroup style={{ maxHeight: '300px', overflowY: 'auto' }}>
          <ListGroupItem className="d-flex justify-content-between font-weight-bold">
            <div style={{ flex: 1 }}>Model</div>
            <div style={{ flex: 1 }}>Name</div>
            <div style={{ flex: 1 }}>Address</div>
            <div style={{ flex: 1 }}>Shelly ID</div>
            <div style={{ flex: 1 }}>Connected</div>
          </ListGroupItem>
          {sensorList}
        </ListGroup>
      </Tab>
    )
  }

  if (pluginState == 'stopped' || pluginState == 'unknown')
    return <h3>Enable plugin to see configuration</h3>
  else
    return (
      <div>
        <Snackbar
          anchorOrigin={{ horizontal: 'center', vertical: 'bottom' }}
          onClose={() => setSnackbarOpen(false)}
          open={snackbarOpen}
          message={snackbarMessage}
          key={'snackbar'}
        />
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

        {error ? <h2 style={{ color: 'red' }}>{error}</h2> : ''}
        <Form
          schema={baseSchema}
          validator={validator}
          uiSchema={baseUISchema}
          onChange={(e) => setBaseData(e.formData)}
          onSubmit={({ formData }, e) => {
            updateBaseData(formData)
            setSchema({})
          }}
          onError={log('errors')}
          formData={baseData}
        />
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
        <p></p>
        <p></p>
        {progress.deviceCount < progress.totalDevices ? (
          <ProgressBar max={progress.maxTimeout} now={progress.progress} />
        ) : (
          ''
        )}
        <p></p>
        <Tabs defaultActiveKey="_configured" id="domain-tabs" className="mb-3">
          {getTabs()}
        </Tabs>
        <div
          style={{
            paddingLeft: 10,
            paddingTop: 10,
            display: Object.keys(schema).length == 0 ? 'none' : ''
          }}
        >
          <Grid container direction="column" style={{ spacing: 5 }}>
            <Grid item>
              <h2>{schema?.title}</h2>
              <p></p>
            </Grid>
            <Grid item>{ReactHtmlParser(schema?.htmlDescription)}</Grid>
          </Grid>
          <fieldset disabled={!enableSchema}>
            <Form
              schema={schema}
              validator={validator}
              uiSchema={uiSchema}
              onChange={(e, id) => {
                const s = deviceMap.get(e.formData.id)
                if (s) {
                  s._changesMade = true
                  s.config = e.formData
                  setSensorData(e.formData)
                }
              }}
              onSubmit={({ formData }, e) => {
                updateSensorData(formData)
                const s = deviceMap.get(formData.id)
                if (s) {
                  s._changesMade = false
                }
                //alert('Changes saved')
              }}
              onError={log('errors')}
              formData={sensorData}
            >
              <div className={classes.root}>
                <Button type="submit" color="primary" variant="contained">
                  Save
                </Button>
                <Button
                  variant="contained"
                  onClick={() => {
                    undoChanges(sensorData.id)
                  }}
                >
                  Undo
                </Button>
                <Button
                  variant="contained"
                  color="secondary"
                  onClick={(e) => confirmDelete(sensorData.id)}
                >
                  Delete
                </Button>
              </div>
            </Form>
          </fieldset>
        </div>
      </div>
    )
}
export default BTConfig
