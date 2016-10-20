/**
 * Wine-searcher.com requests
 */

var exports;

(function () {
    "use strict";
    var _ = require('underscore');

    var API_URL = 'http://api.wine-searcher.com/wine-select-api.lml';
    var MIN_REFRESH_MS = 90 * (24 * 60 * 60 * 1000); // 90 days

    var KEYWORD_MODE = {
        NAMES_LIST: "X",
        PRICES_LIST: "A",
        PRICES_LIST_WIDE: "U"
    };
    var WIDESEARCH = {
        YES: "Y",
        NO: "V"
    };

    var BASE_PARAMS = {
        Xkey: "vnsxxx881854",
        Xcurrencycode: "AUD",
        Xformat: "J"
    };

    var Wine = Parse.Object.extend('Wine');

    // Finds price of the youngest vintage for a wine
    function findLatestPrice(searchKeyword) {
        var params = _.extend({}, BASE_PARAMS, {
            Xwinename: searchKeyword,
            Xlocation: 'Australia',
            Xkeyword_mode: KEYWORD_MODE.PRICES_LIST_WIDE,
            Xwidesearch: WIDESEARCH.NO, // Require exact match
            Xwinecount: '24'
        });

        return Parse.Cloud.httpRequest({url: API_URL, params: params})
            .then(function (httpResponse) {
                var data = JSON.parse(httpResponse.text);

                var records = [];
                if (data['wine-searcher']['return-code'] === '0') {
                    records = data["wine-searcher"]['wine-vintages'];
                    if (!records) {
                        console.log('Failed to get wine vintages for wine "' + searchKeyword + '"');
                        console.log(params);
                        console.log(data);
                        var p = new Parse.Promise();
                        p.reject();
                        return p;
                    }
                }

                var youngestVintage;
                records.forEach(function (wrapper) {
                    var record = wrapper['wine-vintage'];
                    var recordVintage = parseInt(record.vintage, 10);
                    var isGoodRecord = recordVintage > 0 && isNumeric(record['price-average']);
                    if (isGoodRecord) {
                        if (youngestVintage === undefined) {
                            youngestVintage = record;
                        } else if (recordVintage > parseInt(youngestVintage.vintage, 10)) {
                            youngestVintage = record;
                        }
                    }
                });

                return youngestVintage;
            }, function (err) {
                console.error('Winesearcher vintages request failed with: ' + err);
                return Parse.Promise.error('Winesearch vintages request failed');
            });
    }

    function setLatestPrice(wine) {
        var lastFetched = wine.get('wsLastFetched');
        var keyword = wine.get('searchkeyword');
        if (keyword === "NF") { keyword = null; }
        if (!!keyword && (!lastFetched || Date.now() - lastFetched.getTime() > MIN_REFRESH_MS)) {
            return findLatestPrice(keyword).then(function(vintage) {
                Parse.Cloud.useMasterKey();
                if (vintage) {
                    wine.set('wsLastFetched', new Date());
                    wine.set('wsLastVintage', vintage['vintage']);
                    wine.set('wsPriceAverage', vintage['price-average']);
                    wine.set('wsPriceMin', vintage['price-min']);
                    wine.set('wsPriceMax', vintage['price-max']);
                    console.log("Updating latest vintage price for wine " + wine.id + ", [" + keyword +
                        "]: " + JSON.stringify(vintage));
                } else {
                    wine.set('wsLastFetched', new Date());
                    wine.unset('wsLastVintage');
                    wine.unset('wsPriceAverage');
                    wine.unset('wsPriceMin');
                    wine.unset('wsPriceMax');
                    console.log("Couldn't find latest vintage price for wine " + wine.id + ", [" + keyword + "]");
                }
                return wine.save();
            }, function() {
                var msg = 'Failed to update wine: ' + wine.id;
                console.log(msg);
                return msg;
            });
        } else {
            console.log("No keyword or too recently fetched to update wine " + wine.id + ", [" + keyword + "]");
            return Parse.Promise.as(null);
        }
    }

    Parse.Cloud.job("fetchRecentWinePrices", function(request, status) {
        Parse.Cloud.useMasterKey();

        function refreshPrices(wines) {
            console.log("Refreshing prices for wines: " + _.map(wines, function(wine) {return wine.id;}));
            var promises = wines.map(setLatestPrice);
            return Parse.Promise.when(promises);
        }

        var neverFetched = new Parse.Query(Wine);
        neverFetched.doesNotExist('wsLastFetched');
        var old = new Parse.Query(Wine);
        old.lessThan('wsLastFetched', new Date(Date.now() - MIN_REFRESH_MS));

        // /.{4}/ heuristic for search keywords that could actually have a unique result.
        // Explicitly excluding empty and "NF".
        var q = Parse.Query.or(neverFetched, old)
            .matches('searchkeyword', '.{4}.*')
            .descending('updatedAt')
            .limit(request.params.limit || 10);
        q.find().then(function (wines) {
            return refreshPrices(wines);
        }).then(function (/*wine1, wine2, ...*/) {
            //var toLog = _.map(arguments, function(wine) {
            //    return {"id": wine.id, "vintage": wine.get("wsLastVintage"), "avgPrice": wine.get("wsPriceAverage")};
            //});
            //console.log("fetchRecentWinePrices success: " + JSON.stringify(toLog));
            status.success("Updated " + arguments.length + " wines");
        }, function (err) {
            //console.error("fetchRecentWinePrices failed: " + err);
            status.error(JSON.stringify(err));
        });
    });

    exports.minRefreshMs = MIN_REFRESH_MS;

    // Searches for wine details for console operator attribute
    exports.searchWine = function (wineName, vintage, exact) {
        var params = _.extend({}, BASE_PARAMS, {
            Xkeyword_mode: KEYWORD_MODE.NAMES_LIST,
            Xwinename: wineName,
            Xvintage: vintage

        });
        if (!exact) {
            params.Xwidesearch = WIDESEARCH.YES;
        }

        return Parse.Cloud.httpRequest({url: API_URL, params: params})
            .then(function (httpResponse) {
                var data = JSON.parse(httpResponse.text);
                var wineNames = [];
                if (data["wine-searcher"]["return-code"] === "0") {
                    wineNames = data["wine-searcher"].names;
                }
                return wineNames;
            }, function (err) {
                console.error('Winesearcher request failed with: ' + err);
                return Parse.Promise.error('Winesearch request failed');

            });
    };

    exports.getWinePrice = function(keyword, vintage) {
        var params = _.extend({}, BASE_PARAMS, {
            Xwinename: keyword,
            Xlocation: "Australia",
            Xkeyword_mode: KEYWORD_MODE.PRICES_LIST_WIDE,
            Xwinecount:"24"
        });

        if (vintage && (vintage.length === 4 || vintage === "NV")) {
            params.Xvintage = vintage;
        }

        return Parse.Cloud.httpRequest({url: API_URL, params: params})
            .then(function (httpResponse) {
                var data = JSON.parse(httpResponse.text);

                var returnCode = data['wine-searcher']['return-code'];
                if (returnCode === "1") {
                    // Continue, with zero results
                    console.log("No results for wine price query '" + keyword + '" ' + vintage);
                } else if (returnCode !== "0") {
                    console.error("Wine searcher price request rejected: " + JSON.stringify(data['wine-searcher']));
                    return Parse.Promise.error("Wine searcher price request rejected");
                }

                var winelist = [];
                var wineResults = data["wine-searcher"].wines || [];
                for (var wineno = 0; wineno < wineResults.length; ++wineno) {
                    var thisResult = wineResults[wineno].wine;
                    var merchant = thisResult["merchant"];
                    var merchantDescription = thisResult["merchant-description"];
                    var price = thisResult["price"];
                    var bottleSize = thisResult["bottle-size"];

                    // Determine minimum order quantity for each listing
                    var conditions = "N/A";
                    if (merchantDescription.toLowerCase().indexOf("no minimum") > -1) {
                        conditions = 1;
                    } else if (merchantDescription.indexOf("6") > -1) {
                        conditions = 6;
                    } else if (merchantDescription.indexOf("12") || merchantDescription.toLowerCase().indexOf("minimum order of 1 case") > -1) {
                        conditions = 12;
                    }

                    // Check what is the basis for the pricing provided, i.e. per bottle, per case 6, per case 12.
                    // If prices are for half bottles, (include string "H/B") then return "N/A".

                    var pricebasis = "N/A";
                    if (bottleSize.indexOf("H/B") > -1) {
                        pricebasis = "N/A";
                    } else if (bottleSize.indexOf("12") > -1) {
                        pricebasis = 12;
                    } else if (bottleSize.indexOf("6") > -1) {
                        pricebasis = 6;
                    } else if (bottleSize.match(/^Bottle$/)) {
                        pricebasis = 1;
                    }

                    //the true minimum order is in most cases contained in the "merchant-description"
                    //key (in this field it might say for example "Minimum order of 6 botles").
                    //However sometimes the "merchant-description" key says "no minimum", but then
                    //the pricing is given for 6 or 12 bottles, which means really the minimum order
                    //is not 1 bottle but rather the 6 or 12 on which the pricing is based.
                    //So, the below max function picks the largest value from the
                    //"merchant-description" and the "bottle-size" key and sets it as the true
                    //minimum order

                    var minimumOrder = Math.max(conditions, pricebasis);

                    //this puts the pricing on the same basis, i.e. $ per bottle.  Sometimes pricing
                    //is provided $ per case of 6, or 12 etc., so this makes it all comparable
                    var pricePerBottle = price / pricebasis;

                    //Sometimes a wine in the JSON data is not on a 1, 6, or 12 bottle basis, e.g.
                    //sometimes the wine is on a half bottle basis.  The above code returns N/A
                    //when this happens.  In the if/else below, these N/A wines are skipped when
                    //the script is dumping the parsed JSON data into the winelist array
                    if (isNumeric(minimumOrder) && isNumeric(pricePerBottle)) {
                        winelist.push(new Realwine(merchant, pricePerBottle, minimumOrder));
                    }
                }

                var singlePrice = 0;
                var boxPrice = 0;
                var dozenPrice = 0;

                for (var i = 0; i < winelist.length; i++) {
                    if (winelist[i].minimumorder === 1) {
                        if (singlePrice === 0) { singlePrice = winelist[i].pricepb * 1; }
                        else { singlePrice = Math.min(singlePrice, winelist[i].pricepb * 1); }
                        }

                    if (winelist[i].minimumorder <= 6) {
                        if (boxPrice === 0) { boxPrice = winelist[i].pricepb * 1; }
                        else { boxPrice = Math.min(boxPrice, winelist[i].pricepb * 1); }
                        }

                    if (dozenPrice === 0) { dozenPrice = winelist[i].pricepb * 1; }
                    else { dozenPrice = Math.min(dozenPrice, winelist[i].pricepb * 1); }
                    }

                var finalResult = {
                    retailers: winelist
                };
                if (singlePrice !== 0) {
                    finalResult[1] = singlePrice.toFixed(2);
                }
                if (boxPrice !== 0) {
                    finalResult[6] = boxPrice.toFixed(2);
                }
                if (dozenPrice !== 0) {
                    finalResult[12] = dozenPrice.toFixed(2);
                }
                return finalResult;
            }, function (err) {
                console.error("Wine searcher price request failed with:" + err);
                return Parse.Promise.error("Wine searcher price request failed");
            });
    };

    exports.findLatestPrice = function (searchKeyword) {
        return findLatestPrice(searchKeyword);
    };

    exports.findAndStoreLatestPrice = function(wine) {
        return setLatestPrice(wine);
    };

    function Realwine(merchant, pricepb, minimumorder) {
        this.merchant = merchant;
        this.pricepb = pricepb.toFixed(2);
        this.minimumorder = minimumorder;
    }

    function isNumeric(str) {
        var n = parseFloat(str);
        return !isNaN(n) && isFinite(n);
    }
})();

