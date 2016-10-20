
// Load web app
require('./app.js');

var _ = require('underscore');
var env = require('./env.js').env;
var auth = require('./auth.js');
var api = require('./api.js');
var admin = require('./admin.js');
var r = require('./requests.js');
var analytics = require('./analytics.js');
var dashboard = require('./dashboard.js');
var coreActions = require('./coreActions.js');
var wineSearch = require('./wineSearch.js'); // registers background job
var mixpanelExperiments = require('./mixpanelExperiments.js');
var notifications = require('./notifications.js');
var migrations = require('./migrations.js'); // registers background jobs
var wineSpecials = require('./wineSpecials.js'); // registers background job
var slackHooks = require('./slack-hooks.js');//sends notifications to slack

var allPosts;
var results = [];

// Expose API methods as cloud calls
_.each(api, function(exported, name) {
    'use strict';
    Parse.Cloud.define(name, exported);
});


// A method for calling from command-line for testing things.
Parse.Cloud.define("debug", function(request, response) {
    auth.requireAdmin(request.user).then(function() {
        response.success("ok");
    }, r.fail(response));
});

Parse.Cloud.define("migrateUserLifecycles", function(request, response) {
    function doMigration() {
        var query = new Parse.Query('User');
        query.doesNotExist('lifecycle');
        var promise = query.find({useMasterKey: true}).then(function(users) {
            var promises = [];
            users.forEach(function(user) {
                var lifecycle = {};
                lifecycle.welcomeEmailSent = true;
                if (user.get("signupsource") === "facebook") {
                    lifecycle.facebookInviteAttributed = true;
                    lifecycle.facebookFriendJoinedEmailsSent = true;
                }
                var promise = user.save({lifecycle: lifecycle});
                promises.push(promise);
            });
            return Parse.Promise.when(promises).then(function() {
                return users.length;
            });
        });
        promise.then(function(n) {
            response.success("Migrated " + n + " users.");
        }, function(error) {
            response.error(error);
        });
    }

    if (request.params.password === "9f3ja3mfafa2n4asd") {
        doMigration();
    } else {
        response.error("Rejected");
    }
});

function continueFetchNextWineFromPost(posts,callback){
    //remove posts from allPosts
    for(var i=0; i<posts.length; i++){
        allPosts.remove(posts[i]);
    }
    //no more post, return
    if(allPosts.length==0){
        callback(results);
    }else{
        fetchWineFromPost(allPosts.at(0),callback);
    }
}

function fetchWineFromPost(post,callback){
    var wine = post.get('wine');
    //When the post is not linked to wine, continue to next post
    if(wine)
        wine.fetch(
            {success:function(wine){
                results.push(wine);
                //remove all posts that link to wine. So won't fetch the wine again from post
                var queryP = new Parse.Query("Post");
                queryP.equalTo('wine',wine);
                queryP.find({
                    success:function(posts){
                        continueFetchNextWineFromPost(posts,callback);
                    }
                });
            }},
            {error:function(wine,error){throw "Fail to fetch wine:"+error.message;}}
        );
    else{
        var postArr = new Array(post);
        continueFetchNextWineFromPost(postArr,callback);
    }
}

function fetchUserFromPost(post,callback){
    var user = post.get('owner');
    user.fetch(
        {success:function(user){
            results.push(user);
            //remove all posts that link to wine. So won't fetch the wine again from post
            var queryP = new Parse.Query("Post");
            queryP.equalTo('owner',user);
            queryP.find({
                success:function(posts){
                    //remove posts from allPosts
                    for(var i=0; i<posts.length; i++){
                        allPosts.remove(posts[i]);
                    }
                    //no more post, return
                    if(allPosts.length==0){
                        callback(results);
                    }else{
                        fetchUserFromPost(allPosts.at(0),callback);
                    }
                }
            });
        }},
        {error:function(wine,error){throw "Fail to fetch user:"+error.message;}}
    );
}

function privateEmail(fromEmail, fromName, toEmail, toName, content, subject, successCall, failCall){
    if (!!env.emailCatchAll) {
        console.log("send email from " + fromEmail + " to " + toEmail);
        toName = toName + ' ' + '<' + toEmail + '>';
        toEmail = env.emailCatchAll;
    }
    var mandrill = require('mandrill');
    mandrill.initialize('9ra0oQpnlEkKzeeAhtVS-Q'); //account with Mandrill under serviceproviders@getvinus.com
    content = content.replace(/©/g,"&#169;").replace(/é/g,"&#233;");
    mandrill.sendEmail({
        message : {
            html:content,
            subject : subject,
            from_email : fromEmail,
            from_name : fromName,
            to : [ {
                email : toEmail,
                name : toName
            } ]
        },
        async : true
    }, {
        success : function(httpResponse) {
            console.log("Email sent to " + toEmail + " subject: " + subject);
            successCall();
        },
        error : function(httpResponse) {
            console.log("Failed to send email to " + toEmail + " subject: " + subject);
            failCall();
        }
    });
};

//same as privateEmail function but accepts an array for recipients in order to send emails to more than one receipient.  Used for New Wine email so we can notify contractors when a new wine is submitted
function arrayEmail(fromEmail, fromName, toArray, content, subject, successCall, failCall){
    var receiversStr = toArray.map(function(emailObj) { return emailObj.email; }).join(',');
    if (!!env.emailCatchAll) {
        console.log("send email from " + fromEmail + " to " + receiversStr);
        toArray = [{
            name: 'DevCatchAll',
            email: env.emailCatchAll
        }];
    }
    var mandrill = require('mandrill');
    mandrill.initialize('9ra0oQpnlEkKzeeAhtVS-Q'); //account with Mandrill under serviceproviders@getvinus.com
    content = content.replace(/©/g,"&#169;").replace(/é/g,"&#233;");
    mandrill.sendEmail({
        message : {
            html:content,
            subject : subject,
            from_email : fromEmail,
            from_name : fromName,
            to : toArray
        },
        async : true
    }, {
        success : function(httpResponse) {
            console.log("Email sent to " + receiversStr + " subject: " + subject);
            successCall();
        },
        error : function(httpResponse) {
            console.log("Failed to send email to " + receiversStr + " subject: " + subject);
            failCall();
        }
    });
}

function slackAdHocMessage(text,url){
    return Parse.Cloud.httpRequest({
            method:'POST',
            url:url,
            headers: {
                'Content-Type' : 'application/json'
            },    
            body:{
                'text' : text
            }
        }).then(function(httpResponse){
            console.log('Slack message sent');
        },function(httpResponse){
            console.error('Slack request failed with response code '+httpResponse.status);
    });   
}

//Cloud functions

// Search wine for console operator classification
Parse.Cloud.define("searchWine",function(request,response){
    var promise = wineSearch.searchWine(request.params.wineName, request.params.vintage, request.params.exact);
    promise.then(function(wineNames) {
        response.success(JSON.stringify(wineNames));
    }, function(err) {
        response.error(err);
    });
});

Parse.Cloud.define("getUsersFromWine", function(request, response) {
    var wineId = request.params.wineId;
    var query = new Parse.Query("Wine");
    query.get(wineId,{success:function(wine){
        var queryP = new Parse.Query("Post");
        queryP.equalTo("wine", wine);
        queryP.find({
            success : function(posts) {
                if(posts.length==0)
                    response.success([]);
                else{
                    allPosts = new Parse.Collection(posts);
                    fetchUserFromPost(allPosts.at(0), function() {
                        response.success(results);
                    });
                }
            }
        }, {
            error : function(wine, error) {
                throw "Fail to get wine from id:" + error.message
            }
        })
    }});
});

Parse.Cloud.define("getWinesFromUser", function(request, response) {
    var userId = request.params.userId;
    var User = new Parse.Object.extend("User");
    var user = new User();
    user.id = userId;

    var queryP = new Parse.Query("Post");
    queryP.equalTo("owner", user);
    queryP.find({
        success : function(posts) {
            if(posts.length==0)
                response.success([]);
            else {
                allPosts = new Parse.Collection(posts);
                fetchWineFromPost(allPosts.at(0), function() {
                    response.success(results);
                });
            }
        }
    },{
        error:function(user,error){throw "Fail to get user from id:"+error.message}
    });
});

Parse.Cloud.define("sendEmail", function(request, response) {
    auth.requireAdmin(request.user).then(function() {
        var toUser = request.params.toUser;
        var toEmail = request.params.toEmail;
        var subject = request.params.subject;
        var content = request.params.content;
        privateEmail(env.emailFromAddress, "Vinus", toEmail, toUser, content, subject, function(){
            response.success("Email sent!");
        }, function(){
            response.error("Uh oh, something went wrong");
        });
    }, r.fail(response));
});

Parse.Cloud.define("removeOrder", function(request, response) {
    var orderId = request.params.orderId;
    var query = new Parse.Query("Order");

    query.get(orderId,{
        success:function(order){
            order.save({"deleted":true},{//remove order
                success:function(orderAgain){
                    var wineId = orderAgain.get("wineId");//update wine orderNumber
                    query = new Parse.Query("Wine");
                    query.get(wineId,{
                        success:function(wine){
                            wine.relation("orders").query().count({
                                success:function(orderCount){
                                    wine.set('orderNumber',orderCount);
                                    wine.set("exported",false);
                                    wine.save(null,{
                                        success:function(wineAgain){//update user orderNumber
                                            var userId = orderAgain.get("userId");
                                            query = new Parse.Query("User");
                                            query.get(userId,{
                                                success:function(user){
                                                    user.relation("orders").query().count({
                                                        useMasterKey: true,
                                                        success:function(orderCount){
                                                            user.set('orderNumber',orderCount);
                                                            user.set("exported",false);
                                                            user.save(null,{
                                                                success:function(userAgain){response.success();},
                                                                error:function(userAgain,error){response.error("Fail to save user order number:"+error.message);}
                                                            });
                                                        },
                                                        error:function(error){response.error("Fail to get user order count:"+error.message);}
                                                    });
                                                },
                                                error:function(user,error){response.error("Fail to get user from user id:"+error.message);}
                                            });
                                        },
                                        error:function(wineAgain){response.error("Fail to save wine order number:"+error.message);}
                                    });
                                },
                                error:function(error){response.error("Fail to get wine order count:"+error.message);}
                            });
                        },
                        error:function(wine,error){response.error("Fail to get wine from wine id:"+error.message);}
                    });
                },
                error:function(orderAgain,error){response.error("Fail to delete order:"+error.message);}
            });
        },
        error:function(order,error){response.error("Fail to get order from order id:"+error.message);}
    });
});


Parse.Cloud.define("removeWine", function(request, response) {
    var wineId = request.params.wineId;
    var Wine = Parse.Object.extend('Wine');
    var wine = new Wine();
    wine.id = wineId;
    //get posts from this wine
    var queryP = new Parse.Query("Post");
        queryP.equalTo("wine", wine);
        queryP.find({
            useMasterKey: true,
            success : function(posts) {
                if(posts.length!=0){
                    //unset wine field in post
                    for(var i=0; i<posts.length; i++){
                        posts[i].set('exported',false);
                        posts[i].set('wine',null);
                        posts[i].set('correct',null);
                        posts[i].set('status','pending');
                    }

                    Parse.Object.saveAll(posts,function(list,error){
                        if(list){//success
                            wine.save({"deleted":true, useMasterKey: true},{
                                success : function(myObject) {
                                    response.success(myObject);
                                },
                                error : function(myObject, error) {
                                    response.error(myObject,error);
                                }
                            });
                        }else{//fail
                            response.error(wine,error);
                        }
                    });

                }else{//no posts link to this wine. just delete wine
                    wine.save({"deleted":true, useMasterKey: true},{
                        success : function(myObject) {
                            response.success(myObject);
                        },
                        error : function(myObject, error) {
                            response.error(myObject,error);
                        }
                    });
                }
            }
        }, {
            error : function(wine, error) {
                throw "Fail to get wine from id:" + error.message
            }
        });
});

// Real-time price for app
Parse.Cloud.define("getWinePrice", function(request, response) {
    "use strict";
    var promise = wineSearch.getWinePrice(request.params.keyword, request.params.vintage);

    promise.then(function(result) {
        response.success(JSON.stringify(result));
    }, function(err) {
        response.error(err);
    });
});

/** Updates a post object as administrator. */
Parse.Cloud.define("updatePost", function(request, response) {
    admin.updatePost(request, response);
});

/** Updates a user object as an administrator. */
Parse.Cloud.define("userOperation", function(request, response) {
    admin.userOperation(request, response);
});


function recordEmailSent(user, emailType) {
    return analytics.recordForUser(user, "Email sent", {"Email type": emailType});
}

function recordEmailsSent(users, emailType) {
    return analytics.recordForUsers(users, "Email sent", {"Email type": emailType});
}

var USER_LIFECYCLE_KEY = "lifecycle";

function getUserLifecycle(user) {
    return user.get(USER_LIFECYCLE_KEY) || {};
}

function updateUserLifecycle(user, lifecycle) {
    var data = {};
    data[USER_LIFECYCLE_KEY] = lifecycle;
    return user.save(data);
}

/**
 * Self-correcting lifecycle checks called for a user more or less "on login".
 * FYI a read-modify-write race condition exists here, but we don't expect calls to this to be racy.
 */
Parse.Cloud.define("userLifecycleCheck", function(request, response) {
    var currentUser = request.user;
    if (!currentUser) {
        response.error("There must be a current user.");
    } else {
        var lifecycle = getUserLifecycle(currentUser);
        var promises = [];
        var lastSavePromise = Parse.Promise.as();
        var saveId = 0;

        function chainSavePromise(currentUser, lifecycle) {
            // NOTE(mike): saveId to prevent saving the same stuff over and over.
            // For example if you are currently saving something, and then two
            // more saves are queued up, you can skip the middle save and jump
            // straight to the last one. :) Or if you have 5 saves queued up you
            // can skip the first 4 and just do the last one, hence only save
            // where the saveId is 'current'.
            saveId++;
            var currentSaveId = saveId;
            lastSavePromise = lastSavePromise.then(function() {
                if (saveId === currentSaveId) {
                    return updateUserLifecycle(currentUser, lifecycle);
                } else {
                    return Parse.Promise.as();
                }
            });
            return lastSavePromise;
        }

        if (!lifecycle.welcomeEmailSent) {
            var promise = sendWelcomeEmail(currentUser).then(function(sent) {
                lifecycle.welcomeEmailSent = true;
                // NOTE(mike): save these eagerly in case of timeout or other errors
                var p1 = chainSavePromise(currentUser, lifecycle);
                if (!sent) {
                    return p1;
                } else {
                    var p2 = recordEmailSent(currentUser, "Welcome");
                    return Parse.Promise.when(p1, p2);
                }
            });
            promises.push(promise);
        }
        if (currentUser.get("signupsource") === "facebook") {
            if (!lifecycle.facebookInviteAttributed) {
                var promise = attributeFacebookInvite(currentUser).then(function(inviterUserId) {
                    lifecycle.facebookInviteAttributed = true;
                    var promises = [chainSavePromise(currentUser, lifecycle)];
                    if (!!inviterUserId) {
                        promises.push(new Parse.Query("User").get(inviterUserId).then(function(user) {
                            // instrument invite success for the inviter user
                            var p1 = analytics.recordForUser(user, "Invited friend joined", {"Invite method": "Facebook"});
                            // instrument mixpanel people for invitee
                            var p2 = analytics.setPeopleProperties(user, {'Joined after Facebook invite': true});
                            return Parse.Promise.when(p1, p2);
                        }));
                    }
                    return Parse.Promise.when(promises);
                });
                promises.push(promise);
            }
            if (!lifecycle.facebookFriendJoinedEmailsSent) {
                var promise = sendFacebookFriendJoinedEmails(currentUser).then(function(usersSent) {
                   lifecycle.facebookFriendJoinedEmailsSent = true;
                    var p1 = chainSavePromise(currentUser, lifecycle);
                    var p2 = recordEmailsSent(usersSent, "Facebook friend joined");
                    return Parse.Promise.when(p1, p2);
                });
                promises.push(promise);
            }
        }

        Parse.Promise.when(promises).then(function() {
            response.success();
        }, function() {
            response.error();
        });
    }
});

function attributeFacebookInvite(currentUser) {
    var facebookId = currentUser.get("facebookid");
    var query = new Parse.Query("FacebookInvite");
    query.equalTo("facebookId", facebookId);
    query.descending("createdAt");
    return query.find().then(function(facebookInviteObjects) {
        if (!!facebookInviteObjects && facebookInviteObjects.length > 0) {
            var head = facebookInviteObjects[0];
            var tail = facebookInviteObjects.slice(1);

            var ATTRIBUTED_TO_INVITER = "attributedToInviter";

            var promises = [];
            if (head.get(ATTRIBUTED_TO_INVITER) === undefined) {
                var data = {};
                data[ATTRIBUTED_TO_INVITER] = true;
                promises.push(head.save(data));
            }
            tail.forEach(function(obj) {
                if (obj.get(ATTRIBUTED_TO_INVITER) === undefined) {
                    var data = {};
                    data[ATTRIBUTED_TO_INVITER] = false;
                    promises.push(obj.save(data));
                }
            });
            return Parse.Promise.when(promises).then(function() {
                return head.get("inviter").id;
            });
        }
        return undefined;
    });
}

Parse.Cloud.define("pushNotificationAnalytics", function(request, response) {
    var pushType = request.params.pushType;
    var userIds = request.params.userIds;

    if (!pushType || pushType.length <= 0) {
        response.error("invalid pushType parameter");
    } else if (!userIds || userIds.length <= 0) {
        response.error("invalid userIds parameter");
    } else {
        var query = new Parse.Query("User");
        query.containedIn("objectId", userIds);
        var promise = query.find().then(function(users) {
            return analytics.recordPushForUsers(users, pushType);
        });

        promise.then(function() {
            response.success();
        }, function() {
            response.error();
        });
    }
});

//triggers

//Before save for all objects, check it is trying to change exported value, if not, set it to false

Parse.Cloud.beforeSave("_User", function(request, response) {
    var user = request.object;
    var flag = user.get('changeExportFlag');
    if (flag) {
        user.set("exported", false);
    }
    user.set("changeExportFlag", true);

    if (!user.existed()) {
        sendWelcomeEmail(user).then(function (sent) {
            if (sent) {
                user.set("lifecycle", {welcomeEmailSent: true});
            }
            response.success();
        }, function () {
            response.success();
        });
    } else {
        var updateCausedByStatsUpdate = dashboard.setStatsNeedUpdateForUserBeforeSave(user);

        if (updateCausedByStatsUpdate) {
            response.success();
        } else {
            //every time the user is saved, save the followers count and following count automatically
            var query = new Parse.Query("User");
            query.equalTo('following', user);
            query.find({
                success: function (allFollowers) {
                    user.set("follower_count", allFollowers.length);
                    var following = user.get("following");
                    user.set("following_count", following instanceof Array ? following.length : 0);
                    response.success();
                },
                error: function(err) {
                    response.error(err);
                }
            });
        }
    }
});

Parse.Cloud.afterSave("_User", function(request) {
    var user = request.object;
    dashboard.userAfterSaveInitUserStats(user);
    notifications.userAfterSave(user);
    if (user.dirty()) {
        user.save(null, {useMasterKey: true});
    }
});

Parse.Cloud.beforeSave("Order", function(request, response) {
	var flag = request.object.get('changeExportFlag');
    if(flag){
        request.object.set("exported",false);
    }
    request.object.set("changeExportFlag",true);
    if(!request.object.existed())   request.object.set("status","pending");
    response.success();
});

Parse.Cloud.beforeSave("Post", function(request, response) {
	var flag = request.object.get('changeExportFlag');
    if(flag){
        request.object.set("exported",false);
    }
    request.object.set("changeExportFlag",true);
    if(!request.object.existed())   request.object.set("status","pending");
    response.success();
});

Parse.Cloud.beforeSave("Wine", function(request, response) {
	var flag = request.object.get('changeExportFlag');
    if(flag){
        request.object.set("exported",false);
    }
    request.object.set("changeExportFlag",true);
    response.success();
});

Parse.Cloud.afterSave("Wine", function(request) {
    "use strict";
    var wine = request.object;
    wineSearch.findAndStoreLatestPrice(wine);
});


//trigger after actions

Parse.Cloud.afterSave("Post",function(request){
    var post = request.object;
    var user = post.get('owner');
    var wineImage = post.get('post_image');
    var postContent = post.get('post_content');
    var postRating = post.get('rating');
    var recipients = [ {
                email : env.adminUserEmail,
                name : 'Admin'
            },
            {
                email: env.wineTeamEmail,
                name: 'Operators'
            }];
    dashboard.setStatsNeedUpdate(user);
    if(post.existed())  return;//When it is update, no need to send email. 
    slackHooks.slackNewWineMessage(env.slackNewNotificationURL,wineImage,postContent,postRating);
    arrayEmail('support@vinus.net.au', "Vinus", recipients, "Dear Admin, There is a new wine submitted. Please process it.", "New Wine", function(){
        console.log("Email sent when post is created");
    }, function(){
        throw("Fail to send email when post is created");
    });
});

Parse.Cloud.afterSave("Activity", function(request) {
    var activity = request.object;
    var user = activity.get('fromUser');
    if (!!user) {
        dashboard.setStatsNeedUpdate(user);
    }
});

function sendFacebookFriendJoinedEmails(user) {
    var promise = new Parse.Promise();
    //if the user is a facebook user, send mail to the users whose friends include this user
    var facebookid = user.get("facebookid");
    if(undefined!=facebookid){
        query = new Parse.Query("User");
        query.equalTo("facebookFriends",facebookid);

        var usersSent = [];
        query.find({
            success:function(facebookFriends){
                var index = 0;
                var sendFacebookEmail = function(facebookUser){
                    var emailContent = "<div dir=ltr><div><div><div>Hi "+
                        facebookUser.get("firstname")+
                        "<br><br></div>Your friend "+
                        user.get("firstname")+" " +
                        user.get("lastname")+
                        " joined Vinus.<br><br></div><img src='"+
                        user.get("photo")+"' style='border-radius:2px 2px 2px 2px;padding-right:10px' height=72 width=72> <b>"+
                        user.get("firstname")+" " +
                        user.get("lastname")+
                        "<br></b></div><div><br></div><div><b><br></b></div>Go to the Vinus app and follow "+
                        user.get("firstname")+".<br><br>You can find them in the notifications page (fourth button on the bottom row of buttons), look for the blue Follow button.<br><br>&#169; 2013 Vinus<div class=yj6qo></div><div class=adL><br></div><div class=adL><div><div><div><div><div></div></div></div></div></div></div></div>";

                    var subject = "Your friend "+user.get("firstname")+" "+user.get("lastname")+" joined Vinus";

                    privateEmail(env.emailFromAddress, "Vinus", facebookUser.get("email"), facebookUser.get("firstname"), emailContent, subject, function(){
                        usersSent.push(user);
                        index++;
                        if(index<facebookFriends.length) {
                            sendFacebookEmail(facebookFriends[index]);
                        } else {
                            promise.resolve(usersSent);
                        }
                    }, function(){
                        promise.resolve(usersSent);
                    });
                };

                if(facebookFriends.length>0)
                    sendFacebookEmail(facebookFriends[0]);
            }
        });
    }
    return promise;
}


function sendWelcomeEmail(user) {
    var email = user.get('email');
    if (!email) {
        // false = didn't send
        return Parse.Promise.as(false);
    }
    var promise = new Parse.Promise();
    var name = user.get('firstname')+" "+user.get('lastname');
    var emailContent = "<div style=\"overflow: hidden;\"><div style=\"font-family:Helvetica;font-size:14px;font-style:normal;font-weight:normal;line-height:150%;letter-spacing:normal;margin:0px\"><p>Hi "+user.get('firstname')+",</p><p>Hope you're well :)</p><p>I'm Alex, founder of Vinus.  My direct email is alex@getvinus.com and my personal twitter handle is @BAMartelly.</p><p>I'm really excited you've joined our small but quickly growing community of wine lovers.  Welcome!</p><p><b><i>Our mission is to make it insanely easy for you to connect with wonderful wine experiences.</i></b></p><p>I'll give you a couple of quick examples of how we're doing that, so that you can get the most out of using Vinus.</p><p><b>Make faster wine decisions by keeping a wine journal</b></p><p>We found many people who love wine keep some sort of wine journal.  They do it because just like with a personal journal, it helps reinforce memories.</p><p>This in turn makes it much more likely that the next time you pick up a wine list, you'll recognise many more names, and make faster and better decisions about which wine to enjoy.</p><p>Today, thousands in our community are using Vinus to keep a wine journal with just a snap of a photo.</p><p>No need to scribble down the wine name, vintage, producer, etc. on pieces of paper that inevitably get lost.  Our 100% accurate wine recognition technology does all that for you.</p><p><b>Follow friends and wine pros to discover the best wines</b></p><p>People are drinking awesome wines out there.  Most of the time, we're not aware of this, and we're missing out!</p><p>So make sure you go into your app now and follow at least 5 people from our suggested user list, plus your friends and family.</p><p>Health warning - you're likely to feel a little wine envy.  But that's a good thing :) just go out there and get the wines you like! </p><p><b>Help us grow so we can stay free</b></p><p>Vinus is a free service and we'd like to keep it that way.  For us, growth is life, so if you like Vinus and would like to keep it free please consider helping us grow by:</p><ol><li>Reviewing us on the App Store by <a href=\"http://go.onelink.ly/id661997423?pid=plsReview&c="+user.get('firstname')+"-"+user.get('lastname')+"\" target=\"\">following this link and tapping \"Write Review\"</a></li><li>Sharing this app download link with your wine-loving friends, <a href=\"http://go.onelink.ly/id661997423?pid=plsShare&c="+user.get('firstname')+"-"+user.get('lastname')+"\" target=\"\">getvinus.com/download</a>, or simply forwarding this email to your friends</li></ol><p>Lastly, I'd like to personally thank you for trying out Vinus.  If you'd like to send me a note, some feedback on Vinus, an idea or even just to tell me about your day, my email address is <a href=\"mailto:alex@getvinus.com\" target=\"_blank\">alex@getvinus.com</a>.  I'd love to hear from you, and I'm generally pretty quick to respond :)</p><p>Cheers!</p><p>Alex Martell<br>Founder<br>twitter.com/getvinus<br>facebook.com/getvinus<br>instagram.com/getvinus</p><p>P.S. Oh! Almost forgot.  We're doing some background research for an awesome new product for wine lovers.  If you'd like to participate, and ideally if you've ever subscribed to email wine offers, please give me a shout at <a href=\"mailto:alex@getvinus.com\" target=\"_blank\">alex@getvinus.com</a>. We could really use your insights!</p><p>Sent from my iPhone</p></div></div>";

    privateEmail(env.emailFromAddress, "Vinus", email, name, emailContent, "personal welcome to Vinus", function(){
        console.log("Welcome email sent to " + email);
        // true = sent
        promise.resolve(true);
    },function(){
        console.log("Failed to send welcome email");
        promise.resolve(false);
    });

  return promise;
}

Parse.Cloud.afterSave("Order", function(request) {//save the order to user and wine objects
    var user = request.object.get('user');
    var userId = user.id;
    var wineId = request.object.get('wine').id;
    var order = request.object;

    dashboard.setStatsNeedUpdate(user);

    if(order.existed()) return;//When it is update, no need to update user and wine.
    slackAdHocMessage('<!channel>: New Vinus wine order!',env.slackNewOrderURL);        

    var Wine = Parse.Object.extend("Wine");
    var query = new Parse.Query(Wine);

    query.get(wineId, {
        success:function(wine){
            //add this order to wine
            var relation = wine.relation('orders');
            relation.query().count({//check how many orders now
                success:function(number){
                    relation.add(order);//add order to wine
                    number=number*1+1;
                    wine.set('orderNumber',number);//set order number in wine
                    wine.save(null,{
                        success:function(wine){//When wine is saved successfully, do the same to the user
                            var User = Parse.Object.extend("User");
                            query = new Parse.Query(User);
                            query.get(userId, {
                                success:function(user){
                                    relation = user.relation('orders');
                                    relation.query().count({
                                        useMasterKey: true,
                                        success:function(orderCount){
                                            relation.add(order);//add order to user
                                            user.set('orderNumber',orderCount*1+1);
                                            //update user's post address
                                            user.set('post_name',order.get('post_name'));
                                            user.set('post_street',order.get('post_street'));
                                            user.set('post_suburb',order.get('post_suburb'));
                                            user.set('post_state',order.get('post_state'));
                                            user.set('post_country',order.get('post_country'));
                                            user.set('post_code',order.get('post_code'));
                                            user.save(null,{
                                                success:function(user){
                                                    //When everything is done. Send email to both admin and user
                                                    var name = user.get("firstname")+" "+user.get("lastname");
                                                    var bottles = order.get("bottle");
                                                    var vintage = wine.get("vintage");
                                                    var wineName = wine.get("name");
                                                    var producer = wine.get("maker");

                                                    var emailToUser = "Hello "+user.get('firstname')+",<br/>"+
                                                            "<br/>"+
                                                            "Your Vinus order for "+bottles+" "+vintage+" "+producer+" "+wineName+" has been placed.<br/>"+
                                                            "<br/>"+
                                                            "It will be shipped to:<br/>"+
                                                            "<br/>"+
                                                            order.get("post_name")+"<br/>"+
                                                            order.get("post_street")+"<br/>"+
                                                            order.get("post_suburb")+" "+order.get("post_state")+" "+order.get("post_code")+"<br/>"+
                                                            "<br/>"+
                                                            "I will send tracking information when it becomes available.<br/>"+
                                                            "<br/>"+
                                                            "Thanks for using Vinus!<br/>"+
                                                            "<br/>"+
                                                            "-Alex<br/>"+
                                                            "<br/>"+
                                                            "Team Vinus<br/>"+
                                                            "<div><span><a href=\"tel:412%20519%209163\" value=\"+14125199163\" target=\"_blank\">orders@<span style=\"background-color:rgb(255,255,204)\">vinus.net.au</span></a><br><span style=\"text-indent:0px;letter-spacing:normal;font-variant:normal;text-align:left;font-style:normal;display:inline!important;font-weight:normal;float:none;line-height:20.7969px;text-transform:none;font-size:13px;white-space:normal;font-family:'Helvetica Neue',Arial,sans-serif;word-spacing:0px\">1300 040 891</span>&nbsp;<a href=\"tel:412%20519%209163\" value=\"+14125199163\" target=\"_blank\"></a></span></div>";

                                                    privateEmail(env.emailFromAddress, "Vinus", env.adminUserEmail, "Admin", "Dear Admin,<br/><br/>There is a sourcing request from " + name + " (" + user.get("email") + ")<br/><br/>" + emailToUser , "Order has been placed", function(){
                                                        console.log("Order email to admin sent.");
                                                    }, function(){
                                                        throw("Fail to send order email to admin");
                                                    });

                                                    privateEmail(env.emailFromAddress, "Vinus", user.get("email"), name, emailToUser, "Your Vinus order has been placed", function(){
                                                        console.log("order email to customer is sent.");
                                                        return recordEmailSent(user, "Order confirmation");
                                                    }, function(){
                                                        throw("Fail to send order email to customer");
                                                    });
                                                },
                                                error:function(user,error){throw "user save failed:"+error.message;}
                                            });
                                        },
                                        error:function(error){throw "Fail to get user order count:"+error.message}
                                    });
                                },
                                error:function(user,error){throw "user lookup failed:"+error.message;}
                            });
                        },
                        error:function(wine,error){throw "wine save failed:"+error.message;}
                    });
                },
                error:function(error){throw "Fail to get wine orders count:"+error.message}
            });
        },
        error:function(wine,error){throw "wine lookup failed:"+error.message;}
    });
});

