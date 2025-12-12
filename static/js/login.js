function switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(`${tabName}-tab`).classList.add('active');
}

async function handleLogin(event) {
    // 1. Ngăn chặn hành vi tải lại trang mặc định của form
    event.preventDefault();

    // Lấy các phần tử HTML để thu thập dữ liệu và hiển thị lỗi
    const loginForm = document.getElementById('login-form');
    const usernameInput = document.getElementById('login-username');
    const passwordInput = document.getElementById('login-password');
    const errorDisplay = document.getElementById('login-error');

    // Xóa lỗi cũ
    errorDisplay.style.display = 'none';
    errorDisplay.textContent = '';

    // 2. Thu thập dữ liệu
    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    if (!username || !password) {
        errorDisplay.textContent = 'Vui lòng điền đầy đủ email và mật khẩu.';
        errorDisplay.style.display = 'block';
        return;
    }

    try {
        // 3. Gửi Yêu cầu POST (API Call) đến Server Express

        // **Đây là phần handle API login từ client:**
        const response = await fetch('/api/login', {
            method: 'POST',
            // Chỉ định nội dung gửi đi là JSON
            headers: { 'Content-Type': 'application/json' },
            // Chuyển dữ liệu thành chuỗi JSON
            body: JSON.stringify({ username: username, password: password })
        });

        // 4. Xử lý Phản hồi từ Server

        // Server thường trả về JSON, đọc phản hồi
        const data = await response.json();

        if (response.ok) { // Kiểm tra mã trạng thái HTTP (200-299)
            // Đăng nhập thành công!
            console.log('Đăng nhập thành công. Chuyển hướng...');

            // Server đã tạo Session Cookie, bây giờ chuyển hướng người dùng
            window.location.href = data.redirectUrl || '/dashboard';

        } else {
            // Đăng nhập thất bại (Server trả về 401 Unauthorized hoặc 400 Bad Request)
            const errorMessage = data.message || 'Lỗi đăng nhập không xác định.';
            errorDisplay.textContent = errorMessage;
            errorDisplay.style.display = 'block';
        }

    } catch (error) {
        console.error('Lỗi khi gửi yêu cầu đăng nhập:', error);
        errorDisplay.textContent = 'Không thể kết nối đến máy chủ. Vui lòng thử lại sau.';
        errorDisplay.style.display = 'block';
    }
}

function initializeAuth() {
    const tabButtons = document.querySelectorAll('.tab-btn');
    tabButtons.forEach(button => {
        button.addEventListener('click', function () {
            console.log("Tab click")
            const tabName = this.getAttribute('data-tab');
            switchTab(tabName);
        });
    });
    // Login form
    const loginForm = document.getElementById('login-form');
    // Gán hàm xử lý sự kiện 'submit'
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }

    // Signup form
    const signupForm = document.getElementById('signup-form');
    //signupForm.addEventListener('submit', handleSignup);

    // Logout button
    const logoutBtn = document.getElementById('logout-btn');
    //logoutBtn.addEventListener('click', handleLogout);
}

document.addEventListener('DOMContentLoaded', function () {
    // Đảm bảo tab switching cũng được khởi tạo (từ câu trả lời trước)
    initializeAuth();
});