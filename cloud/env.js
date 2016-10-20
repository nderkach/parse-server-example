/**
 * Environment-specific configuration.
 */

var exports;

(function() {
    if (Parse.applicationId === "btM2JJTWRxOJR87pAsE7V79XEbznb3GHZLbB07zy") {
        exports.env = {
            name: "prod",
            vinusHomeUrl: "http://www.getvinus.com",
            vinusShareHost: "getvinus.com",
            emailFromAddress: "hello@getvinus.com",
            adminUserEmail: "support@vinus.net.au",
            wineTeamEmail:"111117recognition@getvinus.com",
            mixpanelApiToken: "2071b0d7968b71c09aee3bedcd838f3e",
            mixpanelApiKey: "e0e1f77298ef7df2fccda4dc9a9b90db",
            mixpanelApiSecret: "f1a9c803899ceaadce3f8d1546e47237",
            slackNewNotificationURL: 'https://hooks.slack.com/services/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',
            slackNewOrderURL:'https://hooks.slack.com/services/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'
        };
    } else {
        exports.env = {
            name: "dev",
            vinusHomeUrl: "http://www.getvinus.com",
            vinusShareHost: "vinus-dev.parseapp.com",
            emailFromAddress: "support@vinus.net.au",
            adminUserEmail: "blackhole@firstorder.com.au",
            wineTeamEmail:"blackhole@firstorder.com.au",
            mixpanelApiToken: "27c1f702eda499a92557db01f82d876e",
            mixpanelApiKey: "416f5c3731db0ceabb709662ffcaa649",
            mixpanelApiSecret: "05565232fad3b5531e0d363b103051e9",
            emailCatchAll: "alex@vinus.net.au",
            slackNewNotificationURL: 'https://hooks.slack.com/services/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',
            slackNewOrderURL:'https://hooks.slack.com/services/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'
        };
    }
//    console.log("Environment: " + exports.env.name);
})();
