const path = require('path');
const now = new Date()
const secondsSinceEpoch = Math.round(now.getTime() / 1000)

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


function buildAssets() {
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
}

//function to execute shell command as a promise
//cmd is the shell command
//wdir is the working dir
//return a Promise
function execCommand(cmd,wdir) {
  console.log('executing  ' + cmd + '  ...');
  const exec = require('child_process').exec;
  return new Promise((resolve, reject) => {
    exec(cmd, {cwd: wdir}, (error, stdout, stderr) => {
      if (error) {
        console.warn(error);
        process.exit(99);
      }
      resolve(stdout? stdout : stderr);
    });
  });
}

async function go() {
  console.log('\n*** NOTE: make sure gulp is already installed (as root, npm install -g gulp-cli). ***\n');

  s = await execCommand('rm -rf node_modules >/dev/null  # removing node_modules','.');

  s = await execCommand('npm install >/dev/null  # main install','.');

  s = await execCommand('npm install >/dev/null  # jssip install','./node_modules/jssip');

  s = await execCommand('gulp dist >/dev/null  # jssip build','./node_modules/jssip');

  s = await execCommand('rm -f public/assets/css/* public/assets/fonts/* public/assets/js/* public/assets/webfonts/* || true > /dev/null 2>&1 ','.');

  s = await execCommand('mkdir -p ../scripts  # init scripts','.');

  s = await execCommand('cp scripts/itrslookup.sh ../scripts/.','.');

  s = await execCommand('chmod 755 ../scripts/itrslookup.sh','.');

  //PATCH jssip.js per our findings, rename to jssip.min.js, let build proceed from there
  tempFile = '/tmp/ed' + secondsSinceEpoch + '.txt';
  s = await execCommand('head -n 18197 node_modules/jssip/dist/jssip.js > ' + tempFile + '  # modifying jssip','.');
  
  s = await execCommand('cat patches/jssip_patch.txt >> ' + tempFile ,'.');
 
  s = await execCommand('tail -n 8168 node_modules/jssip/dist/jssip.js >> ' + tempFile,'.');
 
  s = await execCommand('mv ' + tempFile + ' node_modules/jssip/dist/jssip.min.js  ','.');

  buildAssets();
}

go(); //MAIN

