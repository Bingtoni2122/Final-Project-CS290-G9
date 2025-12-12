const SAMPLE_USERS = [
    {
        _id: 'testing_ID', // ID mock
        username: 'bing_test',
        password: 'password123', // Mật khẩu chưa băm
        name: 'Test User'
    },
    {
        _id: 'testing_ID1', // ID mock
        username: 'song_test',
        password: 'testingpass123', // Mật khẩu chưa băm
        name: 'Test User 2'
    }
    // Bạn có thể thêm nhiều người dùng khác ở đây
];

// server.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
//const bcrypt = require('bcrypt');
require('dotenv').config()

const { parseW2W, parseW2WFileSync } = require('./js/w2w-parser'); // <-- import module
const { transformEvents, exportEventsToJsonFile } = require('./js/w2w-export');

const upload = multer({ dest: '/api/uploads/' });

const app = express();
const PORT = process.env.PORT || 3000;

// --- 中介軟體 ---
app.use(express.urlencoded({ extended: true }));
app.use(express.json());


// --- 設置和靜態檔案 ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'static')));
app.locals.basedir = app.get('views');

// //Connect db
// const { MongoClient, ServerApiVersion } = require('mongodb');
// const uri = process.env.atlas_URL;

// // Create a MongoClient with a MongoClientOptions object to set the Stable API version
// const client = new MongoClient(uri, {
//     serverApi: {
//         version: ServerApiVersion.v1,
//         strict: true,
//         deprecationErrors: true,
//     }
// });

// async function run() {
//     try {
//         // Connect the client to the server	(optional starting in v4.7)
//         await client.connect();
//         // Send a ping to confirm a successful connection
//         await client.db("admin").command({ ping: 1 });
//         console.log("Pinged your deployment. You successfully connected to MongoDB!");
//     } finally {
//         // Ensures that the client will close when you finish/error
//         await client.close();
//     }
// }
// run().catch(console.dir);


// ------------------------------------
// --- 輔助函數 ---
// ------------------------------------

function formatW2WTime(time24) {
    // 檢查 time24 是否為有效字串
    if (!time24 || typeof time24 !== 'string') return '';

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
    if (!dateString) return 'Unknown';
    const [month, day, year] = dateString.split('/').map(Number);
    // 檢查年份是否有效，防止 New Date 崩潰
    if (!year || isNaN(year)) return 'Unknown';

    const date = new Date(year, month - 1, day);
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return dayNames[date.getDay()];
}

function prepareEventsForEJS(workData, classData) {
    const allEvents = [];

    // 修正: 確保 workData 存在，否則使用空陣列 []
    (workData || []).forEach(work => {
        work.time_start_display = formatW2WTime(work.time_start);
        work.time_end_display = formatW2WTime(work.time_end);
        work.type = 'work';
        allEvents.push(work);
    });

    // 修正: 確保 classData 存在，否則使用空陣列 []
    (classData || []).forEach(classEvent => {
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

    // ----------------------------------------------------
    // 修正 1：防止 time_start 為 undefined 導致崩潰 (L130)
    // ----------------------------------------------------
    for (const day of daysOfWeek) {
        if (eventsByDay[day]) {
            eventsByDay[day].sort((a, b) => {
                const timeA = a.time_start;
                const timeB = b.time_start;

                if (!timeA && !timeB) return 0;  // 兩者皆無時間
                if (!timeA) return 1;           // a 無時間，排在後面
                if (!timeB) return -1;          // b 無時間，排在前面

                // 只有兩者都有時間字串時才進行比較
                return timeA.localeCompare(timeB);
            });
        }
    }
    return { eventsByDay, workEventCount: (workData || []).length, classEventCount: (classData || []).length };
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
function filterEvents(allGroupedEvents, workFilter, classFilter, weekOffset) {
    const today = new Date();
    today.setDate(today.getDate() + weekOffset * 7);

    const { startOfWeek, endOfWeek } = getCurrentWeekRange(today);

    const filteredEventsByDay = { eventsByDay: {}, workEventCount: 0, classEventCount: 0 };

    for (const [day, events] of Object.entries(allGroupedEvents.eventsByDay)) {
        const filteredEvents = events.filter(event => {
            if (event.type === 'work') {
                if (!workFilter) return false;  // 如果不顯示工作事件，直接返回 false

                // 檢查工作是否在本週
                // 注意：這裡假設 event.date 是 'MM/DD/YYYY' 格式
                const dateParts = event.date.split('/').map(Number);
                if (dateParts.length !== 3) return false; // 數據格式錯誤或缺失，跳過

                const [month, date, year] = dateParts;
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
// --- 輔助函數：資料儲存 (修正) ---
// ------------------------------------

/**
 * 將新事件寫入對應的 JSON 檔案並更新記憶體中的陣列。
 * @param {object} newEvent - 來自前端的新事件物件。
 */
/**
 * 將新事件寫入對應的 JSON 檔案並更新記憶體中的陣列。
 * @param {object} newEvent - 來自前端的新事件物件。
 */
function updateAndSaveEvent(newEvent) {
    let targetEvents;
    let targetFilePath;

    if (newEvent.eventType === 'class') {
        console.log(newEvent)
        targetEvents = JSON.parse(fs.readFileSync('data/classSchedule1.json', 'utf8'));
        targetFilePath = 'data/classSchedule1.json';
    } else if (newEvent.eventType === 'work') {
        console.log(newEvent)
        targetEvents = JSON.parse(fs.readFileSync('data/w2w-data.json', 'utf8'));
        targetFilePath = 'data/w2w-data.json';
    } else {
        throw new Error('Invalid event type');
    }

    // 統一處理日期欄位。Class 預設佔位符，Work Shift 則強制要求日期。
    let eventDateString = '1/1/2000';

    if (newEvent.date) {
        // 將 HTML date 格式 (YYYY-MM-DD) 轉換為所需的 MM/DD/YYYY 格式
        const [year, month, day] = newEvent.date.split('-');
        // parseInt 用來去除前導零
        eventDateString = `${parseInt(month)}/${parseInt(day)}/${year}`;
        console.log(eventDateString);
    }

    // 1. 創建新的事件物件
    const newEntry = {
        summary: newEvent.summary,
        date: eventDateString, // 現在 Class 或 Work 都使用這個轉換後的日期（或預設日期）

        time_start: newEvent.time_start,
        time_end: newEvent.time_end,
        location: newEvent.location || '',

        professor: newEvent.instructor || '', // 沿用 instructor 欄位
        description: newEvent.description || '',

        // type: newEvent.eventType,
    };

    // 針對 Work Shift 增加 status 欄位以匹配 w2w-data.json 結構
    if (newEvent.eventType === 'work') {
        newEntry.status = 'CONFIRMED';
    }

    // 針對 Class 增加 status 欄位以匹配 classSchedule1.json 結構
    // if (newEvent.eventType === 'class') {
    //     newEntry.status = 'confirmed';
    // }

    // 2. 更新記憶體中的陣列
    targetEvents.push(newEntry);
    console.log(newEntry)

    // 3. 寫回 JSON 檔案 (同步寫入)
    fs.writeFileSync(targetFilePath, JSON.stringify(targetEvents, null, 4), 'utf8');
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

// POST upload (multipart/form-data)
app.post('/api/upload', upload.single('icsfile'), (req, res) => {
    if (!req.file) return res.status(400).send('No file uploaded');

    // đọc file tạm và parse bằng module
    const raw = fs.readFileSync(req.file.path, 'utf8');
    const events = parseW2W(raw);

    // xóa file temp
    try { fs.unlinkSync(req.file.path); } catch (e) { }

    const simpleData = transformEvents(events);
    exportEventsToJsonFile(simpleData, 'data', 'w2w-data.json');
    // // render bằng EJS
    res.redirect('/dashboard');
});

app.use(express.json());
app.get(['/', '/login'], (req, res) => {
    // 設置 eventType 為空字串
    req.params.eventType = '';
    res.render('login')
});


const session = require('express-session');
app.use(session({
    secret: 'YOUR_SECRET_KEY_HERE', // Chuỗi bí mật dùng để ký (sign) session cookie
    resave: false, // Không lưu lại session nếu không có thay đổi
    saveUninitialized: false, // Không tạo session cho người dùng chưa đăng nhập
    cookie: {
        maxAge: 1000 * 60 * 60 * 24 // 24 giờ
    }
}));
// Khai báo trước các hàm chính, vì chúng ta không dùng User Model/Bcrypt thật
const bcrypt = {
    compare: (plain, hash) => plain === hash // MOCKING BCrypt compare
};

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Username and password are required.' });
    }

    // 1. Tìm kiếm người dùng trong Dữ liệu Mẫu
    const user = SAMPLE_USERS.find(u => u.username === username);

    if (!user) {
        // Người dùng không tồn tại
        return res.status(401).json({ success: false, message: 'Invalid username or password.' });
    }

    // 2. So sánh Mật khẩu (Dùng MOCK BCrypt.compare)
    // Lưu ý: Trong thực tế, user.password sẽ là mật khẩu đã băm!
    const passwordMatch = bcrypt.compare(password, user.password);

    if (!passwordMatch) {
        // Mật khẩu không khớp
        return res.status(401).json({ success: false, message: 'Invalid username or password.' });
    }

    // 3. Tạo Session (Vẫn cần Session cho logic chuyển hướng)
    // Lưu ID người dùng mock vào session
    req.session.userId = user._id;
    req.session.username = user.username;

    // 4. Phản hồi thành công
    res.status(200).json({
        success: true,
        message: 'Đăng nhập thành công',
        redirectUrl: '/dashboard' // Chuyển hướng đến route Profile
    });
});
function requireLogin(req, res, next) {
    // Kiểm tra xem ID người dùng có tồn tại trong session không
    if (req.session && req.session.userId) {
        next(); // Đã đăng nhập -> Cho phép đi tiếp
    } else {
        // Chưa đăng nhập -> Chuyển hướng về trang login
        res.redirect('/login');
    }
}
app.post('/api/logout', (req, res) => {
    // Kiểm tra xem session có tồn tại không
    if (req.session) {
        // Hủy session (xóa dữ liệu session khỏi server và cookie session từ trình duyệt)
        req.session.destroy(err => {
            if (err) {
                console.error('Lỗi khi hủy session:', err);
                return res.status(500).json({ success: false, message: 'Could not log out.' });
            }
            // Trả về 200 OK cho Client
            res.status(200).json({ success: true, message: 'Logged out successfully.' });
        });
    } else {
        // Nếu không có session, coi như đã đăng xuất
        res.status(200).json({ success: true, message: 'No active session.' });
    }
});

var glbWorkEvents, glbClassEvents, glbUsername, glbToday = new Date();
app.get('/dashboard', requireLogin, async (req, res) => {
    const userId = req.session.userId;
    const user = SAMPLE_USERS.find(u => u._id === userId);
    glbUsername = user.username
    
    if (!user) {
        // Nếu user bị xóa khỏi mock data hoặc session bị lỗi
        return res.redirect('/login');
    }
    
    // 2. Render trang EJSuser
    if (user.username == "bing_test") {
        glbWorkEvents = JSON.parse(fs.readFileSync('data/w2w-data.json', 'utf8'));
        glbClassEvents = JSON.parse(fs.readFileSync('data/classSchedule1.json', 'utf8'));
    } else if (user.username == "song_test") {
        glbWorkEvents = JSON.parse(fs.readFileSync('data/w2w-data.json', 'utf8'));
        glbClassEvents = JSON.parse(fs.readFileSync('data/classSchedule2.json', 'utf8'));
    }
    handleDashboard(req, res, glbWorkEvents, glbClassEvents, glbUsername, glbToday);
});

// ------------------------------------
// --- API 路由：新增事件 (修正驗證) ---
// ------------------------------------
app.post('/api/add-event', (req, res) => {
    const newEvent = req.body;
    console.log('Received new event data:', newEvent);

    // 修正驗證: 使用 summary 和 time_start/time_end，並移除 dayOfWeek 
    if (!newEvent.eventType || !newEvent.summary || !newEvent.time_start || !newEvent.time_end) {
        return res.status(400).json({ success: false, message: 'Missing required fields: eventType, summary, time_start, or time_end.' });
    }

    // 對於 Work Shift，我們需要 date 欄位
    if (newEvent.eventType === 'work' && !newEvent.date) {
        return res.status(400).json({ success: false, message: 'Work Shift requires a specific date.' });
    }

    try {
        // 1. 更新記憶體中的資料並寫入對應的 JSON 檔案
        updateAndSaveEvent(newEvent);

        // 2. 返回成功響應
        res.json({ success: true, message: `${newEvent.eventType} added successfully. Refreshing schedule...` });

    } catch (error) {
        console.error('Error adding new event:', error);
        res.status(500).json({ success: false, message: 'Server error while saving event.', error: error.message });
    }
});


// ------------------------------------
// --- 通用 Dashboard 處理函數 ---
// ------------------------------------

function handleDashboard(req, res, workEvents, classEvents, username, today) {
    const weekOffset = parseInt(req.query.weekOffset || '0', 10);

    // eventType 已經由下面的路由設置為 'works', 'classes', 或 ''
    const eventType = req.params.eventType || '';

    // 1. 獲取所有事件的結構
    const allEventsStructure = prepareEventsForEJS(workEvents, classEvents);

    // 2. 計算固定的 Tab 顯示總數 (不論在哪個頁面都使用這些數值) 
    //    a. 計算 Work Shifts 總數 (固定為本週)
    const totalWorkShifts = filterEvents(allEventsStructure, true, false, weekOffset).workEventCount;

    //    b. 計算 Classes 總數 (固定為所有)
    const totalClasses = filterEvents(allEventsStructure, false, true, weekOffset).classEventCount;

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
    const filteredContent = filterEvents(allEventsStructure, workFilter, classFilter, weekOffset);

    today.setDate(today.getDate() + weekOffset * 7);

    const { startOfWeek, endOfWeek } = getCurrentWeekRange(today);
    // 5. 渲染視圖
    res.render('dashboard', {
        title: 'Student Schedule Manager',
        eventType: eventType,
        eventsByDay: filteredContent.eventsByDay, // 傳遞篩選後的卡片內容

        // 傳遞固定的 Tab 標籤計數
        workEventCount: totalWorkShifts,
        classEventCount: totalClasses,
        allEventCount: totalWorkShifts + totalClasses,
        username: req.session.username,
        weekOffset: weekOffset,
        currentWeekStart: startOfWeek,
        currentWeekEnd: endOfWeek
    });
}


// ------------------------------------
// --- 最終修正後的 Dashboard 路由 ---
// ------------------------------------

// 2. 處理 /works 
app.get('/works', (req, res) => {
    // 設置 eventType 為 'works'
    req.params.eventType = 'works';
    handleDashboard(req, res, glbWorkEvents, glbClassEvents, glbUsername, glbToday);
});
app.get('/works/:targetDate', requireLogin, (req, res) => {
    req.params.eventType = 'works';
    const today = new Date(req.params.targetDate); 
    handleDashboard(req, res, glbWorkEvents, glbClassEvents, glbUsername, today);
});

// 3. 處理 /classes 
app.get('/classes', (req, res) => {
    // 設置 eventType 為 'classes'
    req.params.eventType = 'classes';
    handleDashboard(req, res, glbWorkEvents, glbClassEvents, glbUsername, glbToday);
});
app.get('/classes/:targetDate', requireLogin, (req, res) => {
    req.params.eventType = 'classes';
    const today = new Date(req.params.targetDate); 
    handleDashboard(req, res, glbWorkEvents, glbClassEvents, glbUsername, today);
});

app.get('/dashboard/:targetDate', requireLogin, (req, res) => {
    req.params.eventType = 'dashboard';
    // Đảm bảo chuyển đổi chuỗi ngày thành đối tượng Date
    const today = new Date(req.params.targetDate); 
    console.log(today)
    handleDashboard(req, res, glbWorkEvents, glbClassEvents, glbUsername, today);
});

app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
