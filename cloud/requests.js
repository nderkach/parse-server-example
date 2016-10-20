/**
 * Request utils
 */

var exports;

(function() {
    "use strict";

    var _ = require('underscore');

    /** Returns a function which fails a response with any message passed to that function. */
    exports.fail = function(response) {
        return function(message) {
            response.error(message);
        };
    };

    exports.requireUser = function(request) {
        if (!request.user) {
            throw "current user must be non-null";
        }
        return request.user;
    };

    exports.requireStringParam = function(request, paramName) {
        var value = request.params[paramName];
        if (typeof value !== 'string' || value === "") {
            throw "expected non-empty string value for parameter '" + paramName + "'";
        }
        return value;
    };

    exports.requireStringArrayParam = function(request, paramName) {
        console.log(request);
        console.log(paramName);
        var value = request.params[paramName];
        if (!value.hasOwnProperty('length')) {
            throw "expected array value for parameter '" + paramName + "'";
        }
        _.forEach(value, function(x) {
            if (typeof x !== 'string' || x === "") {
                throw "expected non-empty string array for parameter '" + paramName + "'";
            }
        });
        return value;
    };

    exports.requireBoolParam = function(request, paramName) {
        var value = request.params[paramName];
        var isBoolean = typeof value === 'boolean';
        var isValidNumber = typeof value === 'number' && (value === 0 || value === 1);

        if (!isBoolean && !isValidNumber) {
            throw "expected boolean value for parameter '" + paramName + "'";
        }

        if (isValidNumber) {
            value = !!value;
        }
        return value;
    };
})();
