/**
 * The client app API.
 *
 * Note that since the client was initially written to access Parse objects directly,
 * this API is incomplete.
 */

var exports;

(function() {
    'use strict';

    var _ = require('underscore');
    var auth = require('./cloud/auth.js');
    var requests = require('./cloud/requests.js');
    var analytics = require('./cloud/analytics.js');
    var notifications = require('./cloud/notifications.js');
    var ActivityType = require('./cloud/activities.js').ActivityType;
    var moment = require('./cloud/moment.min.js');

    var Post = Parse.Object.extend('Post');
    var Activity = Parse.Object.extend('Activity');

    function queryWineLogBase(currentUser) {
        var queryForCaller = queryPosts().equalTo("owner", currentUser);
        var queryForTaggedPosts = queryPosts().containsAll("tagedUser", [currentUser]);

        var query = Parse.Query.or(queryForCaller, queryForTaggedPosts);
        query.descending("createdAt");
        return query;
    }

    exports.queryWineLog = function(request, response) {
        var currentUser = Parse.User.current();
        var skip = request.params.skip || 0;
        var limit = request.params.limit || 10;

        var query = queryWineLogBase(currentUser);
        query.include("wine");
        query.include("owner");
        query.skip(skip).limit(limit);

        query.find().then(function(posts) {
            response.success(posts);
        }, function(err) {
            response.error(err);
        });
    };

    exports.queryWineLogV2 = function(request, response) {
        var currentUser = Parse.User.current();
        var skip = request.params.skip || 0;
        var limit = request.params.limit || 10;

        var postsQuery = queryWineLogBase(currentUser);
        postsQuery.skip(skip).limit(limit);

        var postsPromise = postsQuery.find();

        var winesPromise = postsPromise.then(function(posts) {
            return fetchWinesFromPosts(posts);
        });

        var usersPromise = postsPromise.then(function(posts) {
            return fetchNestedObjects('_User', posts, 'owner');
        });

        var wineSpecialsPromise = postsPromise.then(function(posts) {
            return fetchWineSpecialsFromPosts(posts, currentUser);
        });

        Parse.Promise.when(postsPromise, winesPromise, usersPromise, wineSpecialsPromise).then(function(posts, wines, users, wineSpecials) {
            response.success({
                'posts': posts,
                'wines': asMapById(wines),
                'users': asMapById(users),
                'wineSpecials': asMapById(wineSpecials)
            });
        }, function(err) {
            response.error(err);
        });
    };

    function createHomeFeedPostQuery(currentUser, followees, skip, limit) {
        var query = queryPosts();
        query.containedIn('owner', followees);
        query.notEqualTo('private', true);
        query.notEqualTo('deleted', true);
        query.exists('wine');
        query.notEqualTo('owner', currentUser);
        query.descending('createdAt');
        if (skip !== undefined) {
            query.skip(skip);
        }
        if (limit !== undefined) {
            query.limit(limit);
        }
        return query;
    }

    function homeFeedActivityQuery(postQuery, withIncludes) {
        return postQuery.find().then(function(posts) {
            var query = new Parse.Query('Activity');
            query.notEqualTo('deleted', true);
            if (withIncludes) {
                query.include('fromUser');
                query.include('post');
                query.include('post.wine');
                query.include('post.owner');
            }
            query.containedIn('post', posts);
            query.ascending('createdAt');
            return query.find();
        });
    }

    // deprecated in favour of V2, but still needed for older clients
    exports.queryFollowingTimeline = function(request, response) {
        var currentUser = Parse.User.current();
        var skip = request.params.skip || 0;
        var limit = request.params.limit || 10;

        var followees = followeesForUser(currentUser);

        var postQuery = createHomeFeedPostQuery(currentUser, followees, skip, limit);
        var activitiesPromise = homeFeedActivityQuery(postQuery, true);

        activitiesPromise.then(function(activities) {
            response.success(activities);
        }, function(err) {
            response.error(err);
        });
    };

    exports.queryFollowingTimelineV2 = function(request, response) {
        var currentUser = Parse.User.current();
        var skip = request.params.skip || 0;
        var limit = request.params.limit || 10;

        var followees = followeesForUser(currentUser);

        var postQuery = createHomeFeedPostQuery(currentUser, followees, skip, limit);
        var activitiesPromise = homeFeedActivityQuery(postQuery, true);

        var countPostsPromise = skip === 0 ? createHomeFeedPostQuery(currentUser, followees).count() : Parse.Promise.as(undefined);

        Parse.Promise.when(activitiesPromise, countPostsPromise).then(function(activities, totalCount) {
            var responseObj = {'activities': activities};
            if (totalCount !== undefined) {
                responseObj.totalCount = totalCount;
            }
            response.success(responseObj);
        }, function(err) {
            response.error(err);
        });
    };

    exports.queryFollowingTimelineV3 = function(request, response) {
        var currentUser = Parse.User.current();
        var skip = request.params.skip || 0;
        var limit = request.params.limit || 10;

        var followees = followeesForUser(currentUser);

        var postQuery = createHomeFeedPostQuery(currentUser, followees, skip, limit);
        var activitiesPromise = homeFeedActivityQuery(postQuery, false);

        var postsPromise = activitiesPromise.then(function(activities) {
            return fetchPostsFromActivities(activities);
        });

        var winesPromise = postsPromise.then(function(posts) {
            return fetchWinesFromPosts(posts);
        });

        var usersPromise = Parse.Promise.when(activitiesPromise, postsPromise).then(function(activities, posts) {
            return fetchNestedObjects('_User', activities, 'fromUser', posts, 'owner');
        });

        Parse.Promise.when(activitiesPromise, postsPromise, winesPromise, usersPromise).then(function(activities, posts, wines, users) {
            var responseObj = {
                'activities': activities,
                'posts': asMapById(posts),
                'wines': asMapById(wines),
                'users': asMapById(users)
            };
            response.success(responseObj);
        }, function(err) {
            response.error(err);
        });
    };

    var GENERIC_POST_ACTIVITY_TYPES = [
        ActivityType.TAG_USER,
        ActivityType.ADD_WINE_HISTORY,
        ActivityType.FACEBOOK_FRIEND_SIGNIN,
        ActivityType.WINE_POST_LIKE,
        ActivityType.COMMENT_LIKE,
        ActivityType.REPLIED_TO_LIKE,
        ActivityType.REPLIED_TO_COMMENT,
        ActivityType.WINE_SPECIAL
    ];

    function createQueryCommentsToMyPost(currentUser) {
        var query = new Parse.Query(Activity);
        query.equalTo('activityType', ActivityType.COMMENT);
        query.notEqualTo('fromUser', currentUser);
        query.equalTo('toUser', currentUser);
        query.notEqualTo('deleted', true);
        return query;
    }

    function createQueryCommentsFromFollowees(currentUser, followees) {
        var query = new Parse.Query(Activity);
        query.equalTo('activityType', ActivityType.COMMENT);
        query.containedIn('fromUser', followees);
        query.notEqualTo('toUser', currentUser);
        query.notEqualTo('deleted', true);
        return query;
    }

    function createQueryFolloweesFollowingPeople(currentUser, followees) {
        var query = new Parse.Query(Activity);
        query.equalTo('activityType', ActivityType.FOLLOW_GROUP);
        query.containedIn('fromUser', followees);
        query.notEqualTo('following_group', currentUser); // don't include us, the FollowMe query will get those
        query.notEqualTo('deleted', true);
        return query;
    }

    function createQueryFollowMe(currentUser) {
        var query = new Parse.Query(Activity);
        query.equalTo('activityType', ActivityType.FOLLOW_GROUP);
        query.equalTo('following_group', currentUser);
        query.notEqualTo('deleted', true);
        return query;
    }

    function createQueryActivityTypesToMe(currentUser, types) {
        var query = new Parse.Query(Activity);
        query.containedIn('activityType', types);
        query.equalTo('toUser', currentUser);
        query.notEqualTo('deleted', true);
        return query;
    }

    function newsBaseQuery(currentUser, activityTypesList) {
        var followees = followeesForUser(currentUser);

        var activityTypesSet = {};
        _.each(activityTypesList, function(activityType) {
            activityTypesSet[activityType] = true;
        });

        var queries = [];
        if (activityTypesSet.hasOwnProperty(ActivityType.COMMENT)) {
            queries.push(createQueryCommentsToMyPost(currentUser));
            queries.push(createQueryCommentsFromFollowees(currentUser, followees));
        }
        if (activityTypesSet.hasOwnProperty(ActivityType.FOLLOW_GROUP)) {
            queries.push(createQueryFolloweesFollowingPeople(currentUser, followees));
            queries.push(createQueryFollowMe(currentUser));
        }

        var genericActivityTypesWithPost = [];
        GENERIC_POST_ACTIVITY_TYPES.forEach((function(activityType) {
            if (activityTypesSet.hasOwnProperty(activityType)) {
                genericActivityTypesWithPost.push(activityType);
            }
        }));
        if (genericActivityTypesWithPost.length > 0) {
            queries.push(createQueryActivityTypesToMe(currentUser, genericActivityTypesWithPost));
        }

        var query = Parse.Query.or.apply(Parse.Query, queries);
        query.descending('createdAt');
        return query;
    }

    exports.queryNews = function(request, response) {
        var currentUser = Parse.User.current();
        var activityTypesList = requests.requireStringArrayParam(request, 'activityTypes');
        var skip = request.params.skip || 0;
        var limit = request.params.limit || 10;

        var query = newsBaseQuery(currentUser, activityTypesList);
        query.include('fromUser');
        query.include('following_group');
        query.include('aboutActivity');
        query.include('post');
        query.include('post.owner');
        query.include('post.wine');

        var countPromise = skip === 0 ? query.count() : Parse.Promise.as(undefined);

        Parse.Promise.when(query.skip(skip).limit(limit).find(), countPromise).then(function(activities, totalCount) {
            var responseObj = {'activities': activities};
            if (totalCount !== undefined) {
                responseObj.totalCount = totalCount;
            }
            response.success(responseObj);
        }, function(err) {
            response.error('Failed: ' + JSON.stringify(err));
        });
    };

    exports.queryNewsV2 = function(request, response) {
        var currentUser = Parse.User.current();
        var activityTypesList = requests.requireStringArrayParam(request, 'activityTypes');
        var skip = request.params.skip || 0;
        var limit = request.params.limit || 20;

        var query = newsBaseQuery(currentUser, activityTypesList);

        var activitiesPromise = query.skip(skip).limit(limit).find();

        var postsPromise = activitiesPromise.then(function(activities) {
            return fetchPostsFromActivities(activities);
        });

        var winesPromise = postsPromise.then(function(posts) {
            return fetchWinesFromPosts(posts);
        });

        var usersPromise = Parse.Promise.when(activitiesPromise, postsPromise).then(function(activities, posts) {
            return fetchNestedObjects('_User', activities, ['fromUser', 'following_group'], posts, 'owner');
        });

        var aboutActivitiesPromise = activitiesPromise.then(function(activities) {
            return fetchNestedObjects(Activity, activities, 'aboutActivity');
        });

        var wineSpecialsPromise = postsPromise.then(function(posts) {
            return fetchWineSpecialsFromPosts(posts, currentUser);
        });

        Parse.Promise.when(activitiesPromise, postsPromise, winesPromise, usersPromise, aboutActivitiesPromise, wineSpecialsPromise)
            .then(function(activities, posts, wines, users, aboutActivities, wineSpecials) {
                var responseObj = {
                    'activities': activities,
                    'posts': asMapById(posts),
                    'wines': asMapById(wines),
                    'users': asMapById(users),
                    'aboutActivities': asMapById(aboutActivities),
                    'wineSpecials': asMapById(wineSpecials)
                };
                response.success(responseObj);
            }, function(err) {
                response.error('Failed: ' + JSON.stringify(err));
            });
    };

    exports.queryWinesForUserProfile = function(request, response) {
        var currentUser = Parse.User.current();
        var userId = request.params.userId;
        var targetUser = new Parse.User();
        targetUser.id = userId;

        var queryingCurrentUser = (currentUser.id === userId);

        var queryForCaller = queryPosts().equalTo("owner", targetUser).notEqualTo("private", true);
        if (!queryingCurrentUser) {
            queryForCaller.exists('wine');
        }
        var queryForTaggedPosts = queryPosts().containsAll("tagedUser", [targetUser]).notEqualTo("private", true);

        var postsQuery = Parse.Query.or(queryForCaller, queryForTaggedPosts);
        postsQuery.descending("createdAt");
        // TODO(mike): infinite scroll on UI and therefore use skip/limit? should be fast enough to call lots now though
        // UPD: default limit is 100
        postsQuery.limit(1000);

        var postsPromise = postsQuery.find();

        var winesPromise = postsPromise.then(function(posts) {
            return fetchWinesFromPosts(posts);
        });

        var usersPromise = postsPromise.then(function(posts) {
            return fetchNestedObjects('_User', posts, 'owner');
        });

        var wineSpecialsPromise = !queryingCurrentUser ? Parse.Promise.as(undefined) : postsPromise.then(function(posts) {
            return fetchWineSpecialsFromPosts(posts, currentUser);
        });

        Parse.Promise.when(postsPromise, winesPromise, usersPromise, wineSpecialsPromise).then(function(posts, wines, users, wineSpecials) {
            var responseObj = {
                'posts': posts,
                'wines': asMapById(wines),
                'users': asMapById(users)
            };
            if (wineSpecials) {
                responseObj.wineSpecials = asMapById(wineSpecials);
            }
            response.success(responseObj);
        }, function(err) {
            response.error(err);
        });

    };

    var wineSpecialInteractionsToFieldName = {
        'actionDealClicked': 'userDealClicked',
        'actionBuyWineBegin': 'userBuyWineBegin',
        'actionBuyWineComplete': 'userBuyWineComplete'
    };
    exports.recordWineSpecialInteraction = function(request, response) {
        var currentUser = requests.requireUser(request);
        var wineSpecialId = requests.requireStringParam(request, 'wineSpecialId');
        var action = requests.requireStringParam(request, 'action');

        var field = wineSpecialInteractionsToFieldName[action];

        if (!field) {
            response.error('Invalid action "' + action + '"');
            return;
        }

        var wineSpecialPromise = new Parse.Query('WineSpecial')
            .equalTo('objectId', wineSpecialId)
            .equalTo('user', currentUser)
            .find({useMasterKey: true});

        wineSpecialPromise.then(function(wineSpecials) {
            var wineSpecial = wineSpecials && wineSpecials.length === 1 && wineSpecials[0] || undefined;

            // bad wineSpecialId/user combo
            if (!wineSpecial) {
                throw "not found";
            }
            var appOpened = wineSpecial.has('userOpenedApp');
            var alreadyRecordedInteraction = wineSpecial.has(field);
            // no-op if field exists and appOpened has been recorded
            if (alreadyRecordedInteraction && appOpened) {
                return wineSpecial;
            }
            // perform update
            var date = new Date();
            if (!alreadyRecordedInteraction) {
                wineSpecial.set(field, date);
            }
            if (!appOpened) {
                wineSpecial.set('userOpenedApp', date);
            }
            return wineSpecial.save(null, {useMasterKey: true});
        }).then(function() {
            response.success();
        }, function() {
            response.error();
        });
    };

    exports.recordAppForegrounded = function(request, response) {
        var currentUser = requests.requireUser(request);

        var query = new Parse.Query('WineSpecial')
            .equalTo('user', currentUser)
            .greaterThan('sentDate', moment().subtract(48, 'hours').toDate())
            .doesNotExist('userOpenedApp');

        var date = new Date();
        var wineSpecials = [];
        var wineSpecialsUpdatedPromise = query.each(function(wineSpecial) {
            wineSpecial.set('userOpenedApp', date);
            wineSpecials.push(wineSpecial);
        }, {useMasterKey: true}).then(function() {
            return Parse.Object.saveAll(wineSpecials, {useMasterKey: true});
        });

        wineSpecialsUpdatedPromise.then(function() {
            response.success();
        }, function() {
            response.error();
        });
    };

    function asMapById(parseObjects) {
        var map = {};
        parseObjects.forEach(function(obj) {
            map[obj.id] = obj;
        });
        return map;
    }

    exports.likePost = function(request, response) {
        var currentUser = requests.requireUser(request);
        var postId = requests.requireStringParam(request, 'postId');
        var like = requests.requireBoolParam(request, 'like');

        new Parse.Query(Post).get(postId).then(function(post) {
            if (like) {
                post.addUnique('likedBy', currentUser);
            } else {
                post.remove('likedBy', currentUser);
            }
            return post.save(null, {useMasterKey: true});
        }).then(function(post) {
            // send push and then complete the request
            var pushPromise = like ? notifications.createWinePostLikeActivityAndNotification(post, currentUser) : Parse.Promise.as();
            // promise.always instead of .then, we don't care if the activity stuff fails here
            // as we would prefer to return success to the user having already done their 'like'
            return pushPromise.always(function() {
                var likedBy = post.get('likedBy');
                var likeCount = likedBy && likedBy.length || 0;
                response.success({
                    'liked': userInArray(currentUser, likedBy),
                    'likeCount': likeCount,
                    'updatedAt': post.updatedAt
                });
            });
        }, function(err) {
            response.error('Failed: ' + JSON.stringify(err));
        });
    };

    exports.likeActivity = function(request, response) {
        var currentUser = requests.requireUser(request);
        var activityId = requests.requireStringParam(request, 'activityId');
        var like = requests.requireBoolParam(request, 'like');

        new Parse.Query(Activity).get(activityId).then(function(activity) {
            if (like) {
                activity.addUnique('likedBy', currentUser);
            } else {
                activity.remove('likedBy', currentUser);
            }
            return activity.save(null, {useMasterKey: true});
        }).then(function(activity) {
            var pushPromise = (activity.get('activityType') === 'comment' && like) ?
                notifications.createCommentLikeActivityAndNotification(activity, currentUser) : Parse.Promise.as();
            // promise.always instead of .then, we don't care if the activity stuff fails here
            // as we would prefer to return success to the user having already done their 'like'
            return pushPromise.always(function() {
                var likedBy = activity.get('likedBy');
                var likeCount = likedBy && likedBy.length || 0;
                response.success({
                    'liked': userInArray(currentUser, likedBy),
                    'likeCount': likeCount,
                    'updatedAt': activity.updatedAt
                });
            });
        }, function(err) {
            response.error('Failed: ' + JSON.stringify(err));
        });
    };

    exports.postComment = function(request, response) {
        var currentUser = requests.requireUser(request);
        var postId = requests.requireStringParam(request, 'postId');
        var commentText = requests.requireStringParam(request, 'commentText');

        notifications.createCommentPostedActivityAndNotifications(currentUser, postId, commentText).then(function(activity) {
            response.success(activity);
        }, function(err) {
            response.error('Failed: ' + JSON.stringify(err));
        });
    };

    exports.winePostedFollowersPush = function(request, response) {
        var currentUser = requests.requireUser(request);
        var postId = requests.requireStringParam(request, 'postId');

        return notifications.sendWinePostedNotificationToFollowers(currentUser, postId).then(function() {
            response.success();
        }, function(err) {
            response.error('Failed: ' + JSON.stringify(err));
        });
    };

    exports.sendPush = function(request, response) {
        var message = requests.requireStringParam(request, 'message');
        var pushType = requests.requireStringParam(request, 'pushType');
        var userIds = requests.requireStringArrayParam(request, 'userIds');

        notifications.sendPushToUserIds(userIds, message, pushType).then(function() {
            response.success();
        }, function(err) {
            response.error('Failed: ' + JSON.stringify(err));
        });
    };

    exports.getNotificationSettings = function(request, response) {
        var currentUser = requests.requireUser(request);

        notifications.getNotificationSettingsForUser(currentUser).then(function(notificationSettings) {
            response.success(notificationSettings);
        }, function(err) {
            response.error('Failed: ' + JSON.stringify(err));
        });
    };

    function queryPosts() {
        return new Parse.Query("Post").notEqualTo("deleted", true);
    }

    function userInArray(user, array) {
        return array && array.some(function(u) { return u.id === user.id; });
    }

    function followeesForUser(user) {
        return user.get('following') || [];
    }

    // NOTE(mike): var-args, like (parseClass, List<Object>, fieldName, List<Object>, fieldName...)
    // e.g. ("_User", activities, "fromUser", posts, "owner")
    // field name can also be an array of fields
    // e.g. e.g. ("_User", activities, ["fromUser", "toUser"], posts, "owner")
    function fetchNestedObjects(parseClass) {
        if ((arguments.length % 2) !== 1) {
            throw "invalid number of arguments";
        }

        function processOne(objectsArray, fields, map) {
            fields.forEach(function(field) {
                objectsArray.forEach(function(baseObj) {
                    var nestedObj = baseObj.get(field);
                    if (nestedObj) {
                        if (Array.isArray(nestedObj)) {
                            nestedObj.forEach(function(obj) {
                                map[obj.id] = true;
                            });
                        } else {
                            map[nestedObj.id] = true;
                        }
                    }
                });
            });
        }

        var map = {};

        var i = 1;
        while (i < arguments.length) {
            var objectsArray = arguments[i];
            var fieldArg = arguments[i + 1];
            var fields = typeof fieldArg === 'string' ? [fieldArg] : fieldArg;

            processOne(objectsArray, fields, map);

            i += 2;
        }

        var nestedObjIds = _.keys(map);
        if (nestedObjIds.length === 0) {
            return Parse.Promise.as([]);
        } else {
            return new Parse.Query(parseClass).containedIn('objectId', nestedObjIds).limit(1000).find({useMasterKey: true});
        }
    }

    // custom subset of the data needed by the client
    function fetchWineSpecialsFromPosts(posts, currentUser) {
        // NOTE(mike): only fetch wine specials for posts owned by the current user
        posts = posts.filter(function(post) { return post.get('owner').id === currentUser.id; });
        return fetchNestedObjects('WineSpecial', posts, 'wineSpecial').then(function(wineSpecials) {
            return wineSpecials.map(function(wineSpecial) {
                var now = new Date();
                var expiryDate = wineSpecial.get('expiryDate') || now;

                var deleted = !!wineSpecial.get('deleted') || now >= expiryDate;
                var obj = {
                    'id': wineSpecial.id,
                    'deleted': deleted
                };
                if (!deleted) {
                    obj = _.extend(obj, {
                        'rrp': wineSpecial.get('rrp'),
                        'offerPrice': wineSpecial.get('offerPrice'),
                        'showDiscountPercentage': wineSpecial.get('showDiscountPercentage'),
                        'vintage': wineSpecial.get('vintage'),
                        'dealClicked': !!wineSpecial.get('userDealClicked'),
                        'buyWineBegin': !!wineSpecial.get('userBuyWineBegin'),
                        'buyWineComplete': !!wineSpecial.get('userBuyWineComplete')
                    });
                }
                return obj;
            });
        });
    }

    function fetchWinesFromPosts(posts) {
        return fetchNestedObjects('Wine', posts, 'wine');
    }

    function fetchPostsFromActivities(activities) {
        return fetchNestedObjects(Post, activities, 'post');
    }
})();
