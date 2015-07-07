/**
 * Created by Сергей on 07.07.2015.
 */

module.exprots = function (config) {
    var Model = require('./model')(config);

    function RFID(options) {
        this.constructor.call(this, 'rfid');
        this.rawData = [];

        this.active = false;
        this.device = options.device;
        this.sleepTime = options.sleep || 1000 * 60 * 10;
        this.last = {};
        this.last.record = 1;
        this.last.time = 1;

    }

    RFID.prototype = new Model();


    RFID.prototype.start = function () {
        console.log('Starting...'.green);
        this.active = true;
        this.getData();
    };

    RFID.prototype.stop = function () {
        this.active = false;
    };


    RFID.prototype.getData = function () {
        var self = this;
        var conin = false;

        var rfid = new Model('rfid');
        rfid.sql({
            text: 'select top 500 * from [checkpoint].dbo.rfid where id>' + self.last.record,
            success: function (val) {
                val.forEach(function (value, i) {

                    self.rawData.push(value);
                    self.last.time = new Date(value.time);
                    self.last.record = value.id;
                    conin = true;
                });

                self.next(conin);

            },
            fail: function (msg) {

                console.error(msg);
                self.setPlate();
            }
        });


    };


    RFID.prototype.next = function (nextPage) {

        if (nextPage && this.active) this.last.page++;
        else this.sleep();
        if (this.rawData.length > 0) this.setPlate();
    };

    RFID.prototype.sleep = function (t, f) {
        var self = this;

        var time = t || this.sleepTime;
        var fn = f || function () {
            console.log('Awake, start collection data from: %s'.blue, self.device.name);
            self.getData();
        };
        setTimeout(fn, time);
    };


    RFID.prototype.getPlates = function () {
        var list = [];
        var sql = this.utils.sql;
        var tvp = new sql.Table();
        tvp.columns.add('plate', sql.NVarChar(20));
        this.rawData.forEach(function (rec) {
            if (list.indexOf(rec.plate) == -1) {
                list.push(rec.plate);
                tvp.rows.add(rec.plate);
            }
        });
        return tvp;
    };

    RFID.prototype.setPlate = function () {
        if (this.rawData.length == 0) return;
        var self = this;
        var tags = this.getTags();
        var truck = new Model('truck');
        truck.sql({
            text: 'SELECT rfid, plate FROM [truck] WHERE rfid IN (' + tags.join(',') + ')',
            success: function (trucks) {
                var findPlate = function (tag) {
                    var plate = null;
                    trucks.forEach(function (truck) {
                        if (tag == truck.rfid) {
                            plate = truck.plate;
                            return true;
                        }
                    });
                    return plate;
                };
                for (var i = 0; i < self.rawData.length; i++) {
                    var record = self.rawData[i];
                    record.plate = findPlate(record.tag);
                }
                self.setNet();
            },
            fail: function (msg) {
                console.error('setPlate');
                console.error(msg);
                self.setPlate();
            }
        });
    };

    RFID.prototype.getTags = function () {
        var list = [];
        this.rawData.forEach(function (rec) {
            if (list.indexOf("'" + rec.tag + "'") == -1) list.push("'" + rec.tag + "'");
        });
        return list;
    };

    RFID.prototype.setNet = function () {
        if (this.rawData.length <= 0) return;
        var self = this;
        var plates = this.getPlates();
        plates.rows = plates.rows.join(',');
        var weight = new Model('scale');
        weight.sql({
            text: 'SELECT TOP 30 ISNULL(ROUND(AVG(net), 0), 0) AS weight  FROM scale WHERE plate IN (SELECT DISTINCT plate FROM dbo.truck)',
            success: function (data) {
                var weights = data[0];
                var getNet = function (plate) {
                    return weights.weight;
                };
                for (var i = 0; i < self.rawData.length; i++) {
                    var record = self.rawData[i];
                    record.net = getNet(record.plate);
                }
                //self.setLocation();
                self.save();
            },
            fail: function (msg) {
                console.error('setLocation');
                console.error(msg);
                //self.setLocation();
            }
        });


    };

    RFID.prototype.setLocation = function () {
        if (this.rawData.length <= 0) return;
        var self = this;
        var gate = this.device.params.rfid.type;
        var location = new Model('checkpoint');
        location.sql({
            text: 'SELECT * FROM [checkpoint] WHERE ip = :p_ip ORDER BY date',
            params: [{ name: ':p_ip', value: this.device.ip }],
            success: function (data) {
                var getLocation = function (date) {
                    var name = self.device.location;
                    data.forEach(function (location) {
                        if (new Date(date) >= location.date) name = location.name;
                    });
                    return name;
                };
                for (var i = 0; i < self.rawData.length; i++) {
                    var record = self.rawData[i];
                    if (gate == 'out') record.departure = getLocation(record.time);
                    if (gate == 'in') record.dest = getLocation(record.time);
                }
                self.save();
            },
            fail: function (msg) {
                console.error('setLocation');
                console.error(msg);
                self.setLocation();
            }
        });
    };

    RFID.prototype.save = function () {

        if (this.rawData.length == 0) return;
        this.post(this.rawData);
        var self = this;
        var parent = this.constructor.prototype;
        parent.save.call(this, {
            success: function (count) {
                console.log('%s: Added %s records to the RFID table.'.green, self.device.name, count);
                self.rawData = [];
                self.getData();
                //server.updateParams(self.device.ip, { rfid: { last: self.last } });
            },
            fail: function (error) {
                console.log('save'.red, error);
                console.log('Server database is inaccessible. Error: %s'.red, error);
                self.save();
            }
        });
    };

    return RFID;
};
