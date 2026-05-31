// Run this ONCE locally to get your refresh token
// node get-token.js

require('dotenv').config();
const { google } = require('googleapis');
const readline = require('readline');

const CLIENT_ID = process.env.OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET;
const REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob';

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/spreadsheets'
  ]
});

console.log('\n🔐 Open this URL in your browser:\n');
console.log(authUrl);
console.log('\nAfter authorizing, paste the code below:\n');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

rl.question('Paste code here: ', async (code) => {
  rl.close();
  const { tokens } = await oauth2Client.getToken(code.trim());
  console.log('\n✅ Got your tokens! Add these to Railway Variables:\n');
  console.log(`OAUTH_REFRESH_TOKEN=${tokens.refresh_token}`);
  console.log('\nKeep this safe — you only need to run this once.');
});
