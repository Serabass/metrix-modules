/**
 * Created by Сергей on 07.07.2015.
 */

module.exports = function (config) {
    return {
        Model: require('./lib/model')(config),
        Scale: require('./lib/scale')(config),
        RFID: require('./lib/rfid')(config),
        newRFID: require('./lib/new-rfid')(config),
        Checkpoint: require('./lib/checkpoint')(config)
    }
};