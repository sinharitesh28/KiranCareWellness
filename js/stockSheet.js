document.addEventListener('DOMContentLoaded', () => {
    const tableBody = document.getElementById('stockTableBody');
    const loadingOverlay = document.getElementById('loading-overlay');
    const searchInput = document.getElementById('searchInput');
    const hideExpiredCheckbox = document.getElementById('hideExpired');
    const refreshBtn = document.getElementById('refreshBtn');
    const downloadCsvBtn = document.getElementById('downloadCsvBtn');
    const noResults = document.getElementById('noResults');

    // Totals Elements
    const totalStdStockEl = document.getElementById('totalStdStock');
    const totalLooseStockEl = document.getElementById('totalLooseStock');
    const totalValueEl = document.getElementById('totalValue');

    let allStockData = [];
    let currentSort = { column: 'item_name', direction: 'asc' };

    // Fetch Data
    async function fetchStockData() {
        showLoading(true);
        try {
            const response = await fetch('/api/stock/stock-sheet');
            const data = await response.json();

            if (data.success) {
                allStockData = data.data;
                renderTable(allStockData);
            } else {
                alert('Failed to load stock data: ' + data.error);
            }
        } catch (error) {
            console.error('Error fetching stock:', error);
            alert('An error occurred while fetching stock data.');
        } finally {
            showLoading(false);
        }
    }

    // Render Table
    function renderTable(data) {
        tableBody.innerHTML = '';
        
        // Filter Data
        const searchTerm = searchInput.value.toLowerCase();
        const hideExpired = hideExpiredCheckbox.checked;
        const today = dayjs().startOf('day');

        let filteredData = data.filter(item => {
            const matchesSearch = 
                (item.item_name && item.item_name.toLowerCase().includes(searchTerm)) ||
                (item.batch_number && item.batch_number.toLowerCase().includes(searchTerm)) ||
                (item.vendor_name && item.vendor_name.toLowerCase().includes(searchTerm));
            
            const isExpired = item.expiry_date && item.expiry_date !== 'N/A' && dayjs(item.expiry_date).isBefore(today);
            const passesExpiryCheck = !hideExpired || !isExpired;

            return matchesSearch && passesExpiryCheck;
        });

        // Sort Data
        filteredData.sort((a, b) => {
            let valA = a[currentSort.column];
            let valB = b[currentSort.column];

            // Handle numeric sorting
            if (['standard_stock', 'loose_stock', 'mrp', 'rate', 'value'].includes(currentSort.column)) {
                valA = parseFloat(valA) || 0;
                valB = parseFloat(valB) || 0;
            } else {
                valA = (valA || '').toString().toLowerCase();
                valB = (valB || '').toString().toLowerCase();
            }

            if (valA < valB) return currentSort.direction === 'asc' ? -1 : 1;
            if (valA > valB) return currentSort.direction === 'asc' ? 1 : -1;
            return 0;
        });

        if (filteredData.length === 0) {
            noResults.classList.remove('hidden');
            updateTotals(0, 0, 0);
            return;
        }
        noResults.classList.add('hidden');

        // Totals
        let totalStd = 0;
        let totalLoose = 0;
        let totalVal = 0;

        filteredData.forEach(item => {
            const row = document.createElement('tr');
            row.className = 'hover:bg-gray-50 transition duration-150';
            
            const isExpired = item.expiry_date && item.expiry_date !== 'N/A' && item.expiry_date < today;
            const expiryClass = isExpired ? 'text-red-600 font-semibold' : '';

            row.innerHTML = `
                <td class="px-4 py-3 font-medium text-gray-900">${item.item_name}</td>
                <td class="px-4 py-3">${item.batch_number || '-'}</td>
                <td class="px-4 py-3 ${expiryClass}">${item.expiry_date || '-'}</td>
                <td class="px-4 py-3 text-right font-medium">${item.standard_stock}</td>
                <td class="px-4 py-3 text-right">${item.loose_stock}</td>
                <td class="px-4 py-3 text-right text-gray-500">${item.packing || 1}</td>
                <td class="px-4 py-3 text-right">₹${parseFloat(item.mrp || 0).toFixed(2)}</td>
                <td class="px-4 py-3 text-right">₹${parseFloat(item.rate || 0).toFixed(2)}</td>
                <td class="px-4 py-3 text-right font-semibold text-primary">₹${parseFloat(item.value || 0).toFixed(2)}</td>
            `;
            tableBody.appendChild(row);

            totalStd += parseFloat(item.standard_stock) || 0;
            totalLoose += parseFloat(item.loose_stock) || 0;
            totalVal += parseFloat(item.value) || 0;
        });

        updateTotals(totalStd, totalLoose, totalVal);
    }

    function updateTotals(std, loose, val) {
        totalStdStockEl.textContent = std;
        totalLooseStockEl.textContent = loose;
        totalValueEl.textContent = '₹' + val.toFixed(2);
    }

    function showLoading(show) {
        if (show) loadingOverlay.classList.remove('hidden');
        else loadingOverlay.classList.add('hidden');
    }

    // Event Listeners
    searchInput.addEventListener('input', () => renderTable(allStockData));
    hideExpiredCheckbox.addEventListener('change', () => renderTable(allStockData));
    refreshBtn.addEventListener('click', fetchStockData);

    // Sorting
    document.querySelectorAll('.sortable').forEach(th => {
        th.addEventListener('click', () => {
            const column = th.dataset.sort;
            if (currentSort.column === column) {
                currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
            } else {
                currentSort.column = column;
                currentSort.direction = 'asc';
            }
            
            // Update icons
            document.querySelectorAll('.sortable i').forEach(icon => icon.className = 'fas fa-sort text-xs ml-1');
            const activeIcon = th.querySelector('i');
            if (activeIcon) {
                activeIcon.className = currentSort.direction === 'asc' ? 'fas fa-sort-up text-xs ml-1' : 'fas fa-sort-down text-xs ml-1';
            }

            renderTable(allStockData);
        });
    });

    // CSV Download
    downloadCsvBtn.addEventListener('click', () => {
        if (allStockData.length === 0) return;

        const searchTerm = searchInput.value.toLowerCase();
        const hideExpired = hideExpiredCheckbox.checked;
        const today = new Date().toISOString().split('T')[0];

        let dataToExport = allStockData.filter(item => {
            const matchesSearch = 
                (item.item_name && item.item_name.toLowerCase().includes(searchTerm)) ||
                (item.batch_number && item.batch_number.toLowerCase().includes(searchTerm)) ||
                (item.vendor_name && item.vendor_name.toLowerCase().includes(searchTerm));
            
            const isExpired = item.expiry_date && item.expiry_date !== 'N/A' && item.expiry_date < today;
            const passesExpiryCheck = !hideExpired || !isExpired;

            return matchesSearch && passesExpiryCheck;
        });

        const csvContent = convertToCSV(dataToExport);
        downloadCSV(csvContent, 'stock_sheet_' + new Date().toISOString().slice(0,10) + '.csv');
    });

    function convertToCSV(data) {
        const headers = ['Item Name', 'Batch No', 'Expiry Date', 'Standard Stock', 'Loose Stock', 'Pack Size', 'MRP', 'Rate', 'Total Value', 'Vendor'];
        const rows = data.map(item => [
            `"${(item.item_name || '').replace(/"/g, '""')}"`,
            `"${(item.batch_number || '').replace(/"/g, '""')}"`,
            item.expiry_date || '',
            item.standard_stock || 0,
            item.loose_stock || 0,
            item.packing || 1,
            item.mrp || 0,
            item.rate || 0,
            item.value || 0,
            `"${(item.vendor_name || '').replace(/"/g, '""')}"`
        ]);

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
    fetchStockData();
});
