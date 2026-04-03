const express = require('express');
const cors = require('cors');
const fs = require('fs');
const readline = require('readline');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// 1. Load the RSA Private Key
// IMPORTANT: Make sure 'edge_private_key.pem' is in the same folder as this script!
const privateKeyPem = fs.readFileSync('edge_private_key.pem', 'utf8');

// --- HELPER: Mimic Python's json.dumps() spacing ---
// Python spaces JSON like this: {"a": 1, "b": 2} and [1, 2, 3]
// Node.js spaces JSON like this: {"a":1,"b":2} and [1,2,3]
// We MUST mimic Python so the Fog layer's signature/AAD verification doesn't fail.
function pythonJsonDumps(obj, sortKeys = false) {
    if (Array.isArray(obj)) {
        return '[' + obj.map(v => typeof v === 'string' ? `"${v}"` : v).join(', ') + ']';
    }
    let keys = Object.keys(obj);
    if (sortKeys) keys.sort();
    const pairs = keys.map(k => `"${k}": ${typeof obj[k] === 'string' ? `"${obj[k]}"` : obj[k]}`);
    return '{' + pairs.join(', ') + '}';
}

// --- CORE: Encryption Logic matching your Python script ---
function buildPacket(featureData, seq) {
    // 1. Keys & Nonce
    const sessionKey = crypto.randomBytes(16); // 128-bit
    const nonce = crypto.randomBytes(12);

    // 2. Header
    const header = {
        device_id: "EDGE_NODE_01",
        timestamp: Math.floor(Date.now() / 1000),
        seq: seq
    };

    // 3. AES-GCM Encryption
    const plaintextStr = pythonJsonDumps(featureData);
    const aadStr = pythonJsonDumps(header, true); // sort_keys=True in Python

    const cipher = crypto.createCipheriv('aes-128-gcm', sessionKey, nonce);
    cipher.setAAD(Buffer.from(aadStr, 'utf8'));
    
    const ciphertextBase = Buffer.concat([cipher.update(plaintextStr, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    
    // Python's cryptography lib appends the 16-byte auth tag to the end of the ciphertext
    const fullCiphertext = Buffer.concat([ciphertextBase, tag]);

    // 4. RSA Signature
    // Python signs: json.dumps(h).encode() + cipher (Notice: no sort_keys=True here in your script)
    const headerStrDefault = pythonJsonDumps(header, false); 
    const signData = Buffer.concat([Buffer.from(headerStrDefault, 'utf8'), fullCiphertext]);

    const sign = crypto.createSign('SHA256');
    sign.update(signData);
    const signature = sign.sign(privateKeyPem);

    // 5. Final Packet
    return {
        header: header,
        session_key: sessionKey.toString('hex'),
        nonce: nonce.toString('hex'),
        ciphertext: fullCiphertext.toString('hex'),
        signature: signature.toString('hex')
    };
}

// --- SSE STREAMING SERVER ---
app.get('/api/sensor-stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const fileStream = fs.createReadStream('sample.csv');
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    let isFirstLine = true;
    let seq = 0;
    const lines = [];

    // Read all lines into an array (since sample.csv is small)
   // Read all lines into an array
    rl.on('line', (line) => {
        if (isFirstLine) {
            isFirstLine = false; // Skip CSV headers
            return;
        }
        if (line.trim()) {
            // Convert CSV row to an array of values.
            let featureArray = line.split(',').map(val => {
                const num = Number(val);
                return isNaN(num) ? val : num;
            });
            
            // ✂️ DROP THE LAST COLUMN (The Label) ✂️
            featureArray = featureArray.slice(0, -1);
            
            lines.push(featureArray);
        }
    });

    rl.on('close', () => {
        let index = 0;
        
        const intervalId = setInterval(() => {
            if (index >= lines.length) {
                // Loop back to start (mimicking LOOP_DATA = True)
                index = 0; 
            }
            
            seq++;
            const featureData = lines[index];
            
            // Encrypt and package the data
            const securePacket = buildPacket(featureData, seq);
            
            // Send the encrypted packet to the Fog layer
            res.write(`data: ${JSON.stringify(securePacket)}\n\n`);
            index++;
            
        }, 1000); // Sends every 1 second

        req.on('close', () => {
            clearInterval(intervalId);
            res.end();
        });
    });
});

app.listen(PORT, () => {
    console.log(`Edge Node Simulator running on port ${PORT}`);
});