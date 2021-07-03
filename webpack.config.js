const path = require('path');

const BUILD_DIR = path.join('frontend/temp-build/');
const OUT_DIR = path.join('frontend/static/');

const INDEX_PATH = path.join('public/scripts/index');
const ADMIN_PATH = path.join('admin/scripts/admin');

module.exports = {
    mode: "production",
    entry: {
        [INDEX_PATH]: path.join(__dirname, BUILD_DIR + INDEX_PATH + '.js'),
        [ADMIN_PATH]: path.join(__dirname, BUILD_DIR + ADMIN_PATH + '.js')
    },
    output: {
        path: path.join(__dirname, OUT_DIR),
        filename: "[name].js"
    },
    optimization: {
        minimize: false,
        splitChunks: {
            chunks: 'all',
            name: path.join('public/scripts/vendor')
        }
    }
};