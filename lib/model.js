/**
 * Created by Сергей on 07.07.2015.
 */

module.exports = function (config) {
    function Model() {
        this.table = null;
        this.tasks = [];
        for (var key in arguments) {
            if (arguments.hasOwnProperty(key)) {
                var arg = arguments[key];
                if (typeof arg == 'string') this.name = arg;
                if (typeof arg == 'object') this.config = arg;
            }
        }
        if (typeof this.config == 'undefined') this.config = config.db;
        if (typeof this.name != 'undefined') this.initTable();
    }


    Model.prototype.setServer = function (config) {
        this.config = config;
        if (typeof this.name != 'undefined') this.initTable();
    };

    Model.prototype.setConfig = function (config) {
        this.config = config;
    };

    Model.prototype.connect = function (options) {
        var sql = this.utils.sql;
        var config = options.config || this.config;
        var connection = new sql.Connection(config);
        connection.config.options.useUTC = false;
        connection.connect(function (error) {
            (typeof options.success != 'undefined') && !error && options.success(connection);
            (typeof options.fail != 'undefined') && !!error && options.fail(error);
        });
    };

    Model.prototype.initTable = function () {
        var self = this;
        var sql = this.utils.sql;
        this.table = null;
        this.sql({
            text: "SELECT column_name AS name, data_type AS type, character_maximum_length AS length, is_nullable AS nullable, COLUMNPROPERTY(object_id(TABLE_NAME), COLUMN_NAME, 'IsIdentity') AS incr FROM INFORMATION_SCHEMA.COLUMNS WHERE table_name = UPPER(:p_table)",
            params: [
                {name: ':p_table', value: this.name}
            ],
            success: function (columns) {
                var table = new sql.Table(self.name);
                table.create = true;
                columns.forEach(function (column) {
                    if (column.incr != '1') {
                        table.columns.add(column.name, self.utils.getType(column.type, column.length), {nullable: (column.nullable == 'YES')});
                    }
                });
                self.table = table;
                self.runTask('afterTableInit');
            },
            fail: function (error) {
                console.log(error);
            }
        });
    };

    Model.prototype.addTask = function (event, fn, arg) {
        this.tasks.push({event: event, fn: fn, arg: arg});
    };

    Model.prototype.runTask = function (event) {
        var self = this;
        var done = [];
        this.tasks.every(function (task, index) {
            if (event == task.event) {
                // TODO неверный порядок
                (typeof self[task.fn] != 'undefined') && self[task.fn](task.arg);
                (typeof task.fn == 'function') && task.fn(task.arg);
                done.push(index);
                return !(task.fn == 'save');
            }
        });
        this.tasks = this.tasks.filter(function (task, index) {
            var found = false;
            for (var i in done) {
                if (done.hasOwnProperty(i) && done[i] == index) {
                    found = true;
                    break;
                }
            }
            return !found;
        });
    };

    Model.prototype.taskExists = function (event) {
        var found = false;
        this.tasks.forEach(function (task) {
            if (event == task.event) {
                found = true;
                return true;
            }
        });
        return found;
    }; //TODO unused

    Model.prototype.addRecord = function (record) {
        if (!Array.isArray(record))
            record = this.utils.sterilize(this.table.columns, record);
        this.table.rows.push(this.utils.convert(this.table.columns, record));
    };

    Model.prototype.post = function (data) {
        if (!!data && data.length == 0) return;
        if (this.table == null) {
            this.addTask('afterTableInit', 'post', data);
            return
        }
        var self = this;
        if (Array.isArray(data[0]) || Array.isArray(data) && typeof data[0] === 'object') {
            data.forEach(function (record) {
                self.addRecord(record);
            });
        } else self.addRecord(data);
    };

    Model.prototype.save = function (options) {
        options = options || {};
        if (this.table == null) {
            this.addTask('afterTableInit', 'save', options);
            return;
        }
        var self = this;
        this.connect({
            success: function (connection) {
                var request = connection.request();
                request.bulk(self.table, function (error) {
                    var count = self.table.rows.length;
                    self.table.rows = [];
                    (typeof options.success != 'undefined') && !error && options.success(count);
                    (typeof options.fail != 'undefined') && !!error && options.fail(error);
                    connection.close();
                });
            },
            fail: function (error) {
                console.log(error);
            }
        });
    };

    Model.prototype.sql = function (options) {
        options = options || {};
        var self = this;
        this.connect({
            success: function (connection) {
                if (typeof options.params != 'undefined') {
                    options.params.forEach(function (param) {
                        if (param.value instanceof Date)
                            options.text = options.text.replace(param.name, self.utils.toSQLDate(param.value));
                        else
                            options.text = options.text.replace(param.name, "'" + param.value + "'");
                    });
                }
                var request = connection.request();
                request.query(options.text, function (error, data) {
                    (typeof options.success != 'undefined') && !error && options.success(data);
                    (typeof options.fail != 'undefined') && !!error && options.fail(error);
                    connection.close();
                });
            },
            fail: function (error) {
                (typeof options.fail != 'undefined') && !!error && options.fail(error);
            }
        });
    };

    Model.prototype.update = function (options) {
        var self = this;
        options = options || {};
        typeof options.fail == 'undefined' && (options.fail = console.error);
        var fields = Object.keys(options.field).map(function (key) {
            var variable = key + " = " + options.field[key];
            if (typeof options.field[key] === 'string')
                variable = key + " = N'" + options.field[key] + "'";
            if (options.field[key] instanceof Date)
                variable = key + " = " + self.utils.toSQLDate(options.field[key]);
            return variable;
        });
        var conditions = Object.keys(options.condition).map(function (key) {
            var list = [];
            var cond = options.condition[key];
            var result =
                (!!cond.eq && key + " = '" + cond.eq + "'") ||
                (!!cond.not && key + " != '" + cond.not + "'") ||
                (!!cond.gt && key + " > '" + cond.gt + "'") ||
                (!!cond.gte && key + " >= '" + cond.gte + "'") ||
                (!!cond.ls && key + " < '" + cond.ls + "'") ||
                (!!cond.lse && key + " <= '" + cond.lse + "'");
            if (!result && !!cond.in) {
                list = cond.in.map(function (value) {
                    return "'" + value + "'";
                });
                result = key + ' IN (' + list.join(',') + ')';
            }
            if (!result && !!cond.notIn) {
                list = cond.notIn.map(function (value) {
                    return "'" + value + "'";
                });
                result = key + ' NOT IN (' + list.join(',') + ')';
            }
            if (!result && !!cond.between) {
                result = key + " BETWEEN '" + cond.between + "' AND '" + cond.and + "'";
            }
            return result;
        });
        var sqlText = "UPDATE " + this.name + " SET " + fields.join(', ') + ' WHERE ' + conditions.join(' AND ');
        this.sql({
            text: sqlText,
            success: options.success,
            fail: options.fail
        });
    };

    Model.prototype.procedure = function (options) {
        options = options || {};
        this.connect({
            success: function (connection) {
                var request = connection.request();
                if (typeof options.params != 'undefined') {
                    options.params.forEach(function (param) {
                        request.input(param.name, param.type, param.value);
                    });
                }
                request.execute(options.name, function (error, data, value) {
                    (typeof options.success != 'undefined') && options.success(data, value);
                    (typeof options.fail != 'undefined') && !!error && options.fail(error);
                    connection.close();
                });
            },
            fail: function (error) {
                (typeof options.fail != 'undefined') && !!error && options.fail(error);
            }
        });
    };

    Model.prototype.on = function (event, fn) {
        this.addTask(event, fn);
    };

    Model.prototype.utils = {
        sql: require('mssql'),
        getType: function (type, length) {
            var list = {
                int: this.sql.Int,
                bigint: this.sql.Int,
                float: this.sql.Int,
                varchar: this.sql.VarChar(length),
                nvarchar: this.sql.NVarChar(length),
                bit: this.sql.Bit,
                datetime: this.sql.DateTime,
                date: this.sql.DateTime,
                timestamp: this.sql.Time,
                buffer: this.sql.VarBinary,
                table: this.sql.TVP
            };
            return list[type];
        },
        sterilize: function (columns, data) {
            var record = [];
            columns.forEach(function (column) {
                if (!!data[column.name]) record.push(data[column.name]);
                else record.push(null);
            });
            return record;
        },
        convert: function (columns, data) {
            var self = this;
            var record = [];
            columns.forEach(function (column, index) {
                if (column.type == self.sql.DateTime && data[index] != null && !(data[index] instanceof Date)) {
                    record.push(new Date(data[index]));
                }
                else record.push(data[index]);
            });
            return record;
        },
        getTime: function () {
            var now = new Date();
            return now.getDate() + '/'
                + (now.getMonth() + 1) + '/'
                + now.getFullYear() + ' @ '
                + now.getHours() + ':'
                + now.getMinutes() + ':'
                + now.getSeconds() + ':'
                + now.getMilliseconds();
        },
        toSQLDate: function (date) {
            var result = date
                    .toISOString()
                    .replace('T', ' ')
                    .replace(/\.\d+Z$/, '')
                ;
            return "CONVERT(datetime, '" + result + "', 121)";
        }
    };

    return Model;
};