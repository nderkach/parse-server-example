/**
 * Dashboard data and calculations
 */

var exports;

(function () {
    'use strict';
    var _ = require('underscore');
    var moment = require('./cloud/moment.min.js');
    var math = require('./cloud/math.min.js');
    var dates = require('./cloud/dates.js');
    var mixpanelExports = require('./cloud/mixpanel.js');
    var fbutil = require('./cloud/fbutil.js');
    var analytics = require('./cloud/analytics.js');
    var queries = require('./cloud/queries.js');
    var coreActions = require('./cloud/coreActions.js');

    var User = Parse.Object.extend('User');
    var Post = Parse.Object.extend('Post');
    var Order = Parse.Object.extend('Order');
    var UserStats = Parse.Object.extend('UserStats');
    var CohortStats = Parse.Object.extend('CohortStats');
    var FacebookAdsToken = Parse.Object.extend('FacebookAdsToken');

    var STATS_LAST_MONTH = 60;
    var STATS_MONTHS = (function() {
        var arr = [];
        for (var i = 0; i <= STATS_LAST_MONTH; i++) {
            arr.push(i);
        }
        return arr;
    })();

    // Business logic for calculating stats for orders. Alex M says that before 16 Sep 2013 to only count
    // orders where status === 'completed'. After (and equal) to that date use all orders regardless of status.
    var ORDER_DATE_THRESHOLD = moment([2013, 9 - 1, 16]);

    function coreActionMonthlyUserStatsName(actionType) {
        var prettyName = coreActions.prettyNameForActionType(actionType);
        return 'monthly' + prettyName + 'Count';
    }

    function coreActionMonthZeroUniqueDaysUserStatsName(actionType) {
        var prettyName = coreActions.prettyNameForActionType(actionType);
        return 'monthZeroUniqueDays' + prettyName;
    }

    // a divided by b, math-vector/numpy-style, divide by zero evaluates to 0
    function arrayDivide(a, b) {
        return b.map(function(bb, i) {
            return (bb === 0) ? 0 : a[i] / bb;
        });
    }

    // to convert User data into UserStats data
    var USER_TO_STATS_PROJECTIONS = (function() {
        var base = [
            ['cohort', function(u) {return dates.cohortWeek(u.createdAt);}], // cohort first to make sorting easier at command-line
            ['userId', function(u) {return u.id;}],
            ['mixpanelId', function(u) {return u.get('mixpanel_id');}],
            ['username', function(u) {return u.get('username');}],
            ['email', function(u) {return u.get('email');}],
            ['signup', function(u) {return dates.fmtDate(u.createdAt);}],
            ['signupDay', function(u) {return dates.fmtDay(u.createdAt);}],
            ['signupWeek', function(u) {return dates.fmtWeek(u.createdAt);}],
            ['signupSource', function(u) {return u.get('signupsource');}],

            ['emailIsVerified', function(u) {return !!u.get('emailVerified');}], // emailVerified is a reserved key.
            ['dateOfBirth', function(u) {return dates.fmtDay(u.get('dob'));}],
            ['facebookId', function(u) {return u.get('facebookid');}],
            ['followerCount', function(u) {return u.get('follower_count');}],
            ['followingCount', function(u) {return u.get('following_count');}],
            ['lastNotificationDate', function(u) {return dates.fmtDate(u.get('lastnotificatinDate'));}],

            ['firstPostDate', function(u) {return dates.fmtDate(u._postStats.firstDate);}],
            ['totalPosts', function(u) {return u._postStats.totalCount;}],
            ['weekZeroPostCount', function(u) {return u._postStats.weekZeroCount;}],
            ['monthZeroPostUniqueDaysCount', function(u) {return _.size(u._postStats.monthZeroDays);}],
            ['monthlyPostCounts', function(u) {return u._postStats.monthlyCount;}], // array

            ['firstPurchaseDate', function(u) {return dates.fmtDate(u._orderStats.firstDate);}],
            ['totalPurchases', function(u) {return u._orderStats.totalCount;}],
            ['monthlyPurchases', function(u) {return u._orderStats.monthlyCount;}], // array
            ['monthlyBottlesPurchased', function(u) {return u._orderStats.monthlyBottlesPurchased;}], // array
            ['acquired', function(u) {
                return checkAcquisitionActivation(u._postStats.monthlyCount[0], _.size(u._postStats.monthZeroDays)).acquisition;
            }],
            ['activated', function(u) {
                return checkAcquisitionActivation(u._postStats.monthlyCount[0], _.size(u._postStats.monthZeroDays)).activation;
            }]
        ];
        var ca = [];
        coreActions.coreActionTypes().forEach(function(actionType) {
            ca.push([coreActionMonthlyUserStatsName(actionType), function(u) {return u._coreActionStats[actionType].monthlyCount;}]);
            ca.push([coreActionMonthZeroUniqueDaysUserStatsName(actionType), function(u) {return _.size(u._coreActionStats[actionType].monthZeroDays);}]);
        });
        ca.push([coreActionMonthlyUserStatsName('Session'), function(u) {return u._coreActionStats.Session.monthlyCount;}]);
        ca.push(['monthlyCoreActionsInclPosts', function(u) {return u._coreActionStats.globalInclPosts.monthlyCount;}]); // array
        ca.push(['monthZeroUniqueDaysCoreActionsInclPosts', function(u) {return _.size(u._coreActionStats.globalInclPosts.monthZeroDays);}]);
        ca.push(['monthlyCoreActionsExclPosts', function(u) {return u._coreActionStats.globalExclPosts.monthlyCount;}]); // array
        ca.push(['monthZeroUniqueDaysCoreActionsExclPosts', function(u) {return _.size(u._coreActionStats.globalExclPosts.monthZeroDays);}]);
        ca.push(['coreActionAcquired', function(u) {
            var stats = u._coreActionStats.globalInclPosts;
            return checkAcquisitionActivation(stats.monthlyCount[0], _.size(stats.monthZeroDays)).acquisition;
        }]);
        ca.push(['coreActionActivated', function(u) {
            var stats = u._coreActionStats.globalInclPosts;
            return checkAcquisitionActivation(stats.monthlyCount[0], _.size(stats.monthZeroDays)).activation;
        }]);

        // session data

        function calculateAverageCoreActionsPerSession(user) {
            var monthlyTotalCoreActions = user._coreActionStats.globalInclPosts.monthlyCount;
            var monthlySessionCount = user._coreActionStats.Session.monthlyCount;
            return arrayDivide(monthlyTotalCoreActions, monthlySessionCount);
        }

        function calculateAverageSecondsPerSession(user) {
            var monthlyTotalSessionSeconds = user._coreActionStats.monthlyTotalSessionSeconds;
            var monthlySessionCount = user._coreActionStats.Session.monthlyCount;
            return arrayDivide(monthlyTotalSessionSeconds, monthlySessionCount);
        }

        ca.push(['monthlyTotalSessionSeconds', function(u) {return u._coreActionStats.monthlyTotalSessionSeconds;}]); // array
        ca.push(['monthlyAverageCoreActionsPerSession', function(u) {return calculateAverageCoreActionsPerSession(u);}]); // array
        ca.push(['monthlyAverageSecondsPerSession', function(u) {return calculateAverageSecondsPerSession(u);}]); // array

        ca.push(['wineSpecialsPushSent', function(u) {return u._wineSpecials.sent;}]); // array
        ca.push(['wineSpecialsAppOpened', function(u) {return u._wineSpecials.appOpened;}]); // array
        ca.push(['wineSpecialsDaysSinceFirstPush', function(u) {return u._wineSpecials.daysSinceFirstPush;}]); // array
        ca.push(['wineSpecialsDealClicked', function(u) {return u._wineSpecials.dealClicked;}]); // array
        ca.push(['wineSpecialsBuyWineBegin', function(u) {return u._wineSpecials.buyWineBegin;}]); // array
        ca.push(['wineSpecialsBuyWineComplete', function(u) {return u._wineSpecials.buyWineComplete;}]); // array

        return base.concat(ca);
    })();

    function identity(x) { return x; }
    function numeric(x) { return x === undefined ? 0 : x; }

    // for writing out CohortStats to CSV
    var COHORT_STATS_PROJECTIONS = [
        ['cohortDate', 'Cohort date', dates.fmtDay],
        ['cohortWeek', 'Cohort week', identity],
        ['downloads', 'App downloads', numeric],
        ['signups', 'Signups', identity],
        ['acquisitions', 'Acquisitions', identity],
        ['activations', 'Activations', identity],
        ['month0PostsByActivated', 'Month 0 posts by activated', identity],
        ['FunnelBWB_Basic_Signups', 'Funnel BWB(basic) signups', identity],
        ['FunnelBWB_Basic_BWBs', 'Funnel BWB(basic) bwbs', identity],
        ['FunnelBWB_Detailed_Signups', 'Funnel BWB(detailed) signups', identity],
        ['FunnelBWB_Detailed_BWBs', 'Funnel BWB(detailed) bwbs', identity],
        ['FunnelBWB_Detailed_QuantitySelected', 'Funnel BWB(detailed) quantity selected', identity],
        ['FunnelBWB_Detailed_Complete', 'Funnel BWB(detailed) complete', identity],
        ['facebookInstalls', 'Facebook installs', numeric],
        ['facebookSpend', 'Facebook spend (USD)', numeric]
    ];

    // Expand the per-month column into N columns for writing out to CSV
    // prettyName should contain an X for replacement with month number value
    function addMonthlyProjections(projections, colName, prettyName, startMonth, dataTransformFunc) {
        if (dataTransformFunc === undefined) {
            dataTransformFunc = identity;
        }
        function transform(i) {
            return function(x) {
                return x && dataTransformFunc(x[i]) || 0; // handle missing data
            };
        }
        // force cohort stats CSV output to only show up to month 12
        STATS_MONTHS.slice(startMonth, 13).forEach(function(i) {
           projections.push([colName, prettyName.replace('X', i), transform(i)]);
        });
    }
    addMonthlyProjections(COHORT_STATS_PROJECTIONS, 'monthlyRetentions', 'Month X retentions', 1);
    addMonthlyProjections(COHORT_STATS_PROJECTIONS, 'monthlyPostsByRetained', 'Month X posts by retained', 0);
    addMonthlyProjections(COHORT_STATS_PROJECTIONS, 'monthlyPurchasers', 'Month X purchasers', 0);
    addMonthlyProjections(COHORT_STATS_PROJECTIONS, 'monthlyBottlesPurchased', 'Month X bottles', 0);

    [
        ['FunnelReferrer_Signups', 'Funnel referrer signups', identity],
        ['FunnelReferrer_InviteFriendsComplete', 'Funnel referrers (month 0)', identity],
        ['coreActionAcquisitions', 'Core Action Acquisitions', identity],
        ['coreActionActivations', 'Core Action Activations', identity]
    ].forEach(function(x) { COHORT_STATS_PROJECTIONS.push(x); });

    addMonthlyProjections(COHORT_STATS_PROJECTIONS, 'monthlyCoreActionInclPostsRetentions', 'Month X core action retentions', 1);
    addMonthlyProjections(COHORT_STATS_PROJECTIONS, 'monthlyCoreActionsInclPostsByRetained', 'Month X core actions by retained', 0);

    function sumTransform(x) { return x.sum || 0; }
    addMonthlyProjections(COHORT_STATS_PROJECTIONS, 'aggMonthlyTotalSessionSeconds', 'Month X total session seconds', 0, sumTransform);
    addMonthlyProjections(COHORT_STATS_PROJECTIONS, 'aggMonthlyTotalSessions', 'Month X total sessions', 0, sumTransform);
    addMonthlyProjections(COHORT_STATS_PROJECTIONS, 'aggMonthlyAverageSecondsPerSession', 'Month X totalled averageSecondsPerSession', 0, sumTransform);
    addMonthlyProjections(COHORT_STATS_PROJECTIONS, 'aggMonthlyAverageCoreActionsPerSession', 'Month X totalled averageCoreActionsPerSession', 0, sumTransform);

    function medianTransform(x) { return x.median || 0; }
    addMonthlyProjections(COHORT_STATS_PROJECTIONS, 'aggMonthlyCoreActions', 'Month X median coreActionsPerUser', 0, medianTransform);
    addMonthlyProjections(COHORT_STATS_PROJECTIONS, 'aggMonthlyTotalSessionSeconds', 'Month X median totalSessionSecondsPerUser', 0, medianTransform);
    addMonthlyProjections(COHORT_STATS_PROJECTIONS, 'aggMonthlyTotalSessions', 'Month X median sessionsPerUser', 0, medianTransform);
    addMonthlyProjections(COHORT_STATS_PROJECTIONS, 'aggMonthlyAverageCoreActionsPerSession', 'Month X median averageCoreActionsPerSessionPerUser', 0, medianTransform);
    addMonthlyProjections(COHORT_STATS_PROJECTIONS, 'aggMonthlyAverageSecondsPerSession', 'Month X median averageSecondsPerSessionPerUser', 0, medianTransform);

    // NOTE(mike): add new CohortStats projections here to maintain order

    // for writing UserStats out to CSV
    var USER_STATS_PROJECTIONS = (function() {
        var whitelist = [
            'cohort',
            'userId',
            'mixpanelId',
            'username',
            'email',
            'signup',
            'signupDay',
            'signupWeek',
            'signupSource',
            'emailIsVerified',
            'dateOfBirth',
            'facebookId',
            'followerCount',
            'followingCount',
            'lastNotificationDate',
            'firstPostDate',
            'totalPosts',
            'weekZeroPostCount',
            'monthZeroPostUniqueDaysCount',
            'monthlyPostCounts',
            'firstPurchaseDate',
            'totalPurchases',
            'monthlyPurchases',
            'monthlyBottlesPurchased',
            'wineSpecialsPushSent',
            'wineSpecialsDaysSinceFirstPush',
            'wineSpecialsAppOpened',
            'wineSpecialsDealClicked',
            'wineSpecialsBuyWineBegin',
            'wineSpecialsBuyWineComplete'
        ];
        var allProjectionsByName = {};
        USER_TO_STATS_PROJECTIONS.forEach(function(proj) {
            allProjectionsByName[proj[0]] = proj;
        });

        var outputProjections = [];
        whitelist.forEach(function(projName) {
            var proj = allProjectionsByName[projName];
            if (projName === 'monthlyPostCounts') {
                addMonthlyProjections(outputProjections, projName, 'Month X post count', 0);
            } else if (projName === 'monthlyPurchases') {
                addMonthlyProjections(outputProjections, projName, 'Month X purchases', 0);
            } else if (projName === 'monthlyBottlesPurchased') {
                addMonthlyProjections(outputProjections, projName, 'Month X bottles purchased', 0);
            } else {
                outputProjections.push([projName, projName, identity]);
            }
        });

        return outputProjections;
    })();

    // plain: currentLocation, lastAddress, orderNumber, photo, post_code, post_state, post_suburb, post_street
    // json: wishlist, notificationSetting


    // Exports //

    /** An EJS handler which sends CSV rows with UserStats. */
    exports.usersHandler = function(ejsReq, ejsRes) {
        writeOutTableToCSV(ejsRes, UserStats, USER_STATS_PROJECTIONS);
    };

    /** An EJS handler which sends CSV rows with CohortStats. */
    exports.cohortStatsHandler = function(ejsReq, ejsRes) {
        var query = new Parse.Query(CohortStats).ascending('cohortWeek').limit(1000);
        writeOutQueryToCSV(ejsRes, query, COHORT_STATS_PROJECTIONS);
    };

    /**
     * An EJS handler which clears all User.stats and UserStats. It is preferable to use the
     * background job however if there is a lot of data as this request may time out.
     */
    exports.clearStatsHandler = function(ejsReq, ejsRes) {
        clearStatsJob().then(function(usersUpdated, userStatsDeleted) {
            ejsRes.set("Content-Type", "text/plain");
            ejsRes.write("Clear stats field for " + usersUpdated + " users\n");
            ejsRes.write("Deleted " + userStatsDeleted + " UserStats\n");
            ejsRes.send();
        }, function(error){
            ejsRes.send(500, 'Error: ' + error);
        });
    };

    /**
     * An EJS handler which triggers the UserStats/CohortStats generation.
     * It is preferable to use the background job however if there is a lot
     * of data as this request may time out.
     */
    exports.statsUpdateJob = function(ejsReq, ejsRes) {
        fullStatsUpdateJob().then(function(count) {
            ejsRes.set("Content-Type", "text/plain");
            ejsRes.write("Wrote " + count + " stats entries\n");
            ejsRes.send();
        }, function(error) {
            ejsRes.send(500, 'Error: ' + error);
        });
    };

    /** An EJS handler to test that AppAnnie downloads are written to CohortStats. */
    exports.appAnnieTestHandler = function(ejsReq, ejsRes) {
        updateAppAnnieStats().then(function(result) {
            ejsRes.set("Content-Type", "text/plain");
            ejsRes.write("Done\n");
            ejsRes.send();
        }, function(error) {
            ejsRes.send(500, 'Error: ' + error);
        });
    };

    exports.mixpanelTestHandler = function(ejsReq, ejsRes) {
        updateMixpanelStats().then(function(result) {
            ejsRes.set("Content-Type", "text/plain");
            ejsRes.write("Done\n");
            ejsRes.send();
        }, function(error) {
            ejsRes.send(500, 'Error: ' + error);
        });
    };

    /** Called by /fb.html to update the accessToken for accessing Facebook Ads API */
    exports.updateFacebookTokenHandler = function(ejsReq, ejsRes) {
        fbutil.exchangeToken(ejsReq.body.accessToken).then(function(data) {
            var expiryDays = Math.floor(data.expirySeconds / (60.0 * 60.0 * 24.0));

            function getFacebookAdsToken() {
                return new Parse.Query(FacebookAdsToken).first({useMasterKey: true}).then(function(x) {
                    return x || new FacebookAdsToken();
                });
            }

            return getFacebookAdsToken().then(function(fbAdsToken) {
                return fbAdsToken.save({
                    accessToken: data.accessToken,
                    expires: moment().add('seconds', data.expirySeconds).toDate()
                }, {useMasterKey: true});
            }).then(function() {
                return 'Successfully exchanged token, expires in ' + expiryDays + ' days';
            });
        }).then(function(msg) {
            ejsRes.set("Content-Type", "text/plain");
            ejsRes.write(msg + "\n");
            ejsRes.send();
        }, function(err) {
            ejsRes.send(500, err);
        });
    };

    /**
     * An EJS handler to compare number of rows in User vs UserStats for duplicate detection.
     * The numbers should be equal but may not be if there are duplicates.
     */
    exports.userStatsCountsHandler = function(ejsReq, ejsRes) {
        var numUsersPromise = queries.activeUsers().count();
        var numUsersNeedStatsUpdatePromise = queries.activeUsers().notEqualTo('statsNeedUpdate', false).count();
        var numUserStatsPromise = new Parse.Query(UserStats).count({useMasterKey: true});
        Parse.Promise.when(numUsersPromise, numUsersNeedStatsUpdatePromise, numUserStatsPromise).then(function(numUsers, numUsersNeedStatsUpdate, numUserStats) {
            ejsRes.set("Content-Type", "text/plain");
            ejsRes.write("Num Users: ");
            ejsRes.write("" + numUsers + " (" + numUsersNeedStatsUpdate + " need update)");
            ejsRes.write("\n");
            ejsRes.write("Num UserStats: ");
            ejsRes.write("" + numUserStats);
            ejsRes.write("\n");
            ejsRes.send();
        }, function(error) {
            ejsRes.send(500, 'Error: ' + error);
        });
    };

    /**
     * Should be called from anywhere (except user before/after save triggers) to mark that
     * a user's stats need to be recalculated by the background job.
     */
    exports.setStatsNeedUpdate = function(user) {
        user.set('statsNeedUpdate', true);
        return user.save(null, {useMasterKey: true});
    };

    /**
     * As above but only to be called from user beforeSave trigger.
     * Returns true if the beforeSave was caused by stats updates, otherwise false.
     * The return value should be used to minimise work done by beforeSave trigger
     * while the background job is updating stats.
     */
    exports.setStatsNeedUpdateForUserBeforeSave = function(user) {
        var updateCausedByStatsUpdate;
        if (user.dirty('statsNeedUpdate') || user.dirty('stats')) {
            updateCausedByStatsUpdate = true;
        } else {
            user.set('statsNeedUpdate', true);
            updateCausedByStatsUpdate = false;
        }
        return updateCausedByStatsUpdate;
    };

    /**
     * To be called on user creation to help make duplicates in the UserStats table a highly unlikely event.
     * The stats generation code creates stats if not exists, but updates if exists. So the existence of stats on
     * user creation means that it always updates and never creates. If it never creates it shouldn't duplicate.
     */
    exports.userAfterSaveInitUserStats = function(user) {
        if (!user.existed() && !user.has('stats')) {
            var stats = new UserStats();
            stats.set('userId', user.id);

            user.set('statsNeedUpdate', true);
            user.set('stats', stats);
        }
    };

    // Background jobs

    /** See docs on fullStatsUpdateJob() */
    Parse.Cloud.job("statsUpdateJob", function(request, status) {
        coreActions.prepareCoreActionsForStatsJob().then(fullStatsUpdateJob).then(function(numUserStatsUpdated) {
            status.success("Done (" + numUserStatsUpdated + " UserStats updated)");
        }, function(error) {
            status.error("Error :( " + JSON.stringify(error));
        });
    });

    /** See docs on userAndCohortStatsOnlyJob() */
    Parse.Cloud.job("userAndCohortStatsOnlyJob", function(request, status) {
        userAndCohortStatsOnlyJob().then(function(numUserStatsUpdated) {
            status.success("Done (" + numUserStatsUpdated + " UserStats updated)");
        }, function(error) {
            status.error("Error :( " + JSON.stringify(error));
        });
    });

    /** See docs on clearStatsJob() */
    Parse.Cloud.job("clearStatsJob", function(request, status) {
        clearStatsJob().then(function(usersUpdated, userStatsDeleted) {
            status.success("Cleared (users=" + usersUpdated + ", userStats=" + userStatsDeleted + ")");
        }, function(error) {
            status.error("Error :( " + JSON.stringify(error));
        });
    });

    /** See docs on setStatsNeedUpdateJob() */
    Parse.Cloud.job("setStatsNeedUpdateJob", function(request, status) {
        setStatsNeedUpdateJob().then(function(usersUpdated) {
            status.success("Updated " + usersUpdated + " users");
        }, function(error) {
            status.error("Error :( " + JSON.stringify(error));
        });
    });

    /** Helper to write a table (unsorted) out to CSV ejs response. */
    function writeOutTableToCSV(ejsRes, table, projections) {
        var queryProducer = function(processFunc) {
            return new Parse.Query(table).each(processFunc, {useMasterKey: true});
        };
        writeOutQueryLikeToCSV(ejsRes, queryProducer, projections);
    }

    /** Helper to write the contents of a query out to CSV ejs response. */
    function writeOutQueryToCSV(ejsRes, query, projections) {
        var queryProducer = function(processFunc) {
            return query.find({useMasterKey: true}).then(function(rows) {
                rows.forEach(function(row) {
                    processFunc(row);
                });
            });
        };
        writeOutQueryLikeToCSV(ejsRes, queryProducer, projections);
    }

    /**
     * Common helper method for writing out CSV to ejs response.
     * Format of projections must be [[columnName, prettyName, colDataTransformFunc], ...]
     */
    function writeOutQueryLikeToCSV(ejsRes, queryProducer, projections) {
        var NEWLINE = "\r\n";
        ejsRes.set("Content-Type", "text/csv");
        ejsRes.write(projections.map(function(x) { return x[1]; }).join(","));
        ejsRes.write(NEWLINE);

        function writeOutRow(row) {
            ejsRes.write(projections.map(function(proj) {
                var col = String(proj[2](row.get(proj[0])));
                // escape only if needed
                if (/[,"]/.test(col)) {
                    col = '"' + String(col).replace(/\"/g, '""') + '"';
                }
                return col;
            }).join(","));
            ejsRes.write(NEWLINE);
        }

        return queryProducer(function(data) {
            writeOutRow(data);
        }).then(function() {
            ejsRes.send();
        }, function(error) {
            ejsRes.send(500, 'Error: ' + error);
        });
    }

    /** Stats update background job to update UserStats and CohortStats. */
    function fullStatsUpdateJob() {
        console.log("Starting full CohortStats update");
        var startTime = moment();
        // Update all the sources 1 at a time, to serialise writes to CohortStats.
        return startFacebookAdsStatsRequest().then(function(jobId) {
            return updateMixpanelStats().then(updateAppAnnieStats).then(performUpdateForUserAndCohortStats).then(function(numUserStatsUpdated) {
                var promise = (jobId !== undefined) ? finishFacebookAdsStatsRequest(jobId) : Parse.Promise.as();
                return promise.then(function() {
                   return numUserStatsUpdated;
                });
            });
        }).then(function(numUserStatsUpdated) {
            console.log("Full CohortStats update completed in " + moment().subtract(startTime).seconds() + "s");
            return numUserStatsUpdated;
        });
    }

    /** Just updates user stats and then cohort stats, no mixpanel or fb ads or app annie etc */
    function userAndCohortStatsOnlyJob() {
        console.log("Starting CohortStats update");
        var startTime = moment();
        // Update all the sources 1 at a time, to serialise writes to CohortStats.
        return performUpdateForUserAndCohortStats().then(function(numUserStatsUpdated) {
            console.log("CohortStats update completed in " + moment().subtract(startTime).seconds() + "s");
            return numUserStatsUpdated;
        });
    }

    /** Clear stats field for users and also truncate the UserStats table. */
    function clearStatsJob() {
        function clearReferenceToUserStats() {
            var count = 0;
            return queries.activeUsers().exists('stats').select().each(function(user) {
                count += 1;
                user.unset('stats');
                return user.save(null, {useMasterKey: true});
            }).then(function() {
                return count;
            });
        }
        function deleteUserStats() {
            var count = 0;
            return new Parse.Query(UserStats).each(function(stats) {
                count += 1;
                return stats.destroy({useMasterKey: true});
            }, {useMasterKey: true}).then(function() {
                return count;
            });
        }
        return Parse.Promise.when(clearReferenceToUserStats(), deleteUserStats());
    }

    /** If a user with stats has since been blocked/deleted, their stats should be removed. */
    function clearStatsForBlockedOrDeletedUsers() {
        var queryBlocked = new Parse.Query(User);
        queryBlocked.equalTo('blocked', true);
        queryBlocked.exists('stats');
        queryBlocked.select();

        var queryDeleted = new Parse.Query(User);
        queryDeleted.equalTo('deleted', true);
        queryDeleted.exists('stats');
        queryDeleted.select();

        function neverFailingDestroy(obj) {
            var promise = new Parse.Promise();
            obj.destroy({useMasterKey: true}).then(function() {
                promise.resolve();
            }, function() {
                promise.resolve();
            });
            return promise;
        }

        return Parse.Query.or(queryBlocked, queryDeleted).each(function(user) {
            console.log('Clearing stats for blocked/deleted user ' + user.id);
            return neverFailingDestroy(user.get('stats')).then(function() {
                user.unset('stats');
                return user.save(null, {useMasterKey: true});
            });
        });
    }

    /** Mark all users to need a stats update. */
    function setStatsNeedUpdateJob() {

        function doRecursiveBatch(accumCount) {
            // default argument
            if (accumCount === undefined) {
                accumCount = 0;
            }
            return queries.activeUsers()
                .select()
                .exists('stats')
                .equalTo('statsNeedUpdate', false)
                .limit(100)
                .find({useMasterKey: true}).then(function(users) {
                    users.forEach(function(u) {
                        u.set('statsNeedUpdate', true);
                    });
                    return Parse.Object.saveAll(users, {useMasterKey: true}).then(function() {
                        var count = users.length;
                        accumCount += count;
                        if (count !== 0) {
                            return doRecursiveBatch(accumCount);
                        } else {
                            return accumCount;
                        }
                    });
                });
        }

        return doRecursiveBatch();
    }

    /** Download App Annie stats and save to CohortStats. */
    function updateAppAnnieStats() {
        function doRequest(startDate) {
            var formattedStartDate = dates.fmtDay(startDate);
            console.log("Using startDate " + formattedStartDate);

            return Parse.Cloud.httpRequest({
                method: 'GET',
                headers: {
                    'Authorization': 'bearer 6e8a37500183338eab4688380224d0bc554b09b8',
                    'Content-Type': 'application/json;charset=utf-8'
                },
                url: 'https://api.appannie.com/v1/accounts/86281/apps/661997423/sales',
                params: {
                    'break_down': 'date',
                    'start_date': formattedStartDate
                },
                error: function(httpResponse) {
                    console.error('App Annie request failed with response code ' + httpResponse.status);
                }
            }).then(function(httpResponse) {
                // parse response
                var cohorts = [];
                var numCohorts = dates.cohortWeek(moment()) + 1;
                for (var i = 0; i < numCohorts; i++) {
                    cohorts[i] = -1;
                }
                httpResponse.data.sales_list.forEach(function(obj) {
                    var date = moment(obj.date, "YYYY-MM-DD");
                    var downloads = obj.units.app.downloads;
                    var week = dates.cohortWeek(date);
                    var prevValue = cohorts[week];
                    if (prevValue === -1) {
                        prevValue = 0;
                    }
                    cohorts[week] = prevValue + downloads;
                });

                return cohorts;
            }).then(function(cohorts) {
                // write to database
                return Parse.Promise.when(cohorts.map(function(downloads, week) {
                    if (downloads >= 0) {
                        return getCohortStats(week).then(function(cohortStats) {
                            cohortStats.set('downloads', downloads);
                            return cohortStats.save(null, {useMasterKey: true});
                        });
                    } else {
                        return Parse.Promise.as();
                    }
                }));
            });
        }

        console.log("Starting AppAnnie stats update");
        var startTime = moment();

        return new Parse.Query(CohortStats).exists('downloads').count({useMasterKey: true}).then(function(numPresent) {
            // if there are any missing, do a full request, otherwise past month only
            var startDate = (numPresent === 0) ? dates.START_OF_WEEK_ZERO : dates.startOfWeek(moment().subtract('months', 1));
            return doRequest(startDate);
        }).then(function() {
            console.log("Finished updating AppAnnie stats in " + moment().subtract(startTime).seconds() + "s");
        });
    }

    function updateMixpanelStats() {

        function requestBuilderForBwbBasicFunnel(cohort) {
            console.log('Requesting BWB basic funnel for cohort ' + cohort);
            return mixpanelExports.getBuyWinesBeginBasicFunnel(cohort).then(function(data) {
                return getCohortStats(cohort).then(function(cohortStats) {
                    cohortStats.set('FunnelBWB_Basic_Signups', data.signups);
                    cohortStats.set('FunnelBWB_Basic_BWBs', data.buyWineBegins);
                    return cohortStats.save(null, {useMasterKey: true});
                });
            });
        }

        function requestBuilderForBwbDetailedFunnel(cohort) {
            console.log('Requesting BWB detailed funnel for cohort ' + cohort);
            return mixpanelExports.getBuyWinesBeginDetailedFunnel(cohort).then(function(data) {
                return getCohortStats(cohort).then(function(cohortStats) {
                    cohortStats.set('FunnelBWB_Detailed_Signups', data.signups);
                    cohortStats.set('FunnelBWB_Detailed_BWBs', data.buyWineBegins);
                    cohortStats.set('FunnelBWB_Detailed_QuantitySelected', data.quantitySelected);
                    cohortStats.set('FunnelBWB_Detailed_Complete', data.complete);
                    return cohortStats.save(null, {useMasterKey: true});
                });
            });
        }

        function requestBuilderForReferrerFunnel(cohort) {
            console.log('Requesting referrer funnel for cohort ' + cohort);
            return mixpanelExports.getReferrerFunnel(cohort).then(function(data) {
                return getCohortStats(cohort).then(function(cohortStats) {
                    cohortStats.set('FunnelReferrer_Signups', data.signups);
                    cohortStats.set('FunnelReferrer_InviteFriendsComplete', data.inviteFriendsComplete);
                    return cohortStats.save(null, {useMasterKey: true});
                });
            });
        }

        console.log("Starting Mixpanel stats update");
        var startTime = moment();

        // update missing followed by updating 'latest' to keep them fresh
        function updateFunnel(checkingKey, requestBuilder) {
            return new Parse.Query(CohortStats).doesNotExist(checkingKey).each(function(stats) {
                return requestBuilder(stats.get('cohortWeek'));
            }, {useMasterKey: true}).then(function() {

                function wrapRequestBuilder(week) {
                    return function() {
                        return requestBuilder(week);
                    };
                }

                var numWeeks = 7;
                var thisWeek = dates.cohortWeek(moment());
                var promiseChain = Parse.Promise.as();
                for (var i = 1; i <= numWeeks; i++) {
                    var week = thisWeek - numWeeks + i;
                    promiseChain = promiseChain.then(wrapRequestBuilder(week));
                }
                return promiseChain;
            });
        }

        function updateBwbBasicFunnel() {
            return updateFunnel('FunnelBWB_Basic_Signups', requestBuilderForBwbBasicFunnel);
        }
        function updateBwbDetailedFunnel() {
            return updateFunnel('FunnelBWB_Detailed_Signups', requestBuilderForBwbDetailedFunnel);
        }
        function updateReferrerFunnel() {
            return updateFunnel('FunnelReferrer_Signups', requestBuilderForReferrerFunnel);
        }

        return updateBwbBasicFunnel().then(updateBwbDetailedFunnel).then(updateReferrerFunnel).then(function() {
            console.log("Finished updating Mixpanel stats in " + moment().subtract(startTime).seconds() + "s");
        });
    }

    function startFacebookAdsStatsRequest() {
        function fbRequestAdsStats(accessToken, startDate, weeks) {
            console.log('Starting facebook ads stats update for startDate=' + dates.fmtDay(startDate) + ' weeks=' + weeks);
            function timeInterval() {
                //{'day_start':{'year':'2014', 'month':'4', 'day':'1'},'day_stop':{'year':'2014', 'month':'4', 'day':'23'}}
                // NOTE(mike): end date is exclusive!
                var start = startDate;
                var end = startDate.clone().add('weeks', weeks);

                function ymd(m) {
                    return {
                        'year': m.year(),
                        'month': m.month() + 1,
                        'day': m.date()
                    };
                }

                return JSON.stringify({
                    'day_start': ymd(start),
                    'day_stop': ymd(end)
                });
            }

            var promise = new Parse.Promise();
            Parse.Cloud.httpRequest({
                method: 'POST',
                url: 'https://graph.facebook.com/act_1671669033059208/reportstats',
                headers: {
                    'Content-Type': 'application/json;charset=utf-8'
                },
                params: {
                    'access_token': accessToken,
                    'time_interval': timeInterval(),
                    'data_columns': "['actions','spend', 'adgroup_id']", // won't use adgroup_id but request needs it in order to work
                    'actions_group_by': "['action_type']",
                    'async': 'true'
                },
                error: function(httpResponse) {
                    console.error('Facebook SDK ads reportstats start async request failed with response code ' + httpResponse.status + " and message " + httpResponse.text);
                }
            }).then(function(httpResponse) {
                var jobId = httpResponse.data;
                console.log('Got facebook job id ' + jobId);
                promise.resolve(jobId);
            }, function() {
                promise.resolve(undefined);
            });
            return promise;
        }


        var thisWeek = dates.cohortWeek(moment());

        var fbTokenQuery = new Parse.Query(FacebookAdsToken).first({useMasterKey: true});
        var countPresentQuery = new Parse.Query(CohortStats).exists('facebookInstalls').count({useMasterKey: true});
        return Parse.Promise.when(fbTokenQuery, countPresentQuery).then(function(fbToken, numPresent) {
            if (fbToken !== undefined) {
                // if there are any missing, do a full request, otherwise past month only
                var weeks;
                var startDate;
                if (numPresent === 0) {
                    weeks = thisWeek + 1;
                    startDate = dates.START_OF_WEEK_ZERO;
                } else {
                    weeks = 2;
                    startDate = dates.cohortDate(thisWeek).add('days', 1).subtract('weeks', weeks);
                }
                var accessToken = fbToken.get('accessToken');
                return fbRequestAdsStats(accessToken, startDate, weeks);
            } else {
                var msg = 'Missing facebook ads API access token';
                console.error(msg);
                return undefined;
            }
        });
    }

    function finishFacebookAdsStatsRequest(jobId) {
        function fbRequestPollJobStatus(accessToken, jobId) {
            //act_1671669033059208/reportstats?report_run_id=6014390076528
            return Parse.Cloud.httpRequest({
                method: 'GET',
                url: 'https://graph.facebook.com/' + jobId,
                headers: {
                    'Content-Type': 'application/json;charset=utf-8'
                },
                params: {
                    'access_token': accessToken
                },
                error: function(httpResponse) {
                    console.error('Facebook SDK ads poll job request failed with response code ' + httpResponse.status + " and message " + httpResponse.text);
                }
            }).then(function(httpResponse) {
                console.log(httpResponse.data);
                return httpResponse.data.async_status === 'Job Completed';
            });
        }

        function fbRequestJobData(accessToken, jobId, processDataFunc, pagingUrl) {
            function initialUrl() {
                return 'https://graph.facebook.com/act_1671669033059208/reportstats?report_run_id=' + jobId + '&access_token=' + accessToken;
            }
            if (pagingUrl) {
                pagingUrl += '&access_token=' + accessToken;
            }
            var url = pagingUrl || initialUrl();
            return Parse.Cloud.httpRequest({
                method: 'GET',
                url: url,
                headers: {
                    'Content-Type': 'application/json;charset=utf-8'
                },
                error: function(httpResponse) {
                    console.error('Facebook SDK ads reportstats get result request failed with response code ' + httpResponse.status + " and message " + httpResponse.text);
                }
            }).then(function(httpResponse) {
                var d = httpResponse.data;
                var data = d.data;
                processDataFunc(data);

                var nextUrl = d.paging && d.paging.next;
                if (!nextUrl) {
                    return "Finished";
                } else {
                    return fbRequestJobData(accessToken, jobId, processDataFunc, nextUrl);
                }
            });
        }

        var installs = {};
        var spend = {};

        function processDataFunc(dataArray) {
            /*
             [
                 {
                     "adgroup_id": "6010621451128",
                     "date_start": "2014-05-16",
                     "date_stop": "2014-05-16",
                     "actions": [
                         {
                             "action_type": "mobile_app_install",
                             "value": 4
                         }
                     ],
                     "spend": 4.5
                 },
                 ...
             ]
             */
            function increment(dict, week, val) {
                dict[week] = (dict[week] || 0) + val;
            }
            dataArray.forEach(function(data) {
                var cohort = dates.cohortWeek(data.date_start);
                var dateEndCohort = dates.cohortWeek(data.date_stop);

                if (cohort !== dateEndCohort) {
                    console.error('Skipping facebook ads data that spans multiple cohorts (' + cohort + ', ' + dateEndCohort + ')');
                } else {
                    increment(spend, cohort, data.spend);
                    data.actions.forEach(function(action) {
                        if (action.action_type === 'mobile_app_install') {
                            increment(installs, cohort, action.value);
                        }
                    });
                }
            });
        }

        function pollStatus(accessToken, jobId) {
            return fbRequestPollJobStatus(accessToken, jobId).then(function(finished) {
                if (!finished) {
                    return pollStatus(accessToken, jobId);
                } else {
                    return finished;
                }
            });
        }

        console.log("Starting Facebook Ads stats update");
        var startTime = moment();
        var thisWeek = dates.cohortWeek(startTime);

        return new Parse.Query(FacebookAdsToken).first({useMasterKey: true}).then(function(fbToken) {
           if (fbToken !== undefined) {
               // if there are any missing, do a full request, otherwise past month only
               var accessToken = fbToken.get('accessToken');
               return pollStatus(accessToken, jobId).then(function() {
                   return fbRequestJobData(accessToken, jobId, processDataFunc);
               });
           } else {
               var msg = 'Missing facebook ads API access token';
               console.error(msg);
               return msg;
           }
        }).then(function() {
            function collectCohorts(dict, accum) {
                for (var key in dict) {
                    if (dict.hasOwnProperty(key)) {
                        accum[key] = true;
                    }
                }
            }

            function keysToArray(dict) {
                var arr = [];
                for (var key in dict) {
                    if (dict.hasOwnProperty(key)) {
                        arr.push(parseInt(key, 10));
                    }
                }
                return arr;
            }
            var cohortSet = {};
            collectCohorts(installs, cohortSet);
            collectCohorts(spend, cohortSet);
            var cohorts = keysToArray(cohortSet);
            var numCohorts = cohorts.length;

            console.log('found cohorts ' + JSON.stringify(cohorts));

            function processCohort(arrIndex) {
                if (arrIndex >= numCohorts) {
                    // base case break out of promise recursion
                    return undefined;
                } else {
                    var i = cohorts[arrIndex];
                    return getCohortStats(i).then(function(cohortStats) {
                        cohortStats.set('facebookInstalls', installs[i] || 0);
                        cohortStats.set('facebookSpend', spend[i] || 0);
                        return cohortStats.save(null, {useMasterKey: true});
                    }).then(function() {
                        return processCohort(arrIndex + 1);
                    }, function(err) {
                        console.log('error: ' + JSON.stringify(err));
                    });
                }
            }

            function processCohorts() {
                // kick off looping over cohorts
                return processCohort(0, thisWeek);
            }

            return processCohorts();
        }).then(function() {
            console.log("Finished updating Facebook Ads stats in " + moment().subtract(startTime).seconds() + "s");
        });
    }

    /** Batch update UserStats followed by re-generating CohortStats. */
    function performUpdateForUserAndCohortStats() {
        console.log("Starting UserStats update");
        var startTime = moment();
        var batchSize = 25;
        var numUserStatsUpdated = 0;

        function multiBatchUpdate() {
            // perform query recursion to overcome 1000 limit per request :)
            function maybeRecurse(func, resultLength, limit, finalReturnValue) {
                if (resultLength === limit) {
                    return func();
                } else {
                    return Parse.Promise.as(finalReturnValue);
                }
            }

            function queryExistingNeedsUpdate() {
                return queries.activeUsers().equalTo('statsNeedUpdate', true).exists('stats');
            }
            function queryMissing() {
                return queries.activeUsers().doesNotExist('stats');
            }

            return Parse.Query.or(queryExistingNeedsUpdate(), queryMissing())
                .select('dob', 'email', 'emailVerified', 'username', 'mixpanel_id',
                        'facebookId', 'follower_count', 'following_count', 'lastnotificatinDate',
                        'signupsource', 'stats')
                .include('stats')
                .limit(batchSize)
                .find().then(function(users) {
                    var numUsers = users.length;
                    var numUpdated = numUsers;
                    numUserStatsUpdated += numUpdated;
                    console.log('found ' + users.length + ' users');
                    return updateStatsForUsers(users).then(function() {
                        users.forEach(function(user) {
                            user.set('statsNeedUpdate', false);
                        });
                        return User.saveAll(users, {useMasterKey: true});
                    }).then(function() {
                        console.log("Num updated " + numUpdated);
                        return maybeRecurse(multiBatchUpdate, numUsers, batchSize);
                    });
                }, function() {
                    return "Failed multiBatchUpdate";
                });
        }

        function regenerateCohorts() {
            console.log('Regenerating cohorts');
            function processCohort(i) {
                var signups = 0;
                var acquisitions = 0;
                var activations = 0;
                var monthZeroPostsByActivated = 0;

                var zeroArray = STATS_MONTHS.map(function() { return 0; });
                var perMonthRetentions = zeroArray.slice();
                var perMonthPostsByRetained = zeroArray.slice();
                var perMonthPurchasers = zeroArray.slice();
                var perMonthBottlesPurchased = zeroArray.slice();

                function initCoreActionStats() {
                    return {
                        acquisitions: 0,
                        activations: 0,
                        perMonthRetentions: zeroArray.slice(),
                        perMonthCountByRetained: zeroArray.slice()
                    };
                }
                var coreActionsInclPostStats = initCoreActionStats();
                var coreActionsExclPostStats = initCoreActionStats();
                var monthlyPostsByCoreActionRetained = zeroArray.slice();

                // storing monthly totals for every specific core action
                var perMonthPerCoreActionTotalsByRetainedDict = {};
                coreActions.coreActionTypesWithSession().forEach(function(actionType) {
                    // init the per-type dicts
                    perMonthPerCoreActionTotalsByRetainedDict[actionType] = zeroArray.slice();
                });

                // we want to aggregate specific per-month data in order to calculate mean/median/etc over them
                function initAggArray() {
                    return STATS_MONTHS.map(function() { return []; });
                }
                // NOTE(mike): all aggregated core-actions include posts
                var aggregateDataByRetained = {
                    monthlyCoreActions: initAggArray(),
                    monthlyTotalSessions: initAggArray(),
                    monthlyTotalSessionSeconds: initAggArray(),
                    monthlyAverageCoreActionsPerSession: initAggArray(),
                    monthlyAverageSecondsPerSession: initAggArray()
                };

                var query = new Parse.Query(UserStats).equalTo('cohort', i);
                return query.each(function(stats) {
                    var monthZeroPostUniqueDaysCount = stats.get('monthZeroPostUniqueDaysCount');
                    var monthlyPostCounts = stats.get('monthlyPostCounts');
                    var monthlyPurchases = stats.get('monthlyPurchases');
                    var monthlyBottlesPurchased = stats.get('monthlyBottlesPurchased');

                    var monthlyCoreActionsInclPosts = stats.get('monthlyCoreActionsInclPosts');
                    var monthZeroUniqueDaysCoreActionsInclPosts = stats.get('monthZeroUniqueDaysCoreActionsInclPosts');

                    var monthlyCoreActionsExclPosts = stats.get('monthlyCoreActionsExclPosts');

                    signups += 1;

                    // wine posts AAR
                    var postAA = checkAcquisitionActivation(monthlyPostCounts[0], monthZeroPostUniqueDaysCount);
                    if (postAA.acquisition) {
                        acquisitions += 1;
                        // count post data only from activations
                        if (postAA.activation) {
                            activations += 1;
                            monthZeroPostsByActivated += monthlyPostCounts[0];
                            monthlyPostCounts.forEach(function(postCount, i) {
                                // retentions start from month 1
                                if (postCount >= 1) {
                                    perMonthRetentions[i] += 1;
                                    perMonthPostsByRetained[i] += postCount;
                                }
                            });
                        }
                    }

                    // count purchase data only from signups who bought something in month 0
                    if (monthlyPurchases[0] >= 1) {
                        monthlyPurchases.forEach(function(purchaseCount, i) {
                            if (purchaseCount >= 1) {
                                perMonthPurchasers[i] += 1;
                            }
                        });
                        monthlyBottlesPurchased.forEach(function(bottles, i) {
                           perMonthBottlesPurchased[i] += bottles;
                        });
                    }

                    var coreActionsAA = checkAcquisitionActivation(monthlyCoreActionsInclPosts[0], monthZeroUniqueDaysCoreActionsInclPosts);
                    var coreActionsInclPostMonthlyRetained = STATS_MONTHS.map(function() { return false; });

                    if (coreActionsAA.acquisition) {
                        coreActionsInclPostStats.acquisitions += 1;
                        if (coreActionsAA.activation) {
                            coreActionsInclPostStats.activations += 1;
                            // incl posts bit
                            monthlyCoreActionsInclPosts.forEach(function(coreActionsCount, i) {
                                if (coreActionsCount >= 1) {
                                    coreActionsInclPostStats.perMonthRetentions[i] += 1;
                                    coreActionsInclPostStats.perMonthCountByRetained[i] += coreActionsCount;
                                    coreActionsInclPostMonthlyRetained[i] = true;
                                }
                            });
                            // excl posts bit
                            monthlyCoreActionsExclPosts.forEach(function(coreActionsCount, i) {
                                if (coreActionsCount >= 1) {
                                    coreActionsExclPostStats.perMonthRetentions[i] += 1;
                                    coreActionsExclPostStats.perMonthCountByRetained[i] += coreActionsCount;
                                }
                            });
                            // extra recalculation of monthly post counts under this new definition of 'coreActionActivated'
                            monthlyPostCounts.forEach(function(postCount, i) {
                                monthlyPostsByCoreActionRetained[i] += postCount;
                            });
                        }
                    }

                    // update per-core-action monthly totals for users in the activation pool
                    coreActions.coreActionTypesWithSession().forEach(function(actionType) {
                        // sum up total coreActions
                        var monthlyCounts = stats.get(coreActionMonthlyUserStatsName(actionType));
                        var perCoreActionTotalsByRetained = perMonthPerCoreActionTotalsByRetainedDict[actionType];
                        monthlyCounts.forEach(function(count, i) {
                            if (coreActionsInclPostMonthlyRetained[i]) {
                                perCoreActionTotalsByRetained[i] += count;
                            }
                        });
                    });

                    function pushMonthlyCount(destArray, srcArray, monthlyRetained, totalSessions) {
                        srcArray.forEach(function(count, i) {
                            // For the per-month stats, we omit a month for a user where their total sessions is 0.
                            // Also only consider data for stats if the user was 'retained' for that month.
                            if (totalSessions[i] >= 1 && monthlyRetained[i]) {
                                destArray[i].push(count);
                            }
                        });
                    }

                    var monthlyTotalSessions = stats.get('monthlyTotalSessionSeconds');
                    pushMonthlyCount(aggregateDataByRetained.monthlyCoreActions, monthlyCoreActionsInclPosts, coreActionsInclPostMonthlyRetained, monthlyTotalSessions);
                    pushMonthlyCount(aggregateDataByRetained.monthlyTotalSessions, stats.get('monthlySessionCount'), coreActionsInclPostMonthlyRetained, monthlyTotalSessions);
                    pushMonthlyCount(aggregateDataByRetained.monthlyTotalSessionSeconds, stats.get('monthlyTotalSessionSeconds'), coreActionsInclPostMonthlyRetained, monthlyTotalSessions);
                    pushMonthlyCount(aggregateDataByRetained.monthlyAverageCoreActionsPerSession, stats.get('monthlyAverageCoreActionsPerSession'), coreActionsInclPostMonthlyRetained, monthlyTotalSessions);
                    pushMonthlyCount(aggregateDataByRetained.monthlyAverageSecondsPerSession, stats.get('monthlyAverageSecondsPerSession'), coreActionsInclPostMonthlyRetained, monthlyTotalSessions);

                }, {useMasterKey: true}).then(function() {
                    return getCohortStats(i).then(function(cohortStats) {
//                        if (signups > 0) {
//                            console.log("Found " + signups + " users in cohort " + i);
//                        }
                        cohortStats.set('cohortDate', dates.cohortDate(i).toDate());
                        cohortStats.set('signups', signups);
                        cohortStats.set('acquisitions', acquisitions);
                        cohortStats.set('activations', activations);
                        cohortStats.set('month0PostsByActivated', monthZeroPostsByActivated);
                        cohortStats.set('monthlyRetentions', perMonthRetentions);
                        cohortStats.set('monthlyPostsByRetained', perMonthPostsByRetained);
                        cohortStats.set('monthlyPurchasers', perMonthPurchasers);
                        cohortStats.set('monthlyBottlesPurchased', perMonthBottlesPurchased);

                        cohortStats.set('coreActionAcquisitions', coreActionsInclPostStats.acquisitions);
                        cohortStats.set('coreActionActivations', coreActionsInclPostStats.activations);
                        cohortStats.set('monthlyCoreActionInclPostsRetentions', coreActionsInclPostStats.perMonthRetentions);
                        cohortStats.set('monthlyCoreActionsInclPostsByRetained', coreActionsInclPostStats.perMonthCountByRetained);
                        cohortStats.set('monthlyCoreActionsExclPostsByRetained', coreActionsExclPostStats.perMonthCountByRetained);
                        cohortStats.set('monthlyPostsByCoreActionRetained', monthlyPostsByCoreActionRetained);

                        // per-core-action total counts
                        coreActions.coreActionTypesWithSession().forEach(function(actionType) {
                            var prettyName = coreActions.prettyNameForActionType(actionType);
                            cohortStats.set('monthly' + prettyName + 'CountByRetained',
                                perMonthPerCoreActionTotalsByRetainedDict[actionType]);
                        });

                        function calcStats(arr) {
                            if (arr.length === 0) {
                                return {
                                    'min': 0,
                                    'max': 0,
                                    'mean': 0,
                                    'median': 0,
                                    'std': 0,
                                    'sum': 0,
                                    'count': 0
                                };
                            } else {
                                return {
                                    'min': math.min(arr),
                                    'max': math.max(arr),
                                    'mean': math.mean(arr),
                                    'median': math.median(arr),
                                    'std': math.std(arr),
                                    'sum': math.sum(arr),
                                    'count': arr.length
                                };
                            }
                        }

                        // arr is an array of months, each month is an array of data,
                        // i.e. an array of arrays
                        function calcStatsForMonths(arr, ignoreZeroes) {
                            return arr.map(calcStats);
                        }

                        var monthlyTotalSessionSecondsStats= calcStatsForMonths(aggregateDataByRetained.monthlyTotalSessionSeconds);
                        cohortStats.set('aggMonthlyCoreActions', calcStatsForMonths(aggregateDataByRetained.monthlyCoreActions));
                        cohortStats.set('aggMonthlyTotalSessions', calcStatsForMonths(aggregateDataByRetained.monthlyTotalSessions));
                        cohortStats.set('aggMonthlyTotalSessionSeconds', monthlyTotalSessionSecondsStats);
                        cohortStats.set('aggMonthlyAverageCoreActionsPerSession', calcStatsForMonths(aggregateDataByRetained.monthlyAverageCoreActionsPerSession));
                        cohortStats.set('aggMonthlyAverageSecondsPerSession', calcStatsForMonths(aggregateDataByRetained.monthlyAverageSecondsPerSession));

                        cohortStats.set('monthlyTotalSessionSecondsByRetained', monthlyTotalSessionSecondsStats.map(function(stats) {
                            return stats.sum;
                        }));

                        return cohortStats.save(null, {useMasterKey: true}).fail(function(err) {
                            var message = "Failed to save cohortStats " + i + " " + JSON.stringify(err);
                            console.log(message);
                            return message;
                        });
                    });
                }, function(err) {
                    var msg = "Regenerating cohorts failed in UserStats.each: " + JSON.stringify(err);
                    console.error(msg);
                    return msg;
                });
            }

            var promises = [];
            var numCohorts = dates.cohortWeek(moment()) + 1;
            for (var i = 0; i < numCohorts; i++) {
                promises.push(processCohort(i));
            }
            return Parse.Promise.when(promises).then(function() {
                return numUserStatsUpdated;
            }, function(error) {
                return "Regenerate cohorts failed: " + JSON.stringify(error);
            });
        }

        return clearStatsForBlockedOrDeletedUsers().then(multiBatchUpdate).then(regenerateCohorts).then(function(numUserStatsUpdated) {
            console.log("User Stats updated " + numUserStatsUpdated + " rows in " + moment().subtract(startTime).seconds() + "s");
            return numUserStatsUpdated;
        });
    }

    function serializeCoreActionStatsInPlace(stats) {
        transformCoreActionStats(stats, true);
    }
    function deserializeCoreActionStatsInPlace(stats) {
        transformCoreActionStats(stats, false);
    }

    function transformCoreActionStats(stats, serialize) {
        _.each(stats, function(x, key) {
            if (!!x.firstDate) {
                x.firstDate = serialize ? x.firstDate.toDate().getTime() : moment(x.firstDate);
            }
            if (!!x.firstDate) {
                x.lastDate = serialize ? x.lastDate.toDate().getTime() : moment(x.lastDate);
            }
            // when deserializing saved buckets, fill in any missing months
            if (!serialize && x.monthlyCount && x.monthlyCount.length < STATS_MONTHS.length) {
                while (x.monthlyCount.length < STATS_MONTHS.length) {
                    x.monthlyCount.push(0);
                }
            }

        });
    }

    // Heavy lifting //

    function updateStatsForUsers(users) {
        return fetchUsersWithStats(users).then(function (users) {
            console.log("Saving new stats for " + users.length + " users");
            return Parse.Promise.when(_.map(users, function (user) {
                var stats = new UserStats();
                USER_TO_STATS_PROJECTIONS.forEach(function (projection) {
                    stats.set(projection[0], projection[1](user));
                });
                // save the core action buckets to checkpoint our progress
                // see fetchCoreActionStats to see how this is used to improve performance
                serializeCoreActionStatsInPlace(user._coreActionStats);
                stats.set('coreActionBuckets', user._coreActionStats);

                function updateMixpanelPeople() {
                    var totalPosts = stats.get('totalPosts');
                    var totalPurchases = stats.get('totalPurchases');

                    return analytics.setPeopleProperties(user, {
                        'Parse user id': user.id,
                        'Week cohort': dates.cohortWeek(user.createdAt),
                        'Wines posted v2': totalPosts,
                        'Wines purchased v2': totalPurchases
                    });
                }

                function saveUserStats() {
                    if (user.has('stats')) {
                        // update existing
                        stats.id = user.get('stats').id;
                        return stats.save(null, {useMasterKey: true});
                    } else {
                        return user.save({'stats': stats}, {useMasterKey: true});
                    }
                }

                return Parse.Promise.when(saveUserStats(), updateMixpanelPeople());
            }));
        }).then(function() {
            return Parse.Promise.as("Created stats for " + arguments.length + " new users");
        });
    }

    /** Computes stats for an array of users. Returns a promise of an array of users with stats attached. */
    function fetchUsersWithStats(users) {
        console.log("Fetching stats for " + users.length + " users");
        var promises = [];
        _.each(users, function (user) {
            var dates = createDateBoundaries(user);
            var postsPromise = fetchPostStats(user, dates);
            var ordersPromise = fetchOrderStats(user, dates);
            var coreActionsPromise = fetchCoreActionStats(user, dates);
            var wineSpecialsPromise = fetchWineSpecialStats(user);

            promises.push(Parse.Promise.when(postsPromise, ordersPromise, coreActionsPromise, wineSpecialsPromise).then(function (posts, orders, coreActions, wineSpecials) {
                user._postStats = posts;
                user._orderStats = orders;
                user._coreActionStats = coreActions;
                user._wineSpecials = wineSpecials;
                return user;
            }));
        });
        return Parse.Promise.when(promises).then(function () {
            return arguments;
        });
    }

    function computeEventCounts(eventDates, dateBoundaries) {
        var eventBucket = initEventBucket();
        eventDates.forEach(function(ed) {
            eventBucketProcessOne(eventBucket, dateBoundaries, ed);
        });
        return eventBucket;
    }

    function initEventBucket() {
        return {
            firstDate: null,
            lastDate: null,
            weekZeroCount: 0,
            weekOneCount: 0,
            monthZeroDays: {},
            monthlyCount: STATS_MONTHS.map(function() { return 0; }),
            totalCount: 0
        };
    }

    function eventBucketProcessOne(eventBucket, dateBoundaries, date) {
        eventBucket.totalCount += 1;
        eventBucket.firstDate = dates.earliest(date, eventBucket.firstDate);
        eventBucket.lastDate = dates.latest(date, eventBucket.lastDate);
        if (date.isBefore(dateBoundaries.endOfWeekZero)) {
            eventBucket.weekZeroCount += 1;
        } else if (date.isBefore(dateBoundaries.endOfWeekOne)) {
            eventBucket.weekOneCount += 1;
        }
        if (date.isBefore(dateBoundaries.endOfMonthX[0])) {
            eventBucket.monthZeroDays[date.clone().startOf('day').format()] = 1;
        }
        for (var i = 0; i <= STATS_LAST_MONTH; i++) {
            if (date.isBefore(dateBoundaries.endOfMonthX[i])) {
                eventBucket.monthlyCount[i] += 1;
                break;
            }
        }
    }

    /** events in format: array of [date, bottles] pairs */
    function computeOrderBottleCounts(events, dateBoundaries) {
        var monthlyCount = STATS_MONTHS.map(function() { return 0; });
        events.forEach(function(event) {
            for (var i = 0; i <= STATS_LAST_MONTH; i++) {
                if (event[0].isBefore(dateBoundaries.endOfMonthX[i])) {
                    monthlyCount[i] += event[1];
                    break;
                }
            }
        });
        return monthlyCount;
    }

    /** Calculates post statistics for a user. Returns a promise. */
    function fetchPostStats(user, dateBoundaries) {
        var postQuery = queries.postsByUser(user);
        postQuery.select(); // No fields
        postQuery.limit(1000);
        return postQuery.find().then(function (posts) {
            var postDates = _.map(posts, function(p) { return moment(p.createdAt); });
            return computeEventCounts(postDates, dateBoundaries);
        });
    }

    /** Calculates order statistics for a user. Returns a promise. */
    function fetchOrderStats(user, dateBoundaries) {
        var ordersQuery = new Parse.Query(Order);
        ordersQuery.equalTo('user', user);
        ordersQuery.notEqualTo("deleted", true);
        ordersQuery.select('status', 'bottle');
        ordersQuery.limit(1000);
        return ordersQuery.find().then(function (orders) {
            var orderSplit = orders.map(function(order) {
                var bottles = order.get('bottle');
                if (isOrderComplete(order)) {
                    return [moment(order.createdAt), bottles];
                } else {
                    return undefined;
                }
            }).filter(function(x) { return x !== undefined; });
            var orderStats = computeEventCounts(orderSplit.map(_.first), dateBoundaries);
            orderStats.monthlyBottlesPurchased = computeOrderBottleCounts(orderSplit, dateBoundaries);
            return orderStats;
        });
    }

    /**
     * For each of the core actions, create per-event-type buckets.
     * Also create two global buckets to form 'core actions' as a whole,
     * one including posts and one excluding posts.
     */
    function fetchCoreActionStats(user, dateBoundaries) {
        // dict keyed by actionType
        var stats = {};

        // For performance-reasons we store the previous buckets in the UserStats. FYI the passed-in user
        // has already included the stats field for use here. The aim is to load up previously computed
        // event-buckets and then fetch only new data to add to these buckets. 'New' is determined by the
        // date of the last event processed in the previous run. Recomputing these buckets from scratch
        // will likely be very slow on production with the sheer amount of mixpanel events and will only
        // get slower over time.
        var userStats = user.get('stats');
        if (!!userStats && userStats.has('coreActionBuckets')) {
            stats = userStats.get('coreActionBuckets');
            deserializeCoreActionStatsInPlace(stats);
        } else {
            coreActions.coreActionTypesWithSession().forEach(function(actionType) {
                stats[actionType] = initEventBucket();
            });
            stats.globalInclPosts = initEventBucket();
            stats.globalExclPosts = initEventBucket();
            stats.monthlyTotalSessionSeconds = STATS_MONTHS.map(function() { return 0; });
            stats.posts = initEventBucket();
        }

        var lastActionDates = {};
        coreActions.coreActionTypesWithSession().forEach(function(actionType) {
            lastActionDates[actionType] = stats[actionType].lastDate;
        });

        var actionsPromise = coreActions.fetchCoreActionsAndSessionsForUser(user, lastActionDates, function(action) {
            var date = action.timestamp;
            var actionType = action.actionType;

            eventBucketProcessOne(stats[actionType], dateBoundaries, date);

            if (actionType === 'Session') {
                handleSessionLength(stats, action, date, dateBoundaries);
            } else {
                eventBucketProcessOne(stats.globalExclPosts, dateBoundaries, date);
                eventBucketProcessOne(stats.globalInclPosts, dateBoundaries, date);
            }
        });

        var postQuery = queries.postsByUser(user);
        postQuery.select();
        if (!!stats.posts.lastDate) {
            postQuery.greaterThan('createdAt', stats.posts.lastDate.toDate());
        }

        var postsPromise = postQuery.each(function(post) {
            var date = moment(post.createdAt);
            eventBucketProcessOne(stats.posts, dateBoundaries, date);
            eventBucketProcessOne(stats.globalInclPosts, dateBoundaries, date);
        }, {useMasterKey: true});

        return Parse.Promise.when(actionsPromise, postsPromise).then(function() {
            return stats;
        });
    }

    function fetchWineSpecialStats(user) {
        var stats = {
            'sent': [],
            'daysSinceFirstPush': [],
            'appOpened': [],
            'dealClicked': [],
            'buyWineBegin': [],
            'buyWineComplete': []
        };

        var query = new Parse.Query('WineSpecial')
            .equalTo('user', user)
            .exists('sentDate')
            .ascending('sentDate')
            .limit(1000);

        return query.find({useMasterKey: true}).then(function(wineSpecials) {
            var dateOfFirstPush = wineSpecials.length > 0 && wineSpecials[0].get('sentDate') || undefined;
            wineSpecials.forEach(function(wineSpecial) {
                var sentDateDiff = moment(wineSpecial.get('sentDate')).diff(dateOfFirstPush);
                var sentDateDiffDays = moment.duration(sentDateDiff).days();
                stats.sent.push(1);
                stats.daysSinceFirstPush.push(sentDateDiffDays);
                stats.appOpened.push(wineSpecial.get('userOpenedApp') ? 1 : 0);
                stats.dealClicked.push(wineSpecial.get('userDealClicked') ? 1 : 0);
                stats.buyWineBegin.push(wineSpecial.get('userBuyWineBegin') ? 1 : 0);
                stats.buyWineComplete.push(wineSpecial.get('userBuyWineComplete') ? 1 : 0);
            });
            return stats;
        });
    }

    function handleSessionLength(stats, action, date, dateBoundaries) {
        var sessionLengthSeconds = action.properties.sessionLengthSeconds;
        for (var i = 0; i <= STATS_LAST_MONTH; i++) {
            if (date.isBefore(dateBoundaries.endOfMonthX[i])) {
                stats.monthlyTotalSessionSeconds[i] += sessionLengthSeconds;
                break;
            }
        }
    }

    // Helpers //

    // check docs on ORDER_DATE_THRESHOLD to explain this business logic
    function isOrderComplete(order) {
        var needStatusCheck = moment(order.createdAt).isBefore(ORDER_DATE_THRESHOLD);
        return (!needStatusCheck || order.get('status') === 'completed');
    }

    function getCohortStats(cohortWeek) {
        return new Parse.Query(CohortStats).equalTo('cohortWeek', cohortWeek).first({useMasterKey: true}).then(function(cohortStats) {
            if (!cohortStats) {
                cohortStats = new CohortStats();
                cohortStats.set('cohortWeek', cohortWeek);
            }
            return cohortStats;
        });
    }

    /** Calculates week and month boundaries from a user's signup date. */
    function createDateBoundaries(user) {
        var endOfWeekZero = moment(user.createdAt).add(7, 'days');
        var endOfWeekOne = endOfWeekZero.clone().add(7, 'days');

        var endOfMonthX = STATS_MONTHS.map(function(i) {
            // e.g. month 0 is at the end of 30 days
            return moment(user.createdAt).add(30 * (i + 1), 'days');
        });
        return {
            endOfWeekZero: endOfWeekZero,
            endOfWeekOne: endOfWeekOne,
            endOfMonthX: endOfMonthX
        };
    }

    // check if the user fits into the acquisition and activation categories
    function checkAcquisitionActivation(monthZeroCount, monthZeroUniqueDays) {
        var result = {
            acquisition: false,
            activation: false
        };
        if (monthZeroCount >= 1) {
            result.acquisition = true;
            if (monthZeroUniqueDays >= 2) {
                result.activation = true;
            }
        }
        return result;
    }
})();
