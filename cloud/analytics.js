var exports;

// NOTE(mike): promises resolve as undefined for success and as an error string for errors.
// This is so that failed analytics don't break the chains of promises.
(function() {
    'use strict';

    var env = require('./cloud/env.js').env;
    var _ = require('underscore');
    var Buffer = require('buffer').Buffer;
    var dates = require('./cloud/dates.js');
    var moment = require('./cloud/moment.min.js');

    var MIXPANEL_TRACK_URL = 'http://api.mixpanel.com/track';
    var MIXPANEL_ENGAGE_URL = 'http://api.mixpanel.com/engage';

    function objectToBase64Json(obj) {
        var jsonString = JSON.stringify(obj);
        return new Buffer(jsonString, 'utf8').toString('base64');
    }

    exports.recordForUsers = function(users, event, properties) {
        if (users.length === 0) {
            return Parse.Promise.as();
        }

        // if any users aren't fetched their mixpanel id will be missing,
        // so find the ones we need to fetch and then fetch them
        var groups = _.groupBy(users, function(user) {
            // see https://www.parse.com/questions/determine-if-parseobject-has-been-fetched
            return !!user.createdAt;
        });
        var usersNeedFetch = groups[false] || [];
        var alreadyFetchedUsers = groups[true] || [];

        // NOTE(mike): can't use Parse.Object.fetchAll, it doesn't like it... and responds with
        // Result: Uncaught Tried to save an object with a pointer to a new, unsaved object.
        var fetchedUsersPromise = usersNeedFetch.length > 0 ?
            new Parse.Query('User')
                .containedIn('objectId', usersNeedFetch.map(function(u) { return u.id; }))
                .find()
            :
            Parse.Promise.as([]);

        return fetchedUsersPromise.then(function(fetchedUsers) {
            var users = alreadyFetchedUsers;
            fetchedUsers.forEach(function(u) { users.push(u); });
            return recordForFetchedUsers(users, event, properties);
        });
    };

    function recordForFetchedUsers(users, event, properties) {
        properties = properties || {};

        //console.log('track event: ' + event + ' props: ' + JSON.stringify(properties));

        var usersWithMixpanelId =  _.filter(users, function(user) {
            var mixpanelId = user.get("mixpanel_id");
            return !!mixpanelId && mixpanelId.length > 0;
        });

        var payloadList = _.map(usersWithMixpanelId, function(user) {
            var mixpanelId = user.get("mixpanel_id");
            //console.log("for " + user.get("firstname"));
            var mixpanelProps = {
                distinct_id: mixpanelId,
                token: env.mixpanelApiToken
            };
            var dateStats = getDateStatsForUser(user);

            // Overrides go from right to left, so put our props on the right and the passed props on the left
            var props = _.extend({}, properties, dateStats, mixpanelProps);

            var payload = {
                event: event,
                properties: props
            };
            return payload;
        });

        function doHttpRequest(base64EncodedData) {

            var promise = new Parse.Promise();
            Parse.Cloud.httpRequest({
                method: 'POST', // batch is POST
                url: MIXPANEL_TRACK_URL,
                params: {
                    data: base64EncodedData
                },
                success: function (httpResponse) {
                    //console.log("track => " + httpResponse.text);
                    if (httpResponse.text === "1") {
                        promise.resolve();
                    } else {
                        var error = "recordForUsers: Mixpanel track returned 0 (failure)";
                        console.error(error);
                        promise.resolve(error);
                    }
                },
                error: function (httpResponse) {
                    var error = "recordForUsers: Mixpanel track returned http code " + httpResponse.status;
                    console.error(error);
                    promise.resolve(error);
                }
            });
            return promise;
        }

        function captureHttpRequest(base64EncodedData) {
            return function() {
                return doHttpRequest(base64EncodedData);
            };
        }

        var maxRequests = 50; // taken from docs
        // promise already resolved to support chaining base case
        var chainedPromise = Parse.Promise.as();
        while (payloadList.length > 0) {
            var batch = payloadList.slice(0, maxRequests);
            payloadList = payloadList.slice(maxRequests);
            var base64EncodedData = objectToBase64Json(batch);
            var capturedHttpRequestFunc = captureHttpRequest(base64EncodedData);
            chainedPromise = chainedPromise.then(capturedHttpRequestFunc);
        }
        return chainedPromise.then(function(error) {
            if (!!error) {
                return error;
            } else if (usersWithMixpanelId.length !== users.length) {
                return "recordForUsers: some users did not have mixpanel ids yet";
            } else {
                return undefined;
            }
        });
    }

    exports.recordForUser = function(user, event, properties) {
        return this.recordForUsers([user], event, properties).then(function(error) {
            if (!!error) {
                error = "recordForUser: propagated error => " + error;
                console.error(error);
                return Parse.Promise.as(error);
            }
        });
    };

    exports.setPeopleProperties = function(user, properties) {
//        console.log('set people properties: ' + JSON.stringify(properties));

        var mixpanelId = user.get("mixpanel_id");
        if (!!mixpanelId && mixpanelId.length > 0) {
            var payload = {
                '$token': env.mixpanelApiToken,
                '$distinct_id': mixpanelId,
                "$set": properties
            };
            var base64EncodedData = objectToBase64Json(payload);
            var promise = new Parse.Promise();
            Parse.Cloud.httpRequest({
                url: MIXPANEL_ENGAGE_URL,
                params: {
                    data: base64EncodedData
                },
                success: function(httpResponse) {
                    //console.log('mixpanel ppl: ' + httpResponse.text);
                    if (httpResponse.text === "1") {
                        promise.resolve();
                    } else {
                        promise.resolve("Mixpanel people returned 0 (failure)");
                    }
                },
                error: function(httpResponse) {
                    var error = "setPeopleProperty: Mixpanel people returned http code " + httpResponse.status;
                    console.error(error);
                    promise.resolve(error);
                }
            });
            return promise;
        } else {
            var error = "setPeopleProperty missing user.mixpanel_id";
            console.error(error);
            return Parse.Promise.as(error);
        }
    };

    // NOTE(mike): date stats to send with every event, for now don't bother setting
    // cohort week on mixpanel people because the iOS app will do this
    function getDateStatsForUser(user) {
        var signupDate = moment(user.createdAt);
        var now = moment();
        var cohortWeek = dates.cohortWeek(signupDate);
        var accountAgeDays = now.diff(signupDate, 'days');
        var accountAgeWeeks = now.diff(signupDate, 'weeks');
        var accountAgeMonths = now.diff(signupDate, 'months');
        var startOfDay = moment(now).startOf('day');
        var timeOfDayHours = now.diff(startOfDay, 'hours');

        // names must match iOS Analytics.m
        return {
            "Account age days": accountAgeDays,
            "Account age weeks": accountAgeWeeks,
            "Account age months": accountAgeMonths,
            "Week cohort": cohortWeek,
            "Time of day hours": timeOfDayHours
        };
    }

    // extra helper/common stuff
    exports.recordPushForUsers = function(users, pushType) {
        return exports.recordForUsers(users, "Push notification sent", {"Push type": pushType});
    };
})();
