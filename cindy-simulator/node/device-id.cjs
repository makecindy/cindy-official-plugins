'use strict';
// UDIDs are case-insensitive. Keep validation at each existing input boundary;
// use one spelling for comparisons, saved bindings, jobs and lock keys.
const deviceId = value => typeof value === 'string' ? value.toUpperCase() : value;
module.exports = {deviceId};
