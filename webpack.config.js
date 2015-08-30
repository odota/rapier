module.exports = {
    entry: "./Parser.js",
    output: {
        filename: "./build/rapier.js"
    },
    module: {
        loaders: [
            {
                test: /\.(json)(\?v=[0-9]\.[0-9]\.[0-9])?$/,
                loader: "json-loader"
            }
        ]
    }
};