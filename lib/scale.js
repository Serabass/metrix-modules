/**
 * Created by Сергей on 07.07.2015.
 */

var model = require('./model');

module.exports = function (config) {
    var Model = model(config);

    function Scale(options) {
        this.constructor.call(this, 'scale');
        this.devices = options.devices;
        this.sleepTime = options.sleep || 1000 * 60 * 10;
    }

    Scale.prototype = new Model();


    Scale.prototype.start = function () {
        console.log('Data collection started'.white);
        var self = this;
        this.devices.forEach(function (device) {
            self.grab(device);
        });
    };

    Scale.prototype.wait = function (device, time, fn) {
        var self = this;
        var t = time || this.sleepTime;
        var f = fn || function () {
            console.log('Awake, start collection data from: %s'.blue, device.location);
            self.grab(device);
        };
        setTimeout(f, t);
    };

    Scale.prototype.grab = function (device) {
        this.lastRecord(device);
    };

    Scale.prototype.lastRecord = function (device) {
        var self = this;
        this.sql({
            text: 'SELECT ISNULL(MAX(seq), 0) as last FROM scale s WHERE s.departure = :p_dept',
            params: [
                {name: ':p_dept', value: device.location}
            ],
            success: function (data) {
                var last = data[0].last;
                self.getData(device, last);
            },
            fail: function () {
                console.log('Server database is inaccessible.'.red);
                console.log('Next attempt to connect will be after %s sec.'.yellow, (self.sleepTime / 1000));
                self.wait(null, self.sleepTime, function () {
                    self.lastRecord(device);
                });
            }
        });
    };

    Scale.prototype.getData = function (device, offset) {
        var self = this;
        var client = new Model(device.params.scale);
        var sql = "SELECT TOP 500 w.seq AS seq, replace(w.Plate, ' ', '') AS plate, w.TicketNo AS ticketNo, w.WeighTime2 AS time, " +
            "w.Weight2 AS weight, w.Net AS net, w.MaterialCode AS matCode, w.MaterialName AS material, w.Code1 AS  compCode, " +
            "w.CName1 AS company, w.Code2 AS destCode, w.CName2 AS dest, :p_dept AS departure, :p_ip AS ip FROM Weigh2 w " +
            "WHERE w.seq > :p_start ORDER BY w.seq";
        client.sql({
            text: sql,
            params: [
                {name: ':p_ip', value: device.ip},
                {name: ':p_dept', value: device.location},
                {name: ':p_start', value: offset}
            ],
            success: function (data) {
                if (data.length == 0) {
                    console.log('No data left, lets wait for a while...'.gray);
                    console.log();
                    self.wait(device);
                } else {
                    console.log(self.utils.getTime());
                    console.log('Retrieved records: %s'.green, data.length);
                    console.log('From: %s'.green, device.location);
                    data.forEach(function (record) {
                        record.plate = record.plate.trim();
                    });
                    self.post(data);
                    self.save({
                        success: function () {
                            self.grab(device);
                        },
                        fail: function (error) {
                            console.log(error);
                            console.log('Server database is inaccessible.'.red);
                        }
                    });
                }
            },
            fail: function () {
                console.log('Currently PC in %s is offline.'.red, device.location);
                console.log('Next attempt to connect will be after %s sec.'.yellow, (self.sleepTime / 1000));
                console.log();
                self.wait(device);
            }
        });
    };

    return Scale;
};