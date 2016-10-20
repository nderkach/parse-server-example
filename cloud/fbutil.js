var exports;

(function() {
    'use strict';

    var FACEBOOK_ADMIN_APP_ID = '1441953732744917';
    var FACEBOOK_ADMIN_APP_SECRET = '10ee263e3b249f436ecbd21916e57397';

    exports.exchangeToken = function(shortLivedToken) {
        return Parse.Cloud.httpRequest({
            method: 'GET',
            url: 'https://graph.facebook.com/oauth/access_token',
            params: {
                'grant_type': 'fb_exchange_token',
                'client_id': FACEBOOK_ADMIN_APP_ID,
                'client_secret':FACEBOOK_ADMIN_APP_SECRET,
                'fb_exchange_token': shortLivedToken
            },
            error: function (httpResponse) {
                var msg = 'Facebook exchange token request failed with response code ' + httpResponse.status;
                console.error(msg);
                return msg;
            }
        }).then(function(httpResponse) {
            var parts = httpResponse.text.split('&');
            var data = {};
            parts.forEach(function (part) {
                var arr = part.split('=');
                var key = arr[0];
                var value = arr[1];
                data[key] = value;
            });
            var accessToken = data.access_token;
            var expirySeconds = data.expires;

            return {
                accessToken: accessToken,
                expirySeconds: expirySeconds
            };
        });
    };
})();
