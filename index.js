'use strict';

// Load environment variables from `.env` file
require('dotenv').config();

/***************************************************
---------- APPLICATION DEPENDENCIES ----------
***************************************************/

const express = require('express');
const superagent = require('superagent');
const moment = require('moment');

// Slack APIs
const { WebClient } = require('@slack/web-api');
const { createEventAdapter } = require('@slack/events-api');
const { createMessageAdapter } = require('@slack/interactive-messages');

// Dependencies for OAuth
const passport = require('passport');
const LocalStorage = require('node-localstorage').LocalStorage;
const SlackStrategy = require('@aoberoi/passport-slack').default.Strategy;

/***************************************************
---------- APPLICATION SETUP ----------
***************************************************/

// Initialize an Express application
const app = express();

// Initialize interactive message adapter using signing secret from environment variables
const slackInteractions = createMessageAdapter(process.env.SLACK_SIGNING_SECRET);

// Initialize event adapter using signing secret from environment variables
const slackEvents = createEventAdapter(process.env.SLACK_SIGNING_SECRET, {
  includeBody: true
});

// Initialize a Local Storage object to store authorization info
// NOTE: This is an insecure method and thus for demo purposes only!
const botAuthorizationStorage = new LocalStorage('./storage');

/***************************************************
---------- HELPER FUNCTIONS ----------
***************************************************/

// Helpers to cache and lookup appropriate client
// NOTE: Not enterprise-ready. if the event was triggered inside a shared channel, this lookup
// could fail but there might be a suitable client from one of the other teams that is within that
// shared channel.
const clients = {};
function getClientByTeamId(teamId) {
  if (!clients[teamId] && botAuthorizationStorage.getItem(teamId)) {
    clients[teamId] = new WebClient(botAuthorizationStorage.getItem(teamId));
  }
  if (clients[teamId]) {
    return clients[teamId];
  }
  return null;
}

/***************************************************
---------- OAUTH MIDDLEWARE & ROUTES ----------
***************************************************/
// See docs for OAuth 2.0 in Slack
// https://api.slack.com/docs/oauth

// Initialize Add to Slack (OAuth) helpers
passport.use(new SlackStrategy({
  clientID: process.env.SLACK_CLIENT_ID,
  clientSecret: process.env.SLACK_CLIENT_SECRET,
  skipUserProfile: true,
}, (accessToken, scopes, team, extra, profiles, done) => {
  botAuthorizationStorage.setItem(team.id, extra.bot.accessToken);
  done(null, {});
}));

// Plug the Add to Slack (OAuth) helpers into the express app
app.use(passport.initialize());

// Route for "Add to Slack" button needed to complete app/bot installation
app.get('/', (req, res) => {
  res.send('<a href="/auth/slack"><img alt="Add to Slack" height="40" width="139" src="https://platform.slack-edge.com/img/add_to_slack.png" srcset="https://platform.slack-edge.com/img/add_to_slack.png 1x, https://platform.slack-edge.com/img/add_to_slack@2x.png 2x" /></a>');
});


app.get('/auth/slack', passport.authenticate('slack', {
  scope: ['bot']
}));

// Corresponds to a "Redirect URL" in App Dashboard > Features > OAuth & Permissions
app.get('/auth/slack/callback',
  passport.authenticate('slack', { session: false }),
  (req, res) => {
    res.send('<p>Greet and React was successfully installed on your team.</p>');
  },
  (err, req, res, next) => {
    res.status(500).send(`<p>Greet and React failed to install</p> <pre>${err}</pre>`);
  }
);

// *** Plug the event adapter into the express app as middleware ***
// Corresponds to the "Request URL" in App Dashboard > Features > Event Subscriptions
// Ex: https://your-deployed-bot.com/slack/events
app.use('/slack/events', slackEvents.expressMiddleware());

// *** Plug the interactive message adapter into the express app as middleware ***
// Corresponds to the "Request URL" in App Dashboard > Features > Interactive Components
// Ex: https://your-deployed-bot.com/slack/actions
app.use('/slack/actions', slackInteractions.requestListener());


/***************************************************
---------- SLACK CHANNEL EVENT LISTENERS ----------
***************************************************/
// Attaches listeners to the event adapter 

// Listens for every "message" event
slackEvents.on('message', (message, body) => {
  // console.log('heard message:', message);
  // console.log('message body:', body);


  // ***** If message contains 3 backticks, asks if user wants to save a Gist with buttons
  if (!message.subtype && message.text.indexOf('```') >= 0) {

    // Get the user's display name
    const slack = getClientByTeamId(body.team_id);
    let token = botAuthorizationStorage.getItem(body.team_id);
    return slack.users.info({
      "token": token,
      "user": message.user,
    })
      .then(res => {
        // attach display name to the message object
        message.username = res.user.profile.display_name;
        let attachment_tmp = JSON.stringify([
          {
            "blocks": [
              {
                "type": "actions",
                "elements": [
                  {
                    "type": "button",
                    "text": {
                      "type": "plain_text",
                      "emoji": true,
                      "text": "Yeah"
                    },
                    "value": JSON.stringify(message),
                    "action_id": "save_gist",
                    "style": "primary"
                  },
                  {
                    "type": "button",
                    "text": {
                      "type": "plain_text",
                      "emoji": true,
                      "text": "Nah"
                    },
                    "value": "click_me_123",
                    "style": "danger"
                  }
                ]
              }
            ]
          }
        ]);
        let text_message = `Hey, <@${message.user}>, looks like you pasted a code block. Want me to save it for you as a Gist? :floppy_disk:`

        // Send a message and buttons to save/not save to the user
        // entire message object is passed in as the "value" of the "save" button
  
        let postEphemeralURL = 'https://slack.com/api/chat.postEphemeral?token=' + process.env.SLACK_AUTH_TOKEN 
        + '&user=' + message.user + '&channel='+ message.channel +'&attachments=' + attachment_tmp + '&text=' + text_message;
        console.log('ephemeralURL@@@@@@@@@@@@@@@@@@@@@@@',postEphemeralURL);
        superagent.post(postEphemeralURL).send()
        .set('Content-Type', 'application/json;charset=utf-8')
        .then();
      })
      .catch(err => console.log(err));
  }

  // ***** If message contains "get gists", send back a link from the GitHub API
  if (!message.subtype && message.text.indexOf('get gists') >= 0) {
    const slack = getClientByTeamId(body.team_id);

    return superagent.get('https://api.github.com/users/SlackLackey/gists')
      .then(res => {
        const url = res.body[0].url;
        slack.chat.postMessage({
          channel: message.channel,
          text: 'Your gists are here:\n' + url,
        });
      })
      .catch(err => console.log(err));
  }

});

slackEvents.on('file_created', (fileEvent, body) => {
  console.log('file was created 196')
  console.log('fileEvent', fileEvent);

  const slack = getClientByTeamId(body.team_id);
  let token = botAuthorizationStorage.getItem(body.team_id);

  return slack.files.info({
    "token": token,
    "file": fileEvent.file_id,
  })
    .then(file => {
      console.log('210 mode', file.file.mode);
      if (file.file.mode === 'snippet') {
        console.log('ITS A SNIPPET');
        // console.log('the whole file obj', file);
        console.log('channel to respond to:', file.file.channels[0]);

        // CJ0MKER54 - billy & chris
        // CHW996DHC - everyone

        // Send a message and buttons to save/not save to the user
        // entire message object is passed in as the "value" of the "save" button
        

        let attachment_tmp = JSON.stringify([
          {
            "blocks": [
              {
                "type": "actions",
                "elements": [
                  {
                    "type": "button",
                    "text": {
                      "type": "plain_text",
                      "emoji": true,
                      "text": "Yeah"
                    },
                    "value": fileEvent.file_id,
                    "action_id": "save_gist_snippet",
                    "style": "primary"
                  },
                  {
                    "type": "button",
                    "text": {
                      "type": "plain_text",
                      "emoji": true,
                      "text": "Nah"
                    },
                    "value": "click_me_123",
                    "style": "danger"
                  },
                  {
                    "type": "button",
                    "text": {
                      "type": "plain_text",
                      "emoji": true,
                      "text": ">TEST"
                    },
                    "value": "click_me_1233123123",
                    "action_id": "show_next_question",
                    "style": "danger"
                  }
                ]
              }
            ]
          }
        ]);
        let user = file.file.user;
        let channel = file.file.channels[0];
        let text = `Hey, <@${file.file.user}>, looks like you made a code snippet. Want me to save it for you as a Gist? :floppy_disk:`;
        // console.log(x);
        let postEphemeralURL = 'https://slack.com/api/chat.postEphemeral?token=' + process.env.SLACK_AUTH_TOKEN 
        + '&user=' + user + '&channel='+ channel +'&attachments=' + attachment_tmp + '&text=' + text;
        console.log('ephemeralURL@@@@@@@@@@@@@@@@@@@@@@@',postEphemeralURL);
        superagent.post(postEphemeralURL).send()
        .set('Content-Type', 'application/json;charset=utf-8')
        .then();
          // if(action_id){
          
        // }
        // });
        // respond({
        //   text: text,
        //   replace_original: true,
        //   response_type: 'ephemeral',
        //   attachments: attachment_tmp,
      }
    })
    .catch(err => console.error(err));

});


/***************************************************
---------- SLACK INTERACTIVE MESSAGES ----------
***************************************************/
// Attaches listeners to the interactive message adapter
// `payload` contains information about the action
// Block Kit Builder can be used to explore the payload shape for various action blocks:
// https://api.slack.com/tools/block-kit-builder

// ***** If block interaction "action_id" is "save_gist"
slackInteractions.action({ actionId: 'save_gist' }, (payload, respond) => {

  // Get the original message object (with the future Gist's content)
  const message = JSON.parse(payload.actions[0].value);

  // Make an object to send to the API server to save a Gist
  let title = message.username.replace(/\s+/g, '-').toLowerCase() + '-' + Date.now() + '.js';
  let description = `Created by ${message.username} on ${moment().format('dddd, MMMM Do YYYY, h:mm:ss a')}`;
  let content = message.text.slice(message.text.indexOf('```') + 3, message.text.lastIndexOf('```'));
  const gist = { title, description, content };

  console.log('gist to send 1 :', gist);

  // POST request to hosted API server which saves a Gist and returns a URL
  return superagent.post(`${process.env.BOT_API_SERVER}/createGist`)
    .send(gist)
    .then((res) => {
      respond({
          text: 'I saved it as a gist for you. You can find it here:\n' + res.text,
        });
    
    })
    .catch((error) => {
      respond({ text: 'Sorry, there\'s been an error. Try again later.', replace_original: true });
    });

});



// slackInteractions.action({ actionId: 'show_next_question' }, (payload, respond) => {
//   console.log('show_next_question: 123123123');
  
//   respond({
//     // text: 'sha dan',
//     replace_original: true,
//     response_type: 'ephemeral',
//     attachments: [
//       {
//         "type": "section",
//         "block_id": "section791937301",
//         "text": {
//           "type": "mrkdwn",
//           "text": "Pick an item from the dropdown list"
//         },
//         "accessory": {
//           "action_id": "section734454127",
//           "type": "static_select",
//           "placeholder": {
//             "type": "plain_text",
//             "text": "Select an item",
//             "emoji": true
//           },
//           "options": [
//             {
//               "text": {
//                 "type": "plain_text",
//                 "text": "*this is plaintext text*",
//                 "emoji": true
//               },
//               "value": "value-0"
//             },
//             {
//               "text": {
//                 "type": "plain_text",
//                 "text": "*this is plaintext text*",
//                 "emoji": true
//               },
//               "value": "value-1"
//             },
//             {
//               "text": {
//                 "type": "plain_text",
//                 "text": "*this is plaintext text*",
//                 "emoji": true
//               },
//               "value": "value-2"
//             }
//           ]
//         }
//       }
//     ]
//     // [
//     //   {
//           // "fallback": "Required plain-text summary of the attachment.",
//           // "color": "#2eb886",
//           // "pretext": "Optional text that appears above the attachment block",
//           // "author_name": "Bobby Tables",
//           // "author_link": "http://flickr.com/bobby/",
//           // "author_icon": "http://flickr.com/icons/bobby.jpg",
//           // "title": "Slack API Documentation",
//           // "title_link": "https://api.slack.com/",
//           // "text": "Optional text that appears within the attachment",
//           // "fields": [
//           //     {
//           //         "title": "Priority",
//           //         "value": "High",
//           //         "short": false
//           //     }
//           // ],
//           // "image_url": "http://my-website.com/path/to/image.jpg",
//           // "thumb_url": "http://example.com/path/to/thumb.png",
//           // "footer": "Slack API",
//           // "footer_icon": "https://platform.slack-edge.com/img/default_application_icon.png",
//   //         // "ts": 123456789
//   //     }
//   // ],


//    });

// });





// ***** If block interaction "action_id" is "save_gist_snippet"
slackInteractions.action({ actionId: 'save_gist_snippet' }, (payload, respond) => {

  let file_id = payload.actions[0].value;
  console.log('file ID:', file_id);

  const slack = getClientByTeamId(payload.user.team_id);
  let token = botAuthorizationStorage.getItem(payload.user.team_id);

  return slack.files.info({
    "token": token,
    "file": file_id,
  })
    .then(file => {
      // Get the user's display name and attach to the file object
      return slack.users.info({
        "token": token,
        "user": file.file.user,
      })
        .then(res => {
          file.username = res.user.profile.display_name;

          // Make an object to send to the API server to save a Gist
          let title;
          if (file.file.name[0] === '-') {
            title = file.username.replace(/\s+/g, '-').toLowerCase() + '-' + Date.now() + '.' + file.file.name.split('.').pop();
          } else {
            title = file.file.name;
          }
          let description = `Created by ${file.username} on ${moment().format('dddd, MMMM Do YYYY, h:mm:ss a')}`;
          let content = file.content;
          const gist = { title, description, content };

          console.log('gist to send 2:', gist);

          // POST request to hosted API server which saves a Gist and returns a URL
          return superagent.post(`${process.env.BOT_API_SERVER}/createGist`)
            .send(gist)
            .then((res) => {
              console.log('line 200');
              let msg = 'I saved it as a gist for you. You can find it here:\n' + res.text;
              respond({
                text: msg,
                // replace_original: false,
                // response_type: 'ephemeral',
              });

            })
            .catch((error) => {
              respond({ text: 'Sorry, there\'s been an error. Try again later.', replace_original: true });
            });
        });
    })
    .catch(err => console.error('ERROR on line 336', err));
});


// *** Handle Event API errors ***
slackEvents.on('error', (error) => {
  if (error.code === slackEventsApi.errorCodes.TOKEN_VERIFICATION_FAILURE) {
    // This error type also has a `body` propery containing the request body which failed verification.
    console.error(`An unverified request was sent to the Slack events Request URL. Request body:`);
    console.error(error);
  } else {
    console.error(`An error occurred while handling a Slack event: ${error.message}`);
  }
});


// Start the express application
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server up on port ${port}`);
});
