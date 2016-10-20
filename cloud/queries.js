var exports;

(function() {
    'use strict';

    var User = Parse.Object.extend('User');
    var Post = Parse.Object.extend('Post');

    exports.activeUsers = function() {
        var query = new Parse.Query(User);
        query.notEqualTo('blocked', true);
        query.notEqualTo('deleted', true);
        return query;
    };

    exports.postsByUser = function(user) {
        var postQuery = new Parse.Query(Post);
        postQuery.equalTo("owner", user);
        postQuery.notEqualTo("deleted", true);
        return postQuery;
    };

})();
