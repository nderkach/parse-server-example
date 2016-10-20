var exports;

(function() {
    "use strict";

    var activityService = require('./cloud/activities.js');
    var ActivityType = activityService.ActivityType;
    var notifications = require('./cloud/notifications.js');

    var WineSpecial = Parse.Object.extend('WineSpecial');
    var Activity = Parse.Object.extend('Activity');

    Parse.Cloud.job("pushWineSpecials", function(request, status) {
        pushWineSpecials().then(function(numSent) {
            status.success("Done (sent=" + numSent + ")");
        }, function(error) {
            status.error("Error (sent=" + error.sent + ") error=" + JSON.stringify(error.errorObj));
        });
    });

    Parse.Cloud.afterSave("WineSpecial", function(request) {
        var wineSpecial = request.object;

        // dirty flag checking for the analytics fields is more exact, but it is also prone to code rot,
        // so it's simpler to be a bit eager on setting the needStatsUpdate flag
        if (wineSpecial.existed()) {
            var user = wineSpecial.get('user');
            user.set('statsNeedUpdate', true);
            user.save(null, {useMasterKey: true});
        }
    });

    function pushWineSpecials() {
        var numSent = 0;

        var query = queryUnsent();
        query.include('user');
        query.include('post');
        return query.each(function(wineSpecial) {
            var user = wineSpecial.get('user');
            if (!user) {
                console.log("skipping missing user");
                return wineSpecial.save({'user': undefined}, {useMasterKey: true});
            }

            var post = wineSpecial.get('post');
            if (!post) {
                console.log("skipping missing post");
                return wineSpecial.save({'post': undefined}, {useMasterKey: true});
            }

            // now create the activity, link the post, and fire off the push

            var activityPromise = createActivityForWineSpecial(wineSpecial);
            var linkPostPromise = linkWineSpecialToPost(wineSpecial);
            var pushPromise = Parse.Promise.when(activityPromise, linkPostPromise).then(function() {
                return sendPushForWineSpecial(wineSpecial);
            });
            var markAsSentPromise = pushPromise.then(function() {
                return wineSpecial.save({'sentDate': new Date()}, {useMasterKey: true});
            });

            return markAsSentPromise.then(function() {
                numSent += 1;
            });
        }, {useMasterKey: true}).then(
            function() {
                return numSent;
            },
            function(error) {
                return {'sent': numSent, errorObj: error};
            });
    }

    function queryUnsent() {
        var query = new Parse.Query(WineSpecial);
        query.doesNotExist('sentDate');
        query.lessThanOrEqualTo('scheduledSendDate', new Date());
        return query;
    }

    function createActivityForWineSpecial(wineSpecial) {
        var user = wineSpecial.get('user');
        var post = wineSpecial.get('post');

        var activity = activityService.createActivityWithACLsForUser(user);

        return activity.save({
            'toUser': user,
            'activityType': ActivityType.WINE_SPECIAL,
            'post': post,
            'metadata': {
                'wineSpecialId': wineSpecial.id,
                'newsMessage': wineSpecial.get('newsMessage')
            }
        }, {useMasterKey: true});
    }

    function linkWineSpecialToPost(wineSpecial) {
        var post = wineSpecial.get('post');
        return post.save({'wineSpecial': wineSpecial}, {useMasterKey: true});
    }

    function sendPushForWineSpecial(wineSpecial) {
        return notifications.sendWineSpecialPushToUsers([wineSpecial.get('user')],
            wineSpecial.get('pushMessage'));
    }
})();
