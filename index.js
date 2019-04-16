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
    slack.chat.postMessage({ channel: message.channel, blocks: [
      {
        'type': 'section',
        'text': {
          'type': 'mrkdwn',
          'text': 'I saw that you posted a code snippet!\n\n*Do you want to save it as a Gist on GitHub?*',
        },
      },
      {
        'type': 'actions',
        'elements': [
          {
            'type': 'button',
            'text': {
              'type': 'plain_text',
              'emoji': true,
              'text': 'Yes',
            },
            'value': 'click_me_123',
            'style': 'primary',
          },
          {
            'type': 'button',
            'text': {
              'type': 'plain_text',
              'emoji': true,
              'text': 'No',
            },
            'value': 'click_me_123',
            'style': 'danger',
          },
        ],
      },
      {
        'type': 'divider',
      },
      {
        'type': 'section',
        'text': {
          'type': 'mrkdwn',
          'text': '*Here is the information I will save for you...*',
        },
      },
      {
        'type': 'section',
        'text': {
          'type': 'mrkdwn',
          'text': '*File name:*\nmy-amazing-gist\n\n*Author:*\n',
        },
      },
      {
        'type': 'actions',
        'elements': [
          {
            'type': 'users_select',
            'placeholder': {
              'type': 'plain_text',
              'text': 'Select a user',
              'emoji': true,
            },
          },
        ],
      },
      {
        'type': 'section',
        'text': {
          'type': 'mrkdwn',
          'text': '*Choose a category*',
        },
        'accessory': {
          'type': 'static_select',
          'placeholder': {
            'type': 'plain_text',
            'text': 'Select a category',
            'emoji': true,
          },
          'options': [
            {
              'text': {
                'type': 'plain_text',
                'text': 'Data Structures',
                'emoji': true,
              },
              'value': 'value-0',
            },
            {
              'text': {
                'type': 'plain_text',
                'text': 'Login Instructions',
                'emoji': true,
              },
              'value': 'value-1',
            },
            {
              'text': {
                'type': 'plain_text',
                'text': 'Random Stuff',
                'emoji': true,
              },
              'value': 'value-2',
            },
          ],
        },
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