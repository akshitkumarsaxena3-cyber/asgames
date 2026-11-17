const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// Serve static assets
app.use(express.static(path.join(__dirname)));

// Fallback to index.html for single-page app routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`ASGames server is running on port ${PORT}`);
});
