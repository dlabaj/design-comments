/* eslint-disable @typescript-eslint/no-var-requires */

const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const TsconfigPathsPlugin = require('tsconfig-paths-webpack-plugin');
const Dotenv = require('dotenv-webpack');
const BG_IMAGES_DIRNAME = 'bgimages';
const ASSET_PATH = process.env.ASSET_PATH || '/';
const repoRoot = path.resolve(__dirname, '..');

module.exports = (env) => {
  return {
    entry: {
      main: path.resolve(__dirname, 'src/index.tsx'),
    },
    module: {
      rules: [
        {
          test: /\.(tsx|ts|jsx)?$/,
          use: [
            {
              loader: 'ts-loader',
              options: {
                transpileOnly: true,
                experimentalWatchApi: true,
                configFile: path.resolve(__dirname, 'tsconfig.json'),
              },
            },
          ],
        },
        {
          test: /\.(svg|ttf|eot|woff|woff2)$/,
          type: 'asset/resource',
          include: [
            path.resolve(repoRoot, 'node_modules/patternfly/dist/fonts'),
            path.resolve(repoRoot, 'node_modules/@patternfly/react-core/dist/styles/assets/fonts'),
            path.resolve(repoRoot, 'node_modules/@patternfly/react-core/dist/styles/assets/pficon'),
            path.resolve(repoRoot, 'node_modules/@patternfly/patternfly/assets/fonts'),
            path.resolve(repoRoot, 'node_modules/@patternfly/patternfly/assets/pficon'),
          ],
        },
        {
          test: /\.svg$/,
          type: 'asset/inline',
          include: (input) => input.indexOf('background-filter.svg') > 1,
          use: [
            {
              options: {
                limit: 5000,
                outputPath: 'svgs',
                name: '[name].[ext]',
              },
            },
          ],
        },
        {
          test: /\.svg$/,
          include: (input) => input.indexOf(BG_IMAGES_DIRNAME) > -1,
          type: 'asset/inline',
        },
        {
          test: /\.svg$/,
          include: (input) =>
            input.indexOf(BG_IMAGES_DIRNAME) === -1 &&
            input.indexOf('fonts') === -1 &&
            input.indexOf('background-filter') === -1 &&
            input.indexOf('pficon') === -1,
          use: {
            loader: 'raw-loader',
            options: {},
          },
        },
        {
          test: /\.(jpg|jpeg|png|gif)$/i,
          include: [
            path.resolve(__dirname, 'src'),
            path.resolve(repoRoot, 'src/commenting-system'),
            path.resolve(repoRoot, 'node_modules/patternfly'),
            path.resolve(repoRoot, 'node_modules/@patternfly/patternfly/assets/images'),
            path.resolve(repoRoot, 'node_modules/@patternfly/react-styles/css/assets/images'),
            path.resolve(repoRoot, 'node_modules/@patternfly/react-core/dist/styles/assets/images'),
            path.resolve(
              repoRoot,
              'node_modules/@patternfly/react-core/node_modules/@patternfly/react-styles/css/assets/images'
            ),
            path.resolve(
              repoRoot,
              'node_modules/@patternfly/react-table/node_modules/@patternfly/react-styles/css/assets/images'
            ),
            path.resolve(
              repoRoot,
              'node_modules/@patternfly/react-inline-edit-extension/node_modules/@patternfly/react-styles/css/assets/images'
            ),
          ],
          type: 'asset/inline',
          use: [
            {
              options: {
                limit: 5000,
                outputPath: 'images',
                name: '[name].[ext]',
              },
            },
          ],
        },
      ],
    },
    output: {
      filename: '[name].bundle.js',
      path: path.resolve(__dirname, 'dist'),
      publicPath: ASSET_PATH,
    },
    plugins: [
      new HtmlWebpackPlugin({
        template: path.resolve(__dirname, 'src/index.html'),
      }),
      new Dotenv({
        path: path.resolve(repoRoot, '.env'),
        systemvars: false,
        silent: true,
      }),
      new webpack.DefinePlugin({
        'process.env.SUMMARIZE_API_URL': JSON.stringify(process.env.SUMMARIZE_API_URL || ''),
      }),
    ],
    resolve: {
      extensions: ['.js', '.ts', '.tsx', '.jsx'],
      plugins: [
        new TsconfigPathsPlugin({
          configFile: path.resolve(__dirname, 'tsconfig.json'),
        }),
      ],
      symlinks: false,
      cacheWithContext: false,
    },
  };
};
