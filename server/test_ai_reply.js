const http = require('http');

function postJson(path, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = http.request(
      {
        hostname: 'localhost',
        port: 3000,
        path: path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        }
      },
      (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(body) });
          } catch (e) {
            resolve({ status: res.statusCode, raw: body });
          }
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function getJson(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:3000${path}`, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: body });
        }
      });
    }).on('error', reject);
  });
}

async function runTests() {
  console.log('\n--- 1. Testing GET /health ---');
  const health = await getJson('/health');
  console.log('Health:', health);

  console.log('\n--- 2. Testing POST /api/sync-contacts ---');
  const sync = await postJson('/api/sync-contacts', {
    contacts: [
      { chatId: '923001234567@c.us', name: 'Usman Ali', number: '+92 300 1234567', isSaved: true, lastMsgTime: '17:00' },
      { chatId: '923119876543@c.us', name: 'Unknown', number: '+92 311 9876543', isSaved: false, lastMsgTime: '16:45' }
    ]
  });
  console.log('Sync result:', sync);

  console.log('\n--- 3. Testing GET /api/contacts ---');
  const contacts = await getJson('/api/contacts');
  console.log('Contacts:', contacts);

  console.log('\n--- 4. Testing POST /ai-reply (Gemini Multi-Key Failover Engine) ---');
  const aiTest = await postJson('/ai-reply', {
    chatId: '923001234567@c.us',
    chatTitle: 'Usman Ali',
    senderName: 'Usman Ali',
    senderNumber: '+92 300 1234567',
    isSaved: true,
    incomingMessages: [
      { text: 'AoA bhai', timestamp: '17:05:00' },
      { text: 'Kese ho? Kal uni ao ge?', timestamp: '17:05:05' }
    ],
    chatHistory: [
      { fromMe: false, text: 'Suno kal assignments submit karwane hain?', timestamp: '10:00' },
      { fromMe: true, text: 'Walaikum Assalam, haan bhai deadline kal sham tak hai.', timestamp: '10:02' },
      { fromMe: false, text: 'Sahi hai theek ho gaya', timestamp: '10:05' },
      { fromMe: true, text: 'Done karo', timestamp: '10:06' }
    ]
  });
  console.log('AI Reply Response:', aiTest);
}

runTests().catch(console.error);
