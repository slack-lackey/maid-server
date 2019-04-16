// Load environment variables from `.env` file (optional)
require('dotenv').config();

const slackEventsApi = require('@slack/events-api');
const SlackClient = require('@slack/client').WebClient;
const passport = require('passport');
const LocalStorage = require('node-localstorage').LocalStorage;
const SlackStrategy = require('@aoberoi/passport-slack').default.Strategy;
const http = require('http');
const express = require('express');
const request = require('request');
const bodyParser = require('body-parser');
const urlencodedParser = bodyParser.urlencoded({extended: false});
const superagent = require('superagent');
// *** Initialize event adapter using signing secret from environment variables ***
const slackEvents = slackEventsApi.createEventAdapter(process.env.SLACK_SIGNING_SECRET, {
  includeBody: true,
});
console.log('abcdefg received:');
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
  console.log('message received:');
  console.log('message type:' + message.subtype);
  console.log('message:' + message.text);
  // Only deal with messages that have no subtype (plain messages) and contain 'sweep'
  if (!message.subtype && message.text.indexOf('sweep') >= 0) {
    // Initialize a client
    const slack = getClientByTeamId(body.team_id);
    console.log(slack, 'what is inside');
    // Handle initialization failure
    if (!slack) {
      return console.error('No authorization found for this team. Did you install the app through the url provided by ngrok?');
    }
    // Respond to the message back in the same channel
    slack.chat.postMessage({ channel: message.channel, text: `I am too tired to clean <@${message.user}>! :tired_face:` })
      .catch(console.error);
  }

});

slackEvents.on('file_created', (event, body) => {
  // Only deal with events that have no subtype (plain events) and contain 'hi'
  console.log(event.channels.info(), 'what is this?');
  handle_file_event('file_created', handle_file_event);
  // let fileInfo = handle_file_event('file_created', handle_file_event);
  // let channel = event.file.channels;
  // console.log(channel, 'CHANNEL!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
  if (event.type === 'file_created') {
    // console.log('file successfully created:', message);
    // Initialize a client
    console.log('i did what you wanted');
    const slack = getClientByTeamId(body.team_id);
    // Handle initialization failure
    if (!slack) {
      return console.error('No authorization found for this team. Did you install the app through the url provided by ngrok?');
    }
    // Respond to the message back in the same channel
    slack.chat.postMessage({ channel: event.channel, text: `I saved your file :file_folder: <@${event.user}>! :tada: :tada:` })
      .catch(console.error);
  }
});

function handle_file_event(event, body){

  // console.log('event==>:');
  // console.log(event);
  // console.log(event.file_id);
  // console.log('body==>:');
  // console.log(body);
  let url = 'https://slack.com/api/files.info?file=' + event.file_id +'&token=' + process.env.SLACK_AUTH_TOKEN;
  // console.log(url);
  superagent.get(url).then( data => {
    // console.log(data.body);
    // console.log('data.body.content------------>');
    // console.log(data.body.title);
    console.log(data.body.content);
    console.log('channels --------------------------------------------->', data.body.chanels);
    // console.log(data.body.timestamp);
    //let gist_id_url = call_gist(),
    //mongodb.save(,title, name,   , , , ,, , )  
    //mongodb.search(fromTime, endTime, title:abcdefg)
  });
    
}

slackEvents.on('file_created', handle_file_event);
slackEvents.on('file_change', handle_file_event);


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

app.post('/slack/slash-commands/send-me-buttons', urlencodedParser, (req, res) =>{
  console.log('send-me-buttons-----------');
  res.status(200).end(); // best practice to respond with empty 200 status code
  var reqBody = req.body;
  var responseURL = reqBody.response_url;
  if (reqBody.token != process.env.VERIFICATION_TOKEN){
    res.status(403).end('Access forbidden');
  }else{
    var message = {
      'text': 'This is your first interactive message',
      'attachments': [
        {
          'text': 'Building buttons is easy right?',
          'fallback': 'Shame... buttons aren\'t supported in this land',
          'callback_id': 'button_tutorial',
          'color': '#3AA3E3',
          'attachment_type': 'default',
          'actions': [
            {
              'name': 'yes',
              'text': 'yes',
              'type': 'button',
              'value': 'yes',
            },
            {
              'name': 'no',
              'text': 'no',
              'type': 'button',
              'value': 'no',
            },
            {
              'name': 'maybe',
              'text': 'maybe',
              'type': 'button',
              'value': 'maybe',
              'style': 'danger',
            },
          ],
        },
      ],
    };
    sendMessageToSlackResponseURL(responseURL, message);
  }
});

function sendMessageToSlackResponseURL(responseURL, JSONmessage){
  console.log('sendMessageToSlackResponseURL blablalba');
  var postOptions = {
    uri: responseURL,
    method: 'POST',
    headers: {
      'Content-type': 'application/json',
    },
    json: JSONmessage,
  };
  request(postOptions, (error, response, body) => {
    if (error){
      // handle errors as you see fit
    }
  });
}

app.post('/slack/actions', urlencodedParser, (req, res) =>{

  console.log('/slack/actions blablalba');

  res.status(200).end(); // best practice to respond with 200 status
  var actionJSONPayload = JSON.parse(req.body.payload); // parse URL-encoded payload JSON string
  var message = {
    'text': actionJSONPayload.user.name+' clicked: '+actionJSONPayload.actions[0].name,
    'replace_original': false,
  };
  sendMessageToSlackResponseURL(actionJSONPayload.response_url, message);
});
   

// Start the express application
const port = process.env.PORT || 3000;
http.createServer(app).listen(port, () => {
  console.log(`server listening on port ${port}`);
});