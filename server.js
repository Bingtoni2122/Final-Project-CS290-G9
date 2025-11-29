// server.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const { parseW2W, parseW2WFileSync } = require('./js/w2w-parser'); // <-- import module
const { transformEvents, exportEventsToJsonFile } = require('./js/w2w-export'); 

const upload = multer({ dest: 'uploads/' });

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'static')));

// home + upload page (GET)
app.get('/', (req, res) => res.render('index', {
    title: 'ICS Demo' 
}));

app.get('/upload', (req, res) => res.render('upload', {
    title: 'Upload ICS'
}));

// POST upload (multipart/form-data)
app.post('/upload', upload.single('icsfile'), (req, res) => {
    if (!req.file) return res.status(400).send('No file uploaded');

    // đọc file tạm và parse bằng module
    const raw = fs.readFileSync(req.file.path, 'utf8');
    const events = parseW2W(raw);

    // xóa file temp
    try { fs.unlinkSync(req.file.path); } catch (e) {}

    // render bằng EJS
    res.render('events', { 
        title: 'Parsed Events', events 
    });

    //export data file
    const simpleData = transformEvents(events);

    // The actual call to export the file:
    exportEventsToJsonFile(simpleData, 'data', 'w2w-data.json'); 
});

app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
