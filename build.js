const path = require('path');
var fs = require('fs');


const CSS = [
    'bootstrap/dist/css/bootstrap.min.css',
    'bootstrap-toggle/css/bootstrap-toggle.css',
    'font-awesome/css/font-awesome.min.css',
    'inputmask/css/inputmask.css',
    'admin-lte/dist/css/AdminLTE.min.css',
    'admin-lte/dist/css/skins/skin-blue.min.css',
    'admin-lte/dist/css/skins/skin-purple.min.css',
    'ionicons/dist/css/ionicons.min.css',
    'gridstack/dist/gridstack.min.css',
    'datatables.net-bs/css/dataTables.bootstrap.min.css',


    /*
    'admin-lte/plugins/bootstrap-slider/slider.css',
    'bootstrap-daterangepicker/daterangepicker.css',
    */
];
const FONT = [
    'font-awesome/fonts/fontawesome-webfont.woff2',
    'bootstrap/fonts/glyphicons-halflings-regular.woff',
    'bootstrap/fonts/glyphicons-halflings-regular.woff2',
    'bootstrap/fonts/glyphicons-halflings-regular.ttf'
];

const JS = [
    'bootstrap/dist/js/bootstrap.js',
    'bootstrap-toggle/js/bootstrap-toggle.js',
    'jquery/dist/jquery.min.js',
    'inputmask/dist/min/inputmask/inputmask.min.js',
    'inputmask/dist/min/inputmask/jquery.inputmask.min.js',
    'jwt-decode/build/jwt-decode.min.js',
    'moment/moment.js',
    'admin-lte/dist/js/adminlte.min.js',
    'jssip/dist/jssip.min.js',
    'admin-lte/plugins/jQueryUI/jquery-ui.min.js',
    'gridstack/dist/gridstack.min.js',
    'gridstack/dist/gridstack.jQueryUI.min.js',
    'lodash/lodash.min.js',
    'datatables.net/js/jquery.dataTables.min.js',
    'datatables.net-bs/js/dataTables.bootstrap.min.js',
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
