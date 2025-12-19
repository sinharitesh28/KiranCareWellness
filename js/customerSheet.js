document.addEventListener('DOMContentLoaded', () => {
    const tableBody = document.getElementById('customerTableBody');
    const searchInput = document.getElementById('searchInput');
    const downloadCsvBtn = document.getElementById('downloadCsvBtn');

    let allCustomers = [];

    // Fetch Customers
    async function fetchCustomers() {
        try {
            const res = await fetch('/api/customers');
            const data = await res.json();

            if (data.success) {
                allCustomers = data.customers;
                renderTable(allCustomers);
            } else {
                tableBody.innerHTML = `<tr><td colspan="5" class="px-4 py-8 text-center text-red-500">Error loading data</td></tr>`;
            }
        } catch (error) {
            console.error('Error fetching customers:', error);
            tableBody.innerHTML = `<tr><td colspan="5" class="px-4 py-8 text-center text-red-500">Failed to connect to server</td></tr>`;
        }
    }

    // Render Table
    function renderTable(customers) {
        if (customers.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="5" class="px-4 py-8 text-center text-gray-500">No customers found.</td></tr>`;
            return;
        }

        tableBody.innerHTML = customers.map(customer => {
            // Format Last 3 Orders
            const orderList = customer.last_orders.map(order => {
                const date = new Date(order.transaction_date).toLocaleDateString();
                return `<div class="text-xs border-b border-gray-100 last:border-0 py-1">
                            <span class="font-medium text-gray-700">${order.bill_number}</span> 
                            <span class="text-gray-400 mx-1">|</span> 
                            ${date} 
                            <span class="text-gray-400 mx-1">|</span> 
                            <span class="text-primary font-semibold">₹${parseFloat(order.total_amount).toFixed(0)}</span>
                        </div>`;
            }).join('') || '<span class="text-gray-400 italic">No orders yet</span>';

            return `
                <tr class="hover:bg-gray-50 transition">
                    <td class="px-4 py-3 font-medium text-gray-900">${customer.name || 'Unknown'}</td>
                    <td class="px-4 py-3">
                        <div class="flex flex-col">
                            <span>${customer.mobile_no || '-'}</span>
                            <span class="text-xs text-gray-400">${customer.email || ''}</span>
                        </div>
                    </td>
                    <td class="px-4 py-3 text-center">${customer.total_orders}</td>
                    <td class="px-4 py-3 text-right font-medium text-primary">₹${parseFloat(customer.total_spent || 0).toFixed(2)}</td>
                    <td class="px-4 py-3">${orderList}</td>
                </tr>
            `;
        }).join('');
    }

    // Search Functionality
    searchInput.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        const filtered = allCustomers.filter(c => 
            (c.name && c.name.toLowerCase().includes(term)) ||
            (c.mobile_no && c.mobile_no.includes(term)) ||
            (c.email && c.email.toLowerCase().includes(term))
        );
        renderTable(filtered);
    });

    // CSV Export
    downloadCsvBtn.addEventListener('click', () => {
        if (allCustomers.length === 0) return;

        // Get currently displayed data (in case search is active)
        const term = searchInput.value.toLowerCase();
        const dataToExport = allCustomers.filter(c => 
            (c.name && c.name.toLowerCase().includes(term)) ||
            (c.mobile_no && c.mobile_no.includes(term)) ||
            (c.email && c.email.toLowerCase().includes(term))
        );

        const csvContent = convertToCSV(dataToExport);
        downloadCSV(csvContent, `customer_sheet_${new Date().toISOString().slice(0,10)}.csv`);
    });

    function convertToCSV(data) {
        const headers = ['Customer Name', 'Mobile', 'Email', 'Total Orders', 'Total Spent', 'Last Order 1', 'Last Order 2', 'Last Order 3'];
        
        const rows = data.map(c => {
            // Prepare last 3 orders columns
            const orders = c.last_orders || [];
            const o1 = orders[0] ? `${orders[0].bill_number} (${new Date(orders[0].transaction_date).toLocaleDateString()}) - ₹${orders[0].total_amount}` : '';
            const o2 = orders[1] ? `${orders[1].bill_number} (${new Date(orders[1].transaction_date).toLocaleDateString()}) - ₹${orders[1].total_amount}` : '';
            const o3 = orders[2] ? `${orders[2].bill_number} (${new Date(orders[2].transaction_date).toLocaleDateString()}) - ₹${orders[2].total_amount}` : '';

            return [
                `"${(c.name || '').replace(/