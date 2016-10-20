var exports;

(function() {
    "use strict";

    var Activity = Parse.Object.extend('Activity');

    exports.ActivityType = {
        COMMENT: 'comment',
        FOLLOW_GROUP: 'followgroup',
        TAG_USER: 'taguser',
        ADD_WINE_HISTORY: 'addtowinehistory',
        FACEBOOK_FRIEND_SIGNIN: 'facebookfriendsignin',
        WINE_POST_LIKE: 'winePostLike',
        COMMENT_LIKE: 'commentLike',
        REPLIED_TO_LIKE: 'repliedToLike',
        REPLIED_TO_COMMENT: 'repliedToComment',
        WINE_SPECIAL: 'wineSpecial'
    };

    exports.createActivityWithACLsForUser = function(user) {
        var activity = new Activity();
        var acl = new Parse.ACL(user);
        acl.setRoleWriteAccess('Admin', true);
        acl.setPublicReadAccess(true);
        activity.setACL(acl);
        return activity;
    };
})();
