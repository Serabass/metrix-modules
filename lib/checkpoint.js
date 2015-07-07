
module.exports = function (config) {
    var RFID = require('./rfid')(config);

    function Checkpoint(options) {
        this.sleepTime = options.sleep || 1000 * 60 * 10;
        this.devices = options.devices;
        this.deamons = [];
    }

    Checkpoint.prototype.start = function () {
        var self = this;
        this.devices.forEach(function (device) {
            var daemon = new RFID({device: device, sleepTime: self.sleepTime});
            self.deamons.push(daemon);
            daemon.start();
        });
    };

    return Checkpoint;
};