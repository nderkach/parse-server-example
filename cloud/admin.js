/**
 * Backend to admin console.
 */

var exports;

(function() {
    var auth = require('./auth.js');
    var r = require('./requests.js');

    exports.updatePost = function(request, response) {
        auth.requireAdmin().then(function() {
            var postId = request.params.postId;
            var rating = request.params.rating;
            var content = request.params.content;
            var archived = request.params.archived;
            var image = request.params.image;

            var query = new Parse.Query("Post");
            query.get(postId, {
                useMasterKey: true,
                success:function(post){
                    post.set('rating',rating);
                    post.set('post_content',content);
                    post.set('archived',archived);
                    post.set('post_image',image);
                    post.set('exported',false); //set export to false when post is updated
                    post.save(null,{
                        success:function(postAgain){
                            response.success();
                        },
                        error:function(postAgain,error){
                            response.error(error);
                        }
                    });
                },
                error: r.fail(response)
            });
        }, r.fail(response));
    };

    exports.userOperation = function(request, response) {
        auth.requireAdmin().then(function() {

            var operation = request.params.operation;
            var userId = request.params.userId;
            var query;

            if(operation=="update"){//update user
                query = new Parse.Query("User");
                query.get(userId,{
                    useMasterKey: true,
                    success:function(user){
                        if(request.params.firstname) user.set('firstname',request.params.firstname);
                        if(request.params.lastname) user.set('lastname',request.params.lastname);
                        if(request.params.dob) user.set('dob',request.params.dob);
                        if(request.params.blocked||request.params.blocked===false) user.set('blocked',request.params.blocked);
                        if(request.params.post_name) user.set('post_name',request.params.post_name);
                        if(request.params.post_street) user.set('post_street',request.params.post_street);
                        if(request.params.post_suburb) user.set('post_suburb',request.params.post_suburb);
                        if(request.params.post_state) user.set('post_state',request.params.post_state);
                        if(request.params.post_country) user.set('post_country',request.params.post_country);
                        if(request.params.post_code) user.set('post_code',request.params.post_code);
                        user.set("exported",false);
                        user.save(null,{success:function(user){
                            response.success();
                        }
                        });
                    }
                });
            }else if(operation=="remove"){//remove user
                query = new Parse.Query("User");
                query.get(userId,{success:function(user){
                    user.save({"deleted":true},{
                        success:function(user){response.success()},
                        error:function(user,error){response.error("Fail to remove user:"+error.message);}
                    });
                }
                });
            }
        }, r.fail(response));
    }

})();
