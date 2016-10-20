var exports;

(function() {
    'use strict';

    exports.alwaysSuccessful = function(promise) {
        var p = new Parse.Promise();
        promise.then(function() {
            p.resolve.apply(p, arguments);
        }, function() {
            p.resolve.apply(p, arguments);
        });
        return p;
    };
})();
