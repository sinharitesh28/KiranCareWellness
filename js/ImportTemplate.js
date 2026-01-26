document.addEventListener('DOMContentLoaded', () => {
    // --- Elements ---
    const analyzeBtn = document.getElementById('analyzeBtn');
    const saveConfigBtn = document.getElementById('saveConfigBtn');
    const resetFlowBtn = document.getElementById('resetFlowBtn');
    
    // Tabs
    const tabNew = document.getElementById('tabNew');
    const tabManage = document.getElementById('tabManage');
    const viewNewConfig = document.getElementById('viewNewConfig');
    const viewManage = document.getElementById('viewManage');
    const refreshListBtn = document.getElementById('refreshListBtn');

    // Step Indicators
    const stepIndicators = {
        step1: document.getElementById('step1Indicator'),
        step2: document.getElementById('step2Indicator'),
        step3: document.getElementById('step3Indicator'),
    };

    // --- Smart Extraction Elements ---
    const viewerSubject = document.getElementById('viewerSubject');
    const viewerBody = document.getElementById('viewerBody');
    const btnSelectInvoice = document.getElementById('btnSelectInvoice');
    const btnSelectDate = document.getElementById('btnSelectDate');
    const selectionHint = document.getElementById('selectionHint');
    const extractionPreview = document.getElementById('extractionPreview');
    
    let currentSelectionMode = null; // 'invoice' or 'date'
    let extractionConfig = {
        invoice: { regex: null, source: null, sample: null },
        date: { regex: null, source: null, sample: null }
    };

    // --- Tab Switching ---
    function switchTab(view) {
        if (view === 'new') {
            viewNewConfig.classList.remove('hidden');
            viewManage.classList.add('hidden');
            tabNew.classList.add('tab-active', 'border-b-2');
            tabNew.classList.remove('tab-inactive', 'border-transparent');
            tabManage.classList.remove('tab-active', 'border-b-2');
            tabManage.classList.add('tab-inactive', 'border-transparent');
        } else {
            viewNewConfig.classList.add('hidden');
            viewManage.classList.remove('hidden');
            tabManage.classList.add('tab-active', 'border-b-2');
            tabManage.classList.remove('tab-inactive', 'border-transparent');
            tabNew.classList.remove('tab-active', 'border-b-2');
            tabNew.classList.add('tab-inactive', 'border-transparent');
            loadConfigs();
        }
    }

    tabNew.onclick = () => switchTab('new');
    tabManage.onclick = () => switchTab('manage');
    resetFlowBtn.onclick = resetForm;

    function resetForm() {
        document.getElementById('editingConfigId').value = '';
        document.getElementById('metadataSection').classList.add('hidden');
        document.getElementById('mappingSection').classList.add('hidden');
        setActiveStep(1);
        extractionConfig = { invoice: { regex: null, source: null }, date: { regex: null, source: null } };
        viewerSubject.innerHTML = '';
        viewerBody.innerHTML = '';
        extractionPreview.classList.add('hidden');
        resetSelectionButtons();
    }

    function setActiveStep(stepNumber) {
        Object.values(stepIndicators).forEach(el => {
            el.classList.add('opacity-40');
            el.querySelector('span:first-child').className = "flex items-center justify-center w-8 h-8 rounded-full bg-gray-300 text-gray-600 font-bold mr-4";
        });
        const activeStep = stepIndicators[`step${stepNumber}`];
        if (activeStep) {
            activeStep.classList.remove('opacity-40');
            activeStep.querySelector('span:first-child').className = "flex items-center justify-center w-8 h-8 rounded-full bg-primary text-white font-bold mr-4";
        }
    }

    // --- Step 1: Search & Fetch ---
    const searchEmailsBtn = document.getElementById('searchEmailsBtn');
    const candidatesList = document.getElementById('emailCandidatesList');
    
    searchEmailsBtn.onclick = async () => {
        const keyword = document.getElementById('emailSearchKeyword').value.trim();
        setLoading(searchEmailsBtn, true, 'Searching...');
        candidatesList.classList.remove('hidden');
        candidatesList.innerHTML = '<p class="text-center text-gray-500 text-sm py-4"><i class="fas fa-spinner fa-spin mr-2"></i>Scanning Inbox...</p>';

        try {
            const res = await fetch('/api/distributor/list-recent-emails', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ keyword })
            });
            const data = await res.json();
            candidatesList.innerHTML = '';
            if (data.success && data.candidates.length > 0) {
                data.candidates.forEach(email => {
                    const el = document.createElement('div');
                    el.className = 'p-4 bg-white border border-gray-200 rounded-xl cursor-pointer hover:bg-green-50 hover:border-primary/30 transition flex justify-between items-center shadow-sm mb-2';
                    el.onclick = () => selectCandidate(email.id);
                    el.innerHTML = '
                        <div class="truncate pr-4">
                            <p class="font-bold text-gray-800 text-sm truncate">' + (email.subject || '(No Subject)') + '</p>
                            <p class="text-[10px] text-gray-500 uppercase tracking-tight mt-1">' + email.sender.split('<')[0] + ' &bull; ' + dayjs(email.date).format('DD MMM') + '</p>
                        </div>
                        <i class="fas fa-chevron-right text-gray-300 text-xs"></i>
                    ';
                    candidatesList.appendChild(el);
                });
            } else {
                candidatesList.innerHTML = '<p class="text-center text-gray-500 text-sm py-4">No matching emails found.</p>';
            }
        } catch (err) {
            candidatesList.innerHTML = '<p class="text-center text-red-500 text-sm py-4">Failed to connect to server.</p>';
        } finally {
            setLoading(searchEmailsBtn, false, 'Find Emails');
        }
    };

    function selectCandidate(uid) {
        candidatesList.classList.add('hidden');
        fetchMetadata(null, uid);
    }

    async function fetchMetadata(configId = null, directUid = null) {
        const payload = configId ? { configId } : { directUid };
        const btn = searchEmailsBtn;
        setLoading(btn, true, 'Opening...');

        try {
            const res = await fetch('/api/distributor/fetch-email-metadata', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (res.ok) {
                populateMetadata(data.metadata);
                document.getElementById('metadataSection').classList.remove('hidden');
                setActiveStep(2);
                document.getElementById('metadataSection').scrollIntoView({ behavior: 'smooth' });
            } else {
                alert(data.error);
            }
        } catch (err) { alert('Network Error'); }
        finally { setLoading(btn, false, 'Find Emails'); }
    }

    function populateMetadata(meta) {
        document.getElementById('distributorName').value = meta.distributorName;
        document.getElementById('emailSender').value = meta.senderEmail;
        document.getElementById('subjectKeyword').value = meta.subjectKeyword;
        document.getElementById('fileType').value = meta.fileType;
        document.getElementById('emailUid').value = meta.id;
        document.getElementById('fileName').value = meta.fileName;
        
        // Tokenized Viewers
        renderTokenizedText(viewerSubject, meta.subject, 'subject');
        renderTokenizedText(viewerBody, meta.bodyText, 'body');
        
        if (meta.invoiceNoRegex || meta.invoiceDateRegex) {
            extractionConfig.invoice = { regex: meta.invoiceNoRegex, source: meta.invoiceNoSource, sample: '(Saved)' };
            extractionConfig.date = { regex: meta.invoiceDateRegex, source: meta.invoiceDateSource, sample: '(Saved)' };
            updateExtractionPreview();
        }
    }

    // --- Tokenized Selection UI ---

    function renderTokenizedText(container, text, source) {
        container.innerHTML = '';
        if (!text) { container.innerHTML = '<span class="text-gray-400 italic">Empty</span>'; return; }

        // Split by whitespace but keep the whitespace as tokens too for spacing
        const tokens = text.split(/(\s+)/);
        tokens.forEach((token, idx) => {
            const span = document.createElement('span');
            if (token.trim() === "") {
                span.textContent = token;
            } else {
                span.textContent = token;
                span.className = "token py-0.5 px-0.5 rounded transition cursor-pointer hover:bg-yellow-100";
                span.onclick = () => handleTokenClick(span, token, source, idx, tokens);
            }
            container.appendChild(span);
        });
    }

    function handleTokenClick(el, value, source, index, allTokens) {
        if (!currentSelectionMode) return; 

        // Visual Feedback: Highlight
        document.querySelectorAll('.token-selected').forEach(t => t.classList.remove('token-selected', 'bg-primary', 'text-white'));
        el.classList.add('token-selected', 'bg-primary', 'text-white');

        // Generate Regex Logic
        // We find the nearest preceding anchor (like "Invoice:" or "Date:")
        let anchor = "";
        for (let i = index - 1; i >= Math.max(0, index - 5); i--) {
            const t = allTokens[i].trim();
            if (t.endsWith(':') || t.toLowerCase().includes('no') || t.toLowerCase().includes('date')) {
                anchor = t;
                break;
            }
        }

        const escapedAnchor = anchor.replace(/[.*+?^${}()|[\\]/g, '\\$&');
        const escapedValue = value.replace(/[.*+?^${}()|[\\]/g, '\\$&');
        
        let regexPattern = '';
        if (anchor) {
            // Pattern: Anchor followed by whitespace and then capture non-whitespace
            regexPattern = `${escapedAnchor}\s*([^\\s]+)`;
        } else {
            // Fallback: If it looks like a date
            if (/^\d{2}[-/]\d{2}[-/]\d{4}$/.test(value)) regexPattern = "(\\d{2}[-/]\\d{2}[-/]\\d{4})";
            else regexPattern = `(${escapedValue})`;
        }
        
        // Save to config
        extractionConfig[currentSelectionMode] = {
            regex: regexPattern,
            source: source,
            sample: value
        };

        updateExtractionPreview();
        resetSelectionButtons();
        
        // Android UX: Flash success
        this.showToast(`Selected ${currentSelectionMode}: ${value}`);
    }

    function toggleSelectionMode(mode, btn) {
        if (currentSelectionMode === mode) {
            resetSelectionButtons();
            return;
        }
        resetSelectionButtons();
        currentSelectionMode = mode;
        btn.classList.add('bg-primary', 'text-white', 'border-primary');
        selectionHint.classList.remove('hidden');
        document.getElementById('hintText').textContent = `Now tap the ${mode === 'invoice' ? 'Invoice Number' : 'Date'} in the text below.`;
    }

    btnSelectInvoice.onclick = () => toggleSelectionMode('invoice', btnSelectInvoice);
    btnSelectDate.onclick = () => toggleSelectionMode('date', btnSelectDate);

    function resetSelectionButtons() {
        currentSelectionMode = null;
        selectionHint.classList.add('hidden');
        btnSelectInvoice.className = "flex-1 sm:flex-none px-4 py-2 text-sm border-2 border-gray-200 rounded-xl hover:bg-gray-50 transition selection-mode-btn flex items-center justify-center gap-2";
        btnSelectDate.className = "flex-1 sm:flex-none px-4 py-2 text-sm border-2 border-gray-200 rounded-xl hover:bg-gray-50 transition selection-mode-btn flex items-center justify-center gap-2";
    }

    function updateExtractionPreview() {
        extractionPreview.classList.remove('hidden');
        const inv = extractionConfig.invoice;
        if (inv.sample) {
            document.getElementById('previewInvoice').textContent = inv.sample;
            document.getElementById('regexInvoice').textContent = `[${inv.source}] ${inv.regex}`;
        }
        const dat = extractionConfig.date;
        if (dat.sample) {
            document.getElementById('previewDate').textContent = dat.sample;
            document.getElementById('regexDate').textContent = `[${dat.source}] ${dat.regex}`;
        }
    }

    // --- Step 2: Analyze File ---
    analyzeBtn.onclick = async () => {
        const uid = document.getElementById('emailUid').value;
        const fileName = document.getElementById('fileName').value;
        if (!uid) return alert('No email loaded.');
        setLoading(analyzeBtn, true, 'Analyzing...');

        try {
            const res = await fetch('/api/distributor/analyze-file', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uid, fileName })
            });
            const data = await res.json();
            if (res.ok) {
                renderMappingTable(data.mapping, data.fileHeaders);
                document.getElementById('mappingSection').classList.remove('hidden');
                setActiveStep(3);
                document.getElementById('mappingSection').scrollIntoView({ behavior: 'smooth' });
            } else alert(data.error);
        } catch (e) { alert('Analysis Error'); }
        finally { setLoading(analyzeBtn, false, 'Analyze File'); }
    };

    function renderMappingTable(mapping, fileHeaders) {
        const tbody = document.getElementById('mappingTableBody');
        const datalist = document.getElementById('fileHeadersList');
        tbody.innerHTML = ''; datalist.innerHTML = '';

        fileHeaders.forEach(h => { const o = document.createElement('option'); o.value = h; datalist.appendChild(o); });

        mapping.forEach((row) => {
            const tr = document.createElement('tr');
            let icon = 'fa-times-circle text-red-300';
            let bg = 'bg-white';
            
            if (row.suggestedHeader) {
                if (row.confidence === 'high') { icon = 'fa-check-circle text-green-500'; bg = 'bg-green-50/30'; }
                else if (row.confidence === 'moderate') { icon = 'fa-exclamation-circle text-yellow-500'; bg = 'bg-yellow-50/30'; }
            }

            tr.className = `border-b border-gray-100 ${bg}`;
            tr.innerHTML = '
                <td class="px-4 py-4">
                    <input type="text" list="fileHeadersList" 
                           class="map-input w-full rounded-xl border-gray-200 shadow-sm focus:border-primary focus:ring-primary p-2.5 text-sm"
                           value="' + (row.suggestedHeader || '') + '"
                           data-system-column="' + row.systemColumn + '">
                </td>
                <td class="px-4 py-4"><span class="font-bold text-gray-700 text-sm">' + row.systemLabel + '</span></td>
                <td class="px-4 py-4 text-center"><i class="fas ' + icon + '"></i></td>
            ';
            tbody.appendChild(tr);
        });
    }

    // --- Step 3: Save ---
    saveConfigBtn.onclick = async () => {
        const mapping = [];
        document.querySelectorAll('.map-input').forEach(input => {
            if (input.value.trim()) mapping.push({ systemColumn: input.dataset.systemColumn, fileHeader: input.value.trim() });
        });

        const payload = {
            distributorName: document.getElementById('distributorName').value,
            emailSender: document.getElementById('emailSender').value,
            subjectKeyword: document.getElementById('subjectKeyword').value,
            fileType: document.getElementById('fileType').value,
            gmailThreadId: document.getElementById('emailUid').value,
            mapping: mapping,
            invoiceNoRegex: extractionConfig.invoice.regex,
            invoiceNoSource: extractionConfig.invoice.source,
            invoiceDateRegex: extractionConfig.date.regex,
            invoiceDateSource: extractionConfig.date.source
        };

        if (mapping.length === 0) return alert('Map at least one column.');
        setLoading(saveConfigBtn, true, 'Saving...');

        try {
            const res = await fetch('/api/distributor/save-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (res.ok) {
                alert('Success!');
                switchTab('manage');
            } else alert('Save Failed');
        } catch (e) { alert('Error'); }
        finally { setLoading(saveConfigBtn, false, 'Save Configuration'); }
    };

    // --- Manage View ---
    refreshListBtn.onclick = loadConfigs;

    async function loadConfigs() {
        const tbody = document.getElementById('configListBody');
        tbody.innerHTML = '<tr><td colspan="4" class="text-center py-10 text-gray-400 italic">Loading Configurations...</td></tr>';
        try {
            const res = await fetch('/api/distributor/list-configs');
            const data = await res.json();
            tbody.innerHTML = '';
            if (data.configs.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" class="text-center py-10 text-gray-400">No settings found.</td></tr>';
                return;
            }
            data.configs.forEach(config => {
                const tr = document.createElement('tr');
                tr.className = "hover:bg-gray-50 transition";
                tr.innerHTML = `
                    <td class="px-6 py-4 whitespace-nowrap font-bold text-gray-800">${config.distributor_name}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-gray-500 text-sm">${config.email_sender}</td>
                    <td class="px-6 py-4 whitespace-nowrap">
                        ${config.invoice_no_regex ? '<span class="px-2 py-1 bg-indigo-100 text-indigo-700 text-[10px] font-bold rounded-full mr-1">SMART</span>' : ''}
                        <span class="px-2 py-1 bg-gray-100 text-gray-600 text-[10px] font-bold rounded-full uppercase">${config.template_name ? 'Template Linked' : 'No Template'}</span>
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap text-right text-sm">
                        <button onclick="window.editConfig('${config.id}')" class="text-primary font-bold mr-4"><i class="fas fa-edit"></i></button>
                        <button onclick="window.deleteConfig('${config.id}')" class="text-red-400"><i class="fas fa-trash"></i></button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        } catch (err) { tbody.innerHTML = '<tr><td colspan="4" class="text-center py-10 text-red-400">Error loading data.</td></tr>'; }
    }

    // Global Helpers
    window.showToast = (m) => {
        let c = document.getElementById('toast-container');
        if(!c) { c = document.createElement('div'); c.id = 'toast-container'; c.style.cssText = "position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); z-index: 2000;"; document.body.appendChild(c); }
        const d = document.createElement('div'); d.className = "px-6 py-3 rounded-full bg-gray-800 text-white mb-2 shadow-lg text-sm font-medium animate-bounce-in";
        d.textContent = m; c.appendChild(d); setTimeout(() => d.remove(), 2000);
    };

    window.editConfig = (id) => {
        document.getElementById('editingConfigId').value = id;
        switchTab('new');
        fetchMetadata(id); 
    };

    window.deleteConfig = async (id) => {
        if (!confirm('Are you sure you want to delete this configuration?')) return;
        try {
            const res = await fetch(`/api/distributor/delete-config/${id}`, { method: 'DELETE' });
            if (res.ok) loadConfigs();
            else alert('Delete failed.');
        } catch (e) { alert('Error deleting.'); }
    };

    function setLoading(btn, isLoading, text) {
        if (isLoading) {
            btn.disabled = true;
            btn.dataset.original = btn.innerHTML;
            btn.innerHTML = `<i class="fas fa-circle-notch fa-spin mr-2"></i> ${text}`;
        } else {
            btn.disabled = false;
            btn.innerHTML = btn.dataset.original || text;
        }
    }
});