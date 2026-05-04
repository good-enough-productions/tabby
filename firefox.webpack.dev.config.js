const path = require("path");
const {DefinePlugin} = require("webpack");
const CircularDependencyPlugin = require('circular-dependency-plugin');
const { EmitNewTabPagePlugin } = require("./webpack.newtab-page");

module.exports = {
    mode: "development",
    devtool: "cheap-module-source-map",
    resolve: {
        alias: {
            Polyfill: path.resolve(__dirname, "src/polyfill.js")
        },
        modules: [path.resolve(__dirname, "src"), "node_modules"]
    },
    entry: {
        "background/background": "./src/background/background.js",
        "background/captureTab": "./src/background/captureTab.js",
        "background/commands": "./src/background/commands.js",
        "background/tmpClear": "./src/background/tmpClear.js",
        "content/content": "./src/content/content.js",
        "newtab/newtab": "./src/newtab/newtab.js",
        "options/options": "./src/options/options.js",
        "popup/popup": "./src/popup/popup.js"
    },
    output: {
        filename: "[name].js",
        path: path.resolve(__dirname, "dist")
    },
    plugins: [
        new CircularDependencyPlugin({
            exclude: /node_modules|cartographer\/pkg/,
            failOnError: true,
            allowAsyncCycles: false,
            cwd: process.cwd()
        }),
        new EmitNewTabPagePlugin(),
        new DefinePlugin({
            TARGET: "\"firefox\""
        })
    ],
    experiments: {
        asyncWebAssembly: true,
        // buildHttp: true,
        // layers: true,
        // lazyCompilation: true,
        // outputModule: true,
        // syncWebAssembly: true,
        topLevelAwait: true,
    },
};
