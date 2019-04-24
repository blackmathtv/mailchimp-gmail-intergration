const fs = require('fs');
const readline = require('readline');
const { google } = require('googleapis');
var Mailchimp = require('mailchimp-api-v3')
var addrs = require("email-addresses")

require('dotenv').config()

var mailchimp = new Mailchimp(process.env.mailchimpAPI);

// +===========================================+
// |        BEGIN GMAIL AUTH BOILERPLATE       |
// +===========================================+

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
  authorize(JSON.parse(content), scanMailForAddresses);
});

/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
function authorize(credentials, callback) {
  const { client_secret, client_id, redirect_uris } = credentials.installed;
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

// +===========================================+
// |        END GMAIL AUTH BOILERPLATE         |
// +===========================================+

function scanMailForAddresses(auth) {
  const gmail = google.gmail({ version: 'v1', auth });

  //make request to get list of the ids of all of the email in inbox
  gmail.users.messages.list({
    userId: 'me',
  }, (err, messageListResponse) => {
    if (err) return console.log('The API returned an error: ' + err);
    if (messageListResponse.data.messages) {

      //Make request for each email in inbox
      messageListResponse.data.messages.forEach((message) => {
        gmail.users.messages.get({
          userId: 'me',
          id: message.id
        },
          (err, messageResponse) => {
            if (err) return console.log('The API returned an error: ' + err);

            searchEmailForAddresses(messageResponse,
              function (emailList) {
                
                //parse addresses and full names into array of objects 
                parseAddresses(emailList,
                  function (people) {

                    //add every account in array of object to mailchimp 
                    addListToMailchimp(people)
                  }
                )
              }
            )
            sendMailToTrashOption(messageResponse, auth)
          });
      });
    }
  });
}

function searchEmailForAddresses(messageResponse, callback) {
  //get the email's content
  var payload = messageResponse.data.payload;
  //reading through multipart messages
  var messageBody = '';
  if (payload.parts) {
    messageBody += Buffer.from(payload.parts[0].body.data, 'base64').toString('utf8');
  }
  //reading through singlepart messages
  else {
    messageBody += Buffer.from(payload.body.data, 'base64').toString('utf8');
  }

  //remove all unneeded whitespace
  messageBody = messageBody.replace(/(\r\n|\n|\r)/gm, " ");

  var emailList = [];

  //parse all email addressses from the email chain's To, From, and Cc feilds
  var list1 = messageBody.match(/(?<=(>,|> ,|To: |From: |Cc: ))(.*?)>/gm);
  if (list1) emailList.concat(list1);

  //parse any other email addresses found in the email
  var list2 = messageBody.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/g);
  if (list2) emailList = emailList.concat(list2);

  //reading through To, From, and Cc Headers of the email
  var headers = messageResponse.data.payload.headers;
  headers.forEach((header) => {
    if (header.name == 'From' || header.name == 'Cc' || header.name == 'To') {
      emailList.push(header.value);
    }
    if (header.name == 'Subject') {
      console.log('\x1b[33mSubject: ' + header.value + '\x1b[0m');
    }
  })
  emailList = emailList.join();

  // console.log('\x1b[32m'+messageBody+ '\x1b[0m');
  // console.log(emailList);

  callback(emailList);
}

function parseAddresses(nameList, callback) {
  var addressses = addrs.parseAddressList(nameList);
  if (addressses != null) {
    var people = [];
    for (var i = 0; i < addressses.length; i++) {
      var address = addressses[i];
      if (address != null) {
        var email = address.address;
        var firstName = '';
        var lastName = '';
        if (address.name != null) {
          var fullName = address.name;
          if (fullName.split(" ")[0]) firstName = fullName.split(" ")[0];
          if (fullName.split(" ")[1]) lastName = fullName.split(" ")[1];
        }
        else {
          firstName = address.local;
        }
        if (email) {
          // console.log(email)
          var person = { email: email, firstName: firstName, lastName: lastName };
        }
        people.push(person)
      }
    }
    callback(people);
  }
  else {
    console.log("list was null :/");
  }
}

function addListToMailchimp(people) {
  try {
    var person = people.pop();

    if (person !== null && person.email !== null) {
      var email = person.email;

      if (person.firstName !== null) {
        var firstName = person.firstName;
      }
      else {
        var firstName = ' ';
      }

      if (person.lastName !== null) {
        var lastName = person.lastName;
      }
      else {
        var lastName = ' ';
      }

      mailchimp.post('/lists/' + process.env.mailchimpListID + '/members', {
        email_address: email,
        status: "subscribed",
        merge_fields: {
          FNAME: firstName,
          LNAME: lastName
        }
      })
        .then(function (result) {
          console.log('\x1b[36m' + email + ' was added successfully' + "\x1b[0m");
          addListToMailchimp(people);
        })
        .catch(function (err) {
          if (err.status == 400) console.log("\x1b[33m" + email + ' was already added' + "\x1b[0m")
          else console.log(err);
          addListToMailchimp(people);
        })
    }
    else {
      console.log('\x1b[31m Error! Email was null :/ \x1b[0m');
    }
  }
  catch (err) {
    // console.log('weird error');
  }
}

function sendMailToTrashOption(message, auth){

  if (process.env.DeleteAfter == "true") {

    const gmail = google.gmail({ version: 'v1', auth });
    // console.log(messageResponse);
    // console.log(message.data.id)
    gmail.users.messages.trash(
      {
        userId: 'me',
        id: (message.data.id)
      },
      (err, res) => 
      {
        if(err) console.log(err)
        else console.log(res)
      }
    )
    console.log('deleting message')
  }
}

