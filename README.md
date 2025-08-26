# signalk-shelly2
[![npm version](https://img.shields.io/npm/v/@canboat/ts-pgns.svg)](https://www.npmjs.com/@canboat/ts-pgns)

A Signal K plugin for integrating Shelly Gen 2+ smart devices into your Signal K server. This plugin automatically discovers Shelly devices on your network and provides real-time monitoring and control capabilities.

## Overview

This plugin supports any Gen 2 or better Shelly device, automatically discovering them via mDNS and connecting via WebSocket for real-time data updates. It maps Shelly device components to appropriate Signal K paths, enabling seamless integration with your marine electronics system.

## Features

- **Automatic Device Discovery**: Uses mDNS to automatically find Shelly devices on your network
- **Real-time Updates**: WebSocket connection for instant status updates
- **Component Mapping**: Maps Shelly components to Signal K electrical and environmental paths
- **Device Control**: Send PUT messages to control switches, lights, and other controllable components
- **Reconnection Handling**: Automatic reconnection 

## Supported Shelly Component Types

The plugin does not support specific Shelly devices, instead it supports the following Shelly component types:

### Electrical Components
- **`Switch`** - Basic on/off switches and relays → `electrical.switches`
- **`Light`** - Light controllers → `electrical.switches`
- **`RGB`** - RGB color lights → `electrical.switches`
- **`RGBW`** - RGBW color lights with white channel → `electrical.switches`

### Energy Monitoring
- **`EM`** - Energy meter → `electrical.energymeter`
- **`EM1`** - Single-phase energy meter → `electrical.energymeter`
- **`PM1`** - Power meter → `electrical.powermeter`
- **`voltmeter`** - Voltage measurement → `electrical.voltmeter`

### Environmental Sensors
- **`Temperature`** - Temperature sensors → `environment`
- **`Humidity`** - Humidity sensors → `environment`
- **`Smoke`** - Smoke detectors → `environment.smoke`

### Input/Output
- **`Input`** - Digital inputs and sensors
- **`Devicepower`** - Device power and battery status

## Confirmed Device Support
Please report any devices you've tested so that I can add to the list. Please open a issue.
- Shelly 1 Gen4 (S4SW-001X16EU)
- Shelly Plus 1 Gen2 (SNSW-001X16EU, SNSW-001X15UL)

## Troubleshooting

If you do not see any data you expect, please open an issue. Turn on debug logging for the plugin, and you'll see a message in the log `Initial device status retrieved successfully from...` followed by JSON data. Please include that data in your issue.

## License

Apache-2.0

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

## Author

Scott Bender (scott@scottbender.net)
