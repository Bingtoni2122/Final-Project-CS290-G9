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

// --- 中介軟體 ---
app.use(express.urlencoded({ extended: true }));


// --- 設置和靜態檔案 ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'static')));
app.locals.basedir = app.get('views'); 

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


// --- 數據加載 ---
// ⚠️ 確保 data/w2w-data.json 和 data/classSchedule1.json 存在
let workEvents = JSON.parse(fs.readFileSync('data/w2w-data.json', 'utf8'));
let classEvents = JSON.parse(fs.readFileSync('data/classSchedule1.json', 'utf8'));


// ------------------------------------
// --- 輔助函數 ---
// ------------------------------------

function formatW2WTime(time24) { 
    let [hours, minutes] = time24.split(':').map(Number);
    let ampm = 'AM';
    let displayHours = hours;

    if (hours >= 24) {
        hours -= 24; 
    }

    if (hours >= 12) {
        ampm = 'PM';
        if (hours > 12) {
            displayHours = hours - 12;
        } else {
            displayHours = 12; 
        }
    } else if (hours === 0) {
        displayHours = 12; 
    } else {
        displayHours = hours;
    }
    
    const displayMinutes = String(minutes).padStart(2, '0');
    return `${displayHours}:${displayMinutes} ${ampm}`;
}

function getDayOfWeek(dateString) { 
    const [month, day, year] = dateString.split('/').map(Number);
    const date = new Date(year, month - 1, day);
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return dayNames[date.getDay()];
}

function prepareEventsForEJS(workData, classData) {
    const allEvents = [];
    
    workData.forEach(work => {
        work.time_start_display = formatW2WTime(work.time_start);
        work.time_end_display = formatW2WTime(work.time_end);
        work.type = 'work'; 
        allEvents.push(work);
    });

    classData.forEach(classEvent => {
        classEvent.type = 'class'; 
        allEvents.push(classEvent);
    });

    const eventsByDay = {};
    const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    
    allEvents.forEach(event => {
        const day = getDayOfWeek(event.date);
        if (!eventsByDay[day]) {
            eventsByDay[day] = [];
        }
        eventsByDay[day].push(event);
    });
    
    for (const day of daysOfWeek) {
        if (eventsByDay[day]) {
            eventsByDay[day].sort((a, b) => {
                const timeA = a.time_start;
                const timeB = b.time_start;
                return timeA.localeCompare(timeB);
            });
        }
    }
    return { eventsByDay, workEventCount: workData.length, classEventCount: classData.length };
}

// 獲取本週的開始和結束日期
function getCurrentWeekRange(today) {
    // 計算本週的開始日期 (星期日) 
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay());
    startOfWeek.setHours(0, 0, 0, 0); 
    // 計算本週的結束日期 (星期六)
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);
    return { startOfWeek, endOfWeek };
}

// 使用getCurrentWeekRange來篩選事件
function filterEvents(allGroupedEvents, workFilter, classFilter) {
    const { startOfWeek, endOfWeek } = getCurrentWeekRange(new Date());
    const filteredEventsByDay = { eventsByDay: {}, workEventCount: 0, classEventCount: 0 };

    for (const [day, events] of Object.entries(allGroupedEvents.eventsByDay)) {
        const filteredEvents = events.filter(event => {
            if (event.type === 'work') {
                if (!workFilter) return false;  // 如果不顯示工作事件，直接返回 false
                
                // 檢查工作是否在本週
                const [month, date, year] = event.date.split('/').map(Number);
                const eventDate = new Date(year, month - 1, date);
                // 比較事件日期是否在本週範圍內
                return eventDate >= startOfWeek && eventDate <= endOfWeek;

            } else if (event.type === 'class') {
                // 課程事件只需要檢查 classFilter
                return classFilter;
            }
            return false;
        });

        if (filteredEvents.length > 0) {
            filteredEventsByDay.eventsByDay[day] = filteredEvents;
            // 累計當前頁面實際顯示的卡片數量
            filteredEventsByDay.workEventCount += filteredEvents.filter(e => e.type === 'work').length;
            filteredEventsByDay.classEventCount += filteredEvents.filter(e => e.type === 'class').length;
        }
    }
    return filteredEventsByDay;
}


// ------------------------------------
// --- POST 和非 Dashboard 路由 (必須放在前面) ---
// ------------------------------------

app.post('/import-w2w', (req, res) => {
    const rawData = req.body.scheduleData; 
    if (!rawData) return res.status(400).send('No W2W schedule data pasted.');
    console.log('Received W2W Data:', rawData);
    try { /* 實際導入邏輯 placeholder */ } catch (error) { console.error('W2W Data Import Error:', error); }
    res.redirect('/'); 
});

app.post('/import-osu', (req, res) => {
    const rawData = req.body.scheduleData; 
    if (!rawData) return res.status(400).send('No OSU timetable data pasted.');
    console.log('Received OSU Data:', rawData);
    try { /* 實際導入邏輯 placeholder */ } catch (error) { console.error('OSU Data Import Error:', error); }
    res.redirect('/'); 
});

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

    const simpleData = transformEvents(events);
    exportEventsToJsonFile(simpleData, 'data', 'data/w2w-data.json'); 
});


// ------------------------------------
// --- 通用 Dashboard 處理函數 ---
// ------------------------------------

function handleDashboard(req, res) {
    // eventType 已經由下面的路由設置為 'works', 'classes', 或 ''
    const eventType = req.params.eventType || '';

    // 1. 獲取所有事件的結構
    const allEventsStructure = prepareEventsForEJS(workEvents, classEvents);

    // 2. 🌟 計算固定的 Tab 顯示總數 (不論在哪個頁面都使用這些數值) 🌟
    //    a. 計算 Work Shifts 總數 (固定為本週)
    const totalWorkShifts = filterEvents(allEventsStructure, true, false).workEventCount;
    
    //    b. 計算 Classes 總數 (固定為所有)
    const totalClasses = filterEvents(allEventsStructure, false, true).classEventCount;

    // 3. 確定當前頁面的內容篩選邏輯 (Content Filtering)
    let workFilter = false;
    let classFilter = false;
    
    switch (eventType) {
        case 'works':
            workFilter = true;  // 顯示 Work shifts (本週)
            classFilter = false; // 隱藏 Classes
            break;
        case 'classes':
            workFilter = false;  // 隱藏 Work shifts
            classFilter = true;  // 顯示 Classes (所有)
            break;
        case '': // '/' (All Events)
        default:
            workFilter = true;   // 顯示 Work shifts (本週)
            classFilter = true;  // 顯示 Classes (所有)
            break;
    }

    // 4. 應用內容篩選，獲取要顯示的卡片
    const filteredContent = filterEvents(allEventsStructure, workFilter, classFilter);

    // 5. 渲染視圖
    res.render('dashboard', {
        title: 'Student Schedule Manager',
        eventType: eventType, 
        eventsByDay: filteredContent.eventsByDay, // 傳遞篩選後的卡片內容
        
        // 傳遞固定的 Tab 標籤計數
        workEventCount: totalWorkShifts,      
        classEventCount: totalClasses,        
        allEventCount: totalWorkShifts + totalClasses 
    });
}


// ------------------------------------
// --- 最終修正後的 Dashboard 路由 (使用獨立路由) ---
// ------------------------------------

// 1. 處理根目錄 (All Events /)
app.get('/', (req, res) => {
    // 設置 eventType 為空字串
    req.params.eventType = '';
    handleDashboard(req, res);
});

// 2. 處理 /works 
app.get('/works', (req, res) => {
    // 設置 eventType 為 'works'
    req.params.eventType = 'works';
    handleDashboard(req, res);
});

// 3. 處理 /classes 
app.get('/classes', (req, res) => {
    // 設置 eventType 為 'classes'
    req.params.eventType = 'classes';
    handleDashboard(req, res);
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
