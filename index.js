const fs = require('fs');
const readline = require('readline');
const {google} = require('googleapis');
var Mailchimp = require('mailchimp-api-v3')
var addrs = require("email-addresses")

var mailchimp = new Mailchimp(process.env.mailchimpAPI);

// If modifying these scopes, delete token.json.
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.modify'];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = 'token.json';

// Load client secrets from a local file.
fs.readFile('credentials.json', (err, content) => {
  if (err) return console.log('Error loading client secret file:', err);
  // Authorize a client with credentials, then call the Gmail API.
  // authorize(JSON.parse(content), listLabels);
  authorize(JSON.parse(content), readMessage);
});

/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
function authorize(credentials, callback) {
  const {client_secret, client_id, redirect_uris} = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(
      client_id, client_secret, redirect_uris[0]);

  // Check if we have previously stored a token.
  fs.readFile(TOKEN_PATH, (err, token) => {
    if (err) return getNewToken(oAuth2Client, callback);
    oAuth2Client.setCredentials(JSON.parse(token));
    callback(oAuth2Client);
  });
}

/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized OAuth2 client.
 * @param {google.auth.OAuth2} oAuth2Client The OAuth2 client to get token for.
 * @param {getEventsCallback} callback The callback for the authorized client.
 */
function getNewToken(oAuth2Client, callback) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });
  console.log('Authorize this app by visiting this url:', authUrl);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  rl.question('Enter the code from that page here: ', (code) => {
    rl.close();
    oAuth2Client.getToken(code, (err, token) => {
      if (err) return console.error('Error retrieving access token', err);
      oAuth2Client.setCredentials(token);
      // Store the token to disk for later program executions
      fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
        if (err) return console.error(err);
        console.log('Token stored to', TOKEN_PATH);
      });
      callback(oAuth2Client);
    });
  });
}

/**
 * Lists the labels in the user's account.
 *
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 */
function listLabels(auth) {
  const gmail = google.gmail({version: 'v1', auth});
  gmail.users.labels.list({
    userId: 'me',
  }, (err, res) => {
    if (err) return console.log('The API returned an error: ' + err);
    const labels = res.data.labels;
    if (labels.length) {
      console.log('Labels:');
      labels.forEach((label) => {
        console.log(`- ${label.name}`);
      });
    } else {
      console.log('No labels found.');
    }
  });
}

function readMessage(auth) {
  const gmail = google.gmail({version: 'v1', auth});
  gmail.users.messages.list({
    userId: 'me',
  }, (err, res) => {
    if (err) return console.log('The API returned an error: ' + err);
    if (res.data.messages) res.data.messages.forEach((message) => {

      gmail.users.messages.get({
        userId: 'me',
        id: message.id
      }, (err, res2) => {
        if (err) return console.log('The API returned an error: ' + err);
        var payload = res2.data.payload;
        //reading through multipart messages
        var messageBody = '';
        if(payload.parts) {
          // payload.parts.forEach((part) => {
            messageBody += Buffer.from(payload.parts[0].body.data, 'base64').toString('utf8');
          // })
        }
        //reading through singlepart messages
        else{
          // console.log(payload.body.data);
          messageBody += Buffer.from(payload.body.data, 'base64').toString('utf8');
        }

        // var messageBody = Buffer.from(res2.data.payload.parts[0].body.data, 'base64').toString('utf8');
        messageBody = messageBody.replace(/(\r\n|\n|\r)/gm, " ");
        // console.log(messageBody);
        var emailList = [];
        var list1 = messageBody.match(/(?<=(>,|> ,|To: |From: |Cc: ))(.*?)>/gm);
        if(list1) emailList = list1;
        var list2 = messageBody.match(/([a-zA-Z0-9_.-]*@.*\.[a-zA-Z0-9_.-]*)/g);
        if(list2) emailList.concat(list2);
        // if (err) return console.log('The API returned an error: ' + err);
        
        //reading through To, From, and Cc Headers
        var headers = res2.data.payload.headers;
        headers.forEach((header) => {
          if(header.name == 'From' || header.name == 'Cc' || header.name == 'To'){
            emailList.push(header.value);
          }
        })
        parseNamesAndAdd(emailList.join());
      });
    });
  });
}

function parseNamesAndAdd(nameList){
  var addressses = addrs.parseAddressList(nameList);
  if(addressses != null){
    var people = [];
    for(var i = 0; i < addressses.length; i++){
      var address = addressses[i];
      if(address != null){
        var email = address.address;
        var firstName = '';
        var lastName = '';
        if(address.name != null) {
          var fullName = address.name;  
          if(fullName.split(" ")[0]) firstName = fullName.split(" ")[0];
          if(fullName.split(" ")[1]) lastName = fullName.split(" ")[1];       
        }
        else {
          firstName = address.local;
        }
        var person = {email: email, firstName: firstName, lastName: lastName};
        people.push(person)
      }
    }
    // console.log(people);
    addMemberRecursive(people);
  }
  else{
    console.log("list was null :/");
  }
}

function addMember(email, firstName, lastName, callback, error){
  mailchimp.post('/lists/'+process.env.mailchimpListID+'/members', {
    email_address: email,
    status: "subscribed",
    merge_fields:{
      FNAME: firstName,
      LNAME: lastName
    }
  })
  .then(function (result) {
    callback(result);
  })
  .catch(function (err) {
    error(err);
  })
}

function addMemberRecursive(people){
  var person = people.pop();

  // console.log(person);

  var email = person.email;
  var firstName = person.firstName;
  var lastName = person.lastName;

  mailchimp.post('/lists/'+process.env.mailchimpListID+'/members', {
    email_address: email,
    status: "subscribed",
    merge_fields:{
      FNAME: firstName,
      LNAME: lastName
    }

  })
  .then(function (result) {
    addMemberRecursive(people);
  })
  .catch(function (err) {
    if(err.status == 400) console.log('member already added')
    else console.log(err);
    addMemberRecursive(people);
  })
}

if(process.env.DeleteAfter == "true"){
  console.log('deleting after')
  mailchimp.get('/lists/', {
  })
  .then(function (result) {
    // console.log(result);
  })
  .catch(function (err) {
    console.log(err);
  })
}
