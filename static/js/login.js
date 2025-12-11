document.addEventListener('DOMContentLoaded', function() {
    initializeAuth();
    //initializeApp();
});
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
    // 1. Prevent the default form submission (page reload)
    event.preventDefault(); 

    // Retrieve input values correctly
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-pass').value; // Assuming ID is 'login-pass'
    
    // Retrieve the error display element (DO NOT use .value here)
    const errorDiv = document.getElementById('login-error'); 

    // Clear previous errors
    if (errorDiv) { // Good practice: check if the element exists
        errorDiv.textContent = '';
    } else {
        console.warn("Error display element 'login-error' not found.");
    }
    
    try {
        // 2. Send data to the server's API endpoint
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });
        
        // 3. Process the server's response
        const result = await response.json();

        if (response.ok && result.success) {
            console.log('Login successful:', result.message);
            // Redirect the user to the main application page
            window.location.href = '/upload'; 
        } else {
            // Login failed
            if (errorDiv) {
                errorDiv.textContent = result.message || 'Login failed. Please check your credentials.';
            }
            console.error('Login failed:', result.message);
        }

    } catch (error) {
        // Handle network errors
        if (errorDiv) {
            errorDiv.textContent = 'An unexpected network error occurred.';
        }
        console.error('Network error:', error);
    }
}

function initializeAuth(){
    const tabButtons = document.querySelectorAll('.tab-btn');
    tabButtons.forEach(button => {
        button.addEventListener('click', function() {
            console.log("Tab click")
            const tabName = this.getAttribute('data-tab');
            switchTab(tabName);
        });
    });
    // Login form
    const loginForm = document.getElementById('login-form');
    // Ensure the event listener uses the new asynchronous handleLogin
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