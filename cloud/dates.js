var exports;

(function () {
    'use strict';

    var moment = require('./cloud/moment.min.js');

    // 2013-06-03, month is 0-based :(
    var START_OF_WEEK_ZERO = moment([2013, 6 - 1, 3]); // Monday
    var END_OF_WEEK_ZERO = START_OF_WEEK_ZERO.clone().add('days', 6); // Sunday

    function fmtDate(d) {
        if (d) { return moment(d).format("YYYY-MM-DDTHH:mm:ss"); }
    }
    function fmtDay(d) {
        if (d) { return moment(d).startOf('day').format("YYYY-MM-DD"); }
    }
    function fmtWeek(d) {
        if (d) { return moment(d).endOf('isoWeek').startOf('day').format("YYYY-MM-DD"); }
    }
    function cohortWeek(d) {
        if (d) { return moment(d).startOf('isoWeek').diff(START_OF_WEEK_ZERO, 'weeks'); }
    }
    function cohortDate(week) {
        return END_OF_WEEK_ZERO.clone().add('weeks', week);
    }
    function startOfWeek(d) {
        if (d) { return moment(d).startOf('isoWeek'); }
    }

    // consider a varargs version later
    function earliest(a, b) {
        if (!a) {
            return b;
        }
        if (!b) {
            return a;
        }
        return a.isBefore(b) ? a : b;
    }

    // consider a varargs version later
    function latest(a, b) {
        if (!a) {
            return b;
        }
        if (!b) {
            return a;
        }
        return a.isAfter(b) ? a : b;
    }

    exports.START_OF_WEEK_ZERO = START_OF_WEEK_ZERO;
    exports.END_OF_WEEK_ZERO = END_OF_WEEK_ZERO;
    exports.fmtDate = fmtDate;
    exports.fmtDay = fmtDay;
    exports.fmtWeek = fmtWeek;
    exports.cohortWeek = cohortWeek;
    exports.cohortDate = cohortDate;
    exports.startOfWeek = startOfWeek;
    exports.earliest = earliest;
    exports.latest = latest;
})();
