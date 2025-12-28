// UserManagement.js

document.addEventListener('DOMContentLoaded', () => {
    checkAdminAccess();
    fetchUsers();
    setupEventListeners();
});

let allUsers = [];

// Check if user has admin access
async function checkAdminAccess() {
    try {
        const response = await fetch('/api/users/me');
        const data = await response.json();
        
        if (!data.success || !data.user.is_admin) {
            alert('Access Denied: Admin privileges required.');
            window.location.href = '/index.html';
        }
    } catch (error) {
        console.error('Error checking admin status:', error);
        window.location.href = '/index.html';
    }
}

// Fetch all users
async function fetchUsers() {
    const tableBody = document.getElementById('usersTableBody');
    try {
        const response = await fetch('/api/users/list');
        const data = await response.json();
        
        if (data.success) {
            allUsers = data.users;
            renderUsers(allUsers);
        } else {
            tableBody.innerHTML = `<tr><td colspan="9" class="p-8 text-center text-red-500">Failed to load users: ${data.error}</td></tr>`;
        }
    } catch (error) {
        tableBody.innerHTML = `<tr><td colspan="9" class="p-8 text-center text-red-500">Network error loading users.</td></tr>`;
    }
}

// Render users into the table
function renderUsers(users) {
    const tableBody = document.getElementById('usersTableBody');
    // Update header if not already updated (brute force check not needed if we replace entire body rows, but header is static HTML)
    // Actually, I should update the HTML header too, but I can't easily do that from here without query selector.
    // Let's assume the user will update HTML header manually or I will inject it via JS?
    // Better to stick to row rendering. The columns count changed.
    
    tableBody.innerHTML = '';
    
    if (users.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="9" class="p-8 text-center text-gray-500">No users found.</td></tr>';
        return;
    }
    
    users.forEach(user => {
        const row = document.createElement('tr');
        row.className = 'hover:bg-gray-50 transition-colors group';

        const telegramStatus = user.telegram_chat_id 
            ? `<span class="px-2 py-1 rounded-full text-[10px] font-bold uppercase bg-blue-100 text-blue-600 border border-blue-200"><i class="fab fa-telegram-plane mr-1"></i>Linked</span>`
            : `<span class="px-2 py-1 rounded-full text-[10px] font-bold uppercase bg-gray-100 text-gray-400 border border-gray-200">Not Linked</span>`;

        row.innerHTML = `
            <td class="p-4 font-mono text-xs text-gray-500">${user.code}</td>
            <td class="p-4 font-bold text-gray-800">${user.name}</td>
            <td class="p-4 text-sm text-gray-600">${user.position}</td>
            <td class="p-4 text-sm text-gray-600">${user.gmail}</td>
            <td class="p-4 text-sm text-gray-600">${user.contact_no || 'N/A'}</td>
            <td class="p-4 text-sm text-gray-600">${user.branch}</td>
            <td class="p-4">
                <span class="px-2 py-1 rounded-full text-[10px] font-bold uppercase ${user.is_admin ? 'bg-primary/10 text-primary border border-primary/20' : 'bg-gray-100 text-gray-400 border border-gray-200'}">
                    ${user.is_admin ? 'Admin' : 'User'}
                </span>
            </td>
            <td class="p-4 text-center">
                ${telegramStatus}
            </td>
            <td class="p-4 text-center">
                <div class="flex justify-center space-x-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onclick="connectTelegram(${user.code}, '${user.name}')" class="p-2 text-blue-500 hover:bg-blue-50 rounded-lg transition" title="Connect Telegram">
                        <i class="fab fa-telegram"></i>
                    </button>
                    <button onclick="editUser(${user.code})" class="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition" title="Edit User">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button onclick="deleteUser(${user.code})" class="p-2 text-red-600 hover:bg-red-50 rounded-lg transition ${user.code == 3 ? 'hidden' : ''}" title="Delete User">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </div>
            </td>
        `;
        tableBody.appendChild(row);
    });
}

// Setup Event Listeners
function setupEventListeners() {
    const modal = document.getElementById('userModal');
    const addBtn = document.getElementById('addUserBtn');
    const closeBtn = document.getElementById('closeModal');
    const cancelBtn = document.getElementById('cancelBtn');
    const userForm = document.getElementById('userForm');

    // Telegram Modal
    const teleModal = document.getElementById('connectTelegramModal');
    const closeTeleBtn = document.getElementById('closeTelegramModal');

    addBtn.onclick = () => openModal();
    closeBtn.onclick = () => closeModal();
    cancelBtn.onclick = () => closeModal();
    
    if (closeTeleBtn) {
        closeTeleBtn.onclick = () => {
            teleModal.classList.add('hidden');
            teleModal.classList.remove('flex');
        };
    }
    
    window.onclick = (e) => {
        if (e.target == modal) closeModal();
        if (e.target == teleModal) {
            teleModal.classList.add('hidden');
            teleModal.classList.remove('flex');
        }
    }

    userForm.onsubmit = async (e) => {
        e.preventDefault();
        saveUser();
    };
}

// Connect Telegram Logic
async function connectTelegram(userCode, userName) {
    const modal = document.getElementById('connectTelegramModal');
    const qrContainer = document.getElementById('telegramQrCode');
    
    // Generate a secure token
    // Format: LINK_{EmployeeCode}_{RandomString}
    const secretToken = Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);
    
    let botName = 'KiranCareBot'; // Default fallback
    try {
        const res = await fetch('/api/telegram/info');
        if (res.ok) {
            const data = await res.json();
            if (data.username) {
                botName = data.username;
            }
        } else {
            console.warn('Bot info API unavailable, using default username.');
        }
    } catch (e) {
        console.warn('Could not fetch bot username, using default:', botName);
    }

    const link = `https://t.me/${botName}?start=LINK_${userCode}_${secretToken}`;

    qrContainer.innerHTML = '';
    new QRCode(qrContainer, {
        text: link,
        width: 200,
        height: 200,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.H
    });

    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

// Open Modal (Add/Edit)
function openModal(userCode = null) {
    const modal = document.getElementById('userModal');
    const form = document.getElementById('userForm');
    const title = document.getElementById('modalTitle');
    
    form.reset();
    document.getElementById('userCode').value = '';
    
    if (userCode) {
        const user = allUsers.find(u => u.code == userCode);
        if (user) {
            title.innerText = 'Edit User Details';
            document.getElementById('userCode').value = user.code;
            document.getElementById('userName').value = user.name;
            document.getElementById('userPosition').value = user.position;
            document.getElementById('userGmail').value = user.gmail;
            document.getElementById('userContact').value = user.contact_no;
            document.getElementById('userBranch').value = user.branch;
            document.getElementById('userIsAdmin').checked = user.is_admin;
            
            // Disable admin toggle for ID 3
            if (user.code == 3) {
                document.getElementById('userIsAdmin').disabled = true;
            } else {
                document.getElementById('userIsAdmin').disabled = false;
            }
        }
    } else {
        title.innerText = 'Add New User';
        document.getElementById('userIsAdmin').disabled = false;
    }
    
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

// Close Modal
function closeModal() {
    const modal = document.getElementById('userModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

// Save User (Add/Update)
async function saveUser() {
    const code = document.getElementById('userCode').value;
    const userData = {
        name: document.getElementById('userName').value,
        position: document.getElementById('userPosition').value,
        gmail: document.getElementById('userGmail').value,
        contact_no: document.getElementById('userContact').value,
        branch: document.getElementById('userBranch').value,
        is_admin: document.getElementById('userIsAdmin').checked
    };

    const url = code ? `/api/users/update/${code}` : '/api/users/add';
    const method = code ? 'PUT' : 'POST';

    try {
        const response = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(userData)
        });
        
        const result = await response.json();
        
        if (result.success) {
            showMessage(code ? 'User updated successfully!' : 'User added successfully!', 'success');
            closeModal();
            fetchUsers();
        } else {
            showMessage(result.error || 'Failed to save user.', 'error');
        }
    } catch (error) {
        showMessage('Network error while saving user.', 'error');
    }
}

// Delete User
async function deleteUser(code) {
    if (!confirm('Are you sure you want to remove this user? This action cannot be undone.')) return;

    try {
        const response = await fetch(`/api/users/delete/${code}`, {
            method: 'DELETE'
        });
        const result = await response.json();
        
        if (result.success) {
            showMessage('User removed successfully.', 'success');
            fetchUsers();
        } else {
            showMessage(result.error || 'Failed to remove user.', 'error');
        }
    } catch (error) {
        showMessage('Network error while removing user.', 'error');
    }
}

// Global exposure for onclick handlers
window.editUser = openModal;
window.deleteUser = deleteUser;
window.connectTelegram = connectTelegram;

// Helper: Show Toast Message
function showMessage(msg, type = 'info') {
    const container = document.getElementById('messageContainer');
    const el = document.createElement('div');
    el.className = `p-4 rounded-lg shadow-xl border-l-4 transition-all animate-slide-in ${
        type === 'success' ? 'bg-green-50 border-green-500 text-green-800' : 'bg-red-50 border-red-500 text-red-800'
    }`;
    el.innerHTML = `
        <div class="flex items-center space-x-3">
            <i class="fas ${type === 'success' ? 'fa-check-circle' : 'fa-exclamation-triangle'}"></i>
            <p class="font-bold">${msg}</p>
        </div>
    `;
    container.appendChild(el);
    setTimeout(() => {
        el.style.opacity = '0';
        el.style.transform = 'translateX(20px)';
        setTimeout(() => el.remove(), 300);
    }, 4000);
}
