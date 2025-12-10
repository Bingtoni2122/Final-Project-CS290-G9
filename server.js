// server.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const bcrypt = require('bcrypt');
require('dotenv').config()

const { parseW2W, parseW2WFileSync } = require('./js/w2w-parser'); // <-- import module
const { transformEvents, exportEventsToJsonFile } = require('./js/w2w-export'); 

const upload = multer({ dest: 'uploads/' });

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'static')));

//Connect db
const { MongoClient, ServerApiVersion } = require('mongodb');
const uri = process.env.atlas_URL;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    await client.close();
  }
}
run().catch(console.dir);



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

app.get('/login', (req, res) => {
    res.render('login')
});
app.post('/api/login', async (req, res) => {
    // 1. Data Validation
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Username and password are required.' });
    }

    try {
        const usersCollection = db.collection('users'); 

        const user = await usersCollection.findOne({ username });

        if (!user) {
            // User not found in database (Always use generic message for security)
            return res.status(401).json({ success: false, message: 'Invalid username or password.' });
        }
        
        // 3. Password Verification (SECURE BCrypt Check)
        // bcrypt.compare() compares the plain-text password with the stored hash
        const passwordMatch = await bcrypt.compare(password, user.passwordHash); 
        // NOTE: 'user.passwordHash' assumes you stored the HASH under this field name 
        // in your MongoDB collection during user creation (signup).

        if (!passwordMatch) {
            // Passwords do not match
            return res.status(401).json({ success: false, message: 'Invalid username or password.' });
        }
        
        // 4. Success!
        // In a full application, you would set a session or send a JWT here.
        return res.json({ success: true, message: 'Login successful.' });

    } catch (error) {
        console.error('Error during login:', error);
        return res.status(500).json({ success: false, message: 'Internal server error during authentication.' });
    }
});

app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
