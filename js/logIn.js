// document.addEventListener('DOMContentLoaded', () => { ... }) content here
document.addEventListener('DOMContentLoaded', () => {
    const empInput = document.getElementById('employeeCode');
    const otpInput = document.getElementById('otp');
    const sendBtn = document.getElementById('sendOtp');
    const validateBtn = document.getElementById('validateOtp');
    const hint = document.getElementById('authHint');

    // Timer state variables
    let otpTimer = null;
    const OTP_DURATION = 300; // 5 minutes in seconds

    /**
     * Shows a colored hint message below the login form.
     * @param {string} message - The message to display.
     * @param {('info'|'error'|'success')} kind - The type of message.
     */
    function showHint(message, kind = 'info') {
        hint.textContent = message;
        // The original code was inside logIn.html, here we ensure it uses the classes correctly.
        // Assuming the styles are correctly applied via the main HTML file.
        // This is a simplified class assignment, the full class list should be managed in HTML if using Tailwind styles.
        // For now, we only apply the kind class for color coding.
        hint.className = 'p-3 text-sm text-center rounded-lg hint flex items-center justify-center visible ' + kind;
        
        if (!message) {
            hint.classList.remove('visible');
            hint.classList.remove('error', 'success', 'info');
            hint.textContent = '';
        }
    }

    /**
     * Handles loading state for buttons.
     * @param {HTMLButtonElement} button - The button element.
     * @param {boolean} loading - True to enable loading state, false to disable.
     * @param {string} [text] - Optional text to show during loading.
     */
    function setLoading(button, loading, text) {
        if (loading) {
            button.disabled = true;
            button.dataset.orig = button.textContent;
            button.textContent = text || 'Please wait...';
        } else {
            button.disabled = false;
            if (button.dataset.orig) {
                button.textContent = button.dataset.orig;
                delete button.dataset.orig;
            } else {
                 // Fallback if the timer was running when success happened
                 button.textContent = 'Validate OTP';
            }
        }
    }

    /**
     * Starts the 5-minute OTP countdown timer.
     */
    function startTimer() {
        if (otpTimer) {
            clearInterval(otpTimer);
        }

        let timeLeft = OTP_DURATION;
        sendBtn.disabled = true;
        sendBtn.dataset.orig = sendBtn.textContent; 
        sendBtn.textContent = `Resend OTP in 05:00`;

        otpTimer = setInterval(() => {
            timeLeft--;

            const minutes = Math.floor(timeLeft / 60).toString().padStart(2, '0');
            const seconds = (timeLeft % 60).toString().padStart(2, '0');

            sendBtn.textContent = `Resend OTP in ${minutes}:${seconds}`;

            if (timeLeft <= 0) {
                clearInterval(otpTimer);
                otpTimer = null;
                sendBtn.disabled = false;
                sendBtn.textContent = 'Send OTP';
                showHint('OTP expired. Please request a new OTP.', 'error');
            }
        }, 1000);
    }

    /**
     * Stops and resets the OTP timer.
     */
    function stopTimer() {
        if (otpTimer) {
            clearInterval(otpTimer);
            otpTimer = null;
            sendBtn.disabled = false;
            if (sendBtn.dataset.orig) {
                sendBtn.textContent = sendBtn.dataset.orig;
                delete sendBtn.dataset.orig;
            } else {
                sendBtn.textContent = 'Send OTP'; 
            }
        }
    }

    // --- SEND OTP FUNCTIONALITY (Now calls backend) ---
    sendBtn.addEventListener('click', async () => {
        const employeeCode = (empInput.value || '').trim();
        
        if (!employeeCode) {
            showHint('Please enter employee code', 'error');
            empInput.focus();
            return;
        }

        // REMOVED: Client-side validation for employeeCode length and isNaN check.
        // The server (authRoutes.js) is now fully responsible for validation.


        // Set loading state for the Send button
        sendBtn.disabled = true;
        const originalText = sendBtn.textContent;
        sendBtn.textContent = 'Sending OTP...';
        showHint('', 'info');

        try {
            // **API CALL to Server**
            const res = await fetch('/auth/send-otp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ employeeCode })
            });

            const body = await res.json();
            
            if (res.ok) {
                showHint(body.message || 'OTP sent successfully. Check your email.', 'success');
                otpInput.focus();
                // Start the 5-minute timer on successful send
                startTimer();
            } else {
                // If error (e.g., employee code not found, database error)
                showHint(body.error || 'Failed to send OTP.', 'error');
                // Re-enable button on failure
                sendBtn.disabled = false;
                sendBtn.textContent = originalText;
            }
        } catch (err) {
            showHint('Network connection failed or server is down.', 'error');
            console.error('Fetch error for send-otp:', err);
            // Re-enable button on network error
            sendBtn.disabled = false;
            sendBtn.textContent = originalText;
        }
    });

    // --- VALIDATE OTP FUNCTIONALITY (Now calls backend) ---
    validateBtn.addEventListener('click', async () => {
        const employeeCode = (empInput.value || '').trim();
        const otp = (otpInput.value || '').trim();

        if (!employeeCode) {
            showHint('Please enter your Employee Code first.', 'error');
            empInput.focus();
            return;
        }
        if (!otp) { 
            showHint('Please enter the OTP.', 'error');
            otpInput.focus();
            return;
        }
        // REMOVED: Client-side validation for OTP length. The server (authRoutes.js) handles this.

        setLoading(validateBtn, true, 'Validating...');
        showHint('', 'info');

        try {
            // **API CALL to Server**
            const res = await fetch('/auth/validate-otp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ employeeCode, otp })
            });

            const body = await res.json();
            
            if (res.ok) {
                // Save token if present
                if (body.token) {
                    localStorage.setItem('authToken', body.token);
                }

                showHint(body.message || 'Authentication successful! Redirecting...', 'success');
                // Stop the timer as validation is successful
                stopTimer();

                // 2. On successful authentication, redirect to index.html
                setTimeout(() => {
                    // This is the actual redirect to the protected page
                    window.location = '/index.html';
                }, 500);

            } else {
                showHint(body.error || 'Invalid OTP', 'error');
            }
        } catch (err) {
            showHint('Network connection failed or server is down.', 'error');
            console.error('Fetch error for validate-otp:', err);
        } finally {
            setLoading(validateBtn, false);
        }
    });
});
