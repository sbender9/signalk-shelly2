# signalk-shelly2

A Signal K plugin for integrating Shelly Gen 2+ smart devices into your Signal K server. This plugin automatically discovers Shelly devices on your network and provides real-time monitoring and control capabilities.

## Overview

This plugin supports any Gen 2 or better Shelly device, automatically discovering them via mDNS and connecting via WebSocket for real-time data updates. It maps Shelly device components to appropriate Signal K paths, enabling seamless integration with your marine electronics system.

## Features

- **Automatic Device Discovery**: Uses mDNS to automatically find Shelly devices on your network
- **Real-time Updates**: WebSocket connection for instant status updates
- **Component Mapping**: Maps Shelly components to Signal K electrical and environmental paths
- **Device Control**: Send commands to control switches, lights, and other controllable components
- **Reconnection Handling**: Automatic reconnection 

## Supported Shelly Component Types

The plugin supports the following Shelly component types:

### Electrical Components
- **`switch`** - Basic on/off switches and relays → `electrical.switches`
- **`light`** - Light controllers → `electrical.switches`
- **`rgb`** - RGB color lights → `electrical.switches`
- **`rgbw`** - RGBW color lights with white channel → `electrical.switches`

### Energy Monitoring
- **`em`** - Energy meter → `electrical.energymeter`
- **`em1`** - Single-phase energy meter → `electrical.energymeter`
- **`pm1`** - Power meter → `electrical.powermeter`
- **`voltmeter`** - Voltage measurement → `electrical.voltmeter`

### Environmental Sensors
- **`temperature`** - Temperature sensors → `environment`
- **`humidity`** - Humidity sensors → `environment`
- **`smoke`** - Smoke detectors → `environment.smoke`

### Input/Output
- **`input`** - Digital inputs and sensors
- **`devicepower`** - Device power and battery status

## Troubleshooting

If you do not see any data you expect, please open an issue. Turn on debug logging for the plugin, and you'll see a message in the log `Initial device status retrieved successfully from...` followed by JSON data. Please include that data in your issue.

## Requirements

- Signal K server
- Shelly devices (Gen 2 or higher)
- Network connectivity between Signal K server and Shelly devices

## License

Apache-2.0

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

## Author

Scott Bender (scott@scottbender.net)
