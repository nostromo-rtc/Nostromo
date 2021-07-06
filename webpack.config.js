const path = require('path');

const BUILD_DIR = path.join('frontend/temp-build/');
const OUT_DIR = path.join('frontend/static/');

const ADMIN_PATHNAME = path.join('admin/scripts/admin');
const INDEX_PATHNAME = path.join('public/scripts/index');
const ROOM_PATHNAME = path.join('rooms/scripts/room');

const VENDOR_PATHNAME = path.join('public/scripts/vendor');

module.exports = {
    mode: "production",
    entry: {
        [INDEX_PATHNAME]: path.join(__dirname, BUILD_DIR + INDEX_PATHNAME + '.js'),
        [ADMIN_PATHNAME]: path.join(__dirname, BUILD_DIR + ADMIN_PATHNAME + '.js'),
        [ROOM_PATHNAME] : path.join(__dirname, BUILD_DIR + ROOM_PATHNAME + '.js')
    },
    output: {
        path: path.join(__dirname, OUT_DIR),
        filename: "[name].js"
    },
    optimization: {
        minimize: false,
        splitChunks: {
            chunks: 'all',
            name: VENDOR_PATHNAME
        }
    }
};