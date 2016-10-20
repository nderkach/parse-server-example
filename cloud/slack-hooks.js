'use strict'

var _ = require('underscore');
var env = require('./env.js').env;

var appUserObject = {
	'Roger' : {
		name: 'Roger', 
		icon: 'https://cherysh.com/css/images/rogerSterling.jpg',
		quotes: [
			'\"You know, my mother was right: it\'s a mistake to be conspicuously happy\"',
			'\"My father used to say this is the greatest job in the world except for one thing: clients\"',
			'\"Well, I gotta go learn a bunch of people\'s names before I fire them\"',
			'\"I\'m in charge of thinking of things before people know they need them\"',
			'\"Nobody knows what I\'m doing. It\'s good for mystique\"',
			'\"Sunkist, Carnation, the avocado people: my biggest job in these meetings is to keep them from saying \'golly\' too many times\"',
			'\"Have a drink, it\'ll make me look younger\"',
			'\"I\'m stuffed. I had a jar of olives\"',
			'\"Look, we\'ve got Oysters Rockefeller, Beef Wellington, Napoleons! We leave this lunch alone, it\'ll take over Europe\"',
			'\"Not to get too deep before the cocktail hour, but do I need to remind you of the finite nature of life?\"',
			'\"Every generation thinks the next one is the end of it all.  Bet there are people in the Bible walking around, complaining about kids today\"'
			]
	},
	'Don' : {
		name: 'Don',
		icon:'https://cherysh.com/css/images/don.png',
		quotes : [
			'\"People tell you who they are, but we ignore it because we want them to be who we want them to be\"',
			"\"Change is neither good or bad, it simply is.\"",
			"\"I hate to break it to you, but there is no big lie, there is no system, the universe is indifferent\"",
			'\"I can\"t decide … if you have everything … or nothing\"',
			'\"If you don\'t like what\'s being said, change the conversation\"',
			"\"It wasn\'t a lie, it was ineptitude with insufficient cover\"",
			'\"Is that what you want, or is that what people expect of you?\"',
			"\"There will be fat years, and there will be lean years, but it is going to rain\"",
			"\"I’m glad that this is an environment where you feel free to fail\"",
			"\"This never happened. It will shock you how much it never happened\"",
			"\"People want to be told what to do so badly that they’ll listen to anyone\"",
			"\"We’re gonna sit at our desks typing while the walls fall down around us. Because we’re the least important, most important thing there is\"",
			"\"Advertising is based on one thing, happiness. And you know what happiness is? Happiness is the smell of a new car. It’s freedom from fear. It’s a billboard on the side of the road that screams reassurance that whatever you are doing is okay. You are okay\""
		]
	},
	'Peggy' : {
		name: 'Peggy',
		icon:'https://cherysh.com/css/images/peggy.png',
		quotes: [
			'\"I don’t think anyone wants to be one of a hundred colors in a box\"',
			'\"I’m in the business of persuasion and frankly, I’m disappointed by your presentation\"',
			'\"I’m Peggy Olson. I want to smoke some marijuana\"',
			'\"Your problem is not my problem\"',
			'\"I know what I’m supposed to want, but it just never feels right or as important as anything in that office\"',
			'\"A pretty face comes along and everything goes out the window\"',
			'\"I am the person you need to impress right now\"',
			'\"The work is ten dollars. The lie is extra\"',
			'\"Am I the only one who can work and drink at the same time\"',
			'\"If you can’t tell the difference between which part’s the idea and which part’s the execution of the idea, you’re of no use to me\"',
			'\"If you don’t like what they’re saying, change the conversation\"',
			'\"I’d never recommend imitation as a strategy. You’ll be second, which is very far from first\"',
			'\"You can’t have it both ways\"',
			'\"It just looks good now, but it was miserable when you were in it. Trust me\"'
		]
	},
	'Joan' : {
		name: 'Joan',
		icon: 'https://cherysh.com/css/images/joan.png',
		quotes: [
			'\"These men. Constantly building them up, and for what? Dinner and jewelry? Who cares?\"',
			'\"I’m not a solution to your problems. I’m another problem\"',
			'\"This is why I don’t allow crying in the break room. It erodes morale. There’s a place to do that — like your apartment\"',
			'\"That’s life. One minute you’re on top of the world, the next minute some secretary’s running you over with a lawn mower\"',
			'\"Sometimes when people get what they want they realize how limited their goals were\"'
		]
	},
	'Bert' : {
		name: 'Bert',
		icon: 'https://cherysh.com/css/images/bert.png',
		quotes: [
			'\"You’re going to need a strong stomach if you’re going to be back in the kitchen seeing how the sausage is made\"',
			'\"I didn’t get to where I am by dwelling on the past\"',
			'\"This is medieval\"',
			'\"Reconcile\"',
			'\"Mr Campbell, who cares?\"',
			'\"If you turn us down and elect to be a mid-level cog at McCann Erickson . . . we’ll have to lock you in the storeroom until morning\"',
			'\"One never knows how loyalty is born\"',
			'\"Dont’t waste your youth on age\"',
			'\"She was born in 1898 in a barn. She died on the 37th floor of a skyscraper. She was an astronaut\"',
			'\"The best things in life are free\"'
		]
	}
}
var appUserNameArray = ['Roger','Don', 'Peggy', 'Joan', 'Bert'];
var defaultUser = appUserNameArray[0];

function sendToSlack(url,json){
    return Parse.Cloud.httpRequest({
            method:'POST',
            url:env.slackNewNotificationURL,
            headers: {
                'Content-Type' : 'application/json'
            },    
            body:json || {'text' : 'New wine posted!'}
        }).then(function(httpResponse){
            console.log(httpResponse.txt);
        },function(httpResponse){
            console.error('Slack request failed with response code '+httpResponse.status);
    });	
}

function slackWineAssets(){
	var appUserObjectToArray = _.toArray(appUserObject);
	var selectedObjectWrapped = _.first(_.shuffle(appUserObjectToArray),1);
	var selectedObject = selectedObjectWrapped[0];
	var selectedQuote = _.first(_.shuffle(selectedObject.quotes));
	var assets = {
		icon : selectedObject.icon,
		quote : selectedQuote,
		username : selectedObject.name
	};
	return assets;
}

function slackNewWineMessage(url,wineImage,postContent,postRating){
	var assets = slackWineAssets();
	var ts = new Date().getTime() / 1000;
	var json = {
		'username' : assets.username,
		'icon_url' : assets.icon,
		'attachments' : [
			{
				'fallback' : '<!channel>: New wine posted',
				'color' : 'good',
				'pretext' : assets.quote,
				'author_name' : 'Vinus',
				'author_icon' : 'https://i.imgur.com/qpKJGjg.png',
				'title' : '<!channel>: New wine posted!',
				'fields':[
					{
						'title' : 'User rating',
						'value' : postRating,
						'short' : true
					},
					{
						'title' : 'User comment',
						'value' : postContent,
						'short' : false
					}
				],
				'footer' : 'Vinus API',
				'ts' : parseInt(ts),
				'image_url':wineImage,
				'thumb_url':wineImage
			}
		]
	}

	var fallbackJSON = {
			'username' : 'Roger',
			'icon_url' : 'https://cherysh.com/css/images/rogerSterling.jpg',
			'attachments' : [
				{
					'fallback' : '<!channel>: New wine posted',
					'color' : 'good',
					'pretext' : 'Have a drink, it’ll make me look younger',
					'author_name' : 'Vinus',
					'author_icon' : 'https://i.imgur.com/qpKJGjg.png',
					'title' : '<!channel>: New wine posted!',
					'fields':[
						{
							'title' : 'User rating',
							'value' : postRating,
							'short' : true
						},
						{
							'title' : 'User comment',
							'value' : postContent,
							'short' : false
						}
					],
					'footer' : 'Vinus API',
					'ts' : parseInt(ts),
					'image_url':wineImage,
					'thumb_url':wineImage
				}
			]
		}

	sendToSlack(url,json || fallbackJSON);
}

module.exports = {
	slackNewWineMessage : slackNewWineMessage
}