document.addEventListener('DOMContentLoaded', () => {
    const tableBody = document.getElementById('customerTableBody');
    const searchInput = document.getElementById('searchInput');
    const downloadCsvBtn = document.getElementById('downloadCsvBtn');

    let allCustomers = [];

    // Fetch Customers
    async function fetchCustomers() {
        try {
            const response = await fetch('/api/customers');
            const data = await response.json();

            if (data.success) {
                allCustomers = data.customers;
                renderTable(allCustomers);
            } else {
                tableBody.innerHTML = `<tr><td colspan="5" class="px-4 py-8 text-center text-red-500">Failed to load customers: ${data.error}</td></tr>`;
            }
        } catch (error) {
            console.error('Error fetching customers:', error);
            tableBody.innerHTML = `<tr><td colspan="5" class="px-4 py-8 text-center text-red-500">An error occurred while fetching customer data.</td></tr>`;
        }
    }

    // Render Table
    function renderTable(data) {
        tableBody.innerHTML = '';
        
        const searchTerm = searchInput.value.toLowerCase();
        
        const filteredData = data.filter(customer => {
            const name = (customer.name || '').toLowerCase();
            const mobile = (customer.mobile_no || '').toLowerCase();
            const email = (customer.email || '').toLowerCase();
            
            return name.includes(searchTerm) || mobile.includes(searchTerm) || email.includes(searchTerm);
        });

        if (filteredData.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="5" class="px-4 py-8 text-center text-gray-500">No customers found matching "${searchTerm}"</td></tr>`;
            return;
        }

        filteredData.forEach(customer => {
            const row = document.createElement('tr');
            row.className = 'hover:bg-gray-50 transition duration-150 border-b border-gray-100 last:border-b-0';
            
            // Format last orders
            const lastOrdersHtml = customer.last_orders && customer.last_orders.length > 0 
                ? customer.last_orders.map(order => {
                    const date = dayjs(order.transaction_date).format('DD/MM/YY');
                    return `<div class="text-xs text-gray-500">
                        <span class="font-medium text-gray-700">#${order.bill_number}</span> 
                        - ${date} 
                        - <span class="text-green-600">₹${parseFloat(order.total_amount || 0).toFixed(2)}</span>
                    </div>`;
                }).join('') 
                : '<span class="text-gray-400 italic">No recent orders</span>';

            const contactInfo = `
                <div class="flex items-center gap-2">
                    <div class="font-medium text-gray-900">${customer.mobile_no || '-'}</div>
                    ${customer.mobile_no ? `
                        <a href="https://wa.me/91${customer.mobile_no.replace(/[^0-9]/g, '')}" target="_blank" class="text-green-500 hover:text-green-700 transition" title="Message on WhatsApp">
                            <i class="fab fa-whatsapp"></i>
                        </a>
                    ` : ''}
                </div>
                ${customer.email ? `<div class="text-xs text-gray-500">${customer.email}</div>` : ''}
            `;

            row.innerHTML = `
                <td class="px-4 py-3 font-medium text-gray-900">${customer.name}</td>
                <td class="px-4 py-3">${contactInfo}</td>
                <td class="px-4 py-3 text-center">
                    <span class="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                        ${customer.total_orders || 0}
                    </span>
                </td>
                <td class="px-4 py-3 text-right font-semibold text-primary">₹${parseFloat(customer.total_spent || 0).toFixed(2)}</td>
                <td class="px-4 py-3">${lastOrdersHtml}</td>
            `;
            tableBody.appendChild(row);
        });
    }

    // Event Listeners
    searchInput.addEventListener('input', () => renderTable(allCustomers));

    // CSV Download
    downloadCsvBtn.addEventListener('click', () => {
        if (allCustomers.length === 0) return;

        const searchTerm = searchInput.value.toLowerCase();
        
        const dataToExport = allCustomers.filter(customer => {
            const name = (customer.name || '').toLowerCase();
            const mobile = (customer.mobile_no || '').toLowerCase();
            const email = (customer.email || '').toLowerCase();
            
            return name.includes(searchTerm) || mobile.includes(searchTerm) || email.includes(searchTerm);
        });

        const csvContent = convertToCSV(dataToExport);
        downloadCSV(csvContent, 'customer_sheet_' + new Date().toISOString().slice(0,10) + '.csv');
    });

    function convertToCSV(data) {
        const headers = ['Customer Name', 'Mobile', 'Email', 'Total Orders', 'Total Spent', 'Last Order Date', 'Last Order Amount'];
        const rows = data.map(customer => {
            const lastOrder = customer.last_orders && customer.last_orders.length > 0 ? customer.last_orders[0] : null;
            return [
                `"${(customer.name || '').replace(/"/g, '""')}"`,
                `"${(customer.mobile_no || '').replace(/"/g, '""')}"`,
                `"${(customer.email || '').replace(/"/g, '""')}"`,
                customer.total_orders || 0,
                customer.total_spent || 0,
                lastOrder ? new Date(lastOrder.transaction_date).toLocaleDateString() : '',
                lastOrder ? (lastOrder.total_amount || 0) : ''
            ];
        });

        return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    }

    function downloadCSV(content, fileName) {
        const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        if (link.download !== undefined) {
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', fileName);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    }

    // Initial Load
    fetchCustomers();
});
