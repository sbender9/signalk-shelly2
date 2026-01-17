// const HtmlWebpackPlugin = require('html-webpack-plugin');
const path = require('path')

const { ModuleFederationPlugin } = require('webpack').container
const { WatchIgnorePlugin } = require('webpack')

//require('@signalk/server-admin-ui-dependencies')

const packageJson = require('./package')

console.log(packageJson.name.replace(/[-@/]/g, '_'))

module.exports = {
  entry: './web/index',
  mode: 'development',
  output: {
    path: path.resolve(__dirname, 'public')
  },
  module: {
    rules: [
      {
        test: /\.jsx?$/,
        loader: 'babel-loader',
        exclude: /node_modules/,
        options: {
          presets: [['@babel/preset-react', { runtime: 'classic' }]]
        }
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader']
      },
      {
        test: /\.(png|svg|jpg|gif)$/,
        loader: 'file-loader',
        options: {
          name: '[path][name].[ext]'
        }
      }
    ]
  },
  plugins: [
    new ModuleFederationPlugin({
      name: 'Shelly Gen2 Sensors for Signalk',
      library: { type: 'var', name: packageJson.name.replace(/[-@/]/g, '_') },
      filename: 'remoteEntry.js',
      exposes: {
        './PluginConfigurationPanel':
          './web/components/PluginConfigurationPanel'
      },
      shared: {
        react: {
          singleton: true,
          requiredVersion: '>=16.8.0',
          strictVersion: true
        },
        'react-dom': {
          singleton: true,
          requiredVersion: '>=16.8.0',
          strictVersion: true
        }
      }
    }),
    new WatchIgnorePlugin({
      paths: [path.resolve(__dirname, 'public/')]
    })
    // new HtmlWebpackPlugin({
    //   template: './public/index.html',
    // }),
  ]
}
