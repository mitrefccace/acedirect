const path = require('path');
var fs = require('fs');


const CSS = [
    'bootstrap-toggle/css/bootstrap-toggle.css',
    // font awesome 5
    'admin-lte/plugins/fontawesome-free/css/all.min.css',
    // font awesome 4
    'font-awesome/css/font-awesome.min.css',
    'inputmask/css/inputmask.css',
    'admin-lte/dist/css/adminlte.min.css',
    'admin-lte/plugins/datatables-bs4/css/dataTables.bootstrap4.min.css',
    'ionicons/dist/css/ionicons.min.css',
    'gridstack/dist/gridstack.min.css',


    /*
    'admin-lte/plugins/bootstrap-slider/slider.css',
    'bootstrap-daterangepicker/daterangepicker.css',
    */
];
const FONT = [
    // font awesome 4 fonts
    'font-awesome/fonts/fontawesome-webfont.woff',
    'font-awesome/fonts/fontawesome-webfont.woff2',
    // 'bootstrap/fonts/glyphicons-halflings-regular.woff',
    // 'bootstrap/fonts/glyphicons-halflings-regular.woff2',
    // 'bootstrap/fonts/glyphicons-halflings-regular.ttf',
    //ionicons
    'ionicons/dist/fonts/ionicons.woff',
    'ionicons/dist/fonts/ionicons.woff2',
    'ionicons/dist/fonts/ionicons.ttf',
];
const WEB_FONT = [
    'admin-lte/plugins/fontawesome-free/webfonts/fa-solid-900.woff',
    'admin-lte/plugins/fontawesome-free/webfonts/fa-solid-900.woff2',
    'admin-lte/plugins/fontawesome-free/webfonts/fa-regular-400.woff',
    'admin-lte/plugins/fontawesome-free/webfonts/fa-regular-400.woff2'
]

const JS = [
    'admin-lte/dist/js/adminlte.min.js',
    'admin-lte/plugins/jquery/jquery.min.js',
    'admin-lte/plugins/jquery-ui/jquery-ui.min.js',
    'admin-lte/plugins/bootstrap/js/bootstrap.min.js',
    'admin-lte/plugins/popper/umd/popper.min.js',
    'bootstrap-toggle/js/bootstrap-toggle.js',
    'admin-lte/plugins/datatables/jquery.dataTables.min.js',
    'admin-lte/plugins/datatables-bs4/js/dataTables.bootstrap4.min.js',
    'inputmask/dist/min/inputmask/inputmask.min.js',
    'inputmask/dist/min/inputmask/jquery.inputmask.min.js',
    'jwt-decode/build/jwt-decode.min.js',
    'moment/moment.js',
    'jssip/dist/jssip.min.js',
    'gridstack/dist/gridstack.min.js',
    'gridstack/dist/gridstack.jQueryUI.min.js',
    'lodash/lodash.min.js',
    /*
    'admin-lte/plugins/bootstrap-slider/bootstrap-slider.js',
    'bootstrap-daterangepicker/daterangepicker.js',
    'jquery-form-validator/form-validator/jquery.form-validator.min.js',
    'jquery-form-validator/form-validator/toggleDisabled.js',
    */
];


if (!fs.existsSync('./public/assets')) {
    fs.mkdirSync('./public/assets');
}
if (!fs.existsSync('./public/assets/js')) {
    fs.mkdirSync('./public/assets/js');
}
if (!fs.existsSync('./public/assets/css')) {
    fs.mkdirSync('./public/assets/css');
}
if (!fs.existsSync('./public/assets/fonts')) {
    fs.mkdirSync('./public/assets/fonts');
}
if (!fs.existsSync('./public/assets/webfonts')) {
    fs.mkdirSync('./public/assets/webfonts');
}
JS.map(asset => {
    let filename = asset.substring(asset.lastIndexOf("/") + 1);
    let from = path.resolve(__dirname, `./node_modules/${asset}`)
    let to = path.resolve(__dirname, `./public/assets/js/${filename}`)
    if (fs.existsSync(from)) {
        fs.createReadStream(from).pipe(fs.createWriteStream(to));
    } else {
        console.log(`${from} does not exist.\nUpdate the build.js script with the correct file paths.`)
        process.exit(1)
    }
});

CSS.map(asset => {
    let filename = asset.substring(asset.lastIndexOf("/") + 1);
    let from = path.resolve(__dirname, `./node_modules/${asset}`)
    let to = path.resolve(__dirname, `./public/assets/css/${filename}`)
    if (fs.existsSync(from)) {
        fs.createReadStream(from).pipe(fs.createWriteStream(to));
    } else {
        console.log(`${from} does not exist.\nUpdate the build.js script with the correct file paths.`)
        process.exit(1)
    }
});

FONT.map(asset => {
    let filename = asset.substring(asset.lastIndexOf("/") + 1);
    let from = path.resolve(__dirname, `./node_modules/${asset}`)
    let to = path.resolve(__dirname, `./public/assets/fonts/${filename}`)
    if (fs.existsSync(from)) {
        fs.createReadStream(from).pipe(fs.createWriteStream(to));
    } else {
        console.log(`${from} does not exist.\nUpdate the build.js script with the correct file paths.`)
        process.exit(1)
    }
});
WEB_FONT.map(asset => {
    let filename = asset.substring(asset.lastIndexOf("/") + 1);
    let from = path.resolve(__dirname, `./node_modules/${asset}`)
    let to = path.resolve(__dirname, `./public/assets/webfonts/${filename}`)
    if (fs.existsSync(from)) {
        fs.createReadStream(from).pipe(fs.createWriteStream(to));
    } else {
        console.log(`${from} does not exist.\nUpdate the build.js script with the correct file paths.`)
        process.exit(1)
    }
});
