/**
 * Login and auth related functions
 */

var exports;

(function() {
    /**
     * Returns a promise which resolves if the current user is admin.
     */
    function requireAdmin(currentUser) {
        if (!currentUser) {
            return Parse.Promise.error("No user");
        }

        var promise = new Parse.Promise();
        var roleQuery = new Parse.Query(Parse.Role);
        roleQuery.equalTo("name", "Admin");
        roleQuery.equalTo("users", currentUser);
        roleQuery.find({
            success: function (results) {
                if (results.length > 0) {
                    console.log("User " + currentUser + " is admin");
                    promise.resolve();
                } else {
                    promise.reject("Admin role required");
                }
            },
            error: function (error) {
                promise.reject(error);
            }
        });
        return promise;
    }


    exports.requireAdmin = requireAdmin;
})();

