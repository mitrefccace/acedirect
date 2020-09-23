function noOp() {};
exports.Cleanup = function Cleanup(callback) {
  callback = callback || noOp;
  process.on('cleanup',callback);
  process.on('exit', function () {
    process.emit('cleanup');
  });
  process.on('SIGINT', function () {
    console.log('Ctrl-C...');
    process.exit(2);
  });
  process.on('SIGUSR1', function () {
    console.log('Kill 1 caught...');
    process.exit(3);
  });
  process.on('SIGUSR2', function () {
    console.log('Kill 2 caught...');
    process.exit(4);
  });
  process.on('SIGTERM', function () {
    console.log('SIGTERM...');
    process.exit(5);
  });
  process.on('uncaughtException', function(e) {
    console.log('Uncaught Exception...');
    console.log(e.stack);
    process.exit(99);
  });
};

