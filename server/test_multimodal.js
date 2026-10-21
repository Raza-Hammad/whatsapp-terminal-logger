/**
 * Test Multimodal Gemini Auto-Reply with Image and Document Payload
 */
const http = require('http');

// Small valid 1x1 PNG in base64
const samplePngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const payload = {
  chatId: '923001234567@c.us',
  chatTitle: 'Hamza Bhai',
  senderName: 'Hamza',
  senderNumber: '+92 300 1234567',
  isSaved: true,
  incomingMessages: [
    {
      text: 'Bhai yeh image check karna kaisa lag raha hai?',
      timestamp: '08:52:10 PM',
      media: {
        hasMedia: true,
        mediaType: 'image',
        mimeType: 'image/png',
        fileName: 'design_sample.png',
        fileSize: 120,
        caption: 'Yeh check karo',
        base64Data: samplePngBase64
      }
    }
  ],
  chatHistory: [
    { fromMe: true, text: 'Acha suno kal kab milna hai?', timestamp: '08:30:00 PM' },
    { fromMe: false, text: 'Sham 6 baje bhai', timestamp: '08:35:00 PM' }
  ]
};

const data = JSON.stringify(payload);

const req = http.request({
  hostname: 'localhost',
  port: 3000,
  path: '/ai-reply',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  }
}, (res) => {
  let responseData = '';
  res.on('data', chunk => responseData += chunk);
  res.on('end', () => {
    console.log('HTTP Status:', res.statusCode);
    try {
      const parsed = JSON.parse(responseData);
      console.log('Response JSON:', JSON.stringify(parsed, null, 2));
    } catch (e) {
      console.log('Raw Response:', responseData);
    }
  });
});

req.on('error', (e) => {
  console.error('Request error:', e.message);
});

req.write(data);
req.end();
