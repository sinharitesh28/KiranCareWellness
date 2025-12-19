document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const dateRangeSelect = document.getElementById('dateRange');
    const customDateInputs = document.getElementById('customDateInputs');
    const startDateInput = document.getElementById('startDate');
    const endDateInput = document.getElementById('endDate');
    const applyFiltersBtn = document.getElementById('applyFilters');

    // Chart Instances
    let salesChart, stockStatusChart, distributorChart, abcChart;

    // Toggle Custom Date Inputs
    dateRangeSelect.addEventListener('change', () => {
        if (dateRangeSelect.value === 'custom') {
            customDateInputs.classList.remove('hidden');
        } else {
            customDateInputs.classList.add('hidden');
        }
    });

    // Apply Filters
    applyFiltersBtn.addEventListener('click', loadAllReports);

    // Initial Load
    loadAllReports();

    function getFilterParams() {
        const period = dateRangeSelect.value;
        const startDate = startDateInput.value;
        const endDate = endDateInput.value;
        return new URLSearchParams({ period, startDate, endDate });
    }

    async function loadAllReports() {
        const params = getFilterParams();
        
        await Promise.all([
            loadSalesReports(params),
            loadStockStatus(), // Stock status is usually current snapshot, ignoring date filter
            loadABCAnalysis(params)
        ]);
    }

    // 1. Load Sales Reports
    async function loadSalesReports(params) {
        try {
            const res = await fetch(`/api/analytics/sales?${params}`);
            const data = await res.json();

            if (data.success) {
                renderSalesChart(data.graphData);
                renderSalesTable(data.tableData);
            }
        } catch (error) {
            console.error('Error loading sales report:', error);
        }
    }

    function renderSalesChart(data) {
        const ctx = document.getElementById('salesChart').getContext('2d');
        
        if (salesChart) salesChart.destroy();

        salesChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: data.map(d => new Date(d.date).toLocaleDateString()),
                datasets: [{
                    label: 'Total Sales (₹)',
                    data: data.map(d => d.total_sales),
                    borderColor: '#00712D',
                    backgroundColor: 'rgba(0, 113, 45, 0.1)',
                    tension: 0.4,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                }
            }
        });
    }

    function renderSalesTable(data) {
        const tbody = document.getElementById('salesTableBody');
        tbody.innerHTML = data.map(item => `
            <tr>
                <td class="px-4 py-2 font-medium">${item.item_name}</td>
                <td class="px-4 py-2 text-right">${item.total_quantity}</td>
                <td class="px-4 py-2 text-right">₹${parseFloat(item.total_revenue).toFixed(2)}</td>
            </tr>
        `).join('');
    }

    // 2. Load Stock Status
    async function loadStockStatus() {
        try {
            const res = await fetch(`/api/analytics/stock-status`);
            const data = await res.json();

            if (data.success) {
                renderStockStatusChart(data.statusData);
                renderDistributorChart(data.distributorData);
                populateDistributorTable(data.distributorData);
            }
        } catch (error) {
            console.error('Error loading stock status:', error);
        }
    }

    function renderStockStatusChart(data) {
        const ctx = document.getElementById('stockStatusChart').getContext('2d');
        
        if (stockStatusChart) stockStatusChart.destroy();

        stockStatusChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['Active', 'Inactive'],
                datasets: [{
                    data: [data.active_count, data.inactive_count],
                    backgroundColor: ['#00712D', '#e5e7eb'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false
            }
        });
    }

    function renderDistributorChart(data) {
        const ctx = document.getElementById('distributorChart').getContext('2d');
        const topDistributors = data.slice(0, 10); // Top 10

        if (distributorChart) distributorChart.destroy();

        distributorChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: topDistributors.map(d => d.vendor_name || 'Unknown'),
                datasets: [{
                    label: 'Stock Value (₹)',
                    data: topDistributors.map(d => d.total_value),
                    backgroundColor: '#FF9100'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { beginAtZero: true }
                }
            }
        });
    }

    function populateDistributorTable(data) {
        const tbody = document.getElementById('distributorTableBody');
        tbody.innerHTML = data.map(item => `
            <tr>
                <td>${item.vendor_name || 'Unknown'}</td>
                <td>${item.item_count}</td>
                <td>${parseFloat(item.total_value).toFixed(2)}</td>
            </tr>
        `).join('');
    }

    // 3. Load ABC Analysis
    async function loadABCAnalysis(params) {
        try {
            const res = await fetch(`/api/analytics/abc-analysis?${params}`);
            const data = await res.json();

            if (data.success) {
                renderABCChart(data.summary);
                renderABCTable(data.data);
            }
        } catch (error) {
            console.error('Error loading ABC analysis:', error);
        }
    }

    function renderABCChart(summary) {
        const ctx = document.getElementById('abcChart').getContext('2d');
        
        if (abcChart) abcChart.destroy();

        abcChart = new Chart(ctx, {
            type: 'pie',
            data: {
                labels: ['Class A', 'Class B', 'Class C'],
                datasets: [{
                    data: [summary.A, summary.B, summary.C],
                    backgroundColor: ['#00712D', '#FF9100', '#EF4444']
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false
            }
        });
    }

    function renderABCTable(data) {
        const tbody = document.getElementById('abcTableBody');
        tbody.innerHTML = data.map(item => {
            let colorClass = '';
            if (item.category === 'A') colorClass = 'text-green-600 font-bold';
            else if (item.category === 'B') colorClass = 'text-yellow-600 font-bold';
            else colorClass = 'text-red-600 font-bold';

            return `
                <tr>
                    <td class="px-4 py-2 font-medium">${item.item_name}</td>
                    <td class="px-4 py-2 text-right">₹${parseFloat(item.value).toFixed(2)}</td>
                    <td class="px-4 py-2 text-center ${colorClass}">${item.category}</td>
                </tr>
            `;
        }).join('');
    }

    // Global Export Function
    window.exportTableToCSV = function(tableId, filename) {
        const table = document.getElementById(tableId);
        let csv = [];
        
        // Get headers
        const headers = Array.from(table.querySelectorAll('thead th'))
            .map(th => `"${th.innerText}"`);
        csv.push(headers.join(','));

        // Get rows
        const rows = table.querySelectorAll('tbody tr');
        rows.forEach(row => {
            const cols = Array.from(row.querySelectorAll('td'))
                .map(td => `"${td.innerText.replace(/₹/g, '').trim()}"`);
            csv.push(cols.join(','));
        });

        // Download CSV
        const csvFile = new Blob([csv.join('\n')], { type: 'text/csv' });
        const downloadLink = document.createElement('a');
        downloadLink.download = `${filename}_${new Date().toISOString().slice(0,10)}.csv`;
        downloadLink.href = window.URL.createObjectURL(csvFile);
        downloadLink.style.display = 'none';
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
    };
});