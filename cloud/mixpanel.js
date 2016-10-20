var exports;

(function () {
    'use strict';

    var md5 = require('./md5.js');
    var dates = require('./dates.js');
    var env = require('./env.js').env;

    var API_KEY = env.mixpanelApiKey;
    var API_SECRET = env.mixpanelApiSecret;

    function buildQueryUrl(api, args) {
        args.api_key = API_KEY;
        args.expire =  120 + Math.floor(new Date().getTime() / 1000.0); // 2-min expiry

        function collectKeys(obj) {
            var keys = [];
            for (var key in obj) {
                if (obj.hasOwnProperty(key)) {
                    keys.push(key);
                }
            }
            return keys;
        }

        var params = collectKeys(args).sort().map(function(key) {
            return key + '=' + args[key];
        });

        args.sig = md5(params.join('') + API_SECRET);

        var queryParams = collectKeys(args).map(function(key) {
            return key + '=' + encodeURIComponent(args[key]);
        }).join('&');

        var subdomain = api === 'export' ? 'data.' : '';
        return 'https://' + subdomain + 'mixpanel.com/api/2.0/' + api + '/?' + queryParams;
    }

    function doGetRequest(url) {
        return Parse.Cloud.httpRequest({
            method: 'GET',
            headers: {
                'Content-Type': 'application/json;charset=utf-8'
            },
            url: url,
            error: function(httpResponse) {
                console.error('Mixpanel request failed with response code ' + httpResponse.status);
                return 'error: ' + httpResponse.status;
            }
        });
    }

    function getFunnel(funnelId, startDate, endDate) {
        var args = {
            'funnel_id': funnelId,
            'from_date': startDate,
            'to_date': endDate,
            'length': 30,
            'unit': 'week'
        };
        var url = buildQueryUrl('funnels', args);
        return doGetRequest(url).then(function(httpResponse) {
            return httpResponse.data;
        });
    }

    function getDateRange(cohortWeek) {
        var endDate = dates.cohortDate(cohortWeek);
        var startDate = endDate.clone().subtract('days', 6);
        return {
            startDate: dates.fmtDay(startDate),
            endDate: dates.fmtDay(endDate)
        };
    }

    function getBuyWinesBeginBasicFunnel(cohortWeek) {
        var dateRange = getDateRange(cohortWeek);
        return getFunnel(758661, dateRange.startDate, dateRange.endDate).then(function(d) {
            var date = d.meta.dates[0];
            var steps = d.data[date].steps;
            var signups = steps[0].count;
            var buyWineBegins = steps[1].count;
            return {
                signups: signups,
                buyWineBegins: buyWineBegins
            };
        });
    }

    function getBuyWinesBeginDetailedFunnel(cohortWeek) {
        var dateRange = getDateRange(cohortWeek);
        return getFunnel(758889, dateRange.startDate, dateRange.endDate).then(function(d) {
            var date = d.meta.dates[0];
            var steps = d.data[date].steps;
            var signups = steps[0].count;
            var buyWineBegins = steps[1].count;
            var quantitySelected = steps[2].count;
            var complete = steps[3].count;
            return {
                signups: signups,
                quantitySelected: quantitySelected,
                buyWineBegins: buyWineBegins,
                complete: complete
            };
        });
    }

    function getReferrerFunnel(cohortWeek) {
        var dateRange = getDateRange(cohortWeek);
        return getFunnel(771147, dateRange.startDate, dateRange.endDate).then(function(d) {
            var date = d.meta.dates[0];
            var steps = d.data[date].steps;
            var signups = steps[0].count;
            var inviteFriendsComplete = steps[1].count;
            return {
                signups: signups,
                inviteFriendsComplete: inviteFriendsComplete
            };
        });
    }

    function getEvents(events, startDate, endDate) {
        var args = {
            from_date: dates.fmtDay(startDate),
            to_date: dates.fmtDay(endDate),
            event: JSON.stringify(events)
        };
        var url = buildQueryUrl('export', args);
        return doGetRequest(url).then(function(httpResponse) {
            var events = httpResponse.text.split('\n');
            // strip off last empty element
            if (events.length > 0 && events[events.length - 1] === '') {
                events.length = events.length - 1;
            }
            return events.map(JSON.parse.bind(JSON));
        });
    }

    exports.getBuyWinesBeginBasicFunnel = getBuyWinesBeginBasicFunnel;
    exports.getBuyWinesBeginDetailedFunnel = getBuyWinesBeginDetailedFunnel;
    exports.getReferrerFunnel = getReferrerFunnel;
    exports.getEvents = getEvents;
})();
