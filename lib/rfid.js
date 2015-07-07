/**
 * Created by Сергей on 07.07.2015.
 */

module.exports = function (config) {

    var Model = require('./model')(config);

    function RFID(options) {
        this.constructor.call(this, 'rfid');
        this.rawData = [];
        this.active = false;
        this.device = options.device;
        this.sleepTime = options.sleep || 1000 * 60 * 10;
        this.last = options.device.params.rfid.last;
        this.init(options.device.params.rfid.user, options.device.params.rfid.pass);
    }

    RFID.prototype = new Model();

    RFID.prototype.init = function (username, pass) {
        var login = username + ':' + pass;
        this.url = 'http://' + login + '@' + this.device.ip + ':7410/';
        this.auth = 'Basic ' + new Buffer(login).toString('base64');
    };

    RFID.prototype.start = function () {
        console.log('Starting...');
        this.active = true;
        this.getData();
    };

    RFID.prototype.stop = function () {
        this.active = false;
    };

    RFID.prototype.getUrl = function () {
        return this.url + 'Event.htm?page=' + this.last.page;
    };

    RFID.prototype.getData = function () {
        if (!this.active) return;
        var self = this;
        var onError = function () {
            console.log('Server database is inaccessible.'.red);
            console.log('Next attempt to connect will be after %s sec.'.yellow, (self.sleepTime / 1000));
            self.sleep();
        };
        var request = require('request');
        try {
            request.get({
                    url: this.getUrl(),
                    headers: {
                        Authorization: this.auth
                    }
                },
                function (error, response, html) {
                    (!!html) && self.parse(html);
                    (!!error) && onError();
                }
            );
        } catch (ex) {
            onError();
        }
    };

    RFID.prototype.parse = function (data) {
        var self = this;
        var page = false;
        var REC = 0, TIME = 1, TAG = 2;
        var prefix = this.device.name[this.device.name.length - 1].toUpperCase();
        var row = [], time, rec;
        var $ = cheerio.load(data);
        $('table tr').each(function (i, val) {
            row = $(val).find('th');
            time = $(row[TIME]).text();
            rec = parseInt($(row[REC]).text());
            if (i == 0 || rec <= self.last.record) return true; //skip
            if (!time || self.last.time > new Date(time)) { //!time -> empty(time)
                page = false;
                return false
            }
            self.rawData.push({
                ticketNo: prefix + rec,
                time: time,
                tag: $(row[TAG]).text(),
                ip: self.device.ip
            });
            self.last.time = new Date(time);
            self.last.record = rec;
            page = true;
        });
        this.next(page);
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

    RFID.prototype.getTags = function () {
        var list = [];
        this.rawData.forEach(function (rec) {
            if (list.indexOf("'" + rec.tag + "'") == -1) list.push("'" + rec.tag + "'");
        });
        return list;
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

    RFID.prototype.setNet = function () {
        if (this.rawData.length <= 0) return;
        var self = this;
        var plates = this.getPlates();
        var weight = new Model('scale');
        weight.procedure({
            name: 'avgNet',
            params: [{name: 'plates', value: plates, type: this.utils.sql.TVP}],
            success: function (data) {
                var weights = data[0];
                var getNet = function (plate) {
                    var net = null;
                    weights.forEach(function (weight) {
                        if (weight.plate == plate) {
                            net = weight.net;
                            return true;
                        }
                    });
                    return net;
                };
                for (var i = 0; i < self.rawData.length; i++) {
                    var record = self.rawData[i];
                    record.net = getNet(record.plate);
                }
                self.setLocation();
            },
            fail: function (msg) {
                console.error('setNet');
                console.error(msg);
                self.setNet();
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
            params: [{name: ':p_ip', value: this.device.ip}],
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
                    if (gate == 'in')  record.dest = getLocation(record.time);
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
                server.updateParams(self.device.ip, {rfid: {last: self.last}});
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