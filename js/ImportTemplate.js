document.addEventListener('DOMContentLoaded', () => {
    // --- Elements ---
    const fetchBtn = document.getElementById('fetchBtn');
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

    tabNew.addEventListener('click', () => switchTab('new'));
    tabManage.addEventListener('click', () => switchTab('manage'));
    resetFlowBtn.addEventListener('click', resetForm);

    function resetForm() {
        document.getElementById('emailUrl').value = '';
        document.getElementById('editingConfigId').value = '';
        document.getElementById('metadataSection').classList.add('hidden');
        document.getElementById('mappingSection').classList.add('hidden');
        setActiveStep(1);
        
        // Reset Smart Extraction
        extractionConfig = { invoice: { regex: null, source: null }, date: { regex: null, source: null } };
        viewerSubject.textContent = '';
        viewerBody.textContent = '';
        extractionPreview.classList.add('hidden');
        resetSelectionButtons();
    }

    function setActiveStep(stepNumber) {
        Object.values(stepIndicators).forEach(el => {
            el.classList.add('opacity-40');
            el.querySelector('span:first-child').classList.add('bg-gray-300', 'text-gray-600');
            el.querySelector('span:first-child').classList.remove('bg-primary', 'text-white');
        });

        const activeStep = stepIndicators[`step${stepNumber}`];
        if (activeStep) {
            activeStep.classList.remove('opacity-40');
            activeStep.querySelector('span:first-child').classList.remove('bg-gray-300', 'text-gray-600');
            activeStep.querySelector('span:first-child').classList.add('bg-primary', 'text-white');
        }
    }

    // --- Step 1: Search & Fetch Metadata ---
    const searchEmailsBtn = document.getElementById('searchEmailsBtn');
    const candidatesList = document.getElementById('emailCandidatesList');
    
    // New: Search Candidates
    searchEmailsBtn.addEventListener('click', async () => {
        const keyword = document.getElementById('emailSearchKeyword').value.trim();
        setLoading(searchEmailsBtn, true, 'Searching...');
        candidatesList.classList.remove('hidden');
        candidatesList.innerHTML = '<p class="text-center text-gray-500 text-sm py-2">Scanning...</p>';

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
                    el.className = 'p-3 bg-white border border-gray-200 rounded cursor-pointer hover:bg-green-50 hover:border-green-300 transition flex justify-between items-center';
                    el.onclick = () => selectCandidate(email.id);
                    el.innerHTML = `
                        <div class="truncate">
                            <p class="font-bold text-gray-800 text-sm truncate">${email.subject || '(No Subject)'}</p>
                            <p class="text-xs text-gray-500">${email.sender} &bull; ${dayjs(email.date).format('DD MMM YYYY')}</p>
                        </div>
                        <button class="text-xs bg-primary text-white px-3 py-1 rounded">Select</button>
                    `;
                    candidatesList.appendChild(el);
                });
            } else {
                candidatesList.innerHTML = '<p class="text-center text-gray-500 text-sm py-2">No relevant emails found.</p>';
            }
        } catch (err) {
            console.error(err);
            candidatesList.innerHTML = '<p class="text-center text-red-500 text-sm py-2">Search failed.</p>';
        } finally {
            setLoading(searchEmailsBtn, false, 'Find Emails');
        }
    });

    // Trigger metadata fetch with specific UID
    function selectCandidate(uid) {
        // Clear list to clean up UI
        candidatesList.classList.add('hidden');
        fetchMetadata(null, uid);
    }

    // Updated fetchMetadata signature
    async function fetchMetadata(configId = null, directUid = null) {
        // If directUid is provided, we simulate the "URL" payload logic or handle it in backend
        // Actually, let's update backend to accept 'uid' in fetch-email-metadata, OR just mock the URL
        
        // Wait, backend fetch-email-metadata primarily parses URL. 
        // Let's modify the payload we send.
        
        const payload = configId ? { configId } : {};
        if (directUid) {
            // We need a way to tell backend "Use this UID directly"
            // The existing backend logic checks 'emailUrl'. 
            // If we send emailUrl as just the UID, the backend logic:
            // "threadId = lastPart.split... OR searchCriteria.push(['SUBJECT', emailUrl])"
            // This is brittle.
            // Let's pass a NEW property 'directUid' to backend.
            // I need to update backend 'fetch-email-metadata' to handle 'directUid'.
            payload.directUid = directUid;
        } else if (!configId) {
             // Fallback to keyword if needed, but we rely on selection now
             // If user didn't select anything? 
             return alert("Please search and select an email first.");
        }
        
        // Use a generic loading button reference or the search button
        const btn = configId ? fetchBtn : searchEmailsBtn; 
        // Note: fetchBtn doesn't exist in HTML anymore, it was removed.
        
        setLoading(btn, true, 'Fetching Data...');

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
                document.getElementById('metadataSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
            } else {
                alert('Error: ' + data.error);
            }
        } catch (err) {
            alert('Network error fetching email.');
            console.error(err);
        } finally {
            setLoading(btn, false, configId ? 'Re-scan Email' : 'Find Emails');
        }
    }

    function populateMetadata(meta) {
        document.getElementById('distributorName').value = meta.distributorName;
        document.getElementById('emailSender').value = meta.senderEmail;
        document.getElementById('subjectKeyword').value = meta.subjectKeyword;
        document.getElementById('fileType').value = meta.fileType;
        document.getElementById('emailUid').value = meta.id;
        document.getElementById('fileName').value = meta.fileName;
        
        // Render Smart Extraction Viewers
        viewerSubject.textContent = meta.subject || '(No Subject)';
        viewerBody.textContent = meta.bodyText || '(No Text Content)';
        
        // Load Saved Regex Config if available
        if (meta.invoiceNoRegex || meta.invoiceDateRegex) {
            extractionConfig.invoice = {
                regex: meta.invoiceNoRegex,
                source: meta.invoiceNoSource,
                sample: meta.invoiceNoRegex ? '(Saved Pattern)' : null
            };
            extractionConfig.date = {
                regex: meta.invoiceDateRegex,
                source: meta.invoiceDateSource,
                sample: meta.invoiceDateRegex ? '(Saved Pattern)' : null
            };
            updateExtractionPreview();
        }
    }

    // --- Smart Extraction Logic ---
    
    function resetSelectionButtons() {
        btnSelectInvoice.classList.remove('bg-primary', 'text-white', 'border-primary');
        btnSelectDate.classList.remove('bg-primary', 'text-white', 'border-primary');
        btnSelectInvoice.innerHTML = '<i class="fas fa-file-invoice mr-1"></i> Select Invoice No';
        btnSelectDate.innerHTML = '<i class="fas fa-calendar-alt mr-1"></i> Select Date';
        currentSelectionMode = null;
    }

    function toggleSelectionMode(mode, btn) {
        if (currentSelectionMode === mode) {
            resetSelectionButtons();
            return;
        }
        resetSelectionButtons();
        currentSelectionMode = mode;
        btn.classList.add('bg-primary', 'text-white', 'border-primary');
        btn.innerHTML = `<i class="fas fa-mouse-pointer mr-1"></i> Select ${mode === 'invoice' ? 'Invoice' : 'Date'} Text`;
    }

    btnSelectInvoice.addEventListener('click', () => toggleSelectionMode('invoice', btnSelectInvoice));
    btnSelectDate.addEventListener('click', () => toggleSelectionMode('date', btnSelectDate));

    function handleTextSelection(e) {
        if (!currentSelectionMode) return; 
        
        const selection = window.getSelection();
        const text = selection.toString().trim();
        if (!text) return;

        // Determine Source
        let source = null;
        if (viewerSubject.contains(selection.anchorNode)) source = 'subject';
        else if (viewerBody.contains(selection.anchorNode)) source = 'body';
        else return; // Selected outside

        // Calculate Regex
        const fullText = source === 'subject' ? viewerSubject.textContent : viewerBody.textContent;
        const escapedText = text.replace(/[.*+?^${}()|[\\]/g, '\\$&'); // Escape regex chars
        
        // Find preceding context (anchor)
        const index = fullText.indexOf(text);
        let prefix = "";
        if (index > 0) {
            // Get up to 15 chars before
            const start = Math.max(0, index - 15);
            const rawPrefix = fullText.substring(start, index);
            // Try to find a stable anchor like "Invoice:" or "Date:" or just whitespace
            const match = rawPrefix.match(/([a-zA-Z]+[:\s-]*)\s*$/);
            if (match) {
                prefix = match[1].trim(); 
            }
        }

        // Generate Regex
        // Pattern: (?<=Prefix[\s]*)(CapturedGroup)
        // If no prefix found, just matches the text format loosely
        
        let regexPattern = '';
        if (prefix) {
             regexPattern = `(?<=${prefix.replace(/[.*+?^${}()|[\\]/g, '\\$&')}\s*)([^\\s]+)`;
        } else {
            // Fallback: Try to match the format of the selected text
            if (/^\d{2}[-/]\d{2}[-/]\d{4}$/.test(text)) regexPattern = `(\d{2}[-/]\d{2}[-/]\d{4})`; // Date
            else if (/^[A-Z0-9-]+$/.test(text)) regexPattern = `(${escapedText})`; // Exact match fallback or simple alphanumeric
            else regexPattern = `(${escapedText})`;
        }
        
        // Save Config
        extractionConfig[currentSelectionMode] = {
            regex: regexPattern,
            source: source,
            sample: text
        };

        // Update UI
        updateExtractionPreview();
        resetSelectionButtons();
        window.getSelection().removeAllRanges();
    }

    viewerSubject.addEventListener('mouseup', handleTextSelection);
    viewerBody.addEventListener('mouseup', handleTextSelection);

    function updateExtractionPreview() {
        extractionPreview.classList.remove('hidden');
        
        const inv = extractionConfig.invoice;
        if (inv.sample) {
            document.getElementById('previewInvoice').textContent = inv.sample;
            document.getElementById('regexInvoice').textContent = `Src: ${inv.source} | Rx: ${inv.regex}`;
        }
        
        const dat = extractionConfig.date;
        if (dat.sample) {
            document.getElementById('previewDate').textContent = dat.sample;
            document.getElementById('regexDate').textContent = `Src: ${dat.source} | Rx: ${dat.regex}`;
        }
    }


    // --- Step 2: Analyze & Map ---
    analyzeBtn.addEventListener('click', async () => {
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
                document.getElementById('mappingSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
            } else {
                alert('Analysis Failed: ' + data.error);
            }
        } catch (err) {
            console.error(err);
            alert('Error analyzing file.');
        } finally {
            setLoading(analyzeBtn, false, 'Analyze File');
        }
    });

    function renderMappingTable(mapping, fileHeaders) {
        const tbody = document.getElementById('mappingTableBody');
        const datalist = document.getElementById('fileHeadersList');
        
        tbody.innerHTML = '';
        datalist.innerHTML = '';

        fileHeaders.forEach(header => {
            const option = document.createElement('option');
            option.value = header;
            datalist.appendChild(option);
        });

        mapping.forEach((row) => {
            const tr = document.createElement('tr');
            let rowClass = 'border-l-4 ';
            let iconClass = '';

            if (row.suggestedHeader) {
                if (row.confidence === 'high') {
                    rowClass += 'confidence-high';
                    iconClass = 'fa-check-circle text-green-500';
                } else if (row.confidence === 'moderate') {
                    rowClass += 'confidence-moderate';
                    iconClass = 'fa-exclamation-circle text-yellow-500';
                } else {
                    rowClass += 'confidence-poor';
                    iconClass = 'fa-question-circle text-gray-400';
                }
            } else {
                rowClass += 'bg-white';
                iconClass = 'fa-times-circle text-red-300';
            }

            tr.className = rowClass;
            tr.innerHTML = `
                <td class="px-4 py-3">
                    <input type="text" list="fileHeadersList" 
                           class="map-input w-full rounded-md border-gray-300 shadow-sm focus:border-primary focus:ring-primary p-2 text-sm"
                           value="${row.suggestedHeader || ''}"
                           placeholder="Search..."
                           data-system-column="${row.systemColumn}">
                </td>
                <td class="px-4 py-3 text-left">
                    <span class="font-bold text-gray-800">${row.systemLabel}</span>
                </td>
                <td class="px-4 py-3 text-center text-lg"><i class="fas ${iconClass}"></i></td>
            `;
            tbody.appendChild(tr);
        });
    }

    // --- Step 3: Save ---
    saveConfigBtn.addEventListener('click', async () => {
        const mapping = [];
        document.querySelectorAll('.map-input').forEach(input => {
            const fileHeader = input.value.trim();
            const systemColumn = input.dataset.systemColumn;
            if (fileHeader) mapping.push({ systemColumn, fileHeader });
        });

        const payload = {
            distributorName: document.getElementById('distributorName').value,
            emailSender: document.getElementById('emailSender').value,
            subjectKeyword: document.getElementById('subjectKeyword').value,
            fileType: document.getElementById('fileType').value,
            gmailThreadId: document.getElementById('emailUid').value, // Use the current email UID/ThreadID
            mapping: mapping,
            // New Smart Extraction Data
            invoiceNoRegex: extractionConfig.invoice.regex,
            invoiceNoSource: extractionConfig.invoice.source,
            invoiceDateRegex: extractionConfig.date.regex,
            invoiceDateSource: extractionConfig.date.source
        };

        if (mapping.length === 0) return alert('Please map at least one column.');

        setLoading(saveConfigBtn, true, 'Saving...');

        try {
            const res = await fetch('/api/distributor/save-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                alert('Configuration Saved Successfully!');
                switchTab('manage'); // Go to list view
            } else {
                const d = await res.json();
                alert('Save Failed: ' + d.error);
            }
        } catch (err) {
            console.error(err);
            alert('Error saving configuration.');
        } finally {
            setLoading(saveConfigBtn, false, 'Save Configuration');
        }
    });

    // --- Manage View ---
    refreshListBtn.addEventListener('click', loadConfigs);

    async function loadConfigs() {
        const tbody = document.getElementById('configListBody');
        tbody.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-gray-500">Loading...</td></tr>';

        try {
            const res = await fetch('/api/distributor/list-configs');
            const data = await res.json();

            tbody.innerHTML = '';
            if (data.configs.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-gray-500">No configurations found.</td></tr>';
                return;
            }

            data.configs.forEach(config => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td class="px-6 py-4 whitespace-nowrap font-medium text-gray-900">${config.distributor_name}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-gray-500 text-sm">${config.email_sender}</td>
                    <td class="px-6 py-4 whitespace-nowrap">
                        ${config.invoice_no_regex 
                            ? '<span class="px-2 py-1 bg-purple-100 text-purple-800 text-xs rounded-full">Smart Regex</span>' 
                            : ''}
                        ${config.gmail_thread_id 
                            ? '<span class="px-2 py-1 bg-green-100 text-green-800 text-xs rounded-full">Thread Linked</span>' 
                            : '<span class="px-2 py-1 bg-gray-100 text-gray-800 text-xs rounded-full">Manual</span>'}
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <button class="text-indigo-600 hover:text-indigo-900 mr-3 edit-btn" data-id="${config.id}">
                            <i class="fas fa-edit"></i> Edit
                        </button>
                        <button class="text-red-600 hover:text-red-900 delete-btn" data-id="${config.id}">
                            <i class="fas fa-trash"></i>
                        </button>
                    </td>
                `;
                tbody.appendChild(tr);
            });

            // Attach Listeners
            document.querySelectorAll('.edit-btn').forEach(btn => {
                btn.addEventListener('click', () => editConfig(btn.dataset.id));
            });
            document.querySelectorAll('.delete-btn').forEach(btn => {
                btn.addEventListener('click', () => deleteConfig(btn.dataset.id));
            });

        } catch (err) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-red-500">Failed to load.</td></tr>';
        }
    }

    function editConfig(id) {
        document.getElementById('editingConfigId').value = id;
        switchTab('new');
        fetchMetadata(id); // Smart Re-fetch using config ID
    }

    async function deleteConfig(id) {
        if (!confirm('Are you sure you want to delete this configuration?')) return;
        try {
            const res = await fetch(`/api/distributor/delete-config/${id}`, { method: 'DELETE' });
            if (res.ok) loadConfigs();
            else alert('Delete failed.');
        } catch (e) { alert('Error deleting.'); }
    }

    function setLoading(btn, isLoading, text) {
        if (isLoading) {
            btn.disabled = true;
            btn.dataset.originalText = btn.innerHTML;
            btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${text}`;
        } else {
            btn.disabled = false;
            btn.innerHTML = btn.dataset.originalText || text;
        }
    }
});
