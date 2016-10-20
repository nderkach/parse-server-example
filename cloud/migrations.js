(function() {
    'use strict';

    var _ = require('underscore');
    var notifications = require('./notifications.js');

    Parse.Cloud.job("migrateNotificationSettings", function(request, status) {
        var query = new Parse.Query(Parse.User);
        query.doesNotExist('notificationSettings');

        var notificationsMap = {
            'wine_identification': 'wine_identification',
            'tagged_on_a_wine': 'tagged_on_a_wine',
            'new_follower': 'new_follower',
            'friend_joined_vinus': 'friend_joined_vinus',
            'comment_on_your_wine': 'comment'
        };

        var oldNotifications = _.keys(notificationsMap);

        // map with old notification names set to false
        function generateAbsenceMap() {
            var map = {};
            oldNotifications.forEach(function(notificationType) {
                map[notificationType] = false;
            });
            return map;
        }

        var numUpdated = 0;
        query.each(function(user) {
            // find which settings are omitted
            var presenceMap = generateAbsenceMap();
            var optOutNotifications = [];

            // old settings we are migrating from
            var oldSettings = user.get('notificationSetting');

            // if existing settings are undefined, they haven't been written yet
            if (oldSettings !== undefined) {
                oldSettings.forEach(function(notificationType) {
                    presenceMap[notificationType] = true;
                });

                // find all false notifications, and write them into the new opt-out settings
                oldNotifications.forEach((function(notificationType) {
                    if (!presenceMap[notificationType]) {
                        // translate into new names
                        optOutNotifications.push(notificationsMap[notificationType]);
                    }
                }));
            }

            // new settings pointing to other table
            return notifications.initNotificationSettings(user, optOutNotifications).then(function() {
                numUpdated += 1;
            });
        }, {useMasterKey: true}).then(function() {
            status.success("Done (" + numUpdated + " users updated)");
        }, function(error) {
            status.error("Error :( " + JSON.stringify(error));
        });
    });
})();
