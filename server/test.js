const http = require('http');

const testCases = [
  {
    name: '1-on-1 Saved Contact (Auto-Reply Sent)',
    payload: {
      isGroup: false,
      isSaved: true,
      chatTitle: 'John Doe',
      senderName: 'John Doe',
      senderNumber: '+923001234567',
      message: 'Hey, are you free today for a quick sync?',
      timestamp: '19:55:10',
      autoReplied: true,
      cooldownActive: false
    }
  },
  {
    name: '1-on-1 Unsaved Contact (Auto-Reply Skipped due to Cooldown)',
    payload: {
      isGroup: false,
      isSaved: false,
      chatTitle: '+92 300 1234567',
      senderName: 'Unknown',
      senderNumber: '+92 300 1234567',
      message: 'Hello, are you there?',
      timestamp: '19:55:12',
      autoReplied: false,
      cooldownActive: true
    }
  },
  {
    name: 'Group Chat (No Auto-Reply)',
    payload: {
      isGroup: true,
      isSaved: false,
      chatTitle: 'BS(IT) 8th',
      senderName: 'Ali Khan',
      senderNumber: '+92 311 9876543',
      message: 'Assignment submission deadline is tomorrow at 5 PM.',
      timestamp: '19:55:15',
      autoReplied: false,
      cooldownActive: false
    }
  }
];

function sendTest(tc) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(tc.payload);
    const req = http.request(
      {
        hostname: 'localhost',
        port: 3000,
        path: '/log-message',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        }
      },
      (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => resolve(JSON.parse(body)));
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function run() {
  for (const tc of testCases) {
    console.log(`\n>>> Testing: ${tc.name}`);
    const res = await sendTest(tc);
    console.log('Response:', res);
  }
}

run();
