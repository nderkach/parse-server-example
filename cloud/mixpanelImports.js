/**
 * Importing of mixpanel events into a Parse table.
 */

var exports;

(function () {
    'use strict';

    var _ = require('underscore');
    var moment = require('./cloud/moment.min.js');
    var dates = require('./cloud/dates.js');
    var mixpanelExports = require('./cloud/mixpanel.js');
    var queries = require('./cloud/queries.js');

    var User = Parse.Object.extend('User');
    var MixpanelImports = Parse.Object.extend('MixpanelImports');


    /* Given a list of mixpanel events, write them out to the MixpanelImports table. */
    function importEventsForDay(date, eventNames, usersCallback) {
        return mixpanelExports.getEvents(eventNames, date, date).then(function(rawEvents) {
            console.log('num events: ' + rawEvents.length);
            /*
             * 1) Drop existing mixpanel events for the given day.
             * 2) Fetch users for mixpanel distinct_id.
             * 3) Write new event rows.
             */
            function deleteExistingRows() {
                var deleteQuery = new Parse.Query(MixpanelImports);
                deleteQuery.containedIn('event', eventNames);
                deleteQuery.greaterThanOrEqualTo('timestamp', date.toDate());
                deleteQuery.lessThan('timestamp', date.clone().add(1, 'days').toDate());
                return deleteQuery.each(function (row) {
                    return row.destroy({useMasterKey: true});
                }, {useMasterKey: true});
            }

            function fetchUsers(events) {
                var mixpanelIdsDict = {};
                events.forEach(function (event) {
                    mixpanelIdsDict[event.properties.distinct_id] = true;
                });
                var mixpanelIds = _.keys(mixpanelIdsDict);

                var query = queries.activeUsers();
                query.select('mixpanel_id'); // performance optimisation
                query.containedIn('mixpanel_id', mixpanelIds);

                var usersByMixpanelId = {};
                return query.each(function (user) {
                    usersByMixpanelId[user.get('mixpanel_id')] = user;
                }, {useMasterKey: true}).then(function () {
                    return usersByMixpanelId;
                });
            }

            function writeEvents(events, usersByMixpanelId) {
                var sessionDurationProperty = 'Elapsed seconds';
                var activities = events.filter(function (event) {
                    // filter out where the user could be blocked or deleted etc
                    return usersByMixpanelId.hasOwnProperty(event.properties.distinct_id) &&
                        (event.event !== 'Session' || event.properties.hasOwnProperty(sessionDurationProperty));
                }).map(function (event) {
                    var row = new MixpanelImports();
                    row.set('event', event.event);
                    row.set('timestamp', new Date(event.properties.time * 1000));
                    row.set('user', usersByMixpanelId[event.properties.distinct_id]);
                    if (event.event === 'Session') {
                        row.set('properties', {'sessionLengthSeconds': event.properties[sessionDurationProperty]});
                    }
                    return row;
                });

                return Parse.Object.saveAll(activities, {useMasterKey: true}).then(function () {
                    return activities.length;
                });
            }

            return Parse.Promise.when(deleteExistingRows(), fetchUsers(rawEvents)).then(function (unused, usersByMixpanelId) {
                return writeEvents(rawEvents, usersByMixpanelId).then(function(rowsImported) {
                    var usersCallbackPromise = usersCallback !== undefined ? usersCallback(_.values(usersByMixpanelId), rawEvents) : Parse.Promise.as();
                    return usersCallbackPromise.then(function() {
                        return rowsImported;
                    });
                });
            });
        });
    }

    /**
     * Import event data from Mixpanel and write them to the MixpanelImports table. One day of data is
     * processed at a time. The start date is the last import date, the end date is yesterday as to avoid
     * incomplete data. Failures are handled by running the import as a Cloud Job to provide serialization
     * and then always importing the lastImportDate overwriting the existing data for that day. If it did
     * fail previously it will be overwritten. It's a bit of overhead but saves having the extra complexity
     * of maintaining an 'import log' success/failure information in a separate table.
     *
     * NOTE(mike): It's not strictly necessary to avoid importing incomplete "today's data" but I decided not
     * to do it because it's a property of the failure handling that this is OK. Another method such as a
     * separate table would work easier using whole days.
     */
    exports.importEventsFromMixpanel = function(eventNames, defaultStartDate, usersCallback) {
        var query = new Parse.Query(MixpanelImports);
        query.containedIn('event', eventNames);
        query.descending('timestamp');
        return query.first({useMasterKey: true}).then(function(activity) {
            if (!!activity) {
                var lastImportDate = moment(activity.get('timestamp'));
                return lastImportDate;
            }
            return null;
        }).then(function(lastImportDate) {
            // NOTE(mike): There's a possibility that the last imported day failed for whatever transient reason.
            // So always re-process from the last imported day instead of having to maintain an 'import success log'.
            var startDate = (lastImportDate !== null ? lastImportDate : defaultStartDate).clone().startOf('day');
            var endDate = moment().subtract(1, 'days').clone().startOf('day');
            var numDays = endDate.diff(startDate, 'days') + 1; // inclusive of endDate

            console.log('Fetching from ' + dates.fmtDay(startDate) + ' to ' + dates.fmtDay(endDate) + ' (' + numDays + ' days)');

            function processDate(date) {
                return function(accumRowsImported) {
                    console.log('fetching mixpanel data for day ' + dates.fmtDay(date));
                    return importEventsForDay(date, eventNames, usersCallback).then(function(rowsImported) {
                        return accumRowsImported + rowsImported;
                    });
                };
            }

            var promiseChain = Parse.Promise.as(0); // accumulate num rows imported
            for (var i = 0; i < numDays; i++) {
                var date = startDate.clone().add(i, 'days');
                promiseChain = promiseChain.then(processDate(date));
            }
            return promiseChain;
        });
    };
})();
