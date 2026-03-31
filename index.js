const express = require('express');
const cors = require('cors');
const fs = require('fs');
const csv = require('csv-parser');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

app.get('/api/sensor-stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const results = [];
    
    const csvFilePath = path.join(__dirname, 'sample.csv');
    fs.createReadStream(csvFilePath)
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', () => {
            let index = 0;
            
            const intervalId = setInterval(() => {
                if (index >= results.length) {
                    clearInterval(intervalId);
                    res.end();
                    return;
                }
                
                res.write(`data: ${JSON.stringify(results[index])}\n\n`);
                index++;
            }, 1000);

            req.on('close', () => {
                clearInterval(intervalId);
                res.end();
            });
        });
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});