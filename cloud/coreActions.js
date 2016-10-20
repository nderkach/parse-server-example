/**
 * Analytics relating to user "core actions".
 */

var exports;

(function () {
    'use strict';

    var _ = require('underscore');
    var moment = require('./cloud/moment.min.js');
    var dates = require('./cloud/dates.js');
    var mixpanelImports = require('./cloud/mixpanelImports.js');
    var acls = require('./cloud/acls.js');
    var queries = require('./cloud/queries.js');

    var User = Parse.Object.extend('User');
    var Activity = Parse.Object.extend('Activity');
    var MixpanelImports = Parse.Object.extend('MixpanelImports');

    var MIXPANEL_CORE_ACTIONS = [
        'Activity feed scrolled',
        'Notifications list scrolled',
        'Wine log scrolled',
        'Wine wishlisted',
        'Wine log searched',
        'Wine log sorted',
        'Find friends begin',
        'Friend profile viewed',
        'Profile viewed',
        'Share wine begin',
        'Buy wine begin'
    ];

    var MIXPANEL_EVENTS = MIXPANEL_CORE_ACTIONS.concat([
        'Session'
    ]);

    var ACTIVITY_CORE_ACTIONS = [
        'followgroup', // actually just a generic follow
        'comment',
        'winePostLike',
        'commentLike'
    ];

    var CORE_ACTION_TYPES = MIXPANEL_CORE_ACTIONS.concat(ACTIVITY_CORE_ACTIONS);

    // NOTE(mike): could implement this more automatically, not sure if I should bother
    var CORE_ACTION_PRETTY_NAMES = {
        'Activity feed scrolled': 'ActivityFeedScrolled',
        'Notifications list scrolled': 'NotificationsScrolled',
        'Wine log scrolled': 'WineLogScrolled',
        'Wine wishlisted': 'WineWishlisted',
        'Wine log searched': 'WineLogSearched',
        'Wine log sorted': 'WineLogSorted',
        'Find friends begin': 'FindFriendsBegin',
        'Friend profile viewed': 'FriendProfileViewed',
        'Profile viewed': 'ProfileViewed',
        'Share wine begin': 'ShareWineBegin',
        'Buy wine begin': 'BuyWineBegin',
        'Session': 'Session',
        'followgroup': 'Follow',
        'comment': 'Comment',
        'winePostLike': 'WinePostLike',
        'commentLike': 'CommentLike'
    };

    var CORE_ACTION_MIXPANEL_START_DATE = moment([2014, 6 - 1, 1]);


    function importMixpanelCoreActions() {
        function usersCallback(users, rawEvents) {
            // need to set statsNeedUpdate
            users.forEach(function(user) {
                if (user.get('statsNeedUpdate') !== true) {
                    user.set('statsNeedUpdate', true);
                }
            });
            var dirtyUsers = users.filter(function(u) { return u.dirty(); });
            return Parse.Object.saveAll(dirtyUsers, {useMasterKey: true});
        }
        return mixpanelImports.importEventsFromMixpanel(MIXPANEL_EVENTS, CORE_ACTION_MIXPANEL_START_DATE, usersCallback);
    }

    Parse.Cloud.job("importMixpanelCoreActions", function(request, status) {
        importMixpanelCoreActions().then(function(numRowsImported) {
            status.success("Done (" + numRowsImported + " rows imported)");
        }, function(error) {
            status.error("Error :( " + JSON.stringify(error));
        });
    });

    function activitiesQueryForUser(user, lastEventDate) {
        var query = new Parse.Query(Activity);
        query.containedIn('activityType', CORE_ACTION_TYPES);
        query.notEqualTo('deleted', true);
        query.select('activityType');
        query.equalTo('fromUser', user);
        if (!!lastEventDate) {
            query.greaterThan('createdAt', lastEventDate.toDate());
        }

        return query;
    }

    function mixpanelEventsQueryForUser(user, lastEventDate) {
        var query = new Parse.Query(MixpanelImports);
        query.containedIn('event', MIXPANEL_EVENTS);
        query.select('event', 'timestamp');
        query.equalTo('user', user);
        if (!!lastEventDate) {
            query.greaterThan('timestamp', lastEventDate.toDate());
        }
        return query;
    }

    exports.fetchCoreActionsAndSessionsForUser = function(user, lastActionDates, processFn) {

        // lastActionDates maps from actionType to last-processed-date, we use these dates to determine
        // the date range to fetch from for both mixpanel table and activity table. This is done by iterating
        // over all the mixpanel core actions and finding the max date, and iterating over all the activity
        // core actions finding the max date. These two dates are then used in the queries.

        function findMaxDateForActionTypes(lastActionDates, actionTypes) {
            var maxDate = null;
            actionTypes.forEach(function(actionType) {
                var date = lastActionDates[actionType];
                maxDate = dates.latest(date, maxDate);
            });
            return maxDate;
        }

        var lastActivityDate = findMaxDateForActionTypes(lastActionDates, ACTIVITY_CORE_ACTIONS);
        var lastMixpanelEventDate = findMaxDateForActionTypes(lastActionDates, MIXPANEL_EVENTS);

        var activitiesQuery = activitiesQueryForUser(user, lastActivityDate);
        var mixpanelEventsQuery = mixpanelEventsQueryForUser(user, lastMixpanelEventDate);

        var p1 = activitiesQuery.each(function(activity) {
            return processFn({
                actionType: activity.get('activityType'),
                user: activity.get('fromUser'),
                timestamp: moment(activity.createdAt)
            });
        }, {useMasterKey: true});

        var p2 = mixpanelEventsQuery.each(function(event) {
            return processFn({
                actionType: event.get('event'),
                user: event.get('user'),
                timestamp: moment(event.get('timestamp').getTime()),
                properties: event.get('properties')
            });
        }, {useMasterKey: true});

        return Parse.Promise.when(p1, p2);
    };

    exports.coreActionTypes = function() {
        return CORE_ACTION_TYPES;
    };

    exports.coreActionTypesWithSession = function() {
        return CORE_ACTION_TYPES.concat(['Session']);
    };

    // NOTE(mike): consider prettifying the action types before they leave this module so
    // they can be used directly instead of needing to export this transform.
    exports.prettyNameForActionType = function(actionType) {
        if (CORE_ACTION_PRETTY_NAMES.hasOwnProperty(actionType)) {
            return CORE_ACTION_PRETTY_NAMES[actionType];
        } else {
            return actionType;
        }
    };

    exports.prepareCoreActionsForStatsJob = function() {
        return importMixpanelCoreActions();
    };
})();
