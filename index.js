// Load environment variables from `.env` file (optional)
require('dotenv').config();

const slackEventsApi = require('@slack/events-api');
const SlackClient = require('@slack/client').WebClient;
const passport = require('passport');
const LocalStorage = require('node-localstorage').LocalStorage;
const SlackStrategy = require('@aoberoi/passport-slack').default.Strategy;
const http = require('http');
const express = require('express');

// *** Initialize event adapter using signing secret from environment variables ***
const slackEvents = slackEventsApi.createEventAdapter(process.env.SLACK_SIGNING_SECRET, {
  includeBody: true,
});

// Initialize a Local Storage object to store authorization info
// NOTE: This is an insecure method and thus for demo purposes only!
const botAuthorizationStorage = new LocalStorage('./storage');

// Helpers to cache and lookup appropriate client
// NOTE: Not enterprise-ready. if the event was triggered inside a shared channel, this lookup
// could fail but there might be a suitable client from one of the other teams that is within that
// shared channel.
const clients = {};
function getClientByTeamId(teamId) {
  if (!clients[teamId] && botAuthorizationStorage.getItem(teamId)) {
    clients[teamId] = new SlackClient(botAuthorizationStorage.getItem(teamId));
  }
  if (clients[teamId]) {
    return clients[teamId];
  }
  return null;
}

// Initialize Add to Slack (OAuth) helpers
passport.use(new SlackStrategy({
  clientID: process.env.SLACK_CLIENT_ID,
  clientSecret: process.env.SLACK_CLIENT_SECRET,
  skipUserProfile: true,
}, (accessToken, scopes, team, extra, profiles, done) => {
  botAuthorizationStorage.setItem(team.id, extra.bot.accessToken);
  done(null, {});
}));

// Initialize an Express application
const app = express();

// Plug the Add to Slack (OAuth) helpers into the express app
app.use(passport.initialize());
app.get('/', (req, res) => {
  res.send('<a href="/auth/slack"><img alt="Add to Slack" height="40" width="139" src="https://platform.slack-edge.com/img/add_to_slack.png" srcset="https://platform.slack-edge.com/img/add_to_slack.png 1x, https://platform.slack-edge.com/img/add_to_slack@2x.png 2x" /></a>');
});
app.get('/auth/slack', passport.authenticate('slack', {
  scope: ['bot'],
}));
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
app.use('/slack/events', slackEvents.expressMiddleware());

// *** Attach listeners to the event adapter ***

// *** Greeting any user that says "clean" ***
slackEvents.on('message', (message, body) => {
  // Only deal with messages that have no subtype (plain messages) and contain 'hi'
  if (!message.subtype && message.text.indexOf('clean') >= 0) {
    // Initialize a client
    const slack = getClientByTeamId(body.team_id);
    // Handle initialization failure
    if (!slack) {
      return console.error('No authorization found for this team. Did you install the app through the url provided by ngrok?');
    }
    // Respond to the message back in the same channel
    slack.chat.postMessage({ channel: message.channel, text: `I am too tired to clean <@${message.user}>! :tired_face:` })
      .catch(console.error);
  }
});

slackEvents.on('file_created', (message, body) => {
  // Only deal with messages that have no subtype (plain messages) and contain 'hi'
  if (message.type === 'file_created') {
    console.log('file successfully created:', message);
    // Initialize a client
    const slack = getClientByTeamId(body.team_id);
    // Handle initialization failure
    if (!slack) {
      return console.error('No authorization found for this team. Did you install the app through the url provided by ngrok?');
    }
    // Respond to the message back in the same channel
    slack.chat.postMessage({ channel: message.channel, text: `I saved your file :file_folder: <@${message.user}>! :tada: :tada:` })
      .catch(console.error);
  }
});

// // *** Greeting any user that says "```" ***
// slackEvents.on('message', (message, body) => {
//   // Only deal with messages that have no subtype (plain messages) and contain 'hi'
//   if (!message.subtype && message.text.indexOf('```') >= 0) {
//     console.log('backtick message:', message);
//     // Initialize a client
//     const slack = getClientByTeamId(body.team_id);
//     // Handle initialization failure
//     if (!slack) {
//       return console.error('No authorization found for this team. Did you install the app through the url provided by ngrok?');
//     }
//     // Respond to the message back in the same channel
//     slack.chat.postMessage({ channel: message.channel, blocks: [
//       {
//         'type': 'section',
//         'text': {
//           'type': 'mrkdwn',
//           'text': 'I saw that you posted a code snippet!\n\n*Do you want to save it as a Gist on GitHub?*',
//         },
//       },
//       {
//         'type': 'actions',
//         'elements': [
//           {
//             'type': 'button',
//             'text': {
//               'type': 'plain_text',
//               'emoji': true,
//               'text': 'Yes',
//             },
//             'value': 'click_me_123',
//             'style': 'primary',
//           },
//           {
//             'type': 'button',
//             'text': {
//               'type': 'plain_text',
//               'emoji': true,
//               'text': 'No',
//             },
//             'value': 'click_me_123',
//             'style': 'danger',
//           },
//         ],
//       },
//       {
//         'type': 'divider',
//       },
//       {
//         'type': 'section',
//         'text': {
//           'type': 'mrkdwn',
//           'text': '*Here is the information I will save for you...*',
//         },
//       },
//       {
//         'type': 'section',
//         'text': {
//           'type': 'mrkdwn',
//           'text': '*File name:*\nmy-amazing-gist\n\n*Author:*\n',
//         },
//       },
//       {
//         'type': 'actions',
//         'elements': [
//           {
//             'type': 'users_select',
//             'placeholder': {
//               'type': 'plain_text',
//               'text': 'Select a user',
//               'emoji': true,
//             },
//           },
//         ],
//       },
//       {
//         'type': 'section',
//         'text': {
//           'type': 'mrkdwn',
//           'text': '*Choose a category*',
//         },
//         'accessory': {
//           'type': 'static_select',
//           'placeholder': {
//             'type': 'plain_text',
//             'text': 'Select a category',
//             'emoji': true,
//           },
//           'options': [
//             {
//               'text': {
//                 'type': 'plain_text',
//                 'text': 'Data Structures',
//                 'emoji': true,
//               },
//               'value': 'value-0',
//             },
//             {
//               'text': {
//                 'type': 'plain_text',
//                 'text': 'Login Instructions',
//                 'emoji': true,
//               },
//               'value': 'value-1',
//             },
//             {
//               'text': {
//                 'type': 'plain_text',
//                 'text': 'Random Stuff',
//                 'emoji': true,
//               },
//               'value': 'value-2',
//             },
//           ],
//         },
//       },
//     ] })
//       .catch(console.error);
//   }
// });

// *** Greeting any user that says "```" ***
slackEvents.on('message', (message, body) => {
  // Only deal with messages that have no subtype (plain messages) and contain 'hi'
  if (!message.subtype && message.text.indexOf('```') >= 0) {
    console.log('backtick message:', message);
    // Initialize a client
    const slack = getClientByTeamId(body.team_id);
    // Handle initialization failure
    if (!slack) {
      return console.error('No authorization found for this team. Did you install the app through the url provided by ngrok?');
    }
    // Respond to the message back in the same channel
    slack.chat.postMessage({ channel: message.channel, blocks:
      [
        {
          'type': 'section',
          'text': {
            'type': 'mrkdwn',
            'text': 'I saw that you shared a code snippet!\n\n*Do you want to save it as a Gist on GitHub?*\n\n*Reminder:* _Did you give your code snippet a "Title"? If not you can go add one by clicking the :pencil2: to the right of your snippet message and editing the file_',
          },
          'accessory': {
            'type': 'image',
            'image_url': 'https://i.imgur.com/jkFJzPt.png',
            'alt_text': 'palm tree',
          },
        },
        {
          'type': 'actions',
          'elements': [
            {
              'type': 'button',
              'text': {
                'type': 'plain_text',
                'text': 'Yes',
                'emoji': true,
              },
              'value': 'click_me_123',
              'style': 'primary',
            },
            {
              'type': 'button',
              'text': {
                'type': 'plain_text',
                'text': 'No',
                'emoji': true,
              },
              'value': 'click_me_124',
              'style': 'danger',
            },
          ],
        },
      ] })
      .catch(console.error);
  }
});

// *** Greeting any user that says "save" ***
slackEvents.on('message', (message, body) => {
  // Only deal with messages that have no subtype (plain messages) and contain 'save'
  if (!message.subtype && message.text.indexOf('save') >= 0) {
    console.log('backtick message:', message);
    // Initialize a client
    const slack = getClientByTeamId(body.team_id);
    // Handle initialization failure
    if (!slack) {
      return console.error('No authorization found for this team. Did you install the app through the url provided by ngrok?');
    }
    // Respond to the message back in the same channel
    slack.chat.postMessage({ channel: message.channel, blocks:
      [
        {
          'type': 'section',
          'text': {
            'type': 'mrkdwn',
            'text': 'I am so excited that you want save your code snippet as a Gist!!\n\n\n*Reminder:* _If you don\'t like what you see below you can go edit your snippet and I will ask again after you save :grin:_\n\n\n*This is what I will save for you:*',
          },
          'accessory': {
            'type': 'image',
            'image_url': 'https://i.imgur.com/jkFJzPt.png',
            'alt_text': 'slack lackey',
          },
        },
        {
          'type': 'divider',
        },
        {
          'type': 'section',
          'text': {
            'type': 'mrkdwn',
            'text': '*Title:*\n\n FAKE-TITLE-HERE',
          },
        },
        {
          'type': 'section',
          'text': {
            'type': 'mrkdwn',
            'text': '*Author:*',
          },
        },
        {
          'type': 'actions',
          'elements': [
            {
              'type': 'users_select',
              'placeholder': {
                'type': 'plain_text',
                'text': 'Select a User',
                'emoji': true,
              },
            },
          ],
        },
        {
          'type': 'section',
          'text': {
            'type': 'mrkdwn',
            'text': '*Subject Keywords:*',
          },
        },
        {
          'type': 'actions',
          'elements': [
            {
              'type': 'static_select',
              'placeholder': {
                'type': 'plain_text',
                'text': 'Data Structures',
                'emoji': true,
              },
              'options': [
                {
                  'text': {
                    'type': 'plain_text',
                    'text': 'Array Methods',
                    'emoji': true,
                  },
                  'value': 'value-0',
                },
                {
                  'text': {
                    'type': 'plain_text',
                    'text': 'Linked Lists',
                    'emoji': true,
                  },
                  'value': 'value-1',
                },
                {
                  'text': {
                    'type': 'plain_text',
                    'text': 'Stacks',
                    'emoji': true,
                  },
                  'value': 'value-2',
                },
                {
                  'text': {
                    'type': 'plain_text',
                    'text': 'Queues',
                    'emoji': true,
                  },
                  'value': 'value-3',
                },
                {
                  'text': {
                    'type': 'plain_text',
                    'text': 'Binary Trees',
                    'emoji': true,
                  },
                  'value': 'value-4',
                },
                {
                  'text': {
                    'type': 'plain_text',
                    'text': 'Hash Tables',
                    'emoji': true,
                  },
                  'value': 'value-5',
                },
              ],
            },
            {
              'type': 'static_select',
              'placeholder': {
                'type': 'plain_text',
                'text': 'Code Tools',
                'emoji': true,
              },
              'options': [
                {
                  'text': {
                    'type': 'plain_text',
                    'text': 'Mongo',
                    'emoji': true,
                  },
                  'value': 'value-0',
                },
                {
                  'text': {
                    'type': 'plain_text',
                    'text': 'React',
                    'emoji': true,
                  },
                  'value': 'value-1',
                },
                {
                  'text': {
                    'type': 'plain_text',
                    'text': 'PSQL',
                    'emoji': true,
                  },
                  'value': 'value-2',
                },
                {
                  'text': {
                    'type': 'plain_text',
                    'text': 'AWS',
                    'emoji': true,
                  },
                  'value': 'value-3',
                },
                {
                  'text': {
                    'type': 'plain_text',
                    'text': 'Azure',
                    'emoji': true,
                  },
                  'value': 'value-4',
                },
                {
                  'text': {
                    'type': 'plain_text',
                    'text': 'Heroku',
                    'emoji': true,
                  },
                  'value': 'value-5',
                },
                {
                  'text': {
                    'type': 'plain_text',
                    'text': 'JSDOCS',
                    'emoji': true,
                  },
                  'value': 'value-6',
                },
                {
                  'text': {
                    'type': 'plain_text',
                    'text': 'Swagger',
                    'emoji': true,
                  },
                  'value': 'value-7',
                },
              ],
            },
            {
              'type': 'static_select',
              'placeholder': {
                'type': 'plain_text',
                'text': 'Other Random Topics',
                'emoji': true,
              },
              'options': [
                {
                  'text': {
                    'type': 'plain_text',
                    'text': 'Useful Terminal Commands',
                    'emoji': true,
                  },
                  'value': 'value-0',
                },
                {
                  'text': {
                    'type': 'plain_text',
                    'text': 'ASCII Art',
                    'emoji': true,
                  },
                  'value': 'value-1',
                },
                {
                  'text': {
                    'type': 'plain_text',
                    'text': 'CSS Tricks',
                    'emoji': true,
                  },
                  'value': 'value-2',
                },
                {
                  'text': {
                    'type': 'plain_text',
                    'text': 'Too Random to Categorize',
                    'emoji': true,
                  },
                  'value': 'value-2',
                },
              ],
            },
          ],
        },
        {
          'type': 'section',
          'text': {
            'type': 'mrkdwn',
            'text': '*Link to Snippet:*',
          },
        },
        {
          'type': 'section',
          'text': {
            'type': 'mrkdwn',
            'text': '<https://slacklackey.slack.com/files/UHVUXRV2B/FHY6E36NL/title_to_snippet.pl/edit>',
          },
        },
        {
          'type': 'actions',
          'elements': [
            {
              'type': 'button',
              'text': {
                'type': 'plain_text',
                'text': 'Save as a Gist!',
                'emoji': true,
              },
              'value': 'click_me_123',
            },
          ],
        },
      ] })
      .catch(console.error);
  }
});

// *** Greeting any user that says "success" ***
slackEvents.on('message', (message, body) => {
  // Only deal with messages that have no subtype (plain messages) and contain 'success'
  if (!message.subtype && message.text.indexOf('success') >= 0) {
    console.log('backtick message:', message);
    // Initialize a client
    const slack = getClientByTeamId(body.team_id);
    // Handle initialization failure
    if (!slack) {
      return console.error('No authorization found for this team. Did you install the app through the url provided by ngrok?');
    }
    // Respond to the message back in the same channel
    slack.chat.postMessage({ channel: message.channel, blocks:
      [
        {
          'type': 'section',
          'text': {
            'type': 'mrkdwn',
            'text': '*I saved your Gist!*\n\nHere is your URL if you want to share it with others.\n\n<https://media.giphy.com/media/zaqclXyLz3Uoo/giphy.gif>\n\n',
          },
          'accessory': {
            'type': 'image',
            'image_url': 'https://i.imgur.com/jkFJzPt.png',
            'alt_text': 'slack lackey',
          },
        },
        {
          'type': 'actions',
          'elements': [
            {
              'type': 'button',
              'text': {
                'type': 'plain_text',
                'text': 'See Your Gist on GitHub',
                'emoji': true,
              },
              'value': 'click_me_123',
            },
          ],
        },
        {
          'type': 'divider',
        },
        {
          'type': 'image',
          'title': {
            'type': 'plain_text',
            'text': 'Success',
            'emoji': true,
          },
          'image_url': 'https://media.giphy.com/media/skmziDEEjiin6/giphy.gif',
          'alt_text': 'Success GIF',
        },
        {
          'type': 'section',
          'text': {
            'type': 'plain_text',
            'text': ' ',
            'emoji': true,
          },
        },
        {
          'type': 'divider',
        },
        {
          'type': 'actions',
          'elements': [
            {
              'type': 'button',
              'text': {
                'type': 'plain_text',
                'text': 'Share to Channel',
                'emoji': true,
              },
              'value': 'click_me_123',
            },
          ],
        },
      ] })
      .catch(console.error);
  }
});

// *** Responding to reactions with the same emoji ***
slackEvents.on('reaction_added', (event, body) => {
  // Initialize a client
  const slack = getClientByTeamId(body.team_id);
  // Handle initialization failure
  if (!slack) {
    return console.error('No authorization found for this team. Did you install the app through the url provided by ngrok?');
  }
  // Respond to the reaction back with the same emoji
  slack.chat.postMessage({ channel: event.item.channel, text: `:${event.reaction}:` })
    .catch(console.error);
});



// *** Handle errors ***
slackEvents.on('error', (error) => {
  if (error.code === slackEventsApi.errorCodes.TOKEN_VERIFICATION_FAILURE) {
    // This error type also has a `body` propery containing the request body which failed verification.
    console.error(`An unverified request was sent to the Slack events Request URL. Request body: \
${JSON.stringify(error.body)}`);
  } else {
    console.error(`An error occurred while handling a Slack event: ${error.message}`);
  }
});

// Start the express application
const port = process.env.PORT || 3000;
http.createServer(app).listen(port, () => {
  console.log(`server listening on port ${port}`);
});