const fs = require('fs');
const readline = require('readline');
const { promisify } = require('util');
const writeFileAsync = promisify(fs.writeFile);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const questions = [
  { key: 'PLESKKEY', question: 'Enter your Plesk API Key: ' },
  { key: 'PLESKURL', question: 'Enter your Plesk URL: ' },
  { key: 'CLOUDKEY', question: 'Enter your Cloudflare API Key: ' },
  { key: 'CLOUDEMAIL', question: 'Enter your Cloudflare Email: ' },
  { key: 'CLOUDACCOUNTID', question: 'Enter your Cloudflare Account ID: ' },  
  { key: 'EMAIL', question: 'Enter your email for notifications: ' },
  { key: 'SENDER', question: 'Enter the sender email address: ' },
  { key: 'SPASS', question: 'Enter the sender email password: ' },
  { key: 'HOST', question: 'Enter the SMTP host: ' },
];

(async () => {
  const answers = {};
  for (const { key, question } of questions) {
    answers[key] = await new Promise(resolve => rl.question(question, resolve));
  }
  rl.close();

  const envContent = Object.entries(answers).map(([key, value]) => `${key}=${value}`).join('\n');
  await writeFileAsync('.env', envContent);
  console.log('Environment variables set up successfully.');
})();
