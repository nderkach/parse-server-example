var exports;

(function() {
    'use strict';

    exports.createPrivateACLsForUser = function(user) {
        var acl = new Parse.ACL(user);
        acl.setRoleWriteAccess('Admin', true);
        return acl;
    };

    exports.createAdminReadOnlyACL = function() {
        var acl = new Parse.ACL();
        acl.setRoleReadAccess('Admin', true);
        return acl;
    };

})();
