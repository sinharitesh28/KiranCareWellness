document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const tabAdherence = document.getElementById('tab-adherence');
    const tabBroadcast = document.getElementById('tab-broadcast');
    const contentAdherence = document.getElementById('content-adherence');
    const contentBroadcast = document.getElementById('content-broadcast');
    const adherenceTableBody = document.getElementById('adherence-table-body');
    const refreshTimer = document.getElementById('refresh-timer');
    const fileUpload = document.getElementById('file-upload');
    const fileNameDisplay = document.getElementById('file-name');
    const broadcastForm = document.getElementById('broadcast-form');
    const targetCountSpan = document.getElementById('target-count');

    // State
    let adherenceData = [];
    let refreshInterval;

    // --- Tab Switching Logic ---
    function switchTab(tab) {
        if (tab === 'adherence') {
            tabAdherence.classList.add('bg-primary', 'text-white', 'shadow-lg');
            tabAdherence.classList.remove('bg-white', 'text-gray-600', 'hover:bg-secondary');
            tabBroadcast.classList.remove('bg-primary', 'text-white', 'shadow-lg');
            tabBroadcast.classList.add('bg-white', 'text-gray-600', 'hover:bg-secondary');

            contentAdherence.classList.remove('hidden');
            contentBroadcast.classList.add('hidden');

            fetchAdherenceData();
            startAutoRefresh();
        } else {
            tabBroadcast.classList.add('bg-primary', 'text-white', 'shadow-lg');
            tabBroadcast.classList.remove('bg-white', 'text-gray-600', 'hover:bg-secondary');
            tabAdherence.classList.remove('bg-primary', 'text-white', 'shadow-lg');
            tabAdherence.classList.add('bg-white', 'text-gray-600', 'hover:bg-secondary');

            contentBroadcast.classList.remove('hidden');
            contentAdherence.classList.add('hidden');

            stopAutoRefresh();
            // Optionally fetch target count here if needed
            if (adherenceData.length > 0) {
                targetCountSpan.innerText = adherenceData.length; // Approximate
            } else {
                targetCountSpan.innerText = 'Calculating...';
                fetch('/api/telegram/adherence').then(r => r.json()).then(d => targetCountSpan.innerText = d.length);
            }
        }
    }

    tabAdherence.addEventListener('click', () => switchTab('adherence'));
    tabBroadcast.addEventListener('click', () => switchTab('broadcast'));

    // --- Adherence Data Logic ---
    async function fetchAdherenceData() {
        try {
            const res = await fetch('/api/telegram/adherence');
            const data = await res.json();
            adherenceData = data;
            renderTable(data);
        } catch (err) {
            console.error('Failed to fetch data:', err);
            adherenceTableBody.innerHTML = `<tr><td colspan="6" class="px-6 py-4 text-center text-red-500">Error loading data</td></tr>`;
        }
    }

    function renderTable(data) {
        adherenceTableBody.innerHTML = '';

        if (data.length === 0) {
            adherenceTableBody.innerHTML = `<tr><td colspan="6" class="px-6 py-4 text-center text-gray-500">No active customers found</td></tr>`;
            return;
        }

        data.forEach(customer => {
            const tr = document.createElement('tr');

            // Status Styling
            let statusClass = 'bg-gray-100 text-gray-800';
            if (customer.status === 'Non-Active') statusClass = 'bg-red-100 text-red-800';
            if (customer.status === 'Completed Dosage') statusClass = 'bg-green-100 text-green-800';
            if (customer.status === 'Active') statusClass = 'bg-blue-100 text-blue-800';

            // Action Button
            let actionBtn = '-';
            if (customer.status === 'Completed Dosage') {
                actionBtn = `<button onclick="sendRefillReminder(${customer.customerId})" class="text-xs bg-primary text-white px-3 py-1 rounded hover:bg-green-700 transition">Send Refill Reminder</button>`;
            }

            tr.innerHTML = `
                <td class="px-6 py-4 whitespace-nowrap">
                    <div class="text-sm font-medium text-gray-900">${customer.name}</div>
                    <div class="text-xs text-gray-500">${customer.mobile}</div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${customer.remindersSent}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${customer.responseRate}%</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${formatDate(customer.lastActive)}</td>
                <td class="px-6 py-4 whitespace-nowrap">
                    <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${statusClass}">
                        ${customer.status}
                    </span>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    ${actionBtn}
                </td>
            `;
            adherenceTableBody.appendChild(tr);
        });
    }

    // Expose function globally for the button onclick
    window.sendRefillReminder = async (id) => {
        if (!confirm('Send refill reminder to this customer?')) return;

        try {
            const res = await fetch('/api/telegram/remind-refill', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ customerId: id })
            });

            if (res.ok) {
                alert('Reminder sent successfully!');
            } else {
                alert('Failed to send reminder.');
            }
        } catch (err) {
            console.error(err);
            alert('Error sending reminder.');
        }
    };

    function formatDate(dateStr) {
        if (!dateStr || dateStr === 'N/A') return 'Never';
        const d = new Date(dateStr);
        return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit' });
    }

    // --- Auto Refresh Logic ---
    function startAutoRefresh() {
        let seconds = 3600; // 60 minutes
        refreshTimer.innerText = seconds;

        if (refreshInterval) clearInterval(refreshInterval);

        refreshInterval = setInterval(() => {
            seconds--;
            refreshTimer.innerText = seconds;
            if (seconds <= 0) {
                const hour = new Date().getHours();
                if (hour >= 8 && hour < 22) {
                    fetchAdherenceData();
                }
                seconds = 3600;
            }
        }, 1000);
    }

    function stopAutoRefresh() {
        if (refreshInterval) clearInterval(refreshInterval);
    }

    // --- Broadcast Form Logic ---
    fileUpload.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            fileNameDisplay.innerText = `Selected: ${e.target.files[0].name}`;
            fileNameDisplay.classList.remove('hidden');
        } else {
            fileNameDisplay.classList.add('hidden');
        }
    });

    broadcastForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const formData = new FormData(broadcastForm);
        const btn = document.getElementById('send-broadcast-btn');

        // Basic validation
        if (!formData.get('message') && !formData.get('image').size) {
            alert('Please provide a message text or an image.');
            return;
        }

        if (!confirm('Are you sure you want to send this broadcast to ALL users? This cannot be undone.')) return;

        btn.disabled = true;
        btn.innerText = 'Sending...';

        try {
            const res = await fetch('/api/telegram/broadcast', {
                method: 'POST',
                body: formData
            });
            const result = await res.json();

            if (res.ok) {
                alert(`Broadcast sent successfully to ${result.sentCount} users!`);
                broadcastForm.reset();
                fileNameDisplay.classList.add('hidden');
            } else {
                alert('Broadcast failed: ' + (result.error || 'Unknown error') + (result.message ? '\nDetails: ' + result.message : ''));
            }
        } catch (err) {
            console.error(err);
            alert('Error sending broadcast');
        } finally {
            btn.disabled = false;
            btn.innerText = 'Send Broadcast';
        }
    });

    // --- Staff Linking Logic ---
    // Moved to UserManagement.js

    // Initial Load
    switchTab('adherence');
});
