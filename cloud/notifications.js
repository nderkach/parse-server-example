/**
 * Creating activity objects and sending notifications.
 */

var exports;

(function() {
    'use strict';
    var _ = require('underscore');
    var analytics = require('./analytics.js');
    var promises = require('./promises.js');
    var moment = require('moment');
    var acls = require('./acls.js');
    var env = require('./env.js').env;
    var activityService = require('./activities.js');
    var ActivityType = activityService.ActivityType;

    var Post = Parse.Object.extend('Post');
    var Activity = Parse.Object.extend('Activity');
    var NotificationSettings = Parse.Object.extend('NotificationSettings');
    var USER_NOTIFICATION_SETTINGS_KEY = 'notificationSettings';
    var NOTIFICATIONS_OPT_OUT_KEY = 'optOut';
    var NOTIFICATIONS_LAST_WINE_POST_SENT_KEY = 'lastWinePostSentDate';

    var WINE_IDENTIFICATION_PUSH_TYPE = 'wine_identification';
    var TAGGED_ON_WINE_PUSH_TYPE = 'tagged_on_a_wine';
    var NEW_FOLLOWER_PUSH_TYPE = 'new_follower';
    var FRIEND_JOINED_VINUS_PUSH_TYPE = 'friend_joined_vinus';
    var COMMENT_ON_YOUR_WINE_PUSH_TYPE = 'comment_on_your_wine';
    var LIKE_WINE_PUSH_TYPE = 'Like wine';
    var LIKE_COMMENT_PUSH_TYPE = 'Like comment';
    var REPLIED_TO_LIKE_PUSH_TYPE = 'Replied to like';
    var REPLIED_TO_COMMENT_PUSH_TYPE = 'Replied to comment';
    var WINE_POSTED_BY_FOLLOWEE_PUSH_TYPE = 'Wine posted by followee';
    var WINE_SPECIAL_PUSH_TYPE = 'Wine special';

    var pushOptOutMap = (function() {
        var map = {};
        map[WINE_IDENTIFICATION_PUSH_TYPE] = WINE_IDENTIFICATION_PUSH_TYPE;
        map[TAGGED_ON_WINE_PUSH_TYPE] = TAGGED_ON_WINE_PUSH_TYPE;
        map[NEW_FOLLOWER_PUSH_TYPE] = NEW_FOLLOWER_PUSH_TYPE;
        map[FRIEND_JOINED_VINUS_PUSH_TYPE] = FRIEND_JOINED_VINUS_PUSH_TYPE;
        map[COMMENT_ON_YOUR_WINE_PUSH_TYPE] = 'comment';
        map[LIKE_WINE_PUSH_TYPE] = 'like';
        map[LIKE_COMMENT_PUSH_TYPE] = 'like';
        map[REPLIED_TO_LIKE_PUSH_TYPE] = 'comment';
        map[REPLIED_TO_COMMENT_PUSH_TYPE] = 'comment';
        map[WINE_POSTED_BY_FOLLOWEE_PUSH_TYPE] = 'wine_post';
        map[WINE_SPECIAL_PUSH_TYPE] = 'wineSpecial';
        return map;
    })();

    // 'type' field in push data helps the app decide what screen to show
    function iosPushFieldTypeForSubType(notificationType) {
        if (notificationType === WINE_POSTED_BY_FOLLOWEE_PUSH_TYPE) {
            return 'following';
        } else {
            return 'notification';
        }
    }

    function createNotificationSettingsForUser(user) {
        var notificationSettings = new NotificationSettings();
        notificationSettings.setACL(acls.createPrivateACLsForUser(user));
        notificationSettings.set(NOTIFICATIONS_OPT_OUT_KEY, []);
        return notificationSettings;
    }

    exports.userAfterSave = function(user) {
        if (!user.existed() && !user.has(USER_NOTIFICATION_SETTINGS_KEY)) {
            var notificationSettings = createNotificationSettingsForUser(user);
            user.set(USER_NOTIFICATION_SETTINGS_KEY, notificationSettings);
        }
    };

    exports.initNotificationSettings = function(user, optOut) {
        var notificationSettings = new NotificationSettings();
        notificationSettings.setACL(acls.createPrivateACLsForUser(user));
        notificationSettings.set(NOTIFICATIONS_OPT_OUT_KEY, optOut);
        user.set(USER_NOTIFICATION_SETTINGS_KEY, notificationSettings);
        return user.save(null, {useMasterKey: true});
    };

    exports.sendWineSpecialPushToUsers = function(users, message) {
        return sendPushToUsers(users, message, WINE_SPECIAL_PUSH_TYPE);
    };

    exports.sendPushToUserIds = function(userIds, message, pushType) {
        var query = new Parse.Query(Parse.User);
        query.containedIn('objectId', userIds);
        return query.find({useMasterKey: true}).then(function(users) {
            return sendPushToUsers(users, message, pushType);
        });
    };

    exports.createWinePostLikeActivityAndNotification = function(post, liker) {
        var postOwner = post.get('owner');
        // one does not simply notify oneself
        if (postOwner.id === liker.id) {
            return Parse.Promise.as();
        }

        var activityPromise = createPostLikedActivity(post, liker);
        var pushPromise = sendPostLikedPushNotification(post);

        return Parse.Promise.when(activityPromise, pushPromise);
    };

    exports.createCommentLikeActivityAndNotification = function(comment, liker) {
        var commentAuthor = comment.get('fromUser');
        // one does not simply notify oneself
        if (commentAuthor.id === liker.id) {
            return Parse.Promise.as();
        }

        var activityPromise = createCommentLikedActivity(comment, liker);
        var pushPromise = sendCommentLikedPushNotification(comment);

        return Parse.Promise.when(activityPromise, pushPromise);
    };

    exports.createCommentPostedActivityAndNotifications = function(user, postId, commentText) {
        var query = new Parse.Query(Post);
        query.equalTo('objectId', postId);
        query.include('owner');
        return query.find().then(function(posts) {
            var post = posts[0];
            return createCommentPostedActivity(user, post, commentText).then(function(comment) {
                return promises.alwaysSuccessful(sendCommentPostedPushNotifications(comment, post)).then(function() {
                    // weave comment back through
                    return comment;
                });
            });
        });
    };

    exports.sendWinePostedNotificationToFollowers = function(user, postId) {
        var message = 'Someone you follow posted a wine';

        var usersQuery = new Parse.Query('User');
        usersQuery.equalTo('following', user);
        // NOTE(mike): at most N people get notified to not create a huge work factor issue on the server
        usersQuery.limit(100);

        return queryUsersWithNotificationSettings(usersQuery).then(function(users) {
            var filteredUsers = users.filter(function(user) {
                var notificationSettings = user.get(USER_NOTIFICATION_SETTINGS_KEY);
                var lastSentDate = notificationSettings.get(NOTIFICATIONS_LAST_WINE_POST_SENT_KEY);
                if (lastSentDate) {
                    var lastSentMoment = moment(lastSentDate);
                    var now = moment();
                    var diff = now.diff(lastSentMoment, 'hours');
                    // allow to send again if it's been at least 1 hour
                    return diff >= 1;
                }
                // haven't received one yet, so good to go ahead
                return true;
            });

            var filteredUsersNotificationSettings = filteredUsers.map(function(u) { return u.get(USER_NOTIFICATION_SETTINGS_KEY); });
            filteredUsersNotificationSettings.forEach(function(notificationSettings) {
                notificationSettings.set(NOTIFICATIONS_LAST_WINE_POST_SENT_KEY, new Date());
            });

            var updateLastSentDatePromise = Parse.Object.saveAll(filteredUsersNotificationSettings, {useMasterKey: true});
            var pushPromise = sendPushToUsers(filteredUsers, message, WINE_POSTED_BY_FOLLOWEE_PUSH_TYPE);

            return Parse.Promise.when(updateLastSentDatePromise, pushPromise);
        });
    };

    exports.getNotificationSettingsForUser = function(user) {
        return getOrCreateNotificationSettingsForUser(user);
    };

    // helpers

    function createPostLikedActivity(post, liker) {
        var postOwner = post.get('owner');
        var activity = activityService.createActivityWithACLsForUser(postOwner);
        return activity.save({
            'fromUser': liker,
            'toUser': postOwner,
            'activityType': ActivityType.WINE_POST_LIKE,
            'post': post
        }, {useMasterKey: true});
    }

    function sendPostLikedPushNotification(post) {
        var postOwner = post.get('owner');
        var message = 'Someone loved your wine';
        return sendPushToUsers([postOwner], message, LIKE_WINE_PUSH_TYPE);
    }

    // create an activity for the person who made the comment (that somebody liked it)
    function createCommentLikedActivity(comment, liker) {
        var commentAuthor = comment.get('fromUser');
        var activity = activityService.createActivityWithACLsForUser(commentAuthor);
        return activity.save({
            'fromUser': liker,
            'toUser': commentAuthor,
            'activityType': ActivityType.COMMENT_LIKE,
            'post': comment.get('post'),
            'aboutActivity': comment
        }, {useMasterKey: true});
    }

    // send a push notification to the person who made the comment (that somebody liked it)
    function sendCommentLikedPushNotification(comment) {
        var commentAuthor = comment.get('fromUser');
        var message = 'Someone loved your comment';
        return sendPushToUsers([commentAuthor], message, LIKE_COMMENT_PUSH_TYPE);
    }

    // create an activity to represent a comment being posted
    function createCommentPostedActivity(user, post, commentText) {
        var activity = activityService.createActivityWithACLsForUser(user);
        var postOwner = post.get('owner');
        return activity.save({
            'post': post,
            'fromUser': user,
            'toUser': postOwner,
            'activityType': ActivityType.COMMENT,
            'comment': commentText
        }, {useMasterKey: true});
    }

    function sendCommentPostedPushNotifications(comment, post) {
        // find users who commented on the post
        var commentersDictPromise = findCommentersDictForPost(comment.get('post'));

        // users who liked the comment but didn't comment on it
        var filteredLikersPromise = commentersDictPromise.then(function(commentersDict) {
            return (post.get('likedBy') || [])
                .filter(function(user) { return !commentersDict.hasOwnProperty(user.id); });
        });

        var postOwnerNotifiedPromise = sendPushForCommentedOnYourWine(post, comment);
        var commentersNotifiedPromise = sendPushForRepliedToYourComment(commentersDictPromise, post, comment);
        var likersNotifiedPromise = sendPushForRepliedToPostYouLike(filteredLikersPromise, post, comment);

        return Parse.Promise.when(postOwnerNotifiedPromise, commentersNotifiedPromise, likersNotifiedPromise);
    }

    function sendPushForCommentedOnYourWine(post, comment) {
        var pushType = 'comment_on_your_wine';
        var postOwner = post.get('owner');
        var commentAuthor = comment.get('fromUser');
        // one does not simply notify oneself
        if (postOwner.id === commentAuthor.id) {
            return Parse.Promise.as();
        }
        var message = 'Someone commented on your wine';
        return sendPushToUsers([postOwner], message, pushType);
    }

    function sendPushForRepliedToYourComment(commentersDictPromise, post, comment) {
        var postOwner = post.get('owner');
        var commentAuthorId = comment.get('fromUser').id;
        return commentersDictPromise.then(function(commentersDict) {
            // last-minute filter out the comment author and post-owner, can't go wrong this way
            // the post-owner gets their own special push
            delete commentersDict[commentAuthorId];
            delete commentersDict[postOwner.id];
            var commenters = _.values(commentersDict);
            var subject = postOwner.id === commentAuthorId ? 'The poster' : 'Someone';
            var message = subject + ' replied to a wine you commented on';

            var activityPromise = createRepliedActivitiesForUsers(commenters, 'repliedToComment', post, comment);
            var pushPromise = sendPushToUsers(commenters, message, REPLIED_TO_COMMENT_PUSH_TYPE);
            return Parse.Promise.when(activityPromise, pushPromise);
        });
    }

    function sendPushForRepliedToPostYouLike(filteredLikersPromise, post, comment) {
        var postOwner = post.get('owner');
        var commentAuthorId = comment.get('fromUser').id;
        return filteredLikersPromise.then(function(likers) {
            // last-minute filter out the comment author and post-owner, can't go wrong this way
            // the post-owner gets their own special push
            likers = likers.filter(function(user) { return user.id !== commentAuthorId && user.id !== postOwner.id; });
            var subject = postOwner.id === commentAuthorId ? 'The poster' : 'Someone';
            var message = subject + ' replied to a wine you loved';

            var activityPromise = createRepliedActivitiesForUsers(likers, 'repliedToLike', post, comment);
            var pushPromise = sendPushToUsers(likers, message, REPLIED_TO_LIKE_PUSH_TYPE);
            return Parse.Promise.when(activityPromise, pushPromise);
        });
    }

    function createRepliedActivitiesForUsers(users, activityType, post, comment) {
        if (users.length === 0) {
            return Parse.Promise.as();
        }
        var commentAuthor = comment.get('fromUser');
        function createActivityForUser(user) {
            var activity = activityService.createActivityWithACLsForUser(user);
            activity.set('toUser', user);
            activity.set('fromUser', commentAuthor);
            activity.set('activityType', activityType);
            activity.set('post', post);
            activity.set('aboutActivity', comment);
            return activity;
        }

        var activities = users.map(createActivityForUser);
        return Parse.Object.saveAll(activities, {useMasterKey: true});
    }

    function findCommentersDictForPost(post) {
        var commentersQuery = new Parse.Query(Activity);
        commentersQuery.equalTo('post', post);
        commentersQuery.equalTo('activityType', ActivityType.COMMENT);

        var commentersDict = {};
        return commentersQuery.each(function(comment) {
            var user = comment.get('fromUser');
            commentersDict[user.id] = user;
        }).then(function() {
            return commentersDict;
        });
    }

    function sendPushToUsers(users, message, pushType) {
        if (users.length === 0) {
            //console.log('no users');
            return Parse.Promise.as();
        }
        var userIds = users.map(function(u) { return u.id; });
        //console.log('userIds: ' + userIds.join());

        // installations of target users which have a device token
        var installationsPromise = installationQuery()
            .containedIn('user', userIds)
            .exists('deviceToken')
            .find({useMasterKey: true})
            .then(function(installations) {
                //console.log('found ' + installations.length + ' installations');
                var presenceSet = {};
                installations.forEach(function(installation) {
                    presenceSet[installation.get('user')] = true;
                });
                return presenceSet;
            });

        // users who have enabled this notification
        var usersPromise = new Parse.Query(Parse.User)
            .include(USER_NOTIFICATION_SETTINGS_KEY)
            .containedIn('objectId', userIds)
            .find({useMasterKey: true})
            .then(function(users) {
                return users.filter(function(u) {
                    // accept those who have no settings or where the notification type is NOT found in the opt-out list
                    return !u.has(USER_NOTIFICATION_SETTINGS_KEY) ||
                        u.get(USER_NOTIFICATION_SETTINGS_KEY).get(NOTIFICATIONS_OPT_OUT_KEY).indexOf(pushOptOutMap[pushType]) < 0;
                });
            });

        // users who have both installations with device tokens AND have enabled the push notification setting
        var filteredInstallationsPromise = Parse.Promise.when(installationsPromise, usersPromise).then(
            function(installationsMap, users) {
                //console.log('users with device token: ' + _.keys(installationsMap).join());
                //console.log('users with enabled notification: ' + users.map(function(u) { return u.id; }).join());
                // we want the set intersection of these sets of users
                var usersIntersection = {};
                users.forEach(function(user) {
                    if (installationsMap.hasOwnProperty(user.id)) {
                        usersIntersection[user.id] = user;
                    }
                });
                //console.log('intersection: ' + _.values(usersIntersection).map(function(u) { return u.id; }).join());
                return usersIntersection;
            });

        var pushPromise = filteredInstallationsPromise.then(function(usersMap) {
            var userIds = _.keys(usersMap);
            //console.log('pushing to ' + JSON.stringify(userIds));
            if (userIds.length === 0) {
                return Parse.Promise.as();
            }
            var query = installationQuery();
            query.containedIn('user', userIds);
            return sendPush(query, message, pushType);
        });

        var analyticsPromise = filteredInstallationsPromise.then(function(usersMap) {
            var users = _.values(usersMap);
            return analytics.recordPushForUsers(users, pushType);
        });

        return Parse.Promise.when(pushPromise, analyticsPromise);
    }

    function sendPush(query, message, pushType) {
        return Parse.Push.send({
            where: query,
            data: {
                'alert': message,
                'badge': 'Increment',
                'type': iosPushFieldTypeForSubType(pushType),
                'sound': 'default',
                'subType': pushType
            }
        }).fail(function(error) {
            var msg = "failed to send push " + JSON.stringify(error);
            console.log(msg);
            return msg;
        });
    }

    function getOrCreateNotificationSettingsForUser(user) {
        function fetchNotificationSettingsForUser(user) {
            var settings = user.get(USER_NOTIFICATION_SETTINGS_KEY);
            return !!settings.createdAt ? Parse.Promise.as(settings) : new Parse.Query(NotificationSettings).get(settings.id);
        }

        if (!user.has(USER_NOTIFICATION_SETTINGS_KEY)) {
            var notificationSettings = createNotificationSettingsForUser(user);
            user.set(USER_NOTIFICATION_SETTINGS_KEY, notificationSettings);
            return user.save(null, {useMasterKey: true}).then(fetchNotificationSettingsForUser);
        } else {
            return fetchNotificationSettingsForUser(user);
        }
    }

    function installationQuery() {
        return new Parse.Query(Parse.Installation);
    }

    function queryUsersWithNotificationSettings(usersQuery) {
        usersQuery.include(USER_NOTIFICATION_SETTINGS_KEY);
        return usersQuery.find({useMasterKey: true}).then(function(users) {
            if (users.length === 0) {
                console.log('returning none');
                return users;
            }
            // try to populate any missing notification settings
            var promises = users.map(function(user) { return getOrCreateNotificationSettingsForUser(user); });
            return Parse.Promise.when(promises).then(function() {
                return users;
            });
        });
    }

    // NOTE(mike): unused but I figured leave it here in case we decide to change
    // push notification messages to use actual names instead of "someone"
    function displayNameForUser(user) {
        var firstname = user.get('firstname');
        var lastname = user.get('lastname');

        if (firstname && lastname) {
            return firstname + ' ' + lastname;
        }
        if (firstname) {
            return firstname;
        }
        if (lastname) {
            return lastname;
        }
        return undefined;
    }
})();
