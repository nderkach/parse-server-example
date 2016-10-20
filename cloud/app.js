// Serves pages that act as targets for sharing wines on social networks.

var express = require('express');
var moment = require('moment');
var env = require('./cloud/env.js').env;
var dashboard = require('./cloud/dashboard.js');

// Initialise express
var app = express();

// Initialise app
app.set('views', './cloud/views');
app.set('view engine', 'ejs');
app.use(express.bodyParser());

var termsOfServicePath = '/terms-of-service';
var privacyPolicyPath = '/privacy-policy';

// Routing
app.get('/', homepageRedirect(''));
app.get(termsOfServicePath, homepageRedirect(termsOfServicePath));
app.get(privacyPolicyPath, homepageRedirect(privacyPolicyPath));
app.get('/mobile-terms', homepageRedirect(termsOfServicePath));
app.get('/mobile-privacy-policy', homepageRedirect(privacyPolicyPath));
app.get('/invite', inviteHandler);
app.get('/wine/:postId', postHandler);
app.get('/:postId', postHandler);
app.get('/dashboard/users', express.basicAuth('admin', '104commonwealth'), dashboard.usersHandler);
app.get('/dashboard/clearStats', express.basicAuth('admin', '104commonwealth'), dashboard.clearStatsHandler);
app.get('/dashboard/cohortStats', express.basicAuth('admin', '104commonwealth'), dashboard.cohortStatsHandler);
app.get('/dashboard/statsUpdateJob', express.basicAuth('admin', '104commonwealth'), dashboard.statsUpdateJob);
app.get('/dashboard/userStatsCounts', express.basicAuth('admin', '104commonwealth'), dashboard.userStatsCountsHandler);
app.get('/dashboard/appAnnieTest', express.basicAuth('admin', '104commonwealth'), dashboard.appAnnieTestHandler);
app.get('/dashboard/mixpanelTest', express.basicAuth('admin', '104commonwealth'), dashboard.mixpanelTestHandler);
app.post('/dashboard/updateFacebookToken', express.basicAuth('admin', '104commonwealth'), dashboard.updateFacebookTokenHandler);

// Handlers

// Used for redirecting homepage-related paths to www.getvinus.com, the setup is like so:
// 1) getvinus.com DNS pointed at vinus.parseapp.com for the purpose of viewing server-side template wine posts
// 2) www.getvinus.com is a website hosted on appsites.com
//
// These redirects exist because if people accidentally type the wrong url (skip the www) or if there are
// dangling links out there which don't have www, they will still work. Before this change was done the homepage
// was actually hosted on getvinus.com and NOT www.getvinus.com, since we're hijacking the original domain then
// this will make the transition more seamless.
function homepageRedirect(path) {
    'use strict';
    return function(req, res) {
        res.redirect(307, env.vinusHomeUrl + path);
    };
}

// trampoline for prettier-looking appsflyer link
function inviteHandler(req, res) {
    'use strict';

    var pid = req.params.pid;
    var c = req.params.c;

    res.redirect(307, 'http://app.appsflyer.com/id661997423?pid=' + pid + '&c=' + c);
}

function postHandler(req, res) {
    'use strict';
    var query = new Parse.Query("Post");
    query.include("wine").include("owner");
    query.get(req.params.postId)
        .then(function(post) {
            var template = isMobileBrowser(req) ? 'wine-mobile' : 'wine';
            var wine = post.get("wine");
            var owner = post.get("owner");
            var title = wine ? wine.get("name") + " " + wine.get("vintage") + " " + wine.get("varietal") : "Wine shared via Vinus app";
            var content = post.get("post_content") || "";
            res.render(template, {
                env: env,
                postId: post.id,
                title: title,
                displayTime: moment(new Date(post.createdAt)).fromNow(),
                imageUrl: post.get("post_image"),
                wineName: !!wine ? wine.get("name") : null,
                wineMaker: !!wine ? wine.get("maker") : null,
                ownerName: owner.get("firstname"),
                content: post.get("post_content") || "",
                iosAppUrl: 'http://app.appsflyer.com/id661997423?pid=uniqueURLs&c=' + req.params.postId
            });
        }, function(err) {
            res.redirect(307, env.vinusHomeUrl);
        });
}


// Attach the Express app to Cloud Code.
app.listen();

// From http://detectmobilebrowsers.com/
function isMobileBrowser(req) {
    var ua = req.get('User-Agent').toLowerCase();
    return (/(android|bb\d+|meego).+mobile|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od)|iris|kindle|lge |maemo|midp|mmp|mobile.+firefox|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series(4|6)0|symbian|treo|up\.(browser|link)|vodafone|wap|windows (ce|phone)|xda|xiino/i.test(ua)||/1207|6310|6590|3gso|4thp|50[1-6]i|770s|802s|a wa|abac|ac(er|oo|s\-)|ai(ko|rn)|al(av|ca|co)|amoi|an(ex|ny|yw)|aptu|ar(ch|go)|as(te|us)|attw|au(di|\-m|r |s )|avan|be(ck|ll|nq)|bi(lb|rd)|bl(ac|az)|br(e|v)w|bumb|bw\-(n|u)|c55\/|capi|ccwa|cdm\-|cell|chtm|cldc|cmd\-|co(mp|nd)|craw|da(it|ll|ng)|dbte|dc\-s|devi|dica|dmob|do(c|p)o|ds(12|\-d)|el(49|ai)|em(l2|ul)|er(ic|k0)|esl8|ez([4-7]0|os|wa|ze)|fetc|fly(\-|_)|g1 u|g560|gene|gf\-5|g\-mo|go(\.w|od)|gr(ad|un)|haie|hcit|hd\-(m|p|t)|hei\-|hi(pt|ta)|hp( i|ip)|hs\-c|ht(c(\-| |_|a|g|p|s|t)|tp)|hu(aw|tc)|i\-(20|go|ma)|i230|iac( |\-|\/)|ibro|idea|ig01|ikom|im1k|inno|ipaq|iris|ja(t|v)a|jbro|jemu|jigs|kddi|keji|kgt( |\/)|klon|kpt |kwc\-|kyo(c|k)|le(no|xi)|lg( g|\/(k|l|u)|50|54|\-[a-w])|libw|lynx|m1\-w|m3ga|m50\/|ma(te|ui|xo)|mc(01|21|ca)|m\-cr|me(rc|ri)|mi(o8|oa|ts)|mmef|mo(01|02|bi|de|do|t(\-| |o|v)|zz)|mt(50|p1|v )|mwbp|mywa|n10[0-2]|n20[2-3]|n30(0|2)|n50(0|2|5)|n7(0(0|1)|10)|ne((c|m)\-|on|tf|wf|wg|wt)|nok(6|i)|nzph|o2im|op(ti|wv)|oran|owg1|p800|pan(a|d|t)|pdxg|pg(13|\-([1-8]|c))|phil|pire|pl(ay|uc)|pn\-2|po(ck|rt|se)|prox|psio|pt\-g|qa\-a|qc(07|12|21|32|60|\-[2-7]|i\-)|qtek|r380|r600|raks|rim9|ro(ve|zo)|s55\/|sa(ge|ma|mm|ms|ny|va)|sc(01|h\-|oo|p\-)|sdk\/|se(c(\-|0|1)|47|mc|nd|ri)|sgh\-|shar|sie(\-|m)|sk\-0|sl(45|id)|sm(al|ar|b3|it|t5)|so(ft|ny)|sp(01|h\-|v\-|v )|sy(01|mb)|t2(18|50)|t6(00|10|18)|ta(gt|lk)|tcl\-|tdg\-|tel(i|m)|tim\-|t\-mo|to(pl|sh)|ts(70|m\-|m3|m5)|tx\-9|up(\.b|g1|si)|utst|v400|v750|veri|vi(rg|te)|vk(40|5[0-3]|\-v)|vm40|voda|vulc|vx(52|53|60|61|70|80|81|83|85|98)|w3c(\-| )|webc|whit|wi(g |nc|nw)|wmlb|wonu|x700|yas\-|your|zeto|zte\-/i.test(ua.substr(0,4)));
}
